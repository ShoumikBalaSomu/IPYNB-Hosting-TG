---
trigger: glob
globs: "apps/worker/**/*.ts, wrangler.*"
description: "Enforce Cloudflare Workers 10ms CPU cap via native SubtleCrypto and indexed, quota-safe D1 SQLite queries."
---

# Rule: Cloudflare Free Tier Optimization & Safety (`cloudflare-free-tier`)

## 1. Cloudflare Workers Hard Resource Limits
- **CPU Time Limit**: 10 milliseconds of active CPU execution time per request on the Free Plan.
- **Memory Limit**: 128 MB max memory per Worker isolate.
- **Subrequest Cap**: Maximum 50 subrequests per request.
- **Daily Invocation Limit**: 100,000 requests/day.

## 2. Worker Execution Guidelines

### 2.1 Native Hardware-Accelerated Web Crypto
- NEVER import heavy JavaScript-based cryptographic libraries (e.g., `crypto-js`, `forge`, `bcryptjs`) into `apps/worker`.
- Use the runtime native Web Crypto API (`crypto.subtle`):
  - SHA-256 digests via `crypto.subtle.digest('SHA-256', data)`.
  - HMAC-SHA256 for Telegram `initData` signature validation via `crypto.subtle.sign('HMAC', key, data)`.
  - Native SubtleCrypto calls run directly in C++ / BoringSSL within the V8 engine, consuming < 0.2ms of Worker CPU time.

### 2.2 Zero-Memory Streaming Pipelines
- NEVER buffer complete multi-megabyte encrypted notebook files in Worker RAM (`await response.arrayBuffer()`). Buffering 15 MB chunks risks isolate OOM crashes under concurrent requests.
- Stream binary chunks directly between the client and Telegram Bot API using the Web Streams API:
  ```typescript
  // Pass-through streaming to Telegram Bot API
  const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': request.headers.get('Content-Type') || 'multipart/form-data' },
    body: request.body // Direct ReadableStream pipe
  });
  ```

### 2.3 Cloudflare D1 SQLite Quota-Safe Queries
- **Daily Quotas**:
  - Reads: 5,000,000 rows read / day.
  - Writes: 100,000 rows written / day.
  - Storage: 5 GB total storage.
- **Indexing Requirement**:
  - Every table MUST index lookup columns (`user_id`, `notebook_id`, `version`, `token_hash`, `expires_at`).
  - Never run full-table scans. Queries must be verified with `EXPLAIN QUERY PLAN` to ensure index traversal (`SEARCH TABLE ... USING INDEX`).
- **Batching & Prepared Statements**:
  - Always use parameterized queries: `db.prepare('SELECT ... WHERE id = ?').bind(id)`.
  - Batch atomic updates using `db.batch([stmt1, stmt2])` to minimize network roundtrips and ensure transactional consistency.
  - Maximum 500 statements per D1 batch.

### 2.4 Error Handling & Circuit Breaking
- On upstream Telegram API errors (e.g., HTTP `429 Too Many Requests`), capture the `retry_after` parameter and return standard HTTP `429` with `Retry-After: <seconds>` to the client rather than retrying inside the Worker isolate.
