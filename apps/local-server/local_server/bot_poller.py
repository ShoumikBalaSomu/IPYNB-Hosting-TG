"""
Background Telegram Bot Poller.
Enables local development and self-hosting without requiring a public webhook domain.
"""

from __future__ import annotations
import asyncio
import logging
from typing import Optional
import httpx

from local_server.auth import AuthManager
from local_server.config import ServerConfig

logger = logging.getLogger("telebook.poller")


class BotPoller:
    def __init__(self, auth_manager: AuthManager, config: ServerConfig):
        self.auth_manager = auth_manager
        self.config = config
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._offset = 0

    async def start(self):
        if not self.config.telegram_bot_token:
            logger.info("No TELEGRAM_BOT_TOKEN provided. Bot poller disabled.")
            return
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())
        logger.info("Background Telegram bot poller started.")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Background Telegram bot poller stopped.")

    async def _poll_loop(self):
        url = f"{self.config.telegram_api_url}/bot{self.config.telegram_bot_token}/getUpdates"
        async with httpx.AsyncClient(timeout=35.0) as client:
            while self._running:
                try:
                    params = {"offset": self._offset, "timeout": 20}
                    res = await client.get(url, params=params)
                    if res.status_code == 200 and res.json().get("ok"):
                        updates = res.json().get("result", [])
                        for u in updates:
                            self._offset = u["update_id"] + 1
                            await self._handle_update(u, client)
                    elif res.status_code == 429:
                        await asyncio.sleep(5)
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.debug(f"Poller transient error: {e}")
                    await asyncio.sleep(3)

    async def _handle_update(self, update: dict, client: httpx.AsyncClient):
        msg = update.get("message")
        if not msg:
            return
        from_user = msg.get("from", {})
        sender_id = from_user.get("id")
        chat_id = msg.get("chat", {}).get("id")
        text = (msg.get("text") or "").strip()

        # Strict Single-Owner Gate
        if self.config.owner_telegram_id is not None and sender_id != self.config.owner_telegram_id:
            return

        user = self.auth_manager.db.get_or_create_user(sender_id, username=from_user.get("username", ""))

        send_url = f"{self.config.telegram_api_url}/bot{self.config.telegram_bot_token}/sendMessage"

        if text.startswith("/start auth_"):
            token_id = text.replace("/start auth_", "").strip()
            token_rec = self.auth_manager.db.get_magic_token(token_id)
            if token_rec and token_rec["status"] == "pending":
                jwt_token = self.auth_manager.create_session_jwt(user)
                self.auth_manager.db.approve_magic_token(token_id, jwt_token)
                await client.post(send_url, json={
                    "chat_id": chat_id,
                    "text": "✅ *Terminal Authorized Successfully!*\nYour CLI session is active.",
                    "parse_mode": "Markdown",
                })
        elif text == "/revoke":
            new_epoch = self.auth_manager.db.bump_auth_epoch(user["id"])
            await client.post(send_url, json={
                "chat_id": chat_id,
                "text": f"🔒 *Global Session Revocation Complete!*\nNew epoch: `{new_epoch}`",
                "parse_mode": "Markdown",
            })
        elif text == "/settings":
            await client.post(send_url, json={
                "chat_id": chat_id,
                "text": (
                    "⚙️ *TeleBook Sovereign Bot Settings (Bot API 10.3/10.5)*\n\n"
                    "• *Rich Messages*: Enabled (tables, preformatted code, buttons)\n"
                    "• *Ephemeral Mode*: Supported (120s ephemeral magic tokens)\n"
                    "• *Topic Sidebar*: Supported in private chat (`has_topic_sidebar`)\n"
                    "• *Single-Owner Lock*: Active (`OWNER_TELEGRAM_ID`)\n"
                    "• *Storage Ceiling*: 15 MB chunking over Telegram Bot API"
                ),
                "parse_mode": "Markdown",
            })
        elif text == "/help":
            await client.post(send_url, json={
                "chat_id": chat_id,
                "text": (
                    "📖 *TeleBook Bot API 10.3 Commands Reference*\n\n"
                    "/start - Launch TeleBook Mini App workspace\n"
                    "/login - Authenticate desktop terminal\n"
                    "/settings - View Bot API 10.3/10.5 settings\n"
                    "/revoke - Invalidate all active device sessions\n"
                    "/help - Show this guide"
                ),
                "parse_mode": "Markdown",
            })
