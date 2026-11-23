---
trigger: glob
globs: "apps/web/**/*.{ts,tsx,css}"
description: "Enforce Telegram Mini App viewportStableHeight, safeAreaInset, Bot API 10.2+ same-origin rules, and WCAG 2.1 AA+."
---

# Rule: Telegram Mini App UX & Accessibility Standards (`ui-psychology-tma`)

## 1. Telegram Mini App (TMA) Lifecycle & Viewport Invariants

### 1.1 Viewport Stability and Sizing
- Always call `Telegram.WebApp.ready()` and `Telegram.WebApp.expand()` immediately on app initialization.
- Monitor `Telegram.WebApp.viewportStableHeight` instead of generic `window.innerHeight`. On mobile devices (iOS / Android), keyboard popups trigger sudden viewport contractions; using `viewportStableHeight` prevents jarring layout shifts.
- Prevent accidental gesture-based app closure during notebook scrolling:
  - Call `Telegram.WebApp.enableClosingConfirmation()` when edits or uploads are in flight.
  - Set CSS `overscroll-behavior-y: contain;` and `touch-action: pan-y;` on the root notebook container.

### 1.2 Telegram Safe Area Insets (Bot API 7.0+)
- Never position interactive controls (such as bottom action bars, floating navigation menus, or floating TOC buttons) flush against screen edges.
- Respect Telegram safe area insets via CSS custom properties:
  ```css
  padding-top: max(env(safe-area-inset-top), var(--tg-content-safe-area-inset-top, 0px));
  padding-bottom: max(env(safe-area-inset-bottom), var(--tg-content-safe-area-inset-bottom, 0px));
  padding-left: max(env(safe-area-inset-left), var(--tg-content-safe-area-inset-left, 0px));
  padding-right: max(env(safe-area-inset-right), var(--tg-content-safe-area-inset-right, 0px));
  ```

### 1.3 Bot API 10.2+ Same-Origin & Security Rules
- Comply with Bot API 10.2+ specifications: Mini Apps must not attempt top-level frame navigation or bypass origin boundaries.
- Cross-origin assets and sandboxed JupyterLite / Pyodide WebAssembly environments must be served with strict CORS headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` when using `SharedArrayBuffer` for Pyodide execution).

## 2. Telegram Native Theme & Tactile Integration

### 2.1 CSS Theme Variables
- Synchronize all component styling with Telegram client theme parameters:
  - Background: `var(--tg-theme-bg-color, #ffffff)`
  - Text: `var(--tg-theme-text-color, #000000)`
  - Secondary Background: `var(--tg-theme-secondary-bg-color, #f4f4f5)`
  - Hint / Muted Text: `var(--tg-theme-hint-color, #71717a)`
  - Primary Accent / Button: `var(--tg-theme-button-color, #2563eb)`
  - Button Text: `var(--tg-theme-button-text-color, #ffffff)`
- Support seamless auto-switching when user toggles dark / light mode inside Telegram.

### 2.2 Tactile Haptic Feedback
- Trigger Telegram native haptics on discrete user actions:
  - Copy code cell: `Telegram.WebApp.HapticFeedback.notificationOccurred('success')`
  - Toggle code cell collapse / expand: `Telegram.WebApp.HapticFeedback.impactOccurred('light')`
  - Long press cell / bookmark: `Telegram.WebApp.HapticFeedback.impactOccurred('medium')`
  - Error or validation failure: `Telegram.WebApp.HapticFeedback.notificationOccurred('error')`

## 3. Notebook UX Psychology & Reading Flow

### 3.1 Cognitive Load Management in Notebooks
- **Foldable Code Cells**: On mobile viewports, code inputs should be collapsible by default if their output is an image or visualization, allowing readers to focus on narrative and results.
- **Horizontal Overflow Protection**: Long code lines and wide pandas DataFrames must never break the main page layout. Enforce `overflow-x: auto` with custom scrollbar indicators.
- **Sticky Table of Contents (TOC)**: Provide a lightweight, slide-over drawer showing markdown heading hierarchy (`H1`, `H2`, `H3`) with active scroll-spy highlighting.
- **Output Truncation**: Text outputs exceeding 50 lines or 100 KB must be truncated with an explicit "Expand output (X lines)" control.

## 4. Accessibility (WCAG 2.1 AA+) Compliance
- **Contrast Ratio**: Minimum 4.5:1 contrast for regular text against background; minimum 3:1 for large text and UI borders.
- **Keyboard Navigation**: All interactive elements (run buttons, fold triggers, copy controls) must be tab-navigable with visible focus rings (`focus-visible:ring-2 focus-visible:ring-blue-500`).
- **Screen Reader Support**: Output cells must declare `aria-live="polite"` when executing code live. Collapsible sections must provide `aria-expanded="true|false"` and `aria-controls`.
- **Motion Reduction**: Respect `prefers-reduced-motion: reduce` by disabling smooth scrolling animations and transitions.
