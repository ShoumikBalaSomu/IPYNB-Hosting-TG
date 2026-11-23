"""
Local Telegram Bot API Adapter.
Connects to a self-hosted telegram-bot-api instance, unlocking up to 2 GB file transfers
and optional local disk path reading (--local mode).
"""

from __future__ import annotations
import logging
from pathlib import Path
from typing import Optional
import httpx

from local_server.storage.telegram_adapter import TelegramAdapter, TelegramStorageError
from local_server.storage.base import StorageSaveResult

logger = logging.getLogger("telebook.storage.local_bot_api")


class LocalBotApiAdapter(TelegramAdapter):
    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        api_url: str = "http://localhost:8081",
        local_mode: bool = False,
        timeout: float = 120.0,
    ):
        super().__init__(
            bot_token=bot_token,
            chat_id=chat_id,
            api_url=api_url,
            timeout=timeout,
        )
        self.local_mode = local_mode

    async def get_chunk(self, file_id_or_path: str) -> bytes:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            info_url = f"{self.base_bot_url}/getFile"
            res = await self._get_with_retry(client, info_url, params={"file_id": file_id_or_path})
            if res.status_code != 200 or not res.json().get("ok"):
                raise TelegramStorageError(f"Failed to get file info from Local Bot API: {res.text}")

            file_path_str = res.json()["result"]["file_path"]

            # If running in --local mode, file_path may be an absolute local disk path
            if self.local_mode:
                local_path = Path(file_path_str)
                if local_path.is_file():
                    logger.info(f"Direct local disk read enabled: {local_path}")
                    return local_path.read_bytes()

            # Otherwise download via HTTP from the local Bot API instance
            dl_url = f"{self.file_bot_url}/{file_path_str}"
            dl_res = await self._get_with_retry(client, dl_url)
            if dl_res.status_code != 200:
                raise TelegramStorageError(f"Failed downloading from Local Bot API: {dl_res.status_code}")

            return dl_res.content
