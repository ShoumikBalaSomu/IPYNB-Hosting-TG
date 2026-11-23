// REST API Routes, Notebook CRUD, Streaming & Sharing Tickets Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from '../src/index';
import { createTestD1 } from './d1-mock';
import type { Env } from '../src/env';
import { DbService } from '../src/services/db';
import { AuthService } from '../src/services/auth';
import type { UserRecord } from '../src/types';

describe('REST API Routes & Chunk Streaming', () => {
  const TEST_OWNER_ID = '987654321';
  const TEST_JWT_SECRET = 'jwt-secret-at-least-32-chars-long-abc';
  const TEST_BOT_TOKEN = 'mock_bot_token_123';

  let env: Env;
  let db: DbService;
  let authService: AuthService;
  let owner: UserRecord;
  let sessionToken: string;

  beforeEach(async () => {
    const d1 = createTestD1();
    db = new DbService(d1);
    env = {
      DB: d1,
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      OWNER_TELEGRAM_ID: TEST_OWNER_ID,
      TELEGRAM_WEBHOOK_SECRET: 'test-secret',
      JWT_SECRET: TEST_JWT_SECRET,
      APP_URL: 'https://telebook.pages.dev',
      BOT_USERNAME: 'TeleBookBot'
    };
    authService = new AuthService(env, db);

    owner = await db.getOrCreateOwner(parseInt(TEST_OWNER_ID, 10), 'telebook_owner');
    sessionToken = await authService.createSessionToken(owner);

    // Mock Telegram Bot API fetch
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/sendDocument')) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 301,
              document: { file_id: 'BQACAgIAAxkBAAI_streamed_file_id' }
            }
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes('/getFile')) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { file_path: 'documents/streamed_chunk.tb01', file_size: 1024 }
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes('/file/bot')) {
        const dummyBinary = new Uint8Array([0x54, 0x42, 0x30, 0x31, 0x01, 0x02, 0x03]);
        return new Response(dummyBinary, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '7' }
        });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
  });

  describe('Health Check', () => {
    it('GET /health returns 200 OK', async () => {
      const res = await app.fetch(new Request('http://localhost/health'), env);
      expect(res.status).toBe(200);
      const data = await res.json() as { status: string; service: string };
      expect(data.status).toBe('ok');
      expect(data.service).toBe('telebook-worker');
    });
  });

  describe('Notebook CRUD Endpoints', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.fetch(new Request('http://localhost/api/notebooks'), env);
      expect(res.status).toBe(401);
    });

    it('creates, retrieves, updates, and deletes a notebook', async () => {
      // 1. Create Notebook
      const createReq = new Request('http://localhost/api/notebooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          title: 'Quantum State Estimation',
          description: 'Qiskit variational algorithm',
          tags: ['quantum', 'qiskit']
        })
      });

      const createRes = await app.fetch(createReq, env);
      expect(createRes.status).toBe(201);
      const createdData = await createRes.json() as { notebook: { id: string; title: string; tags: string[] } };
      const notebookId = createdData.notebook.id;
      expect(notebookId).toMatch(/^nb_/);
      expect(createdData.notebook.title).toBe('Quantum State Estimation');
      expect(createdData.notebook.tags).toEqual(['quantum', 'qiskit']);

      // 2. List Notebooks
      const listReq = new Request('http://localhost/api/notebooks', {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      const listRes = await app.fetch(listReq, env);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json() as { notebooks: { id: string }[] };
      expect(listData.notebooks.some(n => n.id === notebookId)).toBe(true);

      // 3. Search Notebooks
      const searchReq = new Request('http://localhost/api/notebooks?q=Quantum', {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      const searchRes = await app.fetch(searchReq, env);
      expect(searchRes.status).toBe(200);
      const searchData = await searchRes.json() as { notebooks: { id: string }[] };
      expect(searchData.notebooks.length).toBe(1);

      // 4. Update Notebook
      const patchReq = new Request(`http://localhost/api/notebooks/${notebookId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          is_starred: true,
          description: 'Updated description'
        })
      });
      const patchRes = await app.fetch(patchReq, env);
      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json() as { notebook: { is_starred: boolean; description: string } };
      expect(patchData.notebook.is_starred).toBe(true);
      expect(patchData.notebook.description).toBe('Updated description');

      // 5. Delete Notebook
      const delReq = new Request(`http://localhost/api/notebooks/${notebookId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      const delRes = await app.fetch(delReq, env);
      expect(delRes.status).toBe(200);

      // Verify deletion
      const getDeleted = await app.fetch(
        new Request(`http://localhost/api/notebooks/${notebookId}`, {
          headers: { 'Authorization': `Bearer ${sessionToken}` }
        }),
        env
      );
      expect(getDeleted.status).toBe(404);
    });
  });

  describe('Versions & Streaming Chunks', () => {
    let notebookId: string;

    beforeEach(async () => {
      const nb = await db.createNotebook({ userId: owner.id, title: 'Streaming Test Notebook' });
      notebookId = nb.id;
    });

    it('uploads chunk stream, records manifest, commits version, and downloads stream', async () => {
      const dummyChunk = new Uint8Array([0x54, 0x42, 0x30, 0x31, 0xAA, 0xBB, 0xCC]);
      const chunkHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

      // 1. Upload Chunk
      const uploadReq = new Request(
        `http://localhost/api/notebooks/${notebookId}/versions/1/chunks/0`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Chunk-Hash': chunkHash,
            'X-Total-Chunks': '1',
            'X-Byte-Length': String(dummyChunk.byteLength),
            'Authorization': `Bearer ${sessionToken}`
          },
          body: dummyChunk
        }
      );

      const uploadRes = await app.fetch(uploadReq, env);
      expect(uploadRes.status).toBe(201);
      const uploadData = await uploadRes.json() as { chunk_index: number; telegram_file_id: string; status: string };
      expect(uploadData.chunk_index).toBe(0);
      expect(uploadData.status).toBe('stored');

      // 2. Commit Version
      const commitReq = new Request(`http://localhost/api/notebooks/${notebookId}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          version: 1,
          total_chunks: 1,
          byte_size: dummyChunk.byteLength,
          commit_message: 'Initial streamed version commit',
          sha256_hash: chunkHash
        })
      });

      const commitRes = await app.fetch(commitReq, env);
      expect(commitRes.status).toBe(201);

      // 3. Retrieve Version Manifest
      const manifestReq = new Request(`http://localhost/api/notebooks/${notebookId}/versions/1`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      const manifestRes = await app.fetch(manifestReq, env);
      expect(manifestRes.status).toBe(200);
      const manifestData = await manifestRes.json() as { version: number; chunks: { chunk_index: number }[] };
      expect(manifestData.version).toBe(1);
      expect(manifestData.chunks.length).toBe(1);

      // 4. Download Chunk Stream
      const downloadReq = new Request(
        `http://localhost/api/notebooks/${notebookId}/versions/1/chunks/0`,
        {
          headers: { 'Authorization': `Bearer ${sessionToken}` }
        }
      );
      const downloadRes = await app.fetch(downloadReq, env);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get('Content-Type')).toBe('application/octet-stream');
      const bodyBytes = new Uint8Array(await downloadRes.arrayBuffer());
      expect(bodyBytes.byteLength).toBe(7);
      expect(bodyBytes[0]).toBe(0x54); // 'T'
      expect(bodyBytes[1]).toBe(0x42); // 'B'
    });

    it('propagates upstream Telegram 429 rate limit with Retry-After header', async () => {
      // Mock 429 from Telegram
      vi.stubGlobal('fetch', async (url: string | URL | Request) => {
        if (url.toString().includes('/sendDocument')) {
          return new Response(JSON.stringify({ ok: false, parameters: { retry_after: 15 } }), {
            status: 429
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const uploadReq = new Request(
        `http://localhost/api/notebooks/${notebookId}/versions/1/chunks/0`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Chunk-Hash': 'test-hash',
            'Authorization': `Bearer ${sessionToken}`
          },
          body: new Uint8Array([1, 2, 3])
        }
      );

      const uploadRes = await app.fetch(uploadReq, env);
      expect(uploadRes.status).toBe(429);
      expect(uploadRes.headers.get('Retry-After')).toBe('15');
      const errData = await uploadRes.json() as { retry_after: number };
      expect(errData.retry_after).toBe(15);
    });
  });

  describe('Cryptographic Sharing Tickets', () => {
    it('creates sharing ticket and allows read-only access to version', async () => {
      const nb = await db.createNotebook({ userId: owner.id, title: 'Shared Research' });
      await db.createVersion({
        notebookId: nb.id,
        version: 1,
        totalChunks: 1,
        byteSize: 500,
        sha256Hash: 'dummy'
      });

      // 1. Create ticket
      const shareReq = new Request(`http://localhost/api/notebooks/${nb.id}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ version: 1, max_access_count: 5 })
      });

      const shareRes = await app.fetch(shareReq, env);
      expect(shareRes.status).toBe(201);
      const shareData = await shareRes.json() as { ticket_token: string; share_url: string };
      expect(shareData.ticket_token).toBeDefined();

      // 2. Access notebook using ticket without Bearer token
      const accessReq = new Request(`http://localhost/api/notebooks/${nb.id}?ticket=${shareData.ticket_token}`);
      const accessRes = await app.fetch(accessReq, env);
      expect(accessRes.status).toBe(200);

      // 3. Sharing ticket cannot mutate or delete
      const deleteReq = new Request(`http://localhost/api/notebooks/${nb.id}?ticket=${shareData.ticket_token}`, {
        method: 'DELETE'
      });
      const deleteRes = await app.fetch(deleteReq, env);
      expect(deleteRes.status).toBe(403);
    });
  });

  describe('Zero-Lock-In Export Route', () => {
    it('GET /api/export returns full archive manifest of all notebooks and chunks', async () => {
      await db.createNotebook({ userId: owner.id, title: 'Archived 1' });
      await db.createNotebook({ userId: owner.id, title: 'Archived 2' });

      const exportReq = new Request('http://localhost/api/export', {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });

      const exportRes = await app.fetch(exportReq, env);
      expect(exportRes.status).toBe(200);
      const exportData = await exportRes.json() as { notebook_count: number; notebooks: unknown[] };
      expect(exportData.notebook_count).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(exportData.notebooks)).toBe(true);
    });
  });
});
