"""
Authentication, Session Epoch Verification, and Single-Owner Security Gate.
"""

from __future__ import annotations
import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional, Tuple

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from local_server.config import ServerConfig, settings
from local_server.db import Database

bearer_scheme = HTTPBearer(auto_error=False)


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def base64url_decode(s: str) -> bytes:
    padding = 4 - (len(s) % 4)
    if padding and padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def sign_jwt(payload: Dict[str, Any], secret_key: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h_b64 = base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    p_b64 = base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{h_b64}.{p_b64}".encode("ascii")
    sig = hmac.new(secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = base64url_encode(sig)
    return f"{h_b64}.{p_b64}.{sig_b64}"


def verify_jwt(token: str, secret_key: str) -> Dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT structure")
    h_b64, p_b64, sig_b64 = parts
    signing_input = f"{h_b64}.{p_b64}".encode("ascii")
    expected_sig = hmac.new(secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()
    actual_sig = base64url_decode(sig_b64)
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Invalid signature")

    payload = json.loads(base64url_decode(p_b64).decode("utf-8"))
    now = int(time.time())
    if "exp" in payload and payload["exp"] < now:
        raise ValueError("Token expired")
    return payload


class AuthManager:
    def __init__(self, db: Database, config: ServerConfig):
        self.db = db
        self.config = config

    def create_session_jwt(self, user: Dict[str, Any], ttl_seconds: int = 30 * 86400) -> str:
        now = int(time.time())
        payload = {
            "sub": user["id"],
            "telegram_id": user["telegram_id"],
            "epoch": user["auth_epoch"],
            "iat": now,
            "exp": now + ttl_seconds,
        }
        return sign_jwt(payload, self.config.secret_key)

    def verify_request_auth(self, token: str) -> Dict[str, Any]:
        """
        Verify JWT signature, check expiration, and assert session epoch matches DB.
        """
        try:
            payload = verify_jwt(token, self.config.secret_key)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid session token: {e}",
            )

        user_id = payload.get("sub")
        token_epoch = payload.get("epoch", 1)

        user = self.db.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found.",
            )

        # Check Single-Owner constraint
        if self.config.owner_telegram_id is not None:
            if user["telegram_id"] != self.config.owner_telegram_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied. Single-owner restriction in effect.",
                )

        # Check Auth Epoch (Revocation Check)
        if token_epoch < user["auth_epoch"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been revoked via epoch bump.",
            )

        return user

    def assert_owner_telegram_id(self, telegram_id: int) -> None:
        """
        Verify that an incoming Telegram ID strictly matches OWNER_TELEGRAM_ID.
        """
        if self.config.owner_telegram_id is not None:
            if telegram_id != self.config.owner_telegram_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized: User does not match OWNER_TELEGRAM_ID",
                )
