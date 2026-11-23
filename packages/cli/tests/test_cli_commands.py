"""
CLI End-to-End Command Tests.
Tests telebook login, push, pull, list, search, export-all, and revoke commands
against a live in-memory / local test server.
"""

import json
import os
import tempfile
import pytest
from click.testing import CliRunner

from telebook.cli import main
from local_server.config import ServerConfig
from local_server.main import create_app


@pytest.fixture
def cli_test_env():
    runner = CliRunner(env={"COLUMNS": "200"})
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = os.path.join(temp_dir, "cli_test.db")
        storage_dir = os.path.join(temp_dir, "chunks")
        cfg_file = os.path.join(temp_dir, "config.json")
        os.environ["TELEBOOK_CONFIG_PATH"] = cfg_file

        config = ServerConfig(
            db_path=db_path,
            storage_dir=storage_dir,
            storage_mode="local",
            owner_telegram_id=987654321,
            secret_key="cli-test-secret-key",
            bot_username="TeleBookBot",
            enable_bot_poller=False,
            watch_dir=None,
        )
        app = create_app(config)

        # Pre-seed approved user and session in config
        user = app.state.db.get_or_create_user(987654321, username="test_owner")
        jwt_token = app.state.auth_manager.create_session_jwt(user)

        with open(cfg_file, "w") as f:
            json.dump({
                "server_url": "http://testserver",
                "session_token": jwt_token,
                "passkey": "test-cli-passkey-123",
                "owner_telegram_id": 987654321,
            }, f)

        # Create sample notebook file
        sample_nb_path = os.path.join(temp_dir, "sample_notebook.ipynb")
        sample_data = {
            "cells": [
                {
                    "cell_type": "markdown",
                    "metadata": {},
                    "source": ["# Analysis of Model Performance\n", "Evaluating accuracy."],
                },
                {
                    "cell_type": "code",
                    "execution_count": 1,
                    "metadata": {},
                    "outputs": [
                        {
                            "name": "stdout",
                            "output_type": "stream",
                            "text": ["Validation accuracy: 98.4%\n"],
                        }
                    ],
                    "source": ["acc = 0.984\n", "print(f'Validation accuracy: {acc:.1%}')"],
                },
            ],
            "metadata": {
                "language_info": {"name": "python", "version": "3.11"},
            },
            "nbformat": 4,
            "nbformat_minor": 5,
        }
        with open(sample_nb_path, "w") as f:
            json.dump(sample_data, f)

        yield runner, app, sample_nb_path, temp_dir


def test_cli_config_command(cli_test_env):
    runner, app, sample_nb, temp_dir = cli_test_env
    res = runner.invoke(main, ["config"])
    assert res.exit_code == 0
    assert "Server URL" in res.output


def test_cli_push_list_search_pull_export_lifecycle(cli_test_env, monkeypatch):
    runner, app, sample_nb, temp_dir = cli_test_env

    # We use FastAPI TestClient under the hood when TelebookClient connects to http://testserver
    from fastapi.testclient import TestClient
    test_client = TestClient(app)

    # Monkeypatch httpx.Client in TelebookClient to use TestClient transport
    import httpx
    orig_init = httpx.Client.__init__

    def mock_httpx_init(self, *args, **kwargs):
        kwargs["transport"] = test_client._transport
        orig_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "__init__", mock_httpx_init)

    # 1. Push
    push_res = runner.invoke(main, [
        "push",
        sample_nb,
        "--title", "Model Performance Analysis",
        "--message", "Initial experiment",
        "--tag", "nlp",
        "--tag", "eval",
    ])
    assert push_res.exit_code == 0
    assert "Upload Complete!" in push_res.output

    # 2. List
    list_res = runner.invoke(main, ["list"])
    assert list_res.exit_code == 0
    assert "nb_sample-notebook" in list_res.output

    # 3. Search
    search_res = runner.invoke(main, ["search", "Performance"])
    assert search_res.exit_code == 0
    assert "nb_sample-notebook" in search_res.output

    # 4. Pull
    pulled_path = os.path.join(temp_dir, "pulled_notebook.ipynb")
    pull_res = runner.invoke(main, [
        "pull",
        "nb_sample-notebook",
        "--output", pulled_path,
    ])
    assert pull_res.exit_code == 0
    assert "Successfully pulled and decrypted!" in pull_res.output
    assert os.path.exists(pulled_path)

    # Verify pulled content matches original
    with open(sample_nb, "r") as f1, open(pulled_path, "r") as f2:
        orig_json = json.load(f1)
        pulled_json = json.load(f2)
        assert orig_json == pulled_json

    # 5. Export-all (Zero Lock-in)
    export_dir = os.path.join(temp_dir, "export_archive")
    export_res = runner.invoke(main, [
        "export-all",
        "--output-dir", export_dir,
    ])
    assert export_res.exit_code == 0
    assert "Export Complete!" in export_res.output

    # Verify export manifest
    manifest_file = os.path.join(export_dir, "export_manifest.json")
    assert os.path.exists(manifest_file)
    with open(manifest_file, "r") as f:
        export_data = json.load(f)
        assert len(export_data) >= 1
        assert export_data[0]["id"] == "nb_sample-notebook"
