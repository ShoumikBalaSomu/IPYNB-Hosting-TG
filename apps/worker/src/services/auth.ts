// Authentication and cryptographic identity verification service

import type { Env } from '../env';
import type { TelegramUser, SessionPayload, UserRecord } from '../types';
import { timingSafeEqual, hmacSha256, signJwt, verifyJwt, generateSecureRandomHex } from '../utils/crypto';
import type { DbService } from './db';

const encoder = new TextEncoder();

export class AuthService {
  constructor(private env: Env, private db: DbService) {}

  /**
   * Cryptographically verify Telegram Mini App initData using native Web Crypto.
   * Enforces 300s freshness check and strict single-owner ID validation.
   */
  async verifyInitData(
    initData: string,
    maxAgeSeconds = 300 // 300 seconds as specified in brief
  ): Promise<{ valid: boolean; user?: TelegramUser; error?: string }> {
    if (!initData) {
      return { valid: false, error: 'Missing initData payload' };
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      return { valid: false, error: 'Missing hash parameter in initData' };
    }

    // Remove hash and sort remaining parameters alphabetically
    params.delete('hash');
    const sortedKeys = Array.from(params.keys()).sort();
    const dataCheckString = sortedKeys.map(k => `${k}=${params.get(k)}`).join('\n');

    // Step 1: secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)
    const webAppDataKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const secretKeyBytes = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(this.env.TELEGRAM_BOT_TOKEN));

    // Step 2: calculated_hash = HMAC-SHA256(secretKeyBytes, dataCheckString)
    const signatureBytes = await hmacSha256(secretKeyBytes, dataCheckString);
    const calculatedHash = Array.from(signatureBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Step 3: Constant-time comparison
    if (!timingSafeEqual(calculatedHash, hash)) {
      return { valid: false, error: 'Invalid HMAC signature' };
    }

    // Step 4: 300s freshness / replay protection check
    const authDateStr = params.get('auth_date');
    if (!authDateStr) {
      return { valid: false, error: 'Missing auth_date' };
    }
    const authDate = parseInt(authDateStr, 10);
    const now = Math.floor(Date.now() / 1000);

    if (isNaN(authDate) || authDate <= 0 || now - authDate > maxAgeSeconds || authDate > now + 60) {
      return { valid: false, error: 'Auth payload expired or invalid timestamp' };
    }

    // Step 5: User extraction & Single Owner Gate
    const userJson = params.get('user');
    if (!userJson) {
      return { valid: false, error: 'Missing user payload' };
    }

    let user: TelegramUser;
    try {
      user = JSON.parse(userJson) as TelegramUser;
    } catch {
      return { valid: false, error: 'Malformed user JSON' };
    }

    if (String(user.id) !== this.env.OWNER_TELEGRAM_ID) {
      return { valid: false, error: 'Access Denied: Not the instance owner' };
    }

    return { valid: true, user };
  }

  /**
   * Create a session JWT tied to the user's current auth epoch.
   */
  async createSessionToken(user: UserRecord, expiresInSeconds = 30 * 86400): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = {
      sub: String(user.telegram_id),
      user_id: user.id,
      epoch: user.auth_epoch,
      iat: now,
      exp: now + expiresInSeconds
    };

    return signJwt(payload as unknown as Record<string, unknown>, this.env.JWT_SECRET);
  }

  /**
   * Verify session token and check epoch against D1.
   */
  async verifySession(token: string): Promise<{ valid: boolean; user?: UserRecord; error?: string }> {
    const verified = await verifyJwt<SessionPayload>(token, this.env.JWT_SECRET);
    if (!verified.valid || !verified.payload) {
      return { valid: false, error: verified.error || 'Invalid session token' };
    }

    const payload = verified.payload;

    // Strict single-owner ID check
    if (String(payload.sub) !== this.env.OWNER_TELEGRAM_ID) {
      return { valid: false, error: 'Access Denied: Not the instance owner' };
    }

    // Fetch user and verify auth epoch
    const user = await this.db.getUserByTelegramId(parseInt(payload.sub, 10));
    if (!user) {
      return { valid: false, error: 'User not found' };
    }

    if (payload.epoch !== user.auth_epoch) {
      return { valid: false, error: 'Session revoked (auth epoch mismatch)' };
    }

    return { valid: true, user };
  }

  /**
   * Generate 256-bit single-use ephemeral magic token (120s TTL).
   */
  async createMagicToken(): Promise<{ token: string; tokenId: string; deepLink: string; expiresAt: number }> {
    const token = generateSecureRandomHex(32); // 256-bit CSPRNG
    const record = await this.db.createMagicToken(token, 120);

    const botUsername = this.env.BOT_USERNAME || 'TeleBookBot';
    const deepLink = `https://t.me/${botUsername}?start=auth_${token}`;

    return {
      token,
      tokenId: record.id,
      deepLink,
      expiresAt: record.expires_at
    };
  }
}
