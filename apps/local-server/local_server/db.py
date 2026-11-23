"""
SQLite Database Layer for TeleBook Local Server.
Matches Cloudflare D1 schema and performance index structure.
"""

from __future__ import annotations
import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    auth_epoch INTEGER DEFAULT 1 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    current_version INTEGER DEFAULT 1 NOT NULL,
    is_starred INTEGER DEFAULT 0 NOT NULL,
    tags TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notebook_versions (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    byte_size INTEGER NOT NULL,
    commit_message TEXT DEFAULT '',
    sha256_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    UNIQUE(notebook_id, version)
);

CREATE TABLE IF NOT EXISTS notebook_chunks (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    chunk_hash TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    UNIQUE(notebook_id, version, chunk_index)
);

CREATE TABLE IF NOT EXISTS magic_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    session_jwt TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    epoch INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Performance indices
CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_lookup ON notebook_versions(notebook_id, version);
CREATE INDEX IF NOT EXISTS idx_chunks_lookup ON notebook_chunks(notebook_id, version, chunk_index);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON magic_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_epoch ON sessions(user_id, epoch);
"""


class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_dir()
        self.init_schema()

    def _ensure_dir(self) -> None:
        p = Path(self.db_path)
        if p.parent != Path("."):
            p.parent.mkdir(parents=True, exist_ok=True)

    def get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def init_schema(self) -> None:
        with self.get_connection() as conn:
            conn.executescript(SCHEMA_SQL)

    # ---------------- User & Epoch operations ----------------

    def get_or_create_user(self, telegram_id: int, username: str = "") -> Dict[str, Any]:
        now = int(time.time())
        user_id = f"usr_{telegram_id}"
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            cursor.execute(
                """
                INSERT INTO users (id, telegram_id, username, auth_epoch, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?)
                """,
                (user_id, telegram_id, username, now, now),
            )
            cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            return dict(cursor.fetchone())

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    def get_user_by_telegram_id(self, telegram_id: int) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
            return dict(row) if row else None

    def bump_auth_epoch(self, user_id: str) -> int:
        now = int(time.time())
        with self.get_connection() as conn:
            conn.execute(
                "UPDATE users SET auth_epoch = auth_epoch + 1, updated_at = ? WHERE id = ?",
                (now, user_id),
            )
            row = conn.execute("SELECT auth_epoch FROM users WHERE id = ?", (user_id,)).fetchone()
            return row["auth_epoch"] if row else 1

    # ---------------- Magic Token operations ----------------

    def create_magic_token(self, token_id: str, token_hash: str, expires_at: int) -> Dict[str, Any]:
        now = int(time.time())
        with self.get_connection() as conn:
            conn.execute(
                """
                INSERT INTO magic_tokens (id, token_hash, status, session_jwt, expires_at, created_at)
                VALUES (?, ?, 'pending', NULL, ?, ?)
                """,
                (token_id, token_hash, expires_at, now),
            )
        return {"id": token_id, "token_hash": token_hash, "status": "pending", "expires_at": expires_at}

    def get_magic_token(self, token_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM magic_tokens WHERE id = ?", (token_id,)).fetchone()
            if not row:
                return None
            data = dict(row)
            # Check expiration
            if data["status"] == "pending" and int(time.time()) > data["expires_at"]:
                conn.execute("UPDATE magic_tokens SET status = 'expired' WHERE id = ?", (token_id,))
                data["status"] = "expired"
            return data

    def approve_magic_token(self, token_id: str, session_jwt: str) -> bool:
        with self.get_connection() as conn:
            cursor = conn.execute(
                """
                UPDATE magic_tokens
                SET status = 'approved', session_jwt = ?
                WHERE id = ? AND status = 'pending'
                """,
                (session_jwt, token_id),
            )
            return cursor.rowcount > 0

    def delete_magic_token(self, token_id: str) -> None:
        with self.get_connection() as conn:
            conn.execute("DELETE FROM magic_tokens WHERE id = ?", (token_id,))

    # ---------------- Notebooks ----------------

    def list_notebooks(
        self,
        user_id: Optional[str] = None,
        search: Optional[str] = None,
        tag: Optional[str] = None,
        starred: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        query = "SELECT * FROM notebooks WHERE 1=1"
        params: List[Any] = []

        if user_id:
            query += " AND user_id = ?"
            params.append(user_id)

        if starred is not None:
            query += " AND is_starred = ?"
            params.append(1 if starred else 0)

        query += " ORDER BY updated_at DESC"

        with self.get_connection() as conn:
            rows = conn.execute(query, params).fetchall()
            results = []
            for r in rows:
                item = dict(r)
                # Parse tags
                try:
                    item["tags"] = json.loads(item.get("tags") or "[]")
                except Exception:
                    item["tags"] = []

                # Client search filter
                if search:
                    s_lower = search.lower()
                    title_match = s_lower in item.get("title", "").lower()
                    desc_match = s_lower in item.get("description", "").lower()
                    tag_match = any(s_lower in t.lower() for t in item["tags"])
                    if not (title_match or desc_match or tag_match):
                        continue

                if tag:
                    t_lower = tag.lower()
                    if not any(t_lower == t.lower() for t in item["tags"]):
                        continue

                # Get chunk and size stats from latest version
                v_row = conn.execute(
                    "SELECT total_chunks, byte_size FROM notebook_versions WHERE notebook_id = ? AND version = ?",
                    (item["id"], item["current_version"]),
                ).fetchone()

                if v_row:
                    item["total_chunks"] = v_row["total_chunks"]
                    item["byte_size"] = v_row["byte_size"]
                else:
                    item["total_chunks"] = 0
                    item["byte_size"] = 0

                item["is_starred"] = bool(item.get("is_starred", 0))
                results.append(item)
            return results

    def get_notebook(self, notebook_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM notebooks WHERE id = ?", (notebook_id,)).fetchone()
            if not row:
                return None
            data = dict(row)
            try:
                data["tags"] = json.loads(data.get("tags") or "[]")
            except Exception:
                data["tags"] = []
            data["is_starred"] = bool(data.get("is_starred", 0))

            v_row = conn.execute(
                "SELECT total_chunks, byte_size FROM notebook_versions WHERE notebook_id = ? AND version = ?",
                (data["id"], data["current_version"]),
            ).fetchone()
            if v_row:
                data["total_chunks"] = v_row["total_chunks"]
                data["byte_size"] = v_row["byte_size"]
            else:
                data["total_chunks"] = 0
                data["byte_size"] = 0
            return data

    def upsert_notebook(
        self,
        notebook_id: str,
        user_id: str,
        title: str,
        description: str = "",
        tags: Optional[List[str]] = None,
        is_starred: bool = False,
    ) -> Dict[str, Any]:
        now = int(time.time())
        tags_json = json.dumps(tags or [])
        with self.get_connection() as conn:
            existing = conn.execute("SELECT * FROM notebooks WHERE id = ?", (notebook_id,)).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE notebooks
                    SET title = ?, description = ?, tags = ?, is_starred = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (title, description, tags_json, 1 if is_starred else 0, now, notebook_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO notebooks (id, user_id, title, description, current_version, is_starred, tags, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
                    """,
                    (notebook_id, user_id, title, description, 1 if is_starred else 0, tags_json, now, now),
                )
        return self.get_notebook(notebook_id)

    def delete_notebook(self, notebook_id: str) -> bool:
        with self.get_connection() as conn:
            cursor = conn.execute("DELETE FROM notebooks WHERE id = ?", (notebook_id,))
            return cursor.rowcount > 0

    # ---------------- Versions & Chunks ----------------

    def record_chunk(
        self,
        chunk_id: str,
        notebook_id: str,
        version: int,
        chunk_index: int,
        total_chunks: int,
        telegram_file_id: str,
        telegram_message_id: int,
        chunk_hash: str,
        byte_length: int,
    ) -> None:
        now = int(time.time())
        with self.get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO notebook_chunks (
                    id, notebook_id, version, chunk_index, total_chunks,
                    telegram_file_id, telegram_message_id, chunk_hash, byte_length, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk_id,
                    notebook_id,
                    version,
                    chunk_index,
                    total_chunks,
                    telegram_file_id,
                    telegram_message_id,
                    chunk_hash,
                    byte_length,
                    now,
                ),
            )

    def get_chunk(self, notebook_id: str, version: int, chunk_index: int) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM notebook_chunks WHERE notebook_id = ? AND version = ? AND chunk_index = ?",
                (notebook_id, version, chunk_index),
            ).fetchone()
            return dict(row) if row else None

    def get_version_manifest(self, notebook_id: str, version: int) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            v_row = conn.execute(
                "SELECT * FROM notebook_versions WHERE notebook_id = ? AND version = ?",
                (notebook_id, version),
            ).fetchone()

            chunks_rows = conn.execute(
                "SELECT * FROM notebook_chunks WHERE notebook_id = ? AND version = ? ORDER BY chunk_index ASC",
                (notebook_id, version),
            ).fetchall()

            if not chunks_rows and not v_row:
                return None

            chunks_list = []
            total_bytes = 0
            for c in chunks_rows:
                c_dict = dict(c)
                total_bytes += c_dict["byte_length"]
                chunks_list.append({
                    "chunk_index": c_dict["chunk_index"],
                    "chunk_hash": c_dict["chunk_hash"],
                    "byte_length": c_dict["byte_length"],
                    "download_url": f"/api/notebooks/{notebook_id}/versions/{version}/chunks/{c_dict['chunk_index']}",
                })

            total_chunks = len(chunks_list)
            byte_size = v_row["byte_size"] if v_row else total_bytes
            sha256_hash = v_row["sha256_hash"] if v_row else ""
            commit_message = v_row["commit_message"] if v_row else ""

            return {
                "notebook_id": notebook_id,
                "version": version,
                "total_chunks": total_chunks,
                "byte_size": byte_size,
                "commit_message": commit_message,
                "sha256_hash": sha256_hash,
                "chunks": chunks_list,
            }

    def check_and_finalize_version(
        self,
        notebook_id: str,
        version: int,
        total_chunks: int,
        sha256_hash: str = "",
        commit_message: str = "",
    ) -> bool:
        """
        Check if all chunks for this version have been received.
        If so, register notebook_versions entry and bump notebooks.current_version.
        """
        now = int(time.time())
        with self.get_connection() as conn:
            rows = conn.execute(
                "SELECT chunk_index, byte_length FROM notebook_chunks WHERE notebook_id = ? AND version = ?",
                (notebook_id, version),
            ).fetchall()

            if len(rows) == total_chunks:
                total_bytes = sum(r["byte_length"] for r in rows)
                v_id = f"ver_{notebook_id}_{version}"
                conn.execute(
                    """
                    INSERT OR REPLACE INTO notebook_versions (
                        id, notebook_id, version, total_chunks, byte_size, commit_message, sha256_hash, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (v_id, notebook_id, version, total_chunks, total_bytes, commit_message, sha256_hash, now),
                )
                conn.execute(
                    """
                    UPDATE notebooks
                    SET current_version = MAX(current_version, ?), updated_at = ?
                    WHERE id = ?
                    """,
                    (version, now, notebook_id),
                )
                return True
        return False
