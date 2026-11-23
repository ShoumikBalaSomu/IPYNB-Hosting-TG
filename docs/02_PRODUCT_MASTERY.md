# TeleBook: Product Mastery & Cryptographic Specification

---

## 1. Zero-Knowledge Cryptographic Specification: `TELEBOOK_V1`

TeleBook enforces a strict **zero-knowledge** architecture. Cloudflare Workers, Cloudflare D1 databases, and Telegram's cloud storage are treated as untrusted infrastructure. Neither intermediate proxies nor hosting servers ever receive or inspect plaintext notebook content, code cells, outputs, or encryption passkeys.

### 1.1 Cryptographic Primitive Suite

| Parameter | Standard / Algorithm | Details & Constraints |
| :--- | :--- | :--- |
| **Symmetric Cipher** | **AES-256-GCM** | NIST SP 800-38D authenticated encryption |
| **Key Derivation** | **PBKDF2-HMAC-SHA256** | 100,000 iterations, 16-byte random salt, 256-bit output key |
| **Nonce / IV** | **96-bit (12 bytes)** | CSPRNG generated per chunk (`crypto.getRandomValues`) |
| **Integrity / Tag** | **128-bit (16 bytes)** | GCM authentication tag appended to ciphertext |
| **AAD Binding** | **Structured String** | `notebook_id:version:chunk_index:total_chunks` |

### 1.2 Additional Authenticated Data (AAD) Cryptographic Binding

To prevent active ciphertext manipulation attacks in transit or at rest, every encrypted chunk cryptographically binds its metadata into the AES-GCM calculation via Additional Authenticated Data (AAD):

$$\text{AAD} = \text{notebook\_id} \mathbin{\Vert} \text{":"} \mathbin{\Vert} \text{version} \mathbin{\Vert} \text{":"} \mathbin{\Vert} \text{chunk\_index} \mathbin{\Vert} \text{":"} \mathbin{\Vert} \text{total\_chunks}$$

#### Attack Vectors Mitigated by AAD:
1. **Chunk Swapping Attacks**: An attacker cannot replace chunk 1 of a sensitive notebook with chunk 1 of a benign notebook; decryption will fail with a GCM tag authentication error.
2. **Version Rollback Attacks**: An attacker cannot replace chunk 2 of version 3 with chunk 2 from version 1; the version mismatch in AAD causes immediate tag failure.
3. **Chunk Reordering & Deletion**: An attacker cannot swap chunk indices or truncate chunks; the index and total count are bound to each individual chunk.

### 1.3 Binary Chunk Wire Format (`TB01`)

Each encrypted chunk transmitted to Telegram Bot storage follows this exact binary structure:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Magic Header ("TB01")                      | (4 bytes: 0x54 0x42 0x30 0x31)
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                       Salt (16 Bytes)                         + (Random salt for PBKDF2)
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       IV / Nonce (12 Bytes)                   | (CSPRNG random 96-bit IV)
|                               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+                               |
|                                                               |
+                 Ciphertext (Variable Length)                  + (AES-256-GCM encrypted payload)
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    GCM Auth Tag (16 Bytes)                    | (128-bit integrity tag)
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

---

## 2. Chunking Protocol & Telegram Storage Engine

### 2.1 Pre-Encryption Chunk Slicing
Because Telegram Bot API imposes a strict 20 MB download limit on `getFile`, raw notebook buffers are sliced into **15 MB (15,728,640 bytes) max segments** prior to encryption:

$$\text{Chunk Size}_{\text{raw}} \le 15 \times 1024 \times 1024 \text{ bytes}$$

With header overhead (4 bytes magic + 16 bytes salt + 12 bytes IV + 16 bytes tag = 48 bytes), the encrypted chunk remains safely under 15.1 MB, far below the 20 MB ceiling.

### 2.2 Storage Manifest in Cloudflare D1
The database stores only cryptographic metadata and Telegram file pointers:

```sql
CREATE TABLE notebook_chunks (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    chunk_hash TEXT NOT NULL,         -- SHA-256 of encrypted binary chunk
    byte_length INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

CREATE INDEX idx_chunks_lookup 
ON notebook_chunks(notebook_id, version, chunk_index);
```

### 2.3 Upload Pipeline Sequence
```
Client (Web / CLI)                 Cloudflare Worker                     Telegram Bot API
       |                                   |                                     |
  1. Slice & Encrypt                       |                                     |
     Chunk TB01                            |                                     |
       |                                   |                                     |
  2. POST /api/notebooks/:id/chunks        |                                     |
     (Stream binary payload) ------------> |                                     |
                                      3. Pipe stream to                          |
                                         sendDocument -------------------------> |
                                           |                                     |
                                           | <----------------------- 4. Return telegram_file_id
                                      5. Record chunk metadata in D1             |
       | <-------------------------------- |                                     |
  6. Repeat for all chunks                 |                                     |
       |                                   |                                     |
  7. Finalize manifest version             |                                     |
```

---

## 3. Desktop Authentication: 120-Second Ephemeral Magic Token

Developers require frictionless terminal (`telebook push`) and desktop browser access without copying sensitive Telegram bot tokens or master passwords onto shared workstations.

