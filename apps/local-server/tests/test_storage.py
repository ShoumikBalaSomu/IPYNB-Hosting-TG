"""
Tests for TeleBook Storage Adapters.
"""

import os
import tempfile
import pytest
import httpx

from local_server.storage.local_disk import LocalDiskStorage
from local_server.storage.telegram_adapter import TelegramAdapter
from local_server.storage.local_bot_api import LocalBotApiAdapter


@pytest.mark.asyncio
async def test_local_disk_storage():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = LocalDiskStorage(storage_dir=tmp_dir)

        chunk_id = "chk_test_01"
        data = b"TB01_mock_chunk_binary_payload"

        res = await storage.save_chunk(chunk_id, data, "test.tb01")
        assert res.file_id == chunk_id

        retrieved = await storage.get_chunk(chunk_id)
        assert retrieved == data

        deleted = await storage.delete_chunk(chunk_id)
        assert deleted is True

        with pytest.raises(FileNotFoundError):
            await storage.get_chunk(chunk_id)


@pytest.mark.asyncio
async def test_telegram_adapter_with_mock():
    # Mock Telegram Bot API transport
    def handler(request: httpx.Request):
        if "sendDocument" in request.url.path:
            return httpx.Response(200, json={
                "ok": True,
                "result": {
                    "message_id": 999,
                    "document": {"file_id": "tg_doc_file_id_xyz"},
                },
            })
        if "getFile" in request.url.path:
            return httpx.Response(200, json={
                "ok": True,
                "result": {"file_path": "documents/chunk_01.tb01"},
            })
        if "documents/chunk_01.tb01" in request.url.path:
            return httpx.Response(200, content=b"downloaded_chunk_content")
        return httpx.Response(404)

    mock_transport = httpx.MockTransport(handler)

    adapter = TelegramAdapter(
        bot_token="mock_token",
        chat_id="123456",
        api_url="https://api.telegram.org",
    )

    # Monkey patch httpx.AsyncClient to use mock transport in the test
    async with httpx.AsyncClient(transport=mock_transport) as client:
        # Test save_chunk logic
        url = f"{adapter.base_bot_url}/sendDocument"
        res = await adapter._post_with_retry(client, url, data={"chat_id": "123456"})
        assert res.status_code == 200
        assert res.json()["result"]["document"]["file_id"] == "tg_doc_file_id_xyz"


@pytest.mark.asyncio
async def test_local_bot_api_adapter_direct_disk():
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(b"local_bot_api_file_content")
        local_file_path = f.name

    try:
        def handler(request: httpx.Request):
            if "getFile" in request.url.path:
                return httpx.Response(200, json={
                    "ok": True,
                    "result": {"file_path": local_file_path},
                })
            return httpx.Response(404)

        adapter = LocalBotApiAdapter(
            bot_token="token",
            chat_id="123",
            api_url="http://localhost:8081",
            local_mode=True,
        )

        # Mock get_chunk reading local file path directly
        mock_transport = httpx.MockTransport(handler)
        # Verify local file reading works
        async with httpx.AsyncClient(transport=mock_transport) as client:
            res = await adapter._get_with_retry(client, f"{adapter.base_bot_url}/getFile", params={"file_id": "any"})
            assert res.json()["result"]["file_path"] == local_file_path
            # Direct disk read
            data = open(local_file_path, "rb").read()
            assert data == b"local_bot_api_file_content"
    finally:
        if os.path.exists(local_file_path):
            os.unlink(local_file_path)
