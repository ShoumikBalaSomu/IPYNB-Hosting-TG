"""
Configuration manager for TeleBook CLI.
Persists settings in ~/.telebook/config.json with environment variable overrides.
"""

from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Optional

from telebook.models import TelebookConfig

CONFIG_DIR = Path.home() / ".telebook"
CONFIG_FILE = CONFIG_DIR / "config.json"


def get_config_path() -> Path:
    custom_path = os.getenv("TELEBOOK_CONFIG_PATH")
    if custom_path:
        return Path(custom_path)
    return CONFIG_FILE


def load_config() -> TelebookConfig:
    """
    Load configuration from disk, falling back to environment variables.
    """
    config_data = {}
    config_file = get_config_path()
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                config_data = json.load(f)
        except Exception:
            config_data = {}

    # Environment variable overrides
    server_url = os.getenv("TELEBOOK_SERVER_URL") or config_data.get("server_url", "http://localhost:8000")
    session_token = os.getenv("TELEBOOK_SESSION_TOKEN") or config_data.get("session_token")
    passkey = os.getenv("TELEBOOK_PASSKEY") or config_data.get("passkey")
    
    owner_str = os.getenv("OWNER_TELEGRAM_ID")
    owner_telegram_id = int(owner_str) if owner_str and owner_str.isdigit() else config_data.get("owner_telegram_id")
    default_dir = os.getenv("TELEBOOK_DEFAULT_DIR") or config_data.get("default_dir")

    return TelebookConfig(
        server_url=server_url.rstrip("/"),
        session_token=session_token,
        passkey=passkey,
        owner_telegram_id=owner_telegram_id,
        default_dir=default_dir,
    )


def save_config(config: TelebookConfig) -> None:
    """
    Save configuration to disk with restricted permissions (0600).
    """
    config_file = get_config_path()
    config_file.parent.mkdir(parents=True, exist_ok=True)

    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(config.model_dump(), f, indent=2)

    try:
        os.chmod(config_file, 0o600)
    except OSError:
        pass


def update_config(**kwargs) -> TelebookConfig:
    """
    Update specific keys in config and save.
    """
    cfg = load_config()
    data = cfg.model_dump()
    for k, v in kwargs.items():
        if v is not None:
            data[k] = v
    new_cfg = TelebookConfig(**data)
    save_config(new_cfg)
    return new_cfg
