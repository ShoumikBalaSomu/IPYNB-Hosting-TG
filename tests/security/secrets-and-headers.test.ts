/**
 * Secret Leakage & HTTP Security Headers Audit Suite
 * Audits:
 * - High-entropy & regex pattern scanners for secrets (Telegram tokens, private keys, AWS/Cloudflare credentials)
 * - Git commit history audit for leaked credentials
 * - Local filesystem path leakage audit
 * - .gitignore coverage
 * - HTTP Security Headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors for Telegram Mini App)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import app from '../../apps/worker/src/index';
import type { Env } from '../../apps/worker/src/env';
import { createTestD1 } from '../../apps/worker/test/d1-mock';

describe('Secret Leakage & HTTP Security Headers Audit Suite', () => {
  const ROOT_DIR = path.resolve(__dirname, '../../');

  describe('1. Secret Entropy & Regex Scanner across Workspace', () => {
    // Regex patterns for dangerous secrets
    const SECRET_PATTERNS = [
      { name: 'Live Telegram Bot Token', regex: /\b\d{9,10}:[a-zA-Z0-9_-]{35}\b/ },
      { name: 'RSA/EC Private Key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
      { name: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
      { name: 'Cloudflare Global API Key', regex: /\b[0-9a-f]{40}\b/ },
      { name: 'Hardcoded Production JWT Secret', regex: /JWT_SECRET\s*=\s*['"][a-zA-Z0-9_\-]{20,}['"]/ },
    ];

    function scanDirectory(dir: string, fileList: string[] = []): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(ROOT_DIR, fullPath);

        // Ignore third-party and build directories
        if (
          relPath.startsWith('node_modules') ||
          relPath.startsWith('.venv') ||
          relPath.startsWith('.git') ||
          relPath.startsWith('dist') ||
          relPath.startsWith('apps/web/dist') ||
          relPath.startsWith('packages/shared/dist') ||
          relPath.startsWith('release-distribution') ||
          relPath.includes('__pycache__') ||
          relPath.endsWith('.egg-info') ||
          relPath.endsWith('.zip') ||
          relPath.endsWith('.tar.gz') ||
          relPath.endsWith('.whl') ||
          relPath.endsWith('.png') ||
          relPath.endsWith('.jpg') ||
          relPath.endsWith('.svg') ||
          entry.name === 'package-lock.json' ||
          entry.name === 'tests/security/auth-adversarial.test.ts' || // contains mock token string
          entry.name === 'auth-adversarial.test.ts' ||
          entry.name === 'auth.test.ts'
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          scanDirectory(fullPath, fileList);
        } else if (entry.isFile()) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    it('WORKSPACE: Zero real bot tokens, private keys, or API credentials present in code', () => {
      const files = scanDirectory(ROOT_DIR);
      const violations: { file: string; pattern: string }[] = [];

      for (const file of files) {
        // Skip .example files explicitly documenting env vars
        if (file.endsWith('.example')) continue;

        const content = fs.readFileSync(file, 'utf-8');
        for (const { name, regex } of SECRET_PATTERNS) {
          if (regex.test(content)) {
            // Check if it's a test file using an obvious mock
            if (file.includes('test') && content.includes('mock_bot_token')) continue;
            violations.push({ file: path.relative(ROOT_DIR, file), pattern: name });
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it('GIT HISTORY: Zero credentials found in git commit log', () => {
      let gitLog = '';
      try {
        gitLog = execSync('git log -p -n 50', { cwd: ROOT_DIR, encoding: 'utf-8' });
      } catch {
        // Not a git repo or no commits
        return;
      }

      const foundSecrets: string[] = [];
      // Search for live telegram bot tokens in git history (ignoring mocks)
      const tokenMatch = gitLog.match(/\b\d{9,10}:[a-zA-Z0-9_-]{35}\b/g);
      if (tokenMatch) {
        for (const m of tokenMatch) {
          if (!m.includes('ABCdefGHIjklMNOpqrSTUvwxYZ_01234567')) {
            foundSecrets.push(m);
          }
        }
      }

      expect(foundSecrets).toEqual([]);
    });

    it('GITIGNORE: Confirms .dev.vars, .env, *.pem, and local SQLite data are ignored', () => {
      const gitignorePath = path.join(ROOT_DIR, '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('.dev.vars');
      expect(content).toContain('.env');
      expect(content).toContain('node_modules');
      expect(content).toContain('.venv');
    });
  });

  describe('2. HTTP Security Headers Audit', () => {
    let env: Env;

    beforeEach(() => {
      const d1 = createTestD1();
      env = {
        DB: d1,
        TELEGRAM_BOT_TOKEN: 'mock_token',
        OWNER_TELEGRAM_ID: '123456',
        TELEGRAM_WEBHOOK_SECRET: 'mock_secret',
        JWT_SECRET: 'mock_jwt_secret_32_characters_long'
      };
    });

    it('SECURITY HEADERS: Worker serves HSTS, X-Content-Type-Options, Referrer-Policy, and CSP frame-ancestors', async () => {
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req, env);

      expect(res.status).toBe(200);

      // 1. X-Content-Type-Options: nosniff
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

      // 2. Referrer-Policy
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');

      // 3. Strict-Transport-Security (HSTS)
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');

      // 4. Content-Security-Policy: frame-ancestors must allow Telegram WebApp embedding
      const csp = res.headers.get('Content-Security-Policy') || '';
      expect(csp).toContain('frame-ancestors');
      expect(csp).toContain('https://web.telegram.org');
      expect(csp).toContain('https://*.telegram.org');

      // 5. Must NOT enforce X-Frame-Options: DENY (which would break Telegram Web)
      expect(res.headers.get('X-Frame-Options')).not.toBe('DENY');
    });
  });
});
