"""
Local Filesystem Chunk Storage Adapter.
Saves encrypted chunks to local disk under data/chunks/<chunk_id>.tb01.
Zero external dependencies, ideal for offline self-hosting.
"""

from __future__ import annotations
import logging
from pathlib import Path
from local_server.storage.base import BaseStorage, StorageSaveResult

logger = logging.getLogger("telebook.storage.local_disk")


class LocalDiskStorage(BaseStorage):
    def __init__(self, storage_dir: str = "./data/chunks"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    async def save_chunk(self, chunk_id: str, data: bytes, filename: str) -> StorageSaveResult:
        file_path = self.storage_dir / f"{chunk_id}.tb01"
        file_path.write_bytes(data)
        logger.debug(f"Saved chunk {chunk_id} to {file_path}")
        return StorageSaveResult(file_id=chunk_id, message_id=0)

    async def get_chunk(self, file_id_or_path: str) -> bytes:
        file_path = self.storage_dir / f"{file_id_or_path}.tb01"
        if not file_path.is_file():
            # Check if direct filename was passed
            direct_path = self.storage_dir / file_id_or_path
            if direct_path.is_file():
                return direct_path.read_bytes()
            raise FileNotFoundError(f"Chunk file not found: {file_id_or_path}")
        return file_path.read_bytes()

    async def delete_chunk(self, file_id_or_path: str) -> bool:
        file_path = self.storage_dir / f"{file_id_or_path}.tb01"
        if file_path.is_file():
            file_path.unlink()
            return True
        return False
