# TeleBook Security Model

## Threat Assumptions

TeleBook assumes untrusted transit and untrusted storage backends. Cloudflare Workers, Cloudflare D1, and Telegram servers only observe encrypted binary payloads.

### Cryptographic Invariants

- **Cipher**: AES-256-GCM.
- **Key Derivation**: PBKDF2 using SHA-256 with 100,000 iterations and a 16-byte random salt.
- **Initialization Vector**: 12 bytes generated per chunk using cryptographically secure random bytes.
- **Authenticated Data Binding**:
  `AAD = notebook_id || ":" || version || ":" || chunk_index || ":" || total_chunks`
  This guarantees that chunks cannot be swapped between notebooks or versions without failing GCM authentication.

## Perimeter Defenses

1. **Owner Identifier Validation**:
   Every incoming Telegram update or API request is evaluated against the configured numeric owner identifier. Requests with mismatched identifiers are rejected immediately.

2. **Telegram Webhook Secret**:
   The webhook endpoint validates the secret header using constant-time comparison to prevent timing side channels.

3. **Telegram Mini App Signature**:
   InitData query strings are parsed, sorted, and checked against HMAC-SHA256 computed with the bot token. Auth dates older than 300 seconds are rejected to mitigate replay attacks.

4. **Session Revocation**:
   Invoking the revocation command increments the user authentication epoch in SQLite. All sessions issued under previous epochs are rejected immediately.
