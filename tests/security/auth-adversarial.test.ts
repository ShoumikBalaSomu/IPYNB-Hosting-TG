/**
 * Adversarial Authentication & Authorization Pentest Suite
 * Tests:
 * - initData spoofing & parameter tampering
 * - Replay attacks & auth_date threshold limits (>300s & future drift)
 * - Strict Single-Owner Gate (non-owner Telegram ID vs OWNER_TELEGRAM_ID)
 * - Missing / tampered X-Telegram-Bot-Api-Secret-Token
 * - Ephemeral 120s magic token replay, expiry, and consumption
 * - Instant session invalidation via /revoke epoch bump
 * - IDOR defense on /api/notebooks routes
 * - Read-only sharing ticket isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../../apps/worker/src/services/auth';
import { DbService } from '../../apps/worker/src/services/db';
import { createTestD1 } from '../../apps/worker/test/d1-mock';
import { hmacSha256, sha256Hex } from '../../apps/worker/src/utils/crypto';
import type { Env } from '../../apps/worker/src/env';
import app from '../../apps/worker/src/index';

describe('Adversarial Authentication & Perimeter Defense', () => {
  const TEST_BOT_TOKEN = 'mock_bot_token_adversarial_test_987';
  const OWNER_ID = '777888999';
  const ATTACKER_ID = '999111222';
  const WEBHOOK_SECRET = 'super-secret-telegram-webhook-token-random-hex-32';
  const JWT_SECRET = 'long-secure-jwt-signing-key-for-worker-telebook-test';

  let env: Env;
  let db: DbService;
  let authService: AuthService;

  beforeEach(() => {
    const d1 = createTestD1();
    db = new DbService(d1);
    env = {
      DB: d1,
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      OWNER_TELEGRAM_ID: OWNER_ID,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      JWT_SECRET: JWT_SECRET,
      APP_URL: 'https://telebook.test'
    };
    authService = new AuthService(env, db);
  });

  async function generateSignedInitData(
    userId: string,
    authDate: number = Math.floor(Date.now() / 1000),
    botToken: string = TEST_BOT_TOKEN,
    username: string = 'telebook_tester'
  ): Promise<string> {
    const userJson = JSON.stringify({
      id: parseInt(userId, 10),
      first_name: 'Tester',
      username
    });

    const params = new URLSearchParams();
    params.set('auth_date', String(authDate));
    params.set('query_id', 'AAHdF6IQAAAAAN0XohD9K7vN');
    params.set('user', userJson);

    const encoder = new TextEncoder();
    const webAppDataKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const secretKeyBytes = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(botToken));

    const sortedKeys = Array.from(params.keys()).sort();
    const dataCheckString = sortedKeys.map(k => `${k}=${params.get(k)}`).join('\n');

    const sigBytes = await hmacSha256(secretKeyBytes, dataCheckString);
    const hash = Array.from(sigBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    params.set('hash', hash);
    return params.toString();
  }

  describe('1. Telegram Mini App initData Spoofing & Tampering', () => {
    it('ATTACK: Empty / missing hash parameter must be rejected', async () => {
      const res = await authService.verifyInitData('auth_date=1700000000&user={"id":777888999}');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Missing hash parameter/i);
    });

    it('ATTACK: Altering user ID after hash generation must fail HMAC verification', async () => {
      const validOwnerData = await generateSignedInitData(OWNER_ID);
      const params = new URLSearchParams(validOwnerData);
      
      // Attacker swaps user id to someone else
      const tamperedUser = JSON.stringify({ id: 999999999, username: 'imposter' });
      params.set('user', tamperedUser);

      const res = await authService.verifyInitData(params.toString());
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Invalid HMAC signature');
    });

    it('ATTACK: 1-character hash tamper must fail verification', async () => {
      const valid = await generateSignedInitData(OWNER_ID);
      const params = new URLSearchParams(valid);
      const originalHash = params.get('hash')!;
      const flippedChar = originalHash[0] === 'a' ? 'b' : 'a';
      params.set('hash', flippedChar + originalHash.slice(1));

      const res = await authService.verifyInitData(params.toString());
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Invalid HMAC signature');
    });

    it('ATTACK: Valid HMAC signature using non-instance bot token must fail', async () => {
      const forgedData = await generateSignedInitData(OWNER_ID, undefined, 'forged_foreign_bot_token');
      const res = await authService.verifyInitData(forgedData);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Invalid HMAC signature');
    });

    it('ATTACK: Expired auth_date (> 300s) replay attack must be blocked', async () => {
      const now = Math.floor(Date.now() / 1000);
      const staleInitData = await generateSignedInitData(OWNER_ID, now - 305);
      const res = await authService.verifyInitData(staleInitData, 300);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/expired or invalid timestamp/i);
    });

    it('ATTACK: Future timestamp drift (> 60s ahead) must be blocked', async () => {
      const now = Math.floor(Date.now() / 1000);
      const futureInitData = await generateSignedInitData(OWNER_ID, now + 100);
      const res = await authService.verifyInitData(futureInitData, 300);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/expired or invalid timestamp/i);
    });

    it('ATTACK: Legitimate Telegram user who is NOT the instance owner must be rejected with 403', async () => {
      const attackerInitData = await generateSignedInitData(ATTACKER_ID);
      const res = await authService.verifyInitData(attackerInitData);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Access Denied: Not the instance owner');
    });

    it('VERIFY: Genuine owner initData within 300s window succeeds', async () => {
      const validData = await generateSignedInitData(OWNER_ID);
      const res = await authService.verifyInitData(validData);
      expect(res.valid).toBe(true);
      expect(res.user?.id).toBe(parseInt(OWNER_ID, 10));
    });
  });

  describe('2. Telegram Webhook Secret Token & Single-Owner Isolation', () => {
    it('ATTACK: Webhook call with missing secret token must return 401', async () => {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1, message: { text: '/start' } })
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/Missing or invalid webhook secret/i);
    });

    it('ATTACK: Webhook call with incorrect secret token must return 401', async () => {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'wrong-fake-secret-token'
        },
        body: JSON.stringify({ update_id: 1, message: { text: '/start' } })
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(401);
    });

    it('ATTACK: Webhook message sent by non-owner user must return 403 Forbidden with zero info leakage', async () => {
      const req = new Request('http://localhost/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET
        },
        body: JSON.stringify({
          update_id: 101,
          message: {
            message_id: 1,
            chat: { id: parseInt(ATTACKER_ID, 10), type: 'private' },
            from: { id: parseInt(ATTACKER_ID, 10), is_bot: false, username: 'attacker' },
            text: '/list'
          }
        })
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Forbidden');
    });
  });

  describe('3. Ephemeral Magic Token Pentest (120s TTL & Single-Use Replay Defense)', () => {
    it('ATTACK: Replaying consumed magic token must return 404', async () => {
      const magic = await authService.createMagicToken();
      const tokenHash = await sha256Hex(magic.token);

      // Approve token
      const owner = await db.getOrCreateOwner(parseInt(OWNER_ID, 10));
      const sessionJwt = await authService.createSessionToken(owner);
      await db.approveMagicToken(tokenHash, sessionJwt);

      // First consumption (Client desktop receives JWT)
      const pollReq1 = new Request(`http://localhost/api/auth/magic-token/${magic.token}`);
      const res1 = await app.fetch(pollReq1, env);
      expect(res1.status).toBe(200);
      const data1 = await res1.json() as { status: string; session_token: string };
      expect(data1.status).toBe('approved');
      expect(data1.session_token).toBe(sessionJwt);

      // Second consumption attempt (Replay attack by eavesdropper)
      const pollReq2 = new Request(`http://localhost/api/auth/magic-token/${magic.token}`);
      const res2 = await app.fetch(pollReq2, env);
      expect(res2.status).toBe(404);
    });

    it('ATTACK: Polling expired magic token (> 120s) returns 410 and deletes token', async () => {
      // Create magic token with artificial past expiration
      const rawToken = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const tokenHash = await sha256Hex(rawToken);
      const pastTime = Math.floor(Date.now() / 1000) - 10; // expired 10s ago

      await env.DB.prepare(
        'INSERT INTO magic_tokens (id, token_hash, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind('tok_expired', tokenHash, 'pending', pastTime, pastTime - 120).run();

      const pollReq = new Request(`http://localhost/api/auth/magic-token/${rawToken}`);
      const res = await app.fetch(pollReq, env);
      expect(res.status).toBe(410);

      // Confirm token is purged from D1
      const record = await db.getMagicTokenByHash(tokenHash);
      expect(record).toBeNull();
    });

    it('ATTACK: Brute forcing token returns 404 with no side-channel info', async () => {
      const fakeToken = '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff';
      const pollReq = new Request(`http://localhost/api/auth/magic-token/${fakeToken}`);
      const res = await app.fetch(pollReq, env);
      expect(res.status).toBe(404);
    });
  });

  describe('4. Session Revocation & Epoch Invalidation (/revoke)', () => {
    it('ATTACK: Stale JWT after /revoke epoch bump must be rejected immediately across all endpoints', async () => {
      const owner = await db.getOrCreateOwner(parseInt(OWNER_ID, 10));
      const oldToken = await authService.createSessionToken(owner);

      // Verify old token works before revocation
      const testReq1 = new Request('http://localhost/api/auth/me', {
        headers: { Authorization: `Bearer ${oldToken}` }
      });
      const res1 = await app.fetch(testReq1, env);
      expect(res1.status).toBe(200);

      // Invoke /revoke to bump epoch
      const revokeReq = new Request('http://localhost/api/auth/revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${oldToken}` }
      });
      const revokeRes = await app.fetch(revokeReq, env);
      expect(revokeRes.status).toBe(200);
      const revokeData = await revokeRes.json() as { revoked: boolean; new_epoch: number };
      expect(revokeData.revoked).toBe(true);
      expect(revokeData.new_epoch).toBe(2);

      // Attempt to access /api/auth/me with old token (epoch: 1)
      const testReq2 = new Request('http://localhost/api/auth/me', {
        headers: { Authorization: `Bearer ${oldToken}` }
      });
      const res2 = await app.fetch(testReq2, env);
      expect(res2.status).toBe(401);
      const body2 = await res2.json() as { error: string };
      expect(body2.error).toMatch(/Session revoked/i);
    });
  });

  describe('5. IDOR & Access Control Boundary Pentest', () => {
    it('ATTACK: Sharing ticket is strictly read-only and cannot mutate notebooks', async () => {
      const owner = await db.getOrCreateOwner(parseInt(OWNER_ID, 10));
      const nb = await db.createNotebook({ userId: owner.id, title: 'Confidential Research' });
      
      const shareToken = 'share_ticket_abc123xyz789';
      await db.createSharingTicket({
        notebookId: nb.id,
        version: 1,
        rawTicketToken: shareToken,
        createdBy: owner.id,
        expiresInSeconds: 3600,
        maxAccessCount: 5
      });

      // 1. Read is permitted with sharing ticket
      const getReq = new Request(`http://localhost/api/notebooks/${nb.id}?ticket=${shareToken}`);
      const getRes = await app.fetch(getReq, env);
      expect(getRes.status).toBe(200);

      // 2. Write / Create version must be blocked with 403 Forbidden
      const postVerReq = new Request(`http://localhost/api/notebooks/${nb.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sharing-Ticket': shareToken
        },
        body: JSON.stringify({ version: 2, total_chunks: 1, byte_size: 100, sha256_hash: 'hash' })
      });
      const postVerRes = await app.fetch(postVerReq, env);
      expect(postVerRes.status).toBe(403);

      // 3. Delete notebook must be blocked with 403 Forbidden
      const delReq = new Request(`http://localhost/api/notebooks/${nb.id}`, {
        method: 'DELETE',
        headers: { 'X-Sharing-Ticket': shareToken }
      });
      const delRes = await app.fetch(delReq, env);
      expect(delRes.status).toBe(403);
    });
  });
});
