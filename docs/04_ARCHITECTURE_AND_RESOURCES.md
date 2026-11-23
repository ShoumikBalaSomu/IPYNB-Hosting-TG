# TeleBook: System Architecture & Resource Blueprint

---

## 1. Monorepo Structure & Dependency Topography

TeleBook is organized as a high-performance monorepo using npm/pnpm workspaces. All internal boundaries are strictly maintained to ensure code reuse across Edge, Browser, Node.js, and CLI runtimes.

```
IPYNB-Hosting-Server/
├── AGENTS.md                          # Swarm Operating Constitution & Invariants
├── package.json                       # Workspace root definition & shared scripts
├── tsconfig.base.json                 # Strict TypeScript root configuration
├── .agents/                           # Antigravity 2.0 workspace intelligence
│   ├── rules/                         # security-ipynb, cloudflare-free-tier, ui-psychology-tma
│   ├── skills/                        # humanize, ai-check, ipynb-security-audit, etc.
│   ├── scripts/                       # pre-tool-use.js, post-tool-use.js
│   └── hooks.json                     # Lifecycle security gates
├── packages/
│   ├── shared/                        # Isomorphic core (types, schemas, TELEBOOK_V1 crypto)
│   │   ├── src/
│   │   │   ├── crypto/                # AES-256-GCM, PBKDF2, AAD binding
│   │   │   ├── models/                # Zod nbformat v4/v5 & API schemas
│   │   │   └── chunking/              # 15 MB stream chunker & assembler
│   │   └── package.json
│   └── cli/                           # 'telebook' CLI binary
│       ├── src/
│       │   ├── commands/              # login, push, pull, export-all
│       │   └── index.ts
│       └── package.json
├── apps/
│   ├── worker/                        # Cloudflare Worker API & Telegram Webhook
│   │   ├── src/
│   │   │   ├── routes/                # auth, notebooks, chunks, webhook
│   │   │   ├── middleware/            # single-owner auth, epoch validation
│   │   │   ├── db/                    # D1 query client & migrations
│   │   │   └── index.ts
│   │   ├── wrangler.toml              # D1 bindings & worker environment
│   │   └── package.json
│   ├── web/                           # Telegram Mini App & Desktop Reader/Editor
│   │   ├── src/
│   │   │   ├── components/            # NotebookViewer, Cell, CodeBlock, XRaySidebar
│   │   │   ├── pyodide/               # Web Worker WASM live execution engine
│   │   │   ├── hooks/                 # useTelegramWebApp, useNotebook
│   │   │   └── App.tsx
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── local-server/                  # Local companion daemon (folder watch & sync)
│       ├── src/
│       │   ├── watcher.ts             # chokidar filesystem monitor
│       │   └── server.ts              # Local HTTP offline server
│       └── package.json
├── tests/                             # Integration tests, crypto vectors, XSS fuzzing
└── docs/                              # Technical specifications & blueprints
    ├── 01_BACKGROUND_STUDY.md
    ├── 02_PRODUCT_MASTERY.md
    ├── 03_INNOVATION_BLUEPRINT.md
    ├── 04_ARCHITECTURE_AND_RESOURCES.md
    └── EXECUTION_LOG.md
```

### Dependency Topology Graph
```
                     +-------------------+
                     |  packages/shared  |
                     +-------------------+
                       ^       ^       ^
        +--------------+       |       +---------------+
        |                      |                       |
+---------------+      +---------------+      +------------------+
|  apps/worker  |      |   apps/web    |      |   packages/cli   |
+---------------+      +---------------+      +------------------+
                                                       ^
                                                       |
                                              +------------------+
                                              | apps/local-server|
                                              +------------------+
```

---

## 2. API Specifications (OpenAPI 3.1 Style)

All Cloudflare Worker endpoints return standard HTTP status codes and JSON envelopes. Binary chunk streaming endpoints stream raw encrypted octet-streams.

### 2.1 Authentication & Session Endpoints

