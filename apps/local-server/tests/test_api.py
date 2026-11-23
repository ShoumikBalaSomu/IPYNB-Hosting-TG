"""
Full API Integration Tests for TeleBook Local Server.
Asserts parity with Cloudflare Worker API, Strict Single-Owner Gate, and Epoch Revocation.
"""

import hashlib
import os
import tempfile
import pytest
from fastapi.testclient import TestClient

from local_server.config import ServerConfig
from local_server.main import create_app


@pytest.fixture
def test_env():
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = os.path.join(temp_dir, "test_telebook.db")
        storage_dir = os.path.join(temp_dir, "chunks")
        config = ServerConfig(
            db_path=db_path,
            storage_dir=storage_dir,
            storage_mode="local",
            owner_telegram_id=987654321,
            secret_key="test-secret-key-super-secure",
            bot_username="TestTeleBookBot",
            enable_bot_poller=False,
            watch_dir=None,
        )
        app = create_app(config)
        client = TestClient(app)
        yield client, config, app


def test_root_and_health(test_env):
    client, config, app = test_env
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["service"] == "TeleBook Local Server"

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"


def test_magic_token_flow_and_single_owner_enforcement(test_env):
    client, config, app = test_env

    # 1. Request magic token
    res = client.post("/api/auth/magic-token")
    assert res.status_code == 201
    data = res.json()
    token_id = data["token_id"]
    assert "start=auth_" in data["deep_link"]
    assert data["expires_at"] > 0

    # 2. Check pending status
    poll_res = client.get(f"/api/auth/magic-token/{token_id}")
    assert poll_res.status_code == 200
    assert poll_res.json()["status"] == "pending"

    # 3. Reject approval if telegram_id != OWNER_TELEGRAM_ID
    bad_approve = client.post(
        "/api/auth/approve-magic-token",
        json={"token_id": token_id, "telegram_id": 111111111},  # wrong owner
    )
    assert bad_approve.status_code == 403

    # 4. Approve with correct OWNER_TELEGRAM_ID
    good_approve = client.post(
        "/api/auth/approve-magic-token",
        json={"token_id": token_id, "telegram_id": 987654321},
    )
    assert good_approve.status_code == 200
    assert good_approve.json()["approved"] is True

    # 5. Check approved status and get JWT
    final_poll = client.get(f"/api/auth/magic-token/{token_id}")
    assert final_poll.status_code == 200
    poll_data = final_poll.json()
    assert poll_data["status"] == "approved"
    jwt_token = poll_data["session_token"]
    assert jwt_token is not None


def test_session_epoch_revocation(test_env):
    client, config, app = test_env

    # Setup valid session
    res = client.post("/api/auth/magic-token")
    token_id = res.json()["token_id"]
    client.post("/api/auth/approve-magic-token", json={"token_id": token_id, "telegram_id": config.owner_telegram_id})
    jwt_token = client.get(f"/api/auth/magic-token/{token_id}").json()["session_token"]

    auth_headers = {"Authorization": f"Bearer {jwt_token}"}

    # Authenticated call succeeds
    list_res = client.get("/api/notebooks", headers=auth_headers)
    assert list_res.status_code == 200

    # Revoke sessions
    revoke_res = client.post("/api/auth/revoke", headers=auth_headers)
    assert revoke_res.status_code == 200
    assert revoke_res.json()["revoked"] is True
    assert revoke_res.json()["new_epoch"] == 2

    # Subsequent call with previous token must fail with 401
    stale_res = client.get("/api/notebooks", headers=auth_headers)
    assert stale_res.status_code == 401
    assert "revoked" in stale_res.json()["detail"].lower()


def test_chunk_upload_integrity_and_download(test_env):
    client, config, app = test_env

    # Setup valid session
    res = client.post("/api/auth/magic-token")
    token_id = res.json()["token_id"]
    client.post("/api/auth/approve-magic-token", json={"token_id": token_id, "telegram_id": config.owner_telegram_id})
    jwt_token = client.get(f"/api/auth/magic-token/{token_id}").json()["session_token"]
    headers = {"Authorization": f"Bearer {jwt_token}"}

    nb_id = "nb_quantum_test"
    chunk_payload = b"TB01" + b"\x00" * 28 + b"mock_encrypted_chunk_data"
    chunk_hash = hashlib.sha256(chunk_payload).hexdigest()

    # Upload with bad hash -> must fail
    bad_upload = client.post(
        f"/api/notebooks/{nb_id}/versions/1/chunks/0",
        content=chunk_payload,
        headers={
            **headers,
            "Content-Type": "application/octet-stream",
            "X-Chunk-Hash": "wrong_hash_123",
            "X-Total-Chunks": "1",
        },
    )
    assert bad_upload.status_code == 400

    # Upload with valid hash
    good_upload = client.post(
        f"/api/notebooks/{nb_id}/versions/1/chunks/0",
        content=chunk_payload,
        headers={
            **headers,
            "Content-Type": "application/octet-stream",
            "X-Chunk-Hash": chunk_hash,
            "X-Total-Chunks": "1",
            "X-Notebook-Title": "Quantum%20Simulation",
            "X-Commit-Message": "Initial%20commit",
            "X-Decrypted-Hash": "mock_decrypted_hash",
        },
    )
    assert good_upload.status_code == 201
    assert good_upload.json()["status"] == "stored"

    # Verify manifest
    manifest_res = client.get(f"/api/notebooks/{nb_id}/versions/1", headers=headers)
    assert manifest_res.status_code == 200
    manifest = manifest_res.json()
    assert manifest["total_chunks"] == 1
    assert manifest["byte_size"] == len(chunk_payload)
    assert manifest["sha256_hash"] == "mock_decrypted_hash"

    # Download chunk
    dl_res = client.get(f"/api/notebooks/{nb_id}/versions/1/chunks/0", headers=headers)
    assert dl_res.status_code == 200
    assert dl_res.content == chunk_payload
    assert dl_res.headers["X-Chunk-Hash"] == chunk_hash


def test_telegram_webhook_updates(test_env):
    client, config, app = test_env

    # 1. Update from unauthorized user
    unauth_update = {
        "update_id": 1,
        "message": {
            "message_id": 10,
            "from": {"id": 12345, "username": "intruder"},
            "chat": {"id": 12345},
            "text": "/list",
        },
    }
    unauth_res = client.post("/api/webhook", json=unauth_update)
    assert unauth_res.status_code == 200

    # 2. Update from valid owner: /start auth_<token>
    token_res = client.post("/api/auth/magic-token")
    token_id = token_res.json()["token_id"]

    auth_update = {
        "update_id": 2,
        "message": {
            "message_id": 11,
            "from": {"id": config.owner_telegram_id, "username": "owner"},
            "chat": {"id": config.owner_telegram_id},
            "text": f"/start auth_{token_id}",
        },
    }
    auth_res = client.post("/api/webhook", json=auth_update)
    assert auth_res.status_code == 200

    # Verify token is now approved
    check = client.get(f"/api/auth/magic-token/{token_id}")
    assert check.json()["status"] == "approved"

    # 3. Owner sends /revoke
    revoke_update = {
        "update_id": 3,
        "message": {
            "message_id": 12,
            "from": {"id": config.owner_telegram_id, "username": "owner"},
            "chat": {"id": config.owner_telegram_id},
            "text": "/revoke",
        },
    }
    client.post("/api/webhook", json=revoke_update)
    # Token from earlier was epoch 1, now epoch is 2
    old_jwt = check.json()["session_token"]
    stale_call = client.get("/api/notebooks", headers={"Authorization": f"Bearer {old_jwt}"})
    assert stale_call.status_code == 401
