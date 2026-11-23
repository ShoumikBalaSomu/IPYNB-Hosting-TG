"""
Authentication API Endpoints.
Implements 120-second ephemeral magic token login and session epoch revocation.
"""

from __future__ import annotations
import hashlib
import secrets
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from local_server.auth import AuthManager, bearer_scheme
from local_server.config import ServerConfig


class MagicTokenRequest(BaseModel):
    pass


class MagicTokenApproveRequest(BaseModel):
    token_id: str
    telegram_id: Optional[int] = None


def create_auth_router(auth_manager: AuthManager, config: ServerConfig) -> APIRouter:
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    @router.post("/magic-token", status_code=status.HTTP_201_CREATED)
    async def request_magic_token():
        token_id = secrets.token_hex(16)
        token_hash = hashlib.sha256(token_id.encode("ascii")).hexdigest()
        expires_at = int(time.time()) + 120  # 120s TTL

        auth_manager.db.create_magic_token(token_id, token_hash, expires_at)
        deep_link = f"https://t.me/{config.bot_username}?start=auth_{token_id}"

        return {
            "token_id": token_id,
            "deep_link": deep_link,
            "expires_at": expires_at,
        }

    @router.get("/magic-token/{token_id}")
    async def get_magic_token_status(token_id: str):
        record = auth_manager.db.get_magic_token(token_id)
        if not record:
            raise HTTPException(status_code=404, detail="Magic token not found")

        status_val = record["status"]
        if status_val == "approved":
            return {
                "status": "approved",
                "session_token": record["session_jwt"],
                "expires_at": record["expires_at"],
            }
        return {"status": status_val}

    @router.post("/approve-magic-token")
    async def approve_magic_token(req: MagicTokenApproveRequest):
        """
        Internal or bot callback endpoint to approve a pending magic token.
        """
        token_id = req.token_id
        record = auth_manager.db.get_magic_token(token_id)
        if not record:
            raise HTTPException(status_code=404, detail="Magic token not found")

        if record["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Token is already {record['status']}")

        # Determine user telegram_id
        target_tg_id = req.telegram_id or config.owner_telegram_id or 1000000001
        auth_manager.assert_owner_telegram_id(target_tg_id)

        user = auth_manager.db.get_or_create_user(target_tg_id, username="owner")
        jwt_token = auth_manager.create_session_jwt(user)

        success = auth_manager.db.approve_magic_token(token_id, jwt_token)
        if not success:
            raise HTTPException(status_code=400, detail="Failed to approve token")

        return {"approved": True, "token_id": token_id}

    @router.post("/revoke")
    async def revoke_sessions(credentials=Depends(bearer_scheme)):
        if not credentials:
            raise HTTPException(status_code=401, detail="Authentication credentials required")
        user = auth_manager.verify_request_auth(credentials.credentials)
        new_epoch = auth_manager.db.bump_auth_epoch(user["id"])
        return {"revoked": True, "new_epoch": new_epoch}

    return router
