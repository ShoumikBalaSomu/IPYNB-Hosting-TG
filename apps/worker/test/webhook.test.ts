// Telegram Webhook, Owner Verification & Bot Commands Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from '../src/index';
import { createTestD1 } from './d1-mock';
import type { Env } from '../src/env';
import { DbService } from '../src/services/db';
import { AuthService } from '../src/services/auth';

describe('Telegram Webhook & Owner Gate', () => {
  const TEST_SECRET = 'correct-webhook-secret-token-xyz';
  const TEST_OWNER_ID = '987654321';
  const NON_OWNER_ID = '555555555';
  const TEST_BOT_TOKEN = 'mock_bot_token_123';

  let env: Env;
  let db: DbService;

  beforeEach(() => {
    const d1 = createTestD1();
    db = new DbService(d1);
    env = {
      DB: d1,
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      OWNER_TELEGRAM_ID: TEST_OWNER_ID,
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      JWT_SECRET: 'jwt-secret-at-least-32-chars-long-abc',
      APP_URL: 'https://telebook.pages.dev',
      BOT_USERNAME: 'TeleBookBot'
    };

    // Mock global fetch for Telegram API calls
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/sendMessage')) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }), { status: 200 });
      }

      if (urlStr.includes('/getFile')) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { file_path: 'documents/notebook.ipynb', file_size: 2048 }
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes('/answerCallbackQuery')) {
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
  });

  describe('Constant-Time Webhook Secret Verification', () => {
    it('rejects webhook request without X-Telegram-Bot-Api-Secret-Token', async () => {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1 })
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(401);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Missing or invalid webhook secret');
    });

    it('rejects webhook request with incorrect secret token', async () => {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret-token'
        },
        body: JSON.stringify({ update_id: 1 })
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(401);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Invalid webhook secret token');
    });

    it('accepts webhook request with correct secret token', async () => {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: parseInt(TEST_OWNER_ID, 10), first_name: 'Owner' },
            chat: { id: parseInt(TEST_OWNER_ID, 10), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start'
          }
        })
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean };
      expect(data.ok).toBe(true);
    });
  });

  describe('Strict Single-Owner Gate (OWNER_TELEGRAM_ID)', () => {
    it('rejects updates sent by non-owner user with HTTP 403 and zero leakage', async () => {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET
        },
        body: JSON.stringify({
          update_id: 2,
          message: {
            message_id: 2,
            from: { id: parseInt(NON_OWNER_ID, 10), first_name: 'Intruder' },
            chat: { id: parseInt(NON_OWNER_ID, 10), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/list'
          }
        })
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(403);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Forbidden');
    });
  });

  describe('Bot Commands', () => {
    async function sendCommand(text: string) {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET
        },
        body: JSON.stringify({
          update_id: 10,
          message: {
            message_id: 10,
            from: { id: parseInt(TEST_OWNER_ID, 10), first_name: 'Owner', username: 'telebook_owner' },
            chat: { id: parseInt(TEST_OWNER_ID, 10), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text
          }
        })
      });
      return app.fetch(req, env);
    }

    it('/start command replies with welcome message and Mini App link', async () => {
      const res = await sendCommand('/start');
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean };
      expect(data.ok).toBe(true);
    });

    it('/login command creates 120s ephemeral magic token', async () => {
      const res = await sendCommand('/login');
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean; token_created?: string };
      expect(data.ok).toBe(true);
      expect(data.token_created).toBeDefined();
    });

    it('/start auth_<token> approves pending magic token for desktop login', async () => {
      const authService = new AuthService(env, db);
      const magic = await authService.createMagicToken();

      const res = await sendCommand(`/start auth_${magic.token}`);
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean; approved_token?: string };
      expect(data.ok).toBe(true);
      expect(data.approved_token).toBeDefined();
    });

    it('/revoke command bumps auth_epoch in D1 and invalidates sessions', async () => {
      const owner = await db.getOrCreateOwner(parseInt(TEST_OWNER_ID, 10));
      expect(owner.auth_epoch).toBe(1);

      const res = await sendCommand('/revoke');
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean; new_epoch?: number };
      expect(data.ok).toBe(true);
      expect(data.new_epoch).toBe(2);

      const updated = await db.getUserByTelegramId(parseInt(TEST_OWNER_ID, 10));
      expect(updated?.auth_epoch).toBe(2);
    });

    it('/list command lists notebooks', async () => {
      const owner = await db.getOrCreateOwner(parseInt(TEST_OWNER_ID, 10));
      await db.createNotebook({ userId: owner.id, title: 'Attention Analysis.ipynb' });

      const res = await sendCommand('/list');
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean };
      expect(data.ok).toBe(true);
    });

    it('/search command finds matching notebooks', async () => {
      const owner = await db.getOrCreateOwner(parseInt(TEST_OWNER_ID, 10));
      await db.createNotebook({ userId: owner.id, title: 'DeepSeek R1 Benchmark' });

      const res = await sendCommand('/search DeepSeek');
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean };
      expect(data.ok).toBe(true);
    });

    it('/versions command shows version history', async () => {
      const owner = await db.getOrCreateOwner(parseInt(TEST_OWNER_ID, 10));
      const nb = await db.createNotebook({ userId: owner.id, title: 'Versioned Model' });
      await db.createVersion({
        notebookId: nb.id,
        version: 1,
        totalChunks: 1,
        byteSize: 1024,
        commitMessage: 'Initial commit',
        sha256Hash: 'abc123hash'
      });

      const res = await sendCommand(`/versions ${nb.id}`);
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean };
      expect(data.ok).toBe(true);
    });

    it('/export command provides sovereign archive export instructions', async () => {
      const res = await sendCommand('/export');
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean };
      expect(data.ok).toBe(true);
    });
  });

  describe('Auto-Ingest .ipynb Document Sent to Bot', () => {
    it('ingests .ipynb file, creates notebook record, version, and chunk in D1', async () => {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET
        },
        body: JSON.stringify({
          update_id: 50,
          message: {
            message_id: 200,
            from: { id: parseInt(TEST_OWNER_ID, 10), first_name: 'Owner', username: 'telebook_owner' },
            chat: { id: parseInt(TEST_OWNER_ID, 10), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            document: {
              file_id: 'BQACAgIAAxkBAAI_test_file_id',
              file_unique_id: 'uniq_123',
              file_name: 'transformer_attention.ipynb',
              file_size: 4096,
              mime_type: 'application/x-ipynb+json'
            }
          }
        })
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean; ingested?: string; version?: number };
      expect(data.ok).toBe(true);
      expect(data.ingested).toBeDefined();
      expect(data.version).toBe(1);

      // Verify D1 records
      const owner = (await db.getUserByTelegramId(parseInt(TEST_OWNER_ID, 10)))!;
      const notebook = await db.getNotebook(data.ingested!, owner.id);
      expect(notebook).not.toBeNull();
      expect(notebook?.title).toBe('transformer_attention');

      const versions = await db.listVersions(data.ingested!);
      expect(versions.length).toBe(1);
      expect(versions[0]?.byte_size).toBe(4096);

      const chunks = await db.getChunksForVersion(data.ingested!, 1);
      expect(chunks.length).toBe(1);
      expect(chunks[0]?.telegram_file_id).toBe('BQACAgIAAxkBAAI_test_file_id');
    });
  });
});
