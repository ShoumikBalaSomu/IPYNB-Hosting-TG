"""
Tests for TeleBook Local Server Database Layer (SQLite).
"""

import os
import tempfile
import time
import pytest

from local_server.db import Database


@pytest.fixture
def temp_db():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    db = Database(db_path)
    yield db
    if os.path.exists(db_path):
        os.unlink(db_path)


def test_user_creation_and_epoch_bump(temp_db):
    user = temp_db.get_or_create_user(telegram_id=12345678, username="testuser")
    assert user["telegram_id"] == 12345678
    assert user["auth_epoch"] == 1

    # Fetch again
    user2 = temp_db.get_user_by_telegram_id(12345678)
    assert user2["id"] == user["id"]

    # Bump epoch
    new_epoch = temp_db.bump_auth_epoch(user["id"])
    assert new_epoch == 2

    user_updated = temp_db.get_user_by_id(user["id"])
    assert user_updated["auth_epoch"] == 2


def test_magic_token_lifecycle(temp_db):
    token_id = "tok_test_123"
    token_hash = "hash_123"
    expires_at = int(time.time()) + 120

    temp_db.create_magic_token(token_id, token_hash, expires_at)
    rec = temp_db.get_magic_token(token_id)
    assert rec is not None
    assert rec["status"] == "pending"

    # Approve
    approved = temp_db.approve_magic_token(token_id, "jwt.token.val")
    assert approved is True

    rec2 = temp_db.get_magic_token(token_id)
    assert rec2["status"] == "approved"
    assert rec2["session_jwt"] == "jwt.token.val"


def test_magic_token_expired(temp_db):
    token_id = "tok_exp"
    token_hash = "hash_exp"
    expires_at = int(time.time()) - 10  # expired

    temp_db.create_magic_token(token_id, token_hash, expires_at)
    rec = temp_db.get_magic_token(token_id)
    assert rec["status"] == "expired"


def test_notebook_crud_and_filtering(temp_db):
    user = temp_db.get_or_create_user(99999)
    uid = user["id"]

    temp_db.upsert_notebook(
        notebook_id="nb_1",
        user_id=uid,
        title="Deep Learning Alpha",
        description="Vision transformers",
        tags=["vision", "transformers"],
        is_starred=True,
    )

    temp_db.upsert_notebook(
        notebook_id="nb_2",
        user_id=uid,
        title="Time Series Forecasting",
        description="ARIMA and LSTM",
        tags=["timeseries"],
        is_starred=False,
    )

    # List all
    all_nbs = temp_db.list_notebooks(user_id=uid)
    assert len(all_nbs) == 2

    # Filter search
    search_res = temp_db.list_notebooks(user_id=uid, search="Alpha")
    assert len(search_res) == 1
    assert search_res[0]["id"] == "nb_1"

    # Filter tag
    tag_res = temp_db.list_notebooks(user_id=uid, tag="timeseries")
    assert len(tag_res) == 1
    assert tag_res[0]["id"] == "nb_2"

    # Filter starred
    star_res = temp_db.list_notebooks(user_id=uid, starred=True)
    assert len(star_res) == 1
    assert star_res[0]["id"] == "nb_1"


def test_chunks_and_version_finalization(temp_db):
    user = temp_db.get_or_create_user(88888)
    uid = user["id"]
    nb_id = "nb_multi_chunk"

    temp_db.upsert_notebook(nb_id, uid, "Multi Chunk Notebook")

    # Record 2 chunks for version 1
    temp_db.record_chunk(
        chunk_id="c1",
        notebook_id=nb_id,
        version=1,
        chunk_index=0,
        total_chunks=2,
        telegram_file_id="tg_1",
        telegram_message_id=101,
        chunk_hash="hash_0",
        byte_length=1000,
    )

    finalized = temp_db.check_and_finalize_version(nb_id, 1, 2)
    assert finalized is False  # only 1 of 2 chunks present

    temp_db.record_chunk(
        chunk_id="c2",
        notebook_id=nb_id,
        version=1,
        chunk_index=1,
        total_chunks=2,
        telegram_file_id="tg_2",
        telegram_message_id=102,
        chunk_hash="hash_1",
        byte_length=1500,
    )

    finalized = temp_db.check_and_finalize_version(nb_id, 1, 2, sha256_hash="raw_sha", commit_message="init")
    assert finalized is True

    manifest = temp_db.get_version_manifest(nb_id, 1)
    assert manifest is not None
    assert manifest["total_chunks"] == 2
    assert manifest["byte_size"] == 2500
    assert manifest["sha256_hash"] == "raw_sha"
    assert len(manifest["chunks"]) == 2
    assert manifest["chunks"][0]["download_url"] == f"/api/notebooks/{nb_id}/versions/1/chunks/0"
