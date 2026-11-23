# TeleBook: Exhaustive Background Study & Technical Foundations

---

## 1. Executive Summary & Thesis

TeleBook provides a sovereign, private Jupyter Notebook hosting, rendering, and in-browser execution platform operating at **$0 infrastructure cost**. By synthesizing Cloudflare Workers, Cloudflare D1, Telegram Bot API storage, and client-side WebAssembly execution (Pyodide / JupyterLite), TeleBook eliminates reliance on expensive hosted cloud instances while guaranteeing zero-knowledge mathematical privacy.

This document establishes the foundational specifications, platform constraints, competitor failure points, cognitive UX principles, and an 18-item Known Failure Matrix governing all implementation decisions.

---

## 2. Jupyter Notebook (`.ipynb`) Format Specification: nbformat v4 & v5

Jupyter Notebooks are serialized JSON documents adhering to the `nbformat` schema (defined by the Jupyter Project). Understanding the exact structural semantics is essential for safe parsing, rendering, and differential editing.

### 2.1 Root Structure
A standard `.ipynb` file contains the following top-level keys:
```json
{
  "nbformat": 4,
  "nbformat_minor": 5,
  "metadata": {
    "kernelspec": {
      "display_name": "Python 3 (ipykernel)",
      "language": "python",
      "name": "python3"
    },
    "language_info": {
      "name": "python",
      "version": "3.11.4",
      "mimetype": "text/x-python",
      "codemirror_mode": { "name": "ipython", "version": 3 },
      "pygments_lexer": "ipython3",
      "file_extension": ".py"
    }
  },
  "cells": []
}
```

### 2.2 Cell Definitions
Every cell is an object containing `cell_type`, `metadata`, `source`, and optionally `execution_count` and `outputs`.

#### A. Markdown Cells (`cell_type: "markdown"`)
- **`source`**: An array of strings or a single string containing CommonMark/GitHub Flavored Markdown mixed with LaTeX math delimiters (`$...$` for inline, `$$...$$` for block display).
- **`metadata`**: Optional metadata including `id` (nbformat v4.5+), `tags`, and slide-show directives.

#### B. Code Cells (`cell_type: "code"`)
- **`source`**: The code payload executed by the kernel.
- **`execution_count`**: Integer indicating sequential execution order, or `null` if unexecuted.
- **`metadata`**: Controls cell behavior:
  - `collapsed` (boolean): Whether output is collapsed.
  - `scrolled` (boolean | "auto"): Output scrolling behavior.
  - `jupyter`: Object containing cell execution timestamps (`execution: { iopub.execute_input: ... }`).
- **`outputs`**: An ordered array of output objects.

#### C. Raw Cells (`cell_type: "raw"`)
- **`source`**: Unprocessed text intended for external converters (e.g., LaTeX, reStructuredText, HTML).
- **`metadata`**: Contains `format` (e.g., `"text/html"` or `"text/latex"`).

### 2.3 Output Types & MIME Bundles
Jupyter outputs represent polymorphic execution results:

| Output Type | Identifying Keys | Payload Structure | Security Risk |
| :--- | :--- | :--- | :--- |
| `stream` | `name: "stdout" \| "stderr"`, `text` | Multiline string array | ANSI escape injection, buffer flooding |
| `display_data` | `data` (MIME bundle), `metadata` | Polymorphic MIME object | XSS via `text/html`, `image/svg+xml`, `application/javascript` |
| `execute_result` | `execution_count`, `data`, `metadata` | Polymorphic MIME object | Same as `display_data` |
| `error` | `ename`, `evalue`, `traceback` | Array of strings with ANSI color codes | ANSI escape injection |