#### `POST /api/auth/magic-token`
- **Description**: Request an ephemeral 120-second token for desktop or CLI login.
- **Request Body**: `{}`
- **Response `201 Created`**:
  ```json
  {
    "token_id": "mt_8f9a2b1c",
    "deep_link": "https://t.me/TeleBookBot?start=auth_8f9a2b1c",
    "expires_at": 1740000120
  }
  ```

#### `GET /api/auth/magic-token/:id`
- **Description**: Poll magic token status from desktop.
- **Response `200 OK` (Pending)**:
  ```json
  { "status": "pending" }
  ```
- **Response `200 OK` (Approved)**:
  ```json
  {
    "status": "approved",
    "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_at": 1742592000
  }
  ```

#### `POST /api/auth/revoke`
- **Description**: Atomically invalidates all issued sessions globally by incrementing `users.auth_epoch`.
- **Headers**: `Authorization: Bearer <token>`
- **Response `200 OK`**:
  ```json
  { "revoked": true, "new_epoch": 4 }
  ```

### 2.2 Notebook Management Endpoints

#### `GET /api/notebooks`
- **Description**: List all notebooks belonging to the single owner.
- **Response `200 OK`**:
  ```json
  {
    "notebooks": [
      {
        "id": "nb_a1b2c3d4",
        "title": "Transformer Attention Analysis",
        "current_version": 3,
        "total_chunks": 1,
        "byte_size": 2458920,
        "updated_at": 1740000000
      }
    ]
  }
  ```

#### `GET /api/notebooks/:id/versions/:version`
- **Description**: Retrieve chunk manifest for a specific notebook version.
- **Response `200 OK`**:
  ```json
  {
    "notebook_id": "nb_a1b2c3d4",
    "version": 3,
    "total_chunks": 2,
    "byte_size": 18458920,
    "chunks": [
      {
        "chunk_index": 0,
        "chunk_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "byte_length": 15728640,
        "download_url": "/api/notebooks/nb_a1b2c3d4/versions/3/chunks/0"
      },
      {
        "chunk_index": 1,
        "chunk_hash": "a85c8f7608f657a8bf6a8f609e257321580f498c4d2938a9d18476a59821a004",
        "byte_length": 2730280,
        "download_url": "/api/notebooks/nb_a1b2c3d4/versions/3/chunks/1"
      }
    ]
  }
  ```

#### `POST /api/notebooks/:id/versions/:version/chunks/:index`
- **Description**: Upload a single encrypted 15 MB chunk. Forwarded directly via Web Streams to Telegram Bot API `sendDocument`.
- **Headers**:
  - `Content-Type: application/octet-stream`
  - `X-Chunk-Hash: <sha256-hex>`
  - `X-Total-Chunks: <int>`
- **Response `201 Created`**:
  ```json
  {
    "chunk_index": 0,
    "telegram_file_id": "BQACAgIAAxkBAAI...",
    "status": "stored"
  }
  ```

#### `GET /api/notebooks/:id/versions/:version/chunks/:index`
- **Description**: Stream encrypted binary chunk from Telegram Bot API directly to client.
- **Response `200 OK`**: `Content-Type: application/octet-stream`

---

## 3. Cloudflare D1 Database Schema (SQLite)

This schema guarantees indexed, sub-millisecond queries under Cloudflare Workers:

