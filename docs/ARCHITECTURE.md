# TeleBook Architecture Reference

## System Components

TeleBook implements a decentralized private notebook repository. It connects a lightweight edge router to client-side encryption and Telegram storage.

### Data Flow

1. **Client Processing**:
   - The user imports or edits a Jupyter notebook.
   - Notebook JSON is serialized, compressed via Gzip, and split into 15 MB chunks.
   - Each chunk receives a 96-bit random IV.
   - Chunks are encrypted with AES-256-GCM. Additional Authenticated Data binds chunk index, total chunks, version, and notebook identifier.
   - A 16-byte GCM authentication tag is generated.

2. **Edge Proxy**:
   - Cloudflare Worker checks request authorization against the single administrator ID.
   - Chunks are streamed via multipart requests directly to Telegram Bot API.
   - Metadata, chunk message identifiers, and SHA-256 digests are stored in Cloudflare D1 SQLite.

3. **Retrieval**:
   - Client queries Cloudflare Worker for version manifest.
   - Worker signs ephemeral download URLs for each chunk file.
   - Client fetches binary chunks, verifies SHA-256 hash, and decrypts payloads.
   - Gzip decompression restores standard nbformat JSON.

## Storage Slicing Strategy

Standard Telegram Bot API limits document downloads to 20 MB. TeleBook enforces a 15 MB raw chunk boundary prior to encryption. This ensures that encrypted chunks with authentication headers remain safely within the 20 MB ceiling.
