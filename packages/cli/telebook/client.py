"""
HTTP client for communicating with TeleBook API (Cloudflare Worker or Local Server).
"""

from __future__ import annotations
import urllib.parse
from typing import Any, Dict, List, Optional
import httpx

from telebook.models import (
    MagicTokenInitResponse,
    MagicTokenStatusResponse,
    NotebookListResponse,
    NotebookSummary,
    VersionManifest,
    ChunkUploadResponse,
    RevokeResponse,
)


class TelebookClientError(Exception):
    """Base exception for TeleBook API client errors."""
    pass


class UnauthorizedError(TelebookClientError):
    """Raised on 401 Unauthorized or 403 Forbidden."""
    pass


class NotFoundError(TelebookClientError):
    """Raised on 404 Not Found."""
    pass


class ServerError(TelebookClientError):
    """Raised on 5xx server errors."""
    pass


class TelebookClient:
    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        session_token: Optional[str] = None,
        timeout: float = 60.0,
        http_client: Optional[httpx.Client] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.session_token = session_token
        self.timeout = timeout
        self._custom_client = http_client
        self._client: Optional[httpx.Client] = None

    @property
    def client(self) -> httpx.Client:
        if self._custom_client is not None:
            return self._custom_client
        if self._client is None or self._client.is_closed:
            headers = {"User-Agent": "TeleBook-CLI/1.0.0"}
            if self.session_token:
                headers["Authorization"] = f"Bearer {self.session_token}"
            self._client = httpx.Client(
                base_url=self.base_url,
                headers=headers,
                timeout=self.timeout,
                follow_redirects=True,
            )
        return self._client

    def set_session_token(self, token: str) -> None:
        self.session_token = token
        if self._client and not self._client.is_closed:
            self._client.headers["Authorization"] = f"Bearer {token}"

    def close(self) -> None:
        if self._client and not self._client.is_closed:
            self._client.close()

    def __enter__(self) -> TelebookClient:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    def _handle_response_status(self, response: httpx.Response) -> None:
        if response.status_code in (401, 403):
            detail = ""
            try:
                detail = response.json().get("detail", "")
            except Exception:
                detail = response.text
            raise UnauthorizedError(
                f"Authentication failed ({response.status_code}): {detail or 'Invalid credentials or expired epoch.'}"
            )
        if response.status_code == 404:
            raise NotFoundError(f"Resource not found: {response.url.path}")
        if response.status_code >= 500:
            raise ServerError(f"Server error ({response.status_code}): {response.text}")
        response.raise_for_status()

    # ---------------- Auth endpoints ----------------

    def request_magic_token(self) -> MagicTokenInitResponse:
        """
        Request a 120s ephemeral magic login token.
        """
        res = self.client.post("/api/auth/magic-token", json={})
        self._handle_response_status(res)
        data = res.json()
        return MagicTokenInitResponse(**data)

    def check_magic_token(self, token_id: str) -> MagicTokenStatusResponse:
        """
        Poll status of an ephemeral magic token.
        """
        res = self.client.get(f"/api/auth/magic-token/{token_id}")
        self._handle_response_status(res)
        data = res.json()
        return MagicTokenStatusResponse(**data)

    def revoke_sessions(self) -> RevokeResponse:
        """
        Atomically increment user auth epoch to revoke all active sessions.
        """
        res = self.client.post("/api/auth/revoke")
        self._handle_response_status(res)
        return RevokeResponse(**res.json())

    # ---------------- Notebook endpoints ----------------

    def list_notebooks(
        self,
        search: Optional[str] = None,
        tag: Optional[str] = None,
        starred: Optional[bool] = None,
    ) -> NotebookListResponse:
        """
        Fetch all notebooks for owner, with optional search and tag filters.
        """
        params: Dict[str, Any] = {}
        if search:
            params["search"] = search
        if tag:
            params["tag"] = tag
        if starred is not None:
            params["starred"] = "true" if starred else "false"

        res = self.client.get("/api/notebooks", params=params)
        self._handle_response_status(res)
        return NotebookListResponse(**res.json())

    def get_notebook(self, notebook_id: str) -> NotebookSummary:
        """
        Get metadata for a single notebook.
        """
        res = self.client.get(f"/api/notebooks/{notebook_id}")
        self._handle_response_status(res)
        return NotebookSummary(**res.json())

    def create_or_update_notebook(
        self,
        notebook_id: str,
        title: str,
        description: str = "",
        tags: Optional[List[str]] = None,
        is_starred: bool = False,
    ) -> NotebookSummary:
        """
        Create or update notebook metadata entry.
        """
        payload = {
            "id": notebook_id,
            "title": title,
            "description": description,
            "tags": tags or [],
            "is_starred": is_starred,
        }
        res = self.client.post("/api/notebooks", json=payload)
        self._handle_response_status(res)
        return NotebookSummary(**res.json())

    def delete_notebook(self, notebook_id: str) -> Dict[str, Any]:
        """
        Delete a notebook and all associated versions/chunks.
        """
        res = self.client.delete(f"/api/notebooks/{notebook_id}")
        self._handle_response_status(res)
        return res.json()

    def get_version_manifest(self, notebook_id: str, version: int) -> VersionManifest:
        """
        Retrieve chunk manifest for a specific notebook version.
        """
        res = self.client.get(f"/api/notebooks/{notebook_id}/versions/{version}")
        self._handle_response_status(res)
        return VersionManifest(**res.json())

    def upload_chunk(
        self,
        notebook_id: str,
        version: int,
        chunk_index: int,
        binary_data: bytes,
        chunk_hash: str,
        total_chunks: int,
        title: str = "",
        commit_message: str = "",
        sha256_hash: str = "",
    ) -> ChunkUploadResponse:
        """
        Upload a single encrypted chunk to /api/notebooks/:id/versions/:v/chunks/:i
        """
        url = f"/api/notebooks/{notebook_id}/versions/{version}/chunks/{chunk_index}"
        headers = {
            "Content-Type": "application/octet-stream",
            "X-Chunk-Hash": chunk_hash,
            "X-Total-Chunks": str(total_chunks),
        }
        if title:
            # quote title to avoid ASCII header encode issues
            headers["X-Notebook-Title"] = urllib.parse.quote(title)
        if commit_message:
            headers["X-Commit-Message"] = urllib.parse.quote(commit_message)
        if sha256_hash:
            headers["X-Decrypted-Hash"] = sha256_hash

        res = self.client.post(url, content=binary_data, headers=headers)
        self._handle_response_status(res)
        return ChunkUploadResponse(**res.json())

    def download_chunk(self, download_url: str) -> bytes:
        """
        Download encrypted chunk binary payload.
        Handles relative or absolute URLs.
        """
        if download_url.startswith("http://") or download_url.startswith("https://"):
            res = self.client.get(download_url)
        else:
            if not download_url.startswith("/"):
                download_url = "/" + download_url
            res = self.client.get(download_url)
        self._handle_response_status(res)
        return res.content