#### MIME Bundle Resolution Precedence
When a cell produces multiple representations in `data`, the renderer must select the highest-fidelity representation supported, in strict order:
1. `application/vnd.jupyter.widget-state+json` / custom interactive widgets (rendered inside sandboxed iframe).
2. `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
3. `image/svg+xml` (sanitized or isolated via `<img>`).
4. `text/html` (DOMPurify sanitized).
5. `text/latex` / `text/markdown`.
6. `text/plain` (raw fallback).

### 2.4 Evolution: nbformat v4 vs v5
- **v4.0 - v4.4**: Cells lacked mandatory unique identifiers; cell diffing relied on array index or source hashing.
- **v4.5**: Introduced the mandatory `id` string field (1-64 alphanumeric characters) per cell, enabling stable reference tracking and clean cell version diffing.
- **v5.0 (Draft)**: Modernizes cell attachments and streamlines metadata schemas.
- **TeleBook Invariant**: Parser accepts v4.0 through v5.x; if cell `id` is missing (legacy v4.0-v4.4), the parser assigns a deterministic hash-based UUID on ingestion to guarantee immutable cell referencing.

---

## 3. Telegram Bot API Constraints, Limits & Quirks

Telegram provides enterprise-grade, geographically replicated object storage disguised as an instant messaging protocol. To leverage it reliably, the system must navigate Telegram's hard operational limits:

| Parameter | Telegram Hard Limit | TeleBook Engineering Strategy |
| :--- | :--- | :--- |
| **`sendDocument` Upload Cap** | **50 MB** per file payload | Pre-split files into **15 MB chunks** before encryption |
| **`getFile` Download Cap** | **20 MB** per file for standard bot tokens | **15 MB chunks** guarantee downloads never hit the 20 MB ceiling |
| **Inline Button `callback_data`** | **64 bytes** UTF-8 maximum | Use compact binary/base64 encoded action tags (e.g., `o:<uuid-8>`) |
| **Chat Rate Limit** | **1 msg/sec** per target chat | Queue and batch updates; debounce status notifications |
| **Global Bot Rate Limit** | **30 msgs/sec** across all chats | Client-side chunk streaming directly via signed worker URLs |
| **Webhook Response Window** | **50 seconds** before timeout | Return HTTP `200 OK` immediately; process asynchronously |
| **Text Message Length** | **4,096 characters** | Truncate or link to Mini App reader for long outputs |
| **Caption Length** | **1,024 characters** | Store metadata in D1, not in Telegram file captions |
| **File Persistence** | Indefinite for bot-uploaded files | Safe against expiration; files remain reachable via `file_id` |

### The Critical 20 MB `getFile` Trap
Many projects mistakenly assume Telegram's 50 MB upload limit applies to downloads. While a bot can upload a 49 MB file via `sendDocument`, attempting to call `getFile` on that file fails with:
`{"ok":false,"error_code":400,"description":"Bad Request: file is too big"}`.
TeleBook's strict **15 MB chunk boundary** completely avoids this trap.

---

## 4. Cloudflare Free-Tier Platform Boundaries

TeleBook operates within Cloudflare's serverless free-tier ecosystem. Every component is engineered to fit within these constraints:

### 4.1 Cloudflare Workers
- **CPU Time Limit**: **10 milliseconds** of active CPU time per invocation.
  - *Engineering Solution*: Offload all heavy asymmetric/symmetric cryptography, markdown parsing, and rendering to the browser or CLI. Workers perform only sub-millisecond HMAC signature checks and streaming chunk passthrough using native `crypto.subtle`.
- **Memory Limit**: **128 MB** per isolate.
  - *Engineering Solution*: Never buffer 15 MB chunks in memory. Use Web Streams (`ReadableStream.pipeTo()`) for zero-allocation binary piping.
- **Subrequest Cap**: **50 requests** per worker invocation.
  - *Engineering Solution*: Upload each chunk in an independent worker invocation; manifest updates batched in D1.

### 4.2 Cloudflare D1 (Serverless SQLite)
- **Storage**: **5 GB** database size (sufficient for millions of chunk manifests and notebook metadata records).
- **Daily Quotas**:
  - Reads: **5,000,000 rows/day**.
  - Writes: **100,000 rows/day**.
- **Execution Limits**: Max 500 statements per batch; max 100KB per SQL statement.
- *Engineering Solution*: All lookups hit indexed B-Trees (`INDEX ON notebooks(id, user_id)`). Manifest updates use `db.batch()` to combine chunk insertions into a single database roundtrip.

### 4.3 Cloudflare Pages
- **Bandwidth**: Unlimited.
- **Static Assets**: Up to 20,000 files per deployment; 25 MB max file size.
- Hosts the compiled React Telegram Mini App, Pyodide WebAssembly bundles, and static assets.

---

## 5. Competitor Teardown & Gap Analysis

```
+--------------------+--------------+-------------+-----------------+---------------+
| Feature / Flaw     | nbviewer.org | GitHub View | Google Colab    | TeleBook      |
+--------------------+--------------+-------------+-----------------+---------------+
| Infrastructure Cost| Cloud VMs    | Proprietary | Cloud Compute   | $0 (Serverless|
| Access Control     | Public Only  | Repo ACL    | Google Account  | Single-Owner  |
| Zero-Knowledge E2EE| None         | None        | None            | TELEBOOK_V1   |
| Large Notebook Rel.| Poor (504s)  | Fails > 2MB | Good            | 15MB Chunks   |
| In-Browser Run     | None         | None        | Remote VM       | WASM Pyodide  |
| Mobile / TMA UX    | Broken       | Unresponsive| Awkward         | Native TMA    |
| Vendor Lock-in     | Low          | Medium      | High            | Zero (export) |
+--------------------+--------------+-------------+-----------------+---------------+
```

### Detailed Competitor Failures:
1. **nbviewer.org**:
   - Dependent on Jupyter's central infrastructure. Suffers frequent HTTP 504 gateway timeouts when rendering notebooks containing large Matplotlib figures or dense dataframes.
   - Caches rendered HTML aggressively with opaque eviction policies; updates to GitHub gists take hours to reflect.
   - Zero privacy: any notebook viewed is publicly exposed on the web.
2. **GitHub Notebook Viewer**:
   - Renders notebooks on the server into a static, unresponsive DOM. Notebooks exceeding ~2MB trigger the notorious error: *"Unable to render code block"*.
   - LaTeX equations regularly fail to parse or render improperly formatted math expressions.
   - Strips all interactive JavaScript widgets (Plotly, Bokeh, ipywidgets).
3. **Google Colab**:
   - Designed for heavy cloud compute rather than lightweight viewing and sharing. Spin-up time takes 15-45 seconds while allocating a cloud container.
   - Injects proprietary metadata fields (`colab: { provenance: [] }`) into the notebook JSON, causing merge conflicts in git repositories.
4. **TeleDrive**:
   - Treats Telegram as raw, indiscriminate file storage. Because it does not chunk files to 15MB or encrypt with application-level AAD binding, it suffers from Telegram download limits and privacy vulnerabilities.

---

## 6. UX Psychology of Reading Notebooks

Data scientists, machine learning engineers, and researchers do not read Jupyter notebooks the same way developers read source code. Reading a notebook is an exercise in **bimodal cognitive navigation**: alternating between analytical prose and technical verification.

### 6.1 The "Narrative First" Cognitive Model
- Readers scan the narrative arc: Markdown titles, abstract, conclusions, and visual figures first.
- Only when an anomaly or interesting claim appears does the reader inspect the code cell that produced the figure.
- **Design Mandate**: Code cells must be visually subordinate to narrative text and graphical outputs. Provide one-click "Fold All Code" and "Show Results Only" viewing modes.

### 6.2 Visual Hierarchy & Output Clutter Reduction
- **Monospace Fatigue**: Long blocks of unformatted monospace text induce rapid cognitive fatigue on mobile displays.
- **ANSI Terminal Output**: Stack traces and compiler outputs must be styled with clean, accessible terminal color palettes (using accessible ANSI color mappings) rather than raw unformatted terminal dumps.
- **Scroll Hijacking Prevention**: When a cell outputs a 10,000-row pandas DataFrame, the main document scroll must not be captured. Outputs must be clamped to `max-height: 480px` with internal smooth scrolling and an "Expand to Full" trigger.

### 6.3 Mobile Telegram Mini App Ergonomics
- The primary reading context is on smartphones (iOS / Android) inside Telegram.
- Thumbs operate in the bottom 40% of the screen. Critical navigation controls (Table of Contents drawer, search, execution toggle) must be placed in the thumb zone.
- Seamless Dark/Light mode switching: the notebook paper canvas and code syntax theme must dynamically mirror Telegram's client theme without flashes of unstyled content.

---

## 7. The 18-Item Known Failure Matrix with Concrete Engineering Mitigations

| # | Failure Mode | Root Cause | Impact | TeleBook Engineering Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Telegram `getFile` 20MB Rejection** | Bot API restricts `getFile` download to 20 MB | Notebooks > 20 MB fail to download | Strict 15 MB chunk partitioning prior to encryption |
| **2** | **XSS via `text/html` Output** | Malicious scripts in cell execution results | Account compromise, session theft | DOMPurify with strict HTML/MathML allowlist; strip all `<script>`, `<base>` |
| **3** | **Interactive JS Output Origin Escape** | Plotly/Bokeh widgets executing in parent frame | Access to Telegram `initData` & local storage | Isolate all interactive widget outputs inside `iframe sandbox="allow-scripts"` (omit `allow-same-origin`) |
| **4** | **Cloudflare Worker 10ms CPU Overrun** | Pure-JS AES-GCM or markdown compilation in worker | Worker killed by V8 isolate watchdog (HTTP 1101) | Offload all parsing/crypto to client; use hardware-accelerated `crypto.subtle` for HMAC only |
| **5** | **Cloudflare Worker Out-of-Memory (OOM)** | Buffering 15 MB ArrayBuffers during concurrent uploads | Worker process termination (128 MB RAM cap) | Direct pass-through Web Streams (`request.body.pipeTo()`); zero RAM buffering |
| **6** | **Cloudflare D1 Query Quota Exhaustion** | Unindexed `SELECT * WHERE user_id = ?` full scans | 5M read limit breached; service throttled | Explicit B-Tree indices on all lookup keys (`user_id`, `notebook_id`, `version`, `hash`) |
| **7** | **Telegram Mini App Keyboard Layout Collapse** | `window.innerHeight` collapses when mobile keyboard opens | UI jumps, floating action bar covers input | Bind layouts to `Telegram.WebApp.viewportStableHeight`; listen to `viewportChanged` |
| **8** | **Accidental Gesture App Closure** | User pulls down while scrolling notebook top | Telegram closes Mini App; unsaved work lost | Call `Telegram.WebApp.enableClosingConfirmation()`; apply CSS `overscroll-behavior-y: contain` |
| **9** | **Replay Attacks on `initData`** | Re-sending intercepted Telegram authentication strings | Unauthorized session creation | Validate `auth_date` within 86,400s; verify `hash` using secret key derived from bot token |
| **10** | **Timing Attacks on Signature Checks** | String comparison (`===`) terminates on first byte mismatch | Attacker deduces valid HMAC byte-by-byte | Constant-time XOR comparison (`crypto.subtle.timingSafeEqual` equivalent) |
| **11** | **LaTeX ReDoS / Expansion Bombs** | Malicious TeX macros (`\def\a{\a\a}\a`) in markdown | Browser UI freezes, infinite regex loop | Configure KaTeX with `maxSize: 500`, `maxExpand: 1000`, `trust: false` |
| **12** | **SVG Script Execution Injection** | `<svg><script>alert(1)</script></svg>` in cell outputs | Stored XSS in viewer context | Render SVGs strictly via `<img src="data:image/svg+xml;base64,...">` or sanitize via DOMPurify SVG profile |
| **13** | **CSS Injection & Clickjacking** | Untrusted `<style>` tags overriding global layout | Invisible overlay clicks hijack user actions | Strip all `<style>` elements from notebook outputs; isolate cell DOM via Shadow DOM / scoped CSS |
| **14** | **Chunk Swapping / Omission Attack** | Attacker substitutes chunk 2 from v1 into v2 | Corrupted notebook or targeted payload delivery | Cryptographic AAD binding: `notebook_id:version:chunk_index:total_chunks` checked on decrypt |
| **15** | **Telegram Bot API Rate Limiting (429)** | Rapid burst uploads of multi-chunk notebooks | Telegram returns HTTP 429 with `retry_after` | Exponential backoff client-side queue; sequence uploads with 500ms delay |
| **16** | **Malformed nbformat JSON Crashing Parser** | Corrupted JSON, circular structures, or missing keys | Application white-screen crash | Strict Zod validation on parse; fallback to raw text view if schema validation fails |
| **17** | **Zombie Session Tokens After Revocation** | Issued JWTs remain valid until token expiry | Compromised device retains access | Global session epoch in D1 `users.auth_epoch`; token epoch checked on every authenticated call |
| **18** | **Pyodide WASM Memory Leaks** | Repeated execution of heavy cells exhausts browser RAM | Mobile browser tab crashes (iOS WebKit Jetsam) | Web Worker execution isolation; terminate and restart Worker if heap exceeds threshold (500 MB) |