### 3.1 Magic Token Protocol Flow
```
Desktop Client (Browser / CLI)        Cloudflare Worker             Telegram Bot & Owner
            |                                 |                                 |
  1. POST /api/auth/magic-token               |                                 |
     ---------------------------------------> |                                 |
                                         2. Generate 32-byte                    |
                                            random hex token                    |
                                            Expires at now + 120s               |
                                            Status: 'pending'                   |
            | <------------------------------ |                                 |
  3. Display QR & Deep Link                   |                                 |
     https://t.me/Bot?start=auth_<token>      |                                 |
            |                                 |                                 |
  4. Poll GET /api/auth/magic-token/:id       |                                 |
     ---------------------------------------> |                                 |
                                              | <--- 5. Owner clicks "Approve" -|
                                              |      in Telegram chat           |
                                              |                                 |
                                         6. Verify from.id == OWNER_TELEGRAM_ID |
                                            Update token to 'approved'          |
                                            Generate session JWT (epoch bound)  |
            | <------------------------------ |                                 |
  7. Return signed JWT & set-cookie           |                                 |
     Token purged from D1                     |                                 |
```

### 3.2 Security Properties of the Magic Flow
- **120-Second Time-To-Live**: Unapproved tokens expire automatically within 2 minutes.
- **Single-Use Deletion**: Immediately upon successful exchange for a JWT, the magic token record is permanently deleted.
- **Physical Device Proof**: Authorization strictly requires interaction inside the Telegram client on the owner's authenticated phone or desktop.

---

## 4. Session Revocation & Epoch Invalidation (`/revoke`)

### 4.1 The Distributed Revocation Problem
Traditional JWTs remain valid until their expiration timestamp, creating a dangerous exposure window if a laptop is lost or a browser token is compromised. Maintaining a distributed token blacklist at edge scale incurs significant latency and database write overhead.

### 4.2 TeleBook Epoch Bumping Solution
TeleBook implements **User Auth Epochs** stored in Cloudflare D1:

1. The `users` record holds `auth_epoch INTEGER DEFAULT 1`.
2. Every issued JWT payload includes the current epoch:
   ```json
   {
     "sub": "tg_987654321",
     "epoch": 3,
     "exp": 1740000000
   }
   ```
3. When the owner sends `/revoke` to the Telegram Bot:
   ```sql
   UPDATE users SET auth_epoch = auth_epoch + 1 WHERE telegram_id = ?;
   ```
4. On every authenticated request, the Worker authentication middleware compares:
   $$\text{jwt.epoch} == \text{user.auth\_epoch}$$
5. If `jwt.epoch < user.auth_epoch`, the request is rejected immediately with HTTP 401 Unauthorized.
6. **Result**: Complete, instantaneous revocation of all issued sessions across all global devices with a single atomic database increment.

---

## 5. Five Real-World User Personas

### Persona 1: Dr. Elena Rostova — Deep Learning Research Scientist
- **Context**: Postdoctoral researcher training multimodal transformers. Produces daily training evaluation notebooks featuring loss curves, attention heatmaps, and latency tables.
- **Pain Point**: ArXiv preprints require strict confidentiality prior to release. Public notebook hosts risk leaking unreleased model architectures or proprietary hyperparameter sweeps.
- **TeleBook Usage**: Elena uses `telebook push eval_epoch40.ipynb` directly from her GPU server terminal. The notebook is encrypted client-side with `TELEBOOK_V1` before leaving her machine. During transit, she reviews convergence plots on her phone via the Telegram Mini App.

### Persona 2: Marcus Vance — Quantitative Trading Analyst
- **Context**: Builds algorithmic strategies in Python (NumPy, pandas, vectorbt). Analyzes millisecond order-book imbalances and risk drawdowns.
- **Pain Point**: Proprietary trading alpha cannot touch third-party SaaS servers (GitHub/Colab) due to IP theft risks and strict compliance mandates. Needs immediate mobile verification when trade alerts fire during market hours.
- **TeleBook Usage**: Marcus hosts his TeleBook instance on his personal Telegram bot. When his trading bot generates an execution post-mortem notebook, it triggers TeleBook storage. Marcus receives a direct Telegram alert and opens the notebook in Telegram Mini App with zero exposure to third-party clouds.

### Persona 3: Priya Nair — Freelance Data Science Consultant
- **Context**: Delivers predictive customer segmentation and churn models to small businesses.
- **Pain Point**: Clients cannot afford dedicated Databricks or cloud notebook enterprise licenses ($50-$200/user/mo). Free tools either leak data publicly or break when notebooks exceed 5 MB.
- **TeleBook Usage**: Priya maintains a sovereign TeleBook deployment operating at $0 cost. She generates time-bounded, encrypted read-only links for her clients. The clients view interactive Plotly churn charts on their phones or browsers without needing to install Python.

### Persona 4: Liam O'Connor — Computer Science Graduate Student
- **Context**: Working on master's thesis in computational biology. Regularly moves between university laboratory desktop, personal MacBook, and Android smartphone.
- **Pain Point**: Fragmented files, broken local environments, and stale Jupyter server sessions when switching devices.
- **TeleBook Usage**: Liam uses `telebook push` to keep an immutable, versioned history of his research notebooks. In class or on the bus, he opens his thesis notebooks in the Telegram Mini App, using the Notebook X-Ray sidebar to review cell runtimes and dependency imports.

### Persona 5: Kenji Takahashi — Open-Source ML Maintainer
- **Context**: Maintainer of a popular open-source computer vision library. Distributes tutorial notebooks and reproducible benchmark figures.
- **Pain Point**: Terrified of vendor lock-in and escalating cloud infrastructure bills. Requires a self-sovereign distribution channel with guarantee of 100% portable raw export.
- **TeleBook Usage**: Kenji uses TeleBook's `telebook export-all` CLI feature. Because TeleBook enforces zero-knowledge AES-256-GCM and standard nbformat serialization, Kenji can export his entire notebook archive into standard `.ipynb` files at any time with zero conversion friction.
