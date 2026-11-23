---
name: ipynb-security-audit
description: Auditing protocol for Jupyter Notebook (.ipynb) parsers, renderers, and execution environments. Detects XSS vectors, DOM clobbering, CSS injection, LaTeX exploits, and sandbox escapes.
---

# Jupyter Notebook Security Audit Protocol (`ipynb-security-audit`)

## 1. Overview
Jupyter Notebooks combine Markdown prose, executable code, and arbitrary MIME type outputs. When rendered in web applications or Telegram Mini Apps, untrusted notebooks can execute malicious payloads unless strictly audited and contained.

Use this skill when developing, reviewing, or testing notebook parsing, rendering, and in-browser execution logic.

## 2. Threat Vectors & Verification Checklist

### 2.1 Markdown Cell Payloads
- **Raw HTML Elements**: Check for `<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<form>`, `<input>`, `<base>`, and `<meta>`.
  - *Mitigation*: Run DOMPurify with an explicit tag allowlist and forbid dangerous tags.
- **Event Handler Attributes**: Check for `onload=`, `onerror=`, `onmouseover=`, `onclick=`, `autofocus`.
  - *Mitigation*: DOMPurify configured with `FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'data-*']`.
- **Dangerous Schemes in Links and Images**: Check for `javascript:`, `vbscript:`, `data:text/html`.
  - *Mitigation*: Enforce URI scheme allowlist (`http`, `https`, `mailto`). Force `rel="noopener noreferrer nofollow"` and `target="_blank"`.

### 2.2 Rich MIME Output Payloads (`display_data`, `execute_result`)
- **`text/html` Output**: Notebooks often output tables or rich HTML snippets (e.g., `pandas.DataFrame.to_html()`).
  - *Audit*: Is `text/html` being passed directly to `innerHTML` or `dangerouslySetInnerHTML`?
  - *Mitigation*: DOMPurify sanitization before insertion.
- **`image/svg+xml` Payloads**: SVGs can contain embedded `<script>` blocks or event handlers.
  - *Audit*: Verify SVGs are not injected raw into the parent document DOM.
  - *Mitigation*: Render as `<img src="data:image/svg+xml;base64,...">` or sanitize with DOMPurify SVG profile.
- **`application/javascript` Payloads**: Produced by interactive charting libraries (Plotly, Altair, Bokeh).
  - *Audit*: Must NEVER be executed in the main application origin.
  - *Mitigation*: Must be isolated in an opaque sandboxed iframe (`sandbox="allow-scripts"` without `allow-same-origin`).

### 2.3 Mathematical Typography & LaTeX Injection (KaTeX / MathJax)
- **Malicious TeX Macros**: TeX syntax can include `\href{javascript:...}`, `\url`, or recursive macros causing ReDoS.
  - *Audit*: KaTeX configuration must have `trust: false` (disallowing arbitrary URLs and HTML macros).
  - *Mitigation*: Set `maxSize: 500`, `maxExpand: 1000` to prevent denial-of-service via deeply nested expansions.

### 2.4 CSS Injection & DOM Clobbering
- **Global Style Bleed**: Untrusted `<style>` tags can override parent UI styles, hide security warnings, or position transparent overlay links over action buttons.
  - *Audit*: Strip all `<style>` tags from rendered markdown and HTML outputs, or scope them strictly via CSS containment/Shadow DOM.
- **Named Form Elements**: Elements with `id="fetch"` or `name="cookie"` can clobber `window` properties.
  - *Mitigation*: Enable DOMPurify `SANITIZE_DOM: true`.

### 2.5 Iframe Sandbox Boundary Testing
- Verify sandboxed iframes do NOT have:
  - `allow-same-origin`: If present alongside `allow-scripts`, the child iframe can remove its own sandbox and execute code in the parent origin.
  - `allow-top-navigation`: Must not redirect the top frame.
  - `allow-modals`, `allow-popups-to-escape-sandbox`: Kept disabled unless strictly necessary.
- Verify `postMessage` listener:
  - Always validate `event.origin`.
  - Strictly schema-validate `event.data` using Zod before processing.

## 3. Audit Procedure
1. Run the test suite against known CVE test cases (e.g., CVE-2022-39286 Jupyter Server XSS, SVG event handler exploits).
2. Inspect AST transformers for unhandled node types.
3. Verify that Content Security Policy (CSP) headers block inline scripts outside sandboxed iframes.
4. Document any findings with severity rating (Critical, High, Medium, Low) and concrete remediations.
