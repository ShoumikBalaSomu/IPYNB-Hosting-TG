/**
 * PBKDF2 Key Derivation Function (Web Crypto API)
 * Follows TELEBOOK_V1: PBKDF2-HMAC-SHA256, 100,000 iterations, 16-byte random salt.
 */

import {
  PBKDF2_ITERATIONS,
  PBKDF2_HASH,
  AES_CIPHER,
  AES_KEY_BITS,
  SALT_LENGTH
} from '../constants.js';

/**
 * Generate a cryptographically secure random salt.
 */
export function generateSalt(byteLength: number = SALT_LENGTH): Uint8Array {
  const salt = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

/**
 * Convert string or Uint8Array password to Uint8Array bytes.
 */
export function normalizePassword(password: string | Uint8Array): Uint8Array {
  if (typeof password === 'string') {
    return new TextEncoder().encode(password);
  }
  return password;
}

/**
 * Derive an AES-GCM 256-bit CryptoKey from a user passphrase and salt via PBKDF2.
 */
export async function deriveAesKeyFromPassword(
  password: string | Uint8Array,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
  extractable: boolean = false
): Promise<CryptoKey> {
  if (salt.byteLength < 16) {
    throw new Error(`Salt must be at least 16 bytes, received ${salt.byteLength} bytes.`);
  }

  const passwordBytes = normalizePassword(password);
  if (passwordBytes.byteLength === 0) {
    throw new Error('Password cannot be empty.');
  }

  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    passwordBytes as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey', 'deriveBits']
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: PBKDF2_HASH
    },
    baseKey,
    {
      name: AES_CIPHER,
      length: AES_KEY_BITS
    },
    extractable,
    ['encrypt', 'decrypt']
  );
}

/**
 * Import a 256-bit raw key as an AES-GCM CryptoKey.
 */
export async function importRawAesKey(
  rawKey: Uint8Array,
  extractable: boolean = false
): Promise<CryptoKey> {
  if (rawKey.byteLength !== 32) {
    throw new Error(`Raw key must be exactly 32 bytes (256 bits), received ${rawKey.byteLength} bytes.`);
  }

  return globalThis.crypto.subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    {
      name: AES_CIPHER,
      length: AES_KEY_BITS
    },
    extractable,
    ['encrypt', 'decrypt']
  );
}
