// Authentication, Mini App initData and Session Epoch Invalidation Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../src/services/auth';
import { DbService } from '../src/services/db';
import { createTestD1 } from './d1-mock';
import type { Env } from '../src/env';
import { hmacSha256 } from '../src/utils/crypto';

describe('AuthService', () => {
  const TEST_BOT_TOKEN = 'mock_bot_token_123456789';
  const TEST_OWNER_ID = '987654321';
  const TEST_JWT_SECRET = 'super-secret-jwt-key-minimum-32-characters-long';

  let env: Env;
  let db: DbService;
  let authService: AuthService;

  beforeEach(() => {
    const d1 = createTestD1();
    db = new DbService(d1);
    env = {
      DB: d1,
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      OWNER_TELEGRAM_ID: TEST_OWNER_ID,
      TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      JWT_SECRET: TEST_JWT_SECRET
    };
    authService = new AuthService(env, db);
  });

  // Helper to create valid Telegram Mini App initData
  async function createMockInitData(
    userId: string,
    authDate: number = Math.floor(Date.now() / 1000),
    botToken: string = TEST_BOT_TOKEN
  ): Promise<string> {
    const userJson = JSON.stringify({
      id: parseInt(userId, 10),
      first_name: 'TestOwner',
      username: 'telebook_owner'
    });

    const params = new URLSearchParams();
    params.set('auth_date', String(authDate));
    params.set('query_id', 'AAHdF6IQAAAAAN0XohD9K7vN');
    params.set('user', userJson);

    // Compute secret key: HMAC-SHA256("WebAppData", botToken)
    const encoder = new TextEncoder();
    const webAppDataKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const secretKeyBytes = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(botToken));

    // Sort parameters alphabetically
    const sortedKeys = Array.from(params.keys()).sort();
    const dataCheckString = sortedKeys.map(k => `${k}=${params.get(k)}`).join('\n');

    // Compute signature
    const sigBytes = await hmacSha256(secretKeyBytes, dataCheckString);
    const hash = Array.from(sigBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    params.set('hash', hash);
    return params.toString();
  }

  describe('verifyInitData', () => {
    it('verifies genuine Telegram Mini App initData for owner', async () => {
      const initData = await createMockInitData(TEST_OWNER_ID);
      const res = await authService.verifyInitData(initData);

      expect(res.valid).toBe(true);
      expect(res.user?.id).toBe(parseInt(TEST_OWNER_ID, 10));
      expect(res.user?.username).toBe('telebook_owner');
    });

    it('rejects initData signed by a non-owner Telegram user', async () => {
      const nonOwnerId = '1122334455';
      const initData = await createMockInitData(nonOwnerId);
      const res = await authService.verifyInitData(initData);

      expect(res.valid).toBe(false);
      expect(res.error).toBe('Access Denied: Not the instance owner');
    });

    it('rejects initData with expired auth_date (> 300s)', async () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 350; // 350s ago
      const initData = await createMockInitData(TEST_OWNER_ID, staleTimestamp);
      const res = await authService.verifyInitData(initData, 300);

      expect(res.valid).toBe(false);
      expect(res.error).toBe('Auth payload expired or invalid timestamp');
    });

    it('rejects initData with future auth_date (> now + 60s)', async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120; // 120s in future
      const initData = await createMockInitData(TEST_OWNER_ID, futureTimestamp);
      const res = await authService.verifyInitData(initData, 300);

      expect(res.valid).toBe(false);
      expect(res.error).toBe('Auth payload expired or invalid timestamp');
    });

    it('rejects tampered hash signature', async () => {
      const initData = await createMockInitData(TEST_OWNER_ID);
      const tampered = initData.replace(/hash=[a-f0-9]{10}/, 'hash=0000000000');
      const res = await authService.verifyInitData(tampered);

      expect(res.valid).toBe(false);
      expect(res.error).toBe('Invalid HMAC signature');
    });

    it('rejects initData signed with wrong bot token', async () => {
      const initData = await createMockInitData(TEST_OWNER_ID, Math.floor(Date.now() / 1000), 'wrong_bot_token');
      const res = await authService.verifyInitData(initData);

      expect(res.valid).toBe(false);
      expect(res.error).toBe('Invalid HMAC signature');
    });
  });

  describe('Session JWT & Epoch Revocation (/revoke)', () => {
    it('creates and verifies session token', async () => {
      const owner = await db.getOrCreateOwner(parseInt(TEST_OWNER_ID, 10), 'telebook_owner');
      const token = await authService.createSessionToken(owner);

      const verified = await authService.verifySession(token);
      expect(verified.valid).toBe(true);
      expect(verified.user?.telegram_id).toBe(parseInt(TEST_OWNER_ID, 10));
      expect(verified.user?.auth_epoch).toBe(1);
    });

    it('immediately invalidates issued token when auth_epoch is bumped (/revoke)', async () => {
      const owner = await db.getOrCreateOwner(parseInt(TEST_OWNER_ID, 10), 'telebook_owner');
      const token = await authService.createSessionToken(owner);

      // Verify token is valid initially
      const preRevoke = await authService.verifySession(token);
      expect(preRevoke.valid).toBe(true);

      // Simulate /revoke: bump auth_epoch in D1
      const newEpoch = await db.bumpAuthEpoch(owner.telegram_id);
      expect(newEpoch).toBe(2);

      // The existing token embedding epoch: 1 MUST now be rejected
      const postRevoke = await authService.verifySession(token);
      expect(postRevoke.valid).toBe(false);
      expect(postRevoke.error).toBe('Session revoked (auth epoch mismatch)');

      // Newly issued token with new epoch is valid
      const updatedUser = (await db.getUserByTelegramId(owner.telegram_id))!;
      const newToken = await authService.createSessionToken(updatedUser);
      const newVerified = await authService.verifySession(newToken);
      expect(newVerified.valid).toBe(true);
      expect(newVerified.user?.auth_epoch).toBe(2);
    });
  });

  describe('Magic Token Flow (120s TTL)', () => {
    it('generates 256-bit magic token with 120s expiry and approve flow', async () => {
      const magic = await authService.createMagicToken();
      expect(magic.token.length).toBe(64); // 32 bytes hex
      expect(magic.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(magic.deepLink).toContain(`start=auth_${magic.token}`);

      const tokenRecord = await db.getMagicTokenByHash(await (await import('../src/utils/crypto')).sha256Hex(magic.token));
      expect(tokenRecord).not.toBeNull();
      expect(tokenRecord?.status).toBe('pending');

      // Approve token
      const owner = await db.getOrCreateOwner(parseInt(TEST_OWNER_ID, 10));
      const sessionJwt = await authService.createSessionToken(owner);
      const approved = await db.approveMagicToken(tokenRecord!.token_hash, sessionJwt);
      expect(approved).toBe(true);

      // Consume token (single use)
      const consumed = await db.consumeMagicToken(tokenRecord!.token_hash);
      expect(consumed?.status).toBe('approved');
      expect(consumed?.session_jwt).toBe(sessionJwt);

      // After consumption, token record is purged
      const deletedRecord = await db.getMagicTokenByHash(tokenRecord!.token_hash);
      expect(deletedRecord).toBeNull();
    });
  });
});