```sql
-- Cloudflare D1 SQLite Schema for TeleBook

-- Single Owner Configuration
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    auth_epoch INTEGER DEFAULT 1 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Notebook Metadata Table
CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    current_version INTEGER DEFAULT 1 NOT NULL,
    is_starred INTEGER DEFAULT 0 NOT NULL,
    tags TEXT DEFAULT '[]',             -- JSON array of strings
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Notebook Version Audit Log
CREATE TABLE IF NOT EXISTS notebook_versions (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    byte_size INTEGER NOT NULL,
    commit_message TEXT DEFAULT '',
    sha256_hash TEXT NOT NULL,          -- Hash of decrypted raw notebook
    created_at INTEGER NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    UNIQUE(notebook_id, version)
);

-- Encrypted Chunks Manifest Table
CREATE TABLE IF NOT EXISTS notebook_chunks (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    chunk_hash TEXT NOT NULL,          -- SHA-256 of encrypted TB01 binary chunk
    byte_length INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    UNIQUE(notebook_id, version, chunk_index)
);

-- Ephemeral Magic Tokens for Desktop Login
CREATE TABLE IF NOT EXISTS magic_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,   -- SHA-256 of magic token
    status TEXT DEFAULT 'pending' NOT NULL, -- 'pending' | 'approved' | 'expired'
    session_jwt TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- Active Device Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    epoch INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- B-Tree Performance Indices
CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_lookup ON notebook_versions(notebook_id, version);
CREATE INDEX IF NOT EXISTS idx_chunks_lookup ON notebook_chunks(notebook_id, version, chunk_index);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON magic_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_epoch ON sessions(user_id, epoch);
```

---

## 4. Hybrid Local + Cloud Architecture Split

TeleBook delivers a seamless hybrid experience:

```
+-----------------------------------------------------------------------------+
|                         Local Environment (Workstation)                     |
|                                                                             |
|   ~/notebooks/              telebook CLI            apps/local-server       |
|  [ analysis.ipynb ] ----> [ Push / Watch ] -----> [ Local HTTP Viewer ]     |
|                                 |                   http://localhost:4040   |
+---------------------------------|-------------------------------------------+
                                  | Zero-Knowledge Sync
                                  v
+-----------------------------------------------------------------------------+
|                         Cloud Infrastructure ($0 Cost)                      |
|                                                                             |
|      Cloudflare Pages                 Cloudflare Worker & D1                |
|   (TMA Frontend / Pyodide) <-------> (API Router & Metadata SQLite)         |
|                                                |                            |
|                                                v                            |
|                                     Telegram Bot API Cloud                  |
|                                    (Encrypted Blob Storage)                 |
+-----------------------------------------------------------------------------+
```

### 1. Cloud Layer
- **Cloudflare Pages**: Hosts the compiled web application and WASM binaries with global CDN edge caching.
- **Cloudflare Worker**: Handles Telegram webhooks, authenticates single-owner claims, verifies session epochs, and pipes encrypted chunks to Telegram.
- **Cloudflare D1**: Stores relational metadata and chunk manifests with edge replication.
- **Telegram Storage**: Acts as sovereign, encrypted document storage.

### 2. Local Layer
- **`telebook` CLI**: Developer CLI for terminal workflows (`telebook push`, `telebook pull`, `telebook export-all`).
- **`apps/local-server`**: Embedded background daemon. Watches project directories, syncs diffs automatically, and provides an offline local browser UI when disconnected from the internet.

---

## 5. Itemized $0 Operating Cost Accounting

TeleBook achieves complete cost sovereignty by fitting strictly within the generous perpetual free tiers of modern serverless infrastructure:

| Component | Free Tier Allocation | TeleBook Monthly Consumption | Monthly Cost |
| :--- | :--- | :--- | :--- |
| **Cloudflare Workers** | 100,000 requests / day (3M / mo) | ~15,000 requests / month | **$0.00** |
| **Worker CPU Time** | 10ms CPU per request | ~0.8ms average CPU per request | **$0.00** |
| **Cloudflare Pages** | Unlimited bandwidth | ~50 GB / month CDN cached | **$0.00** |
| **Cloudflare D1** | 5M row reads / day (150M / mo)<br>100k row writes / day (3M / mo)<br>5 GB storage | ~200,000 reads / month<br>~5,000 writes / month<br>~50 MB database storage | **$0.00** |
| **Telegram Bot API** | Unlimited document storage<br>50 MB upload / 20 MB download | Scalable encrypted chunk storage | **$0.00** |
| **Compute Execution** | Pyodide in-browser WebAssembly | 100% Client-side browser CPU | **$0.00** |
| **Total Monthly Cost**| — | — | **$0.00 / month** |
