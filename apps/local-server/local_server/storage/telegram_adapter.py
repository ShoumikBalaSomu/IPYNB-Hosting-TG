"""
Standard Telegram Bot API Storage Adapter.
Implements chunk upload/download via Telegram Bot API with 429 rate limit backoff.
"""

from __future__ import annotations
import asyncio
import logging
from typing import Optional
import httpx

from local_server.storage.base import BaseStorage, StorageSaveResult

logger = logging.getLogger("telebook.storage.telegram")


class TelegramStorageError(Exception):
    pass


class TelegramAdapter(BaseStorage):
    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        api_url: str = "https://api.telegram.org",
        max_retries: int = 3,
        timeout: float = 60.0,
    ):
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.api_url = api_url.rstrip("/")
        self.max_retries = max_retries
        self.timeout = timeout
        self.base_bot_url = f"{self.api_url}/bot{self.bot_token}"
        self.file_bot_url = f"{self.api_url}/file/bot{self.bot_token}"

    async def _post_with_retry(self, client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
        for attempt in range(self.max_retries):
            res = await client.post(url, **kwargs)
            if res.status_code == 429:
                retry_after = 2.0
                try:
                    retry_after = float(res.json().get("parameters", {}).get("retry_after", 2.0))
                except Exception:
                    pass
                logger.warning(f"Telegram 429 Too Many Requests. Retrying after {retry_after}s...")
                await asyncio.sleep(retry_after)
                continue
            return res
        return res

    async def _get_with_retry(self, client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
        for attempt in range(self.max_retries):
            res = await client.get(url, **kwargs)
            if res.status_code == 429:
                retry_after = 2.0
                try:
                    retry_after = float(res.json().get("parameters", {}).get("retry_after", 2.0))
                except Exception:
                    pass
                logger.warning(f"Telegram 429 Too Many Requests. Retrying after {retry_after}s...")
                await asyncio.sleep(retry_after)
                continue
            return res
        return res

    async def save_chunk(self, chunk_id: str, data: bytes, filename: str) -> StorageSaveResult:
        url = f"{self.base_bot_url}/sendDocument"
        files = {"document": (filename, data, "application/octet-stream")}
        data_payload = {"chat_id": self.chat_id, "caption": f"TeleBook chunk: {chunk_id}"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            res = await self._post_with_retry(client, url, data=data_payload, files=files)
            if res.status_code != 200 or not res.json().get("ok"):
                raise TelegramStorageError(f"Failed to upload chunk to Telegram: {res.text}")

            result = res.json()["result"]
            file_id = result["document"]["file_id"]
            message_id = result.get("message_id", 0)
            return StorageSaveResult(file_id=file_id, message_id=message_id)

    async def get_chunk(self, file_id_or_path: str) -> bytes:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # 1. Resolve file_path via getFile
            info_url = f"{self.base_bot_url}/getFile"
            res = await self._get_with_retry(client, info_url, params={"file_id": file_id_or_path})
            if res.status_code != 200 or not res.json().get("ok"):
                raise TelegramStorageError(f"Failed to get file info from Telegram: {res.text}")

            file_path = res.json()["result"]["file_path"]

            # 2. Download file content
            dl_url = f"{self.file_bot_url}/{file_path}"
            dl_res = await self._get_with_retry(client, dl_url)
            if dl_res.status_code != 200:
                raise TelegramStorageError(f"Failed to download chunk from Telegram: {dl_res.status_code}")

            return dl_res.content

    async def delete_chunk(self, file_id_or_path: str) -> bool:
        # Telegram Bot API does not permit deleting files by file_id directly, only messages
        return True
