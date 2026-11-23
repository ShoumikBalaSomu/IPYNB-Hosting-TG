"""
Abstract base class for TeleBook chunk storage backends.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class StorageSaveResult:
    file_id: str
    message_id: int = 0


class BaseStorage(ABC):
    @abstractmethod
    async def save_chunk(self, chunk_id: str, data: bytes, filename: str) -> StorageSaveResult:
        """Store encrypted binary chunk and return file identifiers."""
        pass

    @abstractmethod
    async def get_chunk(self, file_id_or_path: str) -> bytes:
        """Retrieve binary chunk data using file identifier."""
        pass

    @abstractmethod
    async def delete_chunk(self, file_id_or_path: str) -> bool:
        """Delete chunk if supported."""
        pass
