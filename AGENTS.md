# TeleBook: Agent Operating Constitution & Architecture Contracts

Welcome to **TeleBook** — an enterprise-grade, zero-knowledge, zero-cost private Jupyter Notebook hosting, rendering, and in-browser execution platform powered by Cloudflare Workers, Cloudflare D1, Telegram Bot API storage, and modern web sandboxes.

This document sets the non-negotiable operational invariants, cryptographic contracts, and directory boundaries across the entire TeleBook monorepo. Every agent, contributor, and automated tool operating in this repository must uphold these standards.

---

## 1. Global System Invariants

### 1.1 Invariant I: Strict Single-Owner Security (`OWNER_TELEGRAM_ID`)
- **Zero Multi-Tenant Bleed**: TeleBook is designed as a personal, sovereign cloud. Every instance is locked to a single administrator identified by `OWNER_TELEGRAM_ID`.
- **Enforcement at Perimeter**:
  - The Cloudflare Worker API rejects any webhook update, REST API request, or Telegram Mini App auth payload whose Telegram User ID does not strictly match `OWNER_TELEGRAM_ID`.
  - No fallback, wildcard, or guest access is permitted unless explicitly signed by an ephemeral, time-bounded sharing ticket cryptographically issued by the owner.
  - Return HTTP `403 Forbidden` immediately on mismatched IDs without leaking notebook metadata or system diagnostics.

### 1.2 Invariant II: Zero-Knowledge Cryptography (`TELEBOOK_V1`)
- **Client-Side Encryption Only**: Plaintext notebook data (`.ipynb` JSON, cell source, cell outputs, execution outputs, and attachments) MUST NEVER reach Cloudflare Workers, Cloudflare D1, or Telegram Bot servers unencrypted.
- **Specification (`TELEBOOK_V1`)**:
  - Cipher: Standard AES-256-GCM authenticated encryption.
  - Key Derivation: PBKDF2-HMAC-SHA256 with 100,000 iterations and 16-byte random salt, or client-managed 256-bit raw passkey.
  - Nonce / IV: Unique 96-bit (12-byte) cryptographically random IV generated per chunk (`crypto.getRandomValues`).
  - AAD (Additional Authenticated Data) Binding:
    $$\text{AAD} = \text{notebook\_id} \mathbin{\Vert} \text{":"} \mathbin{\Vert} \text{version} \mathbin{\Vert} \text{":"} \mathbin{\Vert} \text{chunk\_index} \mathbin{\Vert} \text{":"} \mathbin{\Vert} \text{total\_chunks}$$
    This cryptographic binding guarantees tamper resistance against chunk-reordering, chunk-swapping, truncation, or version-rollback attacks.
  - Binary Chunk Header:
    `[4 bytes: 'TB01'] [16 bytes: Salt] [12 bytes: IV] [Ciphertext] [16 bytes: GCM Tag]`

### 1.3 Invariant III: 15 MB Chunking over Telegram Bot API
- **Telegram Hard Limits**:
  - Bot API `sendDocument`: Maximum 50 MB upload.
  - Bot API `getFile` / `file/bot<token>/<file_path>`: Maximum 20 MB download limit for standard bot tokens.
- **The 15 MB Chunk Rule**:
  - Chunks must be partitioned at a maximum payload threshold of **15 MB** (15,728,640 bytes) before encryption, leaving comfortable headroom for GCM tags, headers, and multipart overhead.
  - Storage manifests stored in Cloudflare D1 track: `notebook_id`, `version`, `chunk_index`, `telegram_file_id`, `telegram_message_id`, `chunk_hash` (SHA-256), and `byte_length`.
  - Downloads reassemble chunks sequentially after verifying each chunk's SHA-256 digest and decrypting with verified AAD.

### 1.4 Invariant IV: Staff-Engineer Zero-Shortcut Standard
- **No Mock or Placeholder Shims in Production Paths**: Code paths must be fully implemented, robustly typed, and handled with defensive error boundaries.
- **Strict TypeScript**: `noImplicitAny: true`, `strict: true`. Use Zod or Valibot for runtime validation at all system boundaries (API inputs, Telegram WebApp `initData`, `.ipynb` nbformat JSON parsing).
- **Graceful Failure & Idempotency**: All network calls (Telegram Bot API, D1 queries) must handle rate limits (`429 Too Many Requests` with `retry-after`), transient network timeouts, and atomic rollbacks.

