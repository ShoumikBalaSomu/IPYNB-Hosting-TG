"""
Configuration settings for TeleBook Local Server.
"""

from __future__ import annotations
import os
import secrets
from pathlib import Path
from typing import Optional
from pydantic import BaseModel


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8000
    db_path: str = "./data/telebook.db"
    storage_dir: str = "./data/chunks"
    owner_telegram_id: Optional[int] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    telegram_api_url: str = "https://api.telegram.org"
    telegram_local_mode: bool = False
    storage_mode: str = "auto"  # "auto" | "telegram" | "local"
    secret_key: str = ""
    bot_username: str = "TeleBookBot"
    enable_bot_poller: bool = False
    watch_dir: Optional[str] = None
    watch_passkey: Optional[str] = None


def load_server_config() -> ServerConfig:
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    db_path = os.getenv("DB_PATH", "./data/telebook.db")
    storage_dir = os.getenv("STORAGE_DIR", "./data/chunks")

    owner_str = os.getenv("OWNER_TELEGRAM_ID")
    owner_telegram_id = int(owner_str) if owner_str and owner_str.strip().isdigit() else None

    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID") or (str(owner_telegram_id) if owner_telegram_id else None)
    api_url = os.getenv("TELEGRAM_API_URL", "https://api.telegram.org").rstrip("/")
    local_mode = os.getenv("TELEGRAM_LOCAL_MODE", "false").lower() in ("true", "1", "yes")

    storage_mode = os.getenv("STORAGE_MODE", "auto").lower()
    if storage_mode == "auto":
        storage_mode = "telegram" if bot_token else "local"

    secret_key = os.getenv("TELEBOOK_SECRET_KEY") or os.getenv("SECRET_KEY")
    if not secret_key:
        secret_key = secrets.token_hex(32)

    bot_username = os.getenv("BOT_USERNAME", "TeleBookBot")
    enable_poller = os.getenv("ENABLE_BOT_POLLER", "false").lower() in ("true", "1", "yes")
    watch_dir = os.getenv("WATCH_DIR")
    watch_passkey = os.getenv("WATCH_PASSKEY")

    return ServerConfig(
        host=host,
        port=port,
        db_path=db_path,
        storage_dir=storage_dir,
        owner_telegram_id=owner_telegram_id,
        telegram_bot_token=bot_token,
        telegram_chat_id=chat_id,
        telegram_api_url=api_url,
        telegram_local_mode=local_mode,
        storage_mode=storage_mode,
        secret_key=secret_key,
        bot_username=bot_username,
        enable_bot_poller=enable_poller,
        watch_dir=watch_dir,
        watch_passkey=watch_passkey,
    )


settings = load_server_config()
