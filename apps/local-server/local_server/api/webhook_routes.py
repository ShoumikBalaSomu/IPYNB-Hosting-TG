"""
Telegram Webhook Handler.
Processes bot updates: /start auth_<token>, /list, /search, /revoke, and document events.
"""

from __future__ import annotations
import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, Header, HTTPException, Request, status
import httpx

from local_server.auth import AuthManager
from local_server.config import ServerConfig

logger = logging.getLogger("telebook.webhook")


def create_webhook_router(auth_manager: AuthManager, config: ServerConfig) -> APIRouter:
    router = APIRouter(prefix="/api/webhook", tags=["webhook"])

    async def send_bot_reply(chat_id: int | str, text: str):
        if not config.telegram_bot_token:
            return
        url = f"{config.telegram_api_url}/bot{config.telegram_bot_token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})
        except Exception as e:
            logger.error(f"Failed sending telegram reply: {e}")

    @router.post("", status_code=status.HTTP_200_OK)
    async def handle_telegram_update(
        request: Request,
        x_telegram_bot_api_secret_token: Optional[str] = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
    ):
        update: Dict[str, Any] = await request.json()
        message = update.get("message")
        if not message:
            return {"ok": True}

        from_user = message.get("from", {})
        sender_id = from_user.get("id")
        chat_id = message.get("chat", {}).get("id")
        text = (message.get("text") or "").strip()

        # Strict Single-Owner Gate
        if config.owner_telegram_id is not None and sender_id != config.owner_telegram_id:
            logger.warning(f"Rejected update from unauthorized sender: {sender_id}")
            if chat_id:
                await send_bot_reply(chat_id, "⛔ *Access Denied*: You are not the configured single owner of this TeleBook instance.")
            return {"ok": True}

        # Ensure user exists in DB
        user = auth_manager.db.get_or_create_user(sender_id, username=from_user.get("username", ""))

        # 1. /start auth_<token_id>
        if text.startswith("/start auth_"):
            token_id = text.replace("/start auth_", "").strip()
            token_rec = auth_manager.db.get_magic_token(token_id)
            if not token_rec:
                await send_bot_reply(chat_id, "❌ *Authorization Failed*: Magic token expired or invalid.")
                return {"ok": True}

            jwt_token = auth_manager.create_session_jwt(user)
            auth_manager.db.approve_magic_token(token_id, jwt_token)
            await send_bot_reply(
                chat_id,
                "✅ *Terminal Authorized Successfully!*\n\n"
                "Your CLI session is active. You can now push and pull notebooks."
            )
            return {"ok": True}

        # 2. /list
        if text == "/list":
            notebooks = auth_manager.db.list_notebooks(user_id=user["id"])
            if not notebooks:
                await send_bot_reply(chat_id, "📂 No notebooks found in your TeleBook library.")
            else:
                lines = ["📚 *Your TeleBook Notebooks:*"]
                for nb in notebooks[:15]:
                    lines.append(f"• `{nb['id']}`: *{nb['title']}* (v{nb['current_version']})")
                await send_bot_reply(chat_id, "\n".join(lines))
            return {"ok": True}

        # 3. /search <query>
        if text.startswith("/search"):
            query = text.replace("/search", "").strip()
            results = auth_manager.db.list_notebooks(user_id=user["id"], search=query)
            if not results:
                await send_bot_reply(chat_id, f"🔍 No notebooks matching *'{query}'*.")
            else:
                lines = [f"🔍 *Results for '{query}':*"]
                for nb in results[:10]:
                    lines.append(f"• `{nb['id']}`: *{nb['title']}* (v{nb['current_version']})")
                await send_bot_reply(chat_id, "\n".join(lines))
            return {"ok": True}

        # 4. /revoke
        if text == "/revoke":
            new_epoch = auth_manager.db.bump_auth_epoch(user["id"])
            await send_bot_reply(
                chat_id,
                f"🔒 *Global Session Revocation Complete!*\n\n"
                f"User auth epoch bumped to `{new_epoch}`. All issued CLI and browser sessions have been revoked."
            )
            return {"ok": True}

        # 5. Default help
        if text == "/start" or text == "/help":
            await send_bot_reply(
                chat_id,
                "👋 *Welcome to TeleBook Sovereign Storage*\n\n"
                "Available commands:\n"
                "• `/list` - View your hosted notebooks\n"
                "• `/search <query>` - Find notebooks by title or tag\n"
                "• `/revoke` - Invalidate all active sessions globally\n\n"
                "Use the `telebook` CLI on your workstation to encrypt (`TELEBOOK_V1`) and push notebooks."
            )
            return {"ok": True}

        return {"ok": True}

    return router