### 1.5 Invariant V: High-Craft & Humanized Copy
- All user-facing text, error messages, Telegram Bot command replies, CLI prompts, and documentation must be written with clarity, precision, and respectful engineering polish.
- Avoid generic AI buzzwords, repetitive filler phrases, robot clichés, or condescending apologies. Speak directly to technical practitioners.

---

## 2. Monorepo Boundaries & Architecture

```
/
├── packages/
│   ├── shared/         # Universal types, schemas (Zod), TELEBOOK_V1 crypto primitives, nbformat models
│   └── cli/            # 'telebook' CLI (upload, sync, login, zero-lock-in export-all)
├── apps/
│   ├── worker/         # Cloudflare Worker (Hono REST API, Telegram Webhook, D1 client, zero-knowledge router)
│   ├── web/            # Telegram Mini App (TMA) & Desktop Web Reader/Editor (React, Vite, Tailwind, JupyterLite)
│   └── local-server/   # Local companion server (Node.js/Bun) for offline notebook serving & file watching
├── tests/              # E2E integration tests, cryptographic test vectors, XSS fuzzing suites
└── docs/               # Deep technical specs, failure matrices, threat models, and architecture records
```

### Module Responsibilities:

1. **`packages/shared`**:
   - Zero external framework dependencies. Runs seamlessly in Cloudflare Workers (V8 isolates), Browser Web Workers, Node.js, and Bun.
   - Contains:
     - `crypto/`: Web Crypto API implementation of `TELEBOOK_V1` encryption, decryption, AAD serialization, and PBKDF2 key derivation.
     - `models/`: Zod schemas for Jupyter Notebook format (`nbformat` v4.x & v5.x), metadata manifests, and API wire formats.
     - `chunking/`: Binary stream slicer and reassembler with SHA-256 integrity checkers.

2. **`apps/worker`**:
   - Built on Cloudflare Workers using the lightweight Hono framework.
   - Operates strictly under the Cloudflare Free Tier constraints:
     - 10ms CPU execution cap per invocation (all crypto offloaded to client or streaming native `crypto.subtle`).
     - 128 MB RAM envelope.
     - 100,000 requests/day.
     - Cloudflare D1 SQLite database for metadata, sessions, and chunk manifests.
   - Responsibilities:
     - Validates Telegram Bot webhooks and verifies Mini App `initData` HMAC-SHA256 signatures.
     - Forwards encrypted binary chunks to Telegram Bot API channels/chats without reading plaintext.
     - Serves authenticated signed download URLs for chunks.

3. **`apps/web`**:
   - Built with modern React, Vite, and Tailwind CSS.
   - Designed dual-mode:
     - **Telegram Mini App (TMA)**: Operates inside Telegram iOS, Android, and Desktop clients via Telegram WebApp SDK. Follows viewport stability, safe area insets, and theme styling.
     - **Desktop Web Reader & Editor**: Responsive standalone client for high-productivity notebook review.
   - Key Features:
     - Pure client-side `TELEBOOK_V1` decryption and sanitization (DOMPurify + KaTeX + Prism/Highlight.js).
     - Sandboxed iframe output rendering to isolate arbitrary JavaScript outputs.
     - Notebook X-Ray sidebar (Table of Contents, import scanning, cell run metrics).
     - Optional JupyterLite / Pyodide WebAssembly in-browser live execution environment.

4. **`apps/local-server`**:
   - Lightweight local companion daemon.
   - Allows users to watch a local folder (e.g., `~/notebooks`), auto-encrypt changes with `TELEBOOK_V1`, and push syncs to Telegram storage.
   - Provides local offline rendering when disconnected from the cloud.

5. **`packages/cli` (`telebook`)**:
   - Developer command-line interface:
     - `telebook login`: Generates 120s ephemeral magic token via Telegram bot for instant terminal authentication.
     - `telebook push <file.ipynb>`: Encrypts and uploads notebook to sovereign Telegram storage.
     - `telebook pull <notebook-id>`: Downloads and decrypts notebook to local disk.
     - `telebook export-all`: Bulk decrypts and exports entire archive without vendor lock-in.

6. **`tests/`**:
   - Cryptographic unit tests asserting compatibility against known test vectors.
   - Malicious `.ipynb` XSS attack payloads verifying sandbox containment.
   - Telegram Bot API mock harnesses verifying 15 MB chunking boundaries.

---

## 3. Communication and Handoff Protocol

- Agents communicate exclusively through the shared Swarm Message Board.
- Peer-to-peer handoffs specify concrete deliverables, file paths, and test outcomes.
- Any change to cryptographic structures, D1 schemas, or security invariants requires consensus and an update to this `AGENTS.md` file.
