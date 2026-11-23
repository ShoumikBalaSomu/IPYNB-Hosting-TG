// Crypto Utilities Tests

import { describe, it, expect } from 'vitest';
import {
  timingSafeEqual,
  sha256Hex,
  hmacSha256,
  generateSecureRandomHex,
  signJwt,
  verifyJwt
} from '../src/utils/crypto';

describe('Crypto Utilities', () => {
  describe('timingSafeEqual', () => {
    it('returns true for identical strings', () => {
      expect(timingSafeEqual('telebook-secret-token-12345', 'telebook-secret-token-12345')).toBe(true);
    });

    it('returns false for mismatched strings of same length', () => {
      expect(timingSafeEqual('telebook-secret-token-12345', 'telebook-secret-token-12346')).toBe(false);
    });

    it('returns false for mismatched strings of different lengths', () => {
      expect(timingSafeEqual('short', 'longer-secret')).toBe(false);
      expect(timingSafeEqual('longer-secret', 'short')).toBe(false);
    });

    it('handles empty strings', () => {
      expect(timingSafeEqual('', '')).toBe(true);
      expect(timingSafeEqual('', 'non-empty')).toBe(false);
    });
  });

  describe('sha256Hex', () => {
    it('computes known SHA-256 digest', async () => {
      const hash = await sha256Hex('telebook');
      // sha256("telebook") = c96cfd28613e4a32411bf1652c2773389f46f4bf76b46dbd33a07ca3684b1d62
      expect(hash).toBe('c96cfd28613e4a32411bf1652c2773389f46f4bf76b46dbd33a07ca3684b1d62');
    });

    it('computes hash for Uint8Array', async () => {
      const bytes = new TextEncoder().encode('telebook');
      const hash = await sha256Hex(bytes);
      expect(hash).toBe('c96cfd28613e4a32411bf1652c2773389f46f4bf76b46dbd33a07ca3684b1d62');
    });
  });

  describe('hmacSha256', () => {
    it('computes valid HMAC signature', async () => {
      const key = new TextEncoder().encode('secret-key');
      const sig = await hmacSha256(key, 'message-data');
      expect(sig.byteLength).toBe(32);
    });
  });

  describe('generateSecureRandomHex', () => {
    it('generates 32 bytes (64 hex characters) by default', () => {
      const token1 = generateSecureRandomHex();
      const token2 = generateSecureRandomHex();
      expect(token1.length).toBe(64);
      expect(token2.length).toBe(64);
      expect(token1).not.toBe(token2);
    });
  });

  describe('signJwt & verifyJwt', () => {
    const secret = 'super-secret-key-at-least-32-chars-long';

    it('signs and verifies valid JWT payload', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = { sub: '123456789', epoch: 1, exp: now + 3600 };

      const token = await signJwt(payload, secret);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);

      const verified = await verifyJwt<{ sub: string; epoch: number }>(token, secret);
      expect(verified.valid).toBe(true);
      expect(verified.payload?.sub).toBe('123456789');
      expect(verified.payload?.epoch).toBe(1);
    });

    it('rejects tampered signature', async () => {
      const payload = { sub: '123456789', epoch: 1 };
      const token = await signJwt(payload, secret);

      const parts = token.split('.');
      const tampered = `${parts[0]}.${parts[1]}.badsignature`;

      const verified = await verifyJwt(tampered, secret);
      expect(verified.valid).toBe(false);
      expect(verified.error).toBe('Invalid JWT signature');
    });

    it('rejects expired JWT', async () => {
      const past = Math.floor(Date.now() / 1000) - 100;
      const payload = { sub: '123456789', epoch: 1, exp: past };

      const token = await signJwt(payload, secret);
      const verified = await verifyJwt(token, secret);
      expect(verified.valid).toBe(false);
      expect(verified.error).toBe('JWT has expired');
    });

    it('rejects JWT signed with different secret', async () => {
      const payload = { sub: '123456789', epoch: 1 };
      const token = await signJwt(payload, 'wrong-secret-key-different-hash');

      const verified = await verifyJwt(token, secret);
      expect(verified.valid).toBe(false);
      expect(verified.error).toBe('Invalid JWT signature');
    });
  });
});
