# TeleBook Local Server

Self-hosted backend parity server for TeleBook. Mirrors the Cloudflare Worker REST API, Telegram Webhook handler, and D1 SQLite database locally.

## Features

- **100% Cloudflare Worker API Parity**: Routes for magic token authentication, notebook metadata, chunk manifests, and streaming chunk storage.
- **SQLite Database**: Local SQLite schema matching Cloudflare D1 with B-Tree indices.
- **Pluggable Storage Adapters**:
  - `telegram`: Stores encrypted chunks in a private Telegram channel via Bot API.
  - `local-bot-api`: Integrates with a local `telegram-bot-api` server, unlocking 2 GB file transfers and local disk paths.
  - `local`: Pure local disk chunk storage for offline use.
- **Telegram Bot Poller**: Optional background poller so users can interact with the Telegram bot without setting up public webhooks or tunnels.
- **Filesystem Watcher**: Background service that monitors a directory (e.g. `~/notebooks`) and auto-encrypts/syncs `.ipynb` modifications.
- **Single-Owner Security**: Strictly enforces `OWNER_TELEGRAM_ID`.
- **Instant Global Revocation**: Epoch bumping (`/revoke`) invalidates all active sessions atomically.

## Running Locally

```bash
# Start server with local storage
export STORAGE_MODE=local
telebook-server
```

## Running with Docker Compose

```bash
docker compose up -d
```
