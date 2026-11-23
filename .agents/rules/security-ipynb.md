---
trigger: model_decision
description: "Enforce strict .ipynb XSS sanitization, opaque sandboxed iframes, AES-256-GCM crypto, and single-owner auth."
---

# Rule: Jupyter Notebook Security & Sanitization (`security-ipynb`)

## 1. Context and Threat Model
Jupyter notebooks (`.ipynb`) contain arbitrary user-generated Markdown, raw HTML, SVG diagrams, and interactive MIME outputs (such as `text/html`, `image/svg+xml`, `application/javascript`, and custom widget state).
Because notebooks frequently execute code and render rich visualization libraries (Plotly, Bokeh, Altair, Matplotlib), they are a prime target for stored Cross-Site Scripting (XSS), DOM clobbering, CSS injection, clickjacking, and token exfiltration.

## 2. Mandatory Sanitization Directives

### 2.1 Markdown & HTML Output Sanitization
- All cell markdown and standard HTML outputs (`text/html`) MUST be sanitized prior to DOM insertion using DOMPurify with strict profile constraints:
  ```typescript
  DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'data-*']
  });
  ```
- All external links rendered within notebook cells MUST enforce `rel="noopener noreferrer nofollow"` and `target="_blank"`.

### 2.2 Opaque Sandboxed Iframes for Interactive Script Outputs
- Any output requiring JavaScript execution (e.g., custom Plotly figures, Bokeh charts, or `application/javascript` MIME payloads) MUST be isolated within an opaque, sandboxed `<iframe>`:
  - Enforce attributes: `sandbox="allow-scripts"` (NEVER include `allow-same-origin` or `allow-top-navigation`).
  - Without `allow-same-origin`, the iframe operates under an opaque origin (`null`), strictly preventing access to `localStorage`, session cookies, Telegram WebApp `initData`, or parent DOM contexts.
  - Inter-frame messaging between the parent reader and the sandboxed iframe MUST use `window.postMessage` with strict structural typing and validation of `event.data`.

### 2.3 SVG Sanitization
- `image/svg+xml` payloads frequently embed `<script>` tags, XML external entities (XXE), and xlink exploits.
- SVGs must either be sanitized with DOMPurify's SVG profile or rendered strictly via `<img>` tags (`<img src="data:image/svg+xml;base64,...">`), which browsers natively isolate from JavaScript execution.

## 3. Cryptographic Invariants (`TELEBOOK_V1`)
- Plaintext notebooks MUST NEVER touch the server or Telegram storage unencrypted.
- Only the authenticated client holds the cryptographic key.
- Every encrypted chunk must bind the Additional Authenticated Data (`AAD`) as:
  $$\text{AAD} = \text{notebook\_id} + ":" + \text{version} + ":" + \text{chunk\_index} + ":" + \text{total\_chunks}$$
- Decryption must verify the GCM 128-bit authentication tag before any bytes are forwarded to the parser.

## 4. Single-Owner Authentication Guard
- Verify that every incoming session token or Telegram Mini App auth string resolves to the pinned `OWNER_TELEGRAM_ID`.
- If an authorization header or query token does not match `OWNER_TELEGRAM_ID`, drop the request immediately with HTTP 403.
