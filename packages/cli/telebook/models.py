"""
Data models and schemas for TeleBook CLI and client.
"""

from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field


class MagicTokenInitResponse(BaseModel):
    token_id: str
    deep_link: str
    expires_at: int


class MagicTokenStatusResponse(BaseModel):
    status: str  # "pending" | "approved" | "expired"
    session_token: Optional[str] = None
    expires_at: Optional[int] = None


class NotebookSummary(BaseModel):
    id: str
    title: str
    description: str = ""
    current_version: int = 1
    total_chunks: int = 1
    byte_size: int = 0
    tags: List[str] = Field(default_factory=list)
    is_starred: bool = False
    updated_at: int = 0


class NotebookListResponse(BaseModel):
    notebooks: List[NotebookSummary] = Field(default_factory=list)


class ChunkManifestItem(BaseModel):
    chunk_index: int
    chunk_hash: str
    byte_length: int
    download_url: str


class VersionManifest(BaseModel):
    notebook_id: str
    version: int
    total_chunks: int
    byte_size: int
    commit_message: str = ""
    sha256_hash: str
    chunks: List[ChunkManifestItem] = Field(default_factory=list)


class ChunkUploadResponse(BaseModel):
    chunk_index: int
    telegram_file_id: Optional[str] = None
    status: str = "stored"


class RevokeResponse(BaseModel):
    revoked: bool
    new_epoch: int


class TelebookConfig(BaseModel):
    server_url: str = "http://localhost:8000"
    session_token: Optional[str] = None
    passkey: Optional[str] = None
    owner_telegram_id: Optional[int] = None
    default_dir: Optional[str] = None
