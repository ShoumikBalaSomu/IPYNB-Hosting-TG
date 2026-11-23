/**
 * Weaponized .ipynb Ingestion & Rendering Pentest Suite
 * Tests:
 * - DOMPurify sanitization profile on all XSS attack vectors (<script>, <img onerror>, <svg onload>, <foreignObject>, javascript: URIs)
 * - CSS Injection prevention (<style> tag neutralization)
 * - DOM Clobbering defense (SANITIZE_DOM: true)
 * - KaTeX LaTeX injection (\href{javascript:...}) and ReDoS macro bomb containment
 * - Safe JSON Parser prototype pollution (__proto__, constructor, prototype) rejection
 * - Nesting depth bomb rejection (> 50 levels)
 * - Oversized cell count bomb rejection (> 5000 cells)
 * - Opaque sandboxed iframe security contract (sandbox="allow-scripts" WITHOUT allow-same-origin)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import katex from 'katex';
import { safeJsonParse, safeParseNotebook, JsonSecurityError } from '../../packages/shared/src/parser/safe-json';

const domWindow = new JSDOM('').window;
const DOMPurify = createDOMPurify(domWindow as unknown as Window & typeof globalThis);

// TeleBook production sanitization configuration (from MarkdownCell.tsx & OutputView.tsx)
const TELEBOOK_DOMPURIFY_CONFIG = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  ADD_ATTR: ['target', 'rel', 'class', 'id', 'aria-hidden'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base', 'style'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'data-*'],
  SANITIZE_DOM: true,
};

// TeleBook hardened KaTeX options (from katexRenderer.ts)
const KATEX_SAFE_OPTIONS = {
  throwOnError: false,
  trust: false,
  maxSize: 500,
  maxExpand: 1000,
  strict: false,
};

describe('Weaponized .ipynb Ingestion & Rendering Security Suite', () => {
  describe('1. DOMPurify XSS Vector Neutralization', () => {
    it('ATTACK: Neutralizes raw <script> execution tags', () => {
      const malicious = '<p>Normal text</p><script>alert("XSS-RAW-SCRIPT");</script>';
      const clean = DOMPurify.sanitize(malicious, TELEBOOK_DOMPURIFY_CONFIG);
      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('XSS-RAW-SCRIPT');
      expect(clean).toContain('<p>Normal text</p>');
    });

    it('ATTACK: Strips onerror and event handlers from <img> tags', () => {
      const malicious = '<img src="nonexistent.png" onerror="window.__pwned=true;alert(1)" alt="photo" />';
      const clean = DOMPurify.sanitize(malicious, TELEBOOK_DOMPURIFY_CONFIG);
      expect(clean).not.toContain('onerror');
      expect(clean).not.toContain('window.__pwned');
      expect(clean).toContain('<img');
    });

    it('ATTACK: Disarms SVG onload and embedded scripts', () => {
      const malicious = '<svg onload="alert(\'svg-xss\')"><script>alert(1)</script><circle cx="50" cy="50" r="40"/></svg>';
      const clean = DOMPurify.sanitize(malicious, TELEBOOK_DOMPURIFY_CONFIG);
      expect(clean).not.toContain('onload');
      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('alert');
    });

    it('ATTACK: Disarms SVG foreignObject payload containing XHTML body and script', () => {
      const malicious = `
        <svg width="200" height="100">
          <foreignObject width="200" height="100">
            <body xmlns="http://www.w3.org/1999/xhtml">
              <script>window.__xss=true;</script>
              <div>Injected Div</div>
            </body>
          </foreignObject>
        </svg>
      `;
      const clean = DOMPurify.sanitize(malicious, TELEBOOK_DOMPURIFY_CONFIG);
      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('window.__xss');
    });

    it('ATTACK: Disarms javascript: URIs in anchor links', () => {
      const malicious = '<a href="javascript:alert(\'pwned\')">Click to win prize</a>';
      const clean = DOMPurify.sanitize(malicious, TELEBOOK_DOMPURIFY_CONFIG);
      expect(clean).not.toContain('javascript:');
      expect(clean).not.toContain('alert');
    });

    it('ATTACK: Completely removes <style> tags preventing CSS injection & clickjacking', () => {
      const malicious = `
        <style>body { display: none !important; } .overlay { position: fixed; }</style>
        <div class="overlay">Phishing overlay</div>
      `;
      const clean = DOMPurify.sanitize(malicious, TELEBOOK_DOMPURIFY_CONFIG);
      expect(clean).not.toContain('<style');
      expect(clean).not.toContain('display: none');
    });

    it('ATTACK: Neutralizes DOM clobbering attempts (SANITIZE_DOM: true)', () => {
      const malicious = '<form id="cookie"><input id="value" name="stolen" /></form><input id="fetch" />';
      const clean = DOMPurify.sanitize(malicious, TELEBOOK_DOMPURIFY_CONFIG);
      expect(clean).not.toContain('<form');
    });
  });

  describe('2. KaTeX LaTeX Injection & ReDoS Defense', () => {
    it('ATTACK: KaTeX trust: false neutralizes \\href with javascript: scheme', () => {
      const maliciousFormula = '\\href{javascript:alert(1)}{Malicious Link}';
      const rendered = katex.renderToString(maliciousFormula, KATEX_SAFE_OPTIONS);
      // With trust: false, KaTeX does not output href="javascript:..."
      expect(rendered).not.toContain('href="javascript:');
    });

    it('ATTACK: KaTeX maxExpand limits recursive macro expansion without hanging', () => {
      const macroBomb = '\\def\\a{\\b\\b}\\def\\b{\\a\\a}\\a';
      // KaTeX should either safely fail or stop at maxExpand (1000) within milliseconds
      const start = Date.now();
      const rendered = katex.renderToString(macroBomb, KATEX_SAFE_OPTIONS);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000); // Must resolve in < 1s
      expect(rendered).toBeDefined();
    });
  });

  describe('3. Safe JSON Parser Adversarial Fixture Defense', () => {
    it('ATTACK: Rejects prototype-pollution.ipynb with __proto__ injection', () => {
      const fixturePath = path.resolve(__dirname, '../fixtures/prototype-pollution.ipynb');
      const content = fs.readFileSync(fixturePath, 'utf-8');

      expect(() => {
        safeJsonParse(content);
      }).toThrow(JsonSecurityError);

      expect(() => {
        safeJsonParse(content);
      }).toThrow(/Dangerous prototype pollution key detected/i);

      // Verify Object.prototype was NOT polluted
      expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('ATTACK: Rejects deeply-nested-bomb.json exceeding 50 nesting levels', () => {
      const fixturePath = path.resolve(__dirname, '../fixtures/deeply-nested-bomb.json');
      const content = fs.readFileSync(fixturePath, 'utf-8');

      expect(() => {
        safeJsonParse(content);
      }).toThrow(JsonSecurityError);

      expect(() => {
        safeJsonParse(content);
      }).toThrow(/nesting depth exceeded safety threshold/i);
    });

    it('ATTACK: Rejects cell-overflow-bomb.json exceeding 5,000 cells', () => {
      const fixturePath = path.resolve(__dirname, '../fixtures/cell-overflow-bomb.json');
      const content = fs.readFileSync(fixturePath, 'utf-8');

      expect(() => {
        safeParseNotebook(content);
      }).toThrow(JsonSecurityError);

      expect(() => {
        safeParseNotebook(content);
      }).toThrow(/cell count.*exceeds safety limit/i);
    });

    it('ATTACK: Rejects oversized payload (> 100 MB)', () => {
      const oversizedText = ' '.repeat(101) + '{"nbformat": 4}';
      expect(() => {
        safeJsonParse(oversizedText, { maxPayloadBytes: 100 });
      }).toThrow(JsonSecurityError);

      expect(() => {
        safeJsonParse(oversizedText, { maxPayloadBytes: 100 });
      }).toThrow(/exceeds maximum limit/i);
    });
  });

  describe('4. Opaque Sandboxed Iframe Security Invariants', () => {
    it('VERIFY: SandboxedIframe enforces sandbox="allow-scripts" WITHOUT allow-same-origin', () => {
      const iframeComponentPath = path.resolve(__dirname, '../../apps/web/src/components/SandboxedIframe.tsx');
      const source = fs.readFileSync(iframeComponentPath, 'utf-8');

      // Assert sandbox attribute exists and strictly matches allow-scripts
      expect(source).toMatch(/sandbox\s*=\s*["']allow-scripts["']/);

      // Assert sandbox attribute NEVER includes allow-same-origin or allow-top-navigation
      expect(source).not.toMatch(/sandbox\s*=\s*["'][^"']*allow-same-origin/);
      expect(source).not.toMatch(/sandbox\s*=\s*["'][^"']*allow-top-navigation/);
    });

    it('VERIFY: OutputView isolates application/javascript in SandboxedIframe', () => {
      const outputViewPath = path.resolve(__dirname, '../../apps/web/src/components/OutputView.tsx');
      const source = fs.readFileSync(outputViewPath, 'utf-8');

      expect(source).toContain("data['application/javascript']");
      expect(source).toContain('<SandboxedIframe htmlContent={`<script>${rawJs}</script>`} />');
    });

    it('VERIFY: SVG outputs are rendered strictly via <img> data URI isolation', () => {
      const outputViewPath = path.resolve(__dirname, '../../apps/web/src/components/OutputView.tsx');
      const source = fs.readFileSync(outputViewPath, 'utf-8');

      expect(source).toContain("data['image/svg+xml']");
      expect(source).toContain('data:image/svg+xml;base64');
      expect(source).toContain('<img');
    });
  });
});
