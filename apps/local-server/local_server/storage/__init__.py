"""
Storage factory and backends.
"""

from local_server.config import ServerConfig
from local_server.storage.base import BaseStorage, StorageSaveResult
from local_server.storage.telegram_adapter import TelegramAdapter
from local_server.storage.local_bot_api import LocalBotApiAdapter
from local_server.storage.local_disk import LocalDiskStorage


def get_storage_engine(config: ServerConfig) -> BaseStorage:
    """
    Select appropriate storage backend based on configuration.
    """
    if config.storage_mode == "telegram" and config.telegram_bot_token and config.telegram_chat_id:
        if "api.telegram.org" in config.telegram_api_url:
            return TelegramAdapter(
                bot_token=config.telegram_bot_token,
                chat_id=config.telegram_chat_id,
                api_url=config.telegram_api_url,
            )
        else:
            return LocalBotApiAdapter(
                bot_token=config.telegram_bot_token,
                chat_id=config.telegram_chat_id,
                api_url=config.telegram_api_url,
                local_mode=config.telegram_local_mode,
            )
    return LocalDiskStorage(storage_dir=config.storage_dir)


__all__ = [
    "BaseStorage",
    "StorageSaveResult",
    "TelegramAdapter",
    "LocalBotApiAdapter",
    "LocalDiskStorage",
    "get_storage_engine",
]
