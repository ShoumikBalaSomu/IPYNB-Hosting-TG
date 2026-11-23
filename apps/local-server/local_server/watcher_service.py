"""
Local Folder Watcher Service for TeleBook Local Server.
Monitors configured WATCH_DIR and automatically syncs notebooks to local database/storage.
"""

from __future__ import annotations
import asyncio
import hashlib
import logging
from pathlib import Path
from typing import Optional

from telebook.crypto import encrypt_notebook
from telebook.watcher import DirectoryWatcher
from local_server.auth import AuthManager
from local_server.config import ServerConfig
from local_server.storage.base import BaseStorage

logger = logging.getLogger("telebook.server.watcher")


class WatcherService:
    def __init__(
        self,
        auth_manager: AuthManager,
        storage: BaseStorage,
        config: ServerConfig,
    ):
        self.auth_manager = auth_manager
        self.storage = storage
        self.config = config
        self._watcher: Optional[DirectoryWatcher] = None
        self._task: Optional[asyncio.Task] = None

    def start(self):
        if not self.config.watch_dir:
            return
        watch_path = Path(self.config.watch_dir).resolve()
        if not watch_path.exists():
            watch_path.mkdir(parents=True, exist_ok=True)

        logger.info(f"Starting server-level directory watcher on: {watch_path}")
        self._watcher = DirectoryWatcher(
            watch_dir=watch_path,
            on_change_callback=self._handle_file_change,
        )
        self._task = asyncio.create_task(self._watcher.run())

    def stop(self):
        if self._watcher:
            self._watcher.stop()
        if self._task:
            self._task.cancel()
        logger.info("Server-level directory watcher stopped.")

    def _handle_file_change(self, file_path: Path):
        try:
            raw_bytes = file_path.read_bytes()
            passkey = self.config.watch_passkey or "default-local-passkey"
            owner_id = self.config.owner_telegram_id or 1000000001
            user = self.auth_manager.db.get_or_create_user(owner_id, username="owner")

            stem = file_path.stem
            nb_id = f"nb_{stem.lower()}"
            title = stem.replace("_", " ").title()
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()

            # Check existing version
            cur_ver = 1
            existing = self.auth_manager.db.get_notebook(nb_id)
            if existing:
                cur_ver = existing["current_version"] + 1

            self.auth_manager.db.upsert_notebook(nb_id, user["id"], title)

            chunks = encrypt_notebook(
                notebook_bytes=raw_bytes,
                passkey=passkey,
                notebook_id=nb_id,
                version=cur_ver,
            )

            # Store chunks synchronously/in event loop
            loop = asyncio.get_event_loop()
            for c in chunks:
                chunk_id = f"chk_{nb_id}_v{cur_ver}_{c.chunk_index}"
                save_res = asyncio.run_coroutine_threadsafe(
                    self.storage.save_chunk(chunk_id, c.binary_data, f"{chunk_id}.tb01"),
                    loop,
                ).result(timeout=15.0)

                self.auth_manager.db.record_chunk(
                    chunk_id=chunk_id,
                    notebook_id=nb_id,
                    version=cur_ver,
                    chunk_index=c.chunk_index,
                    total_chunks=len(chunks),
                    telegram_file_id=save_res.file_id,
                    telegram_message_id=save_res.message_id,
                    chunk_hash=c.chunk_hash,
                    byte_length=c.byte_length,
                )

            self.auth_manager.db.check_and_finalize_version(
                notebook_id=nb_id,
                version=cur_ver,
                total_chunks=len(chunks),
                sha256_hash=raw_hash,
                commit_message="Server watcher auto-sync",
            )
            logger.info(f"Watcher auto-synced {file_path.name} to {nb_id} v{cur_ver}")
        except Exception as e:
            logger.error(f"Watcher sync failed for {file_path}: {e}")
