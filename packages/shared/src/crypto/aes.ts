/**
 * AES-256-GCM Encryption / Decryption with AAD Binding (Web Crypto API)
 * Follows TELEBOOK_V1: 96-bit CSPRNG IV, 128-bit tag, AAD binding.
 */

import {
  AES_CIPHER,
  GCM_TAG_LENGTH_BITS,
  IV_LENGTH
} from '../constants.js';

/**
 * Generate a 96-bit (12-byte) cryptographically secure random Initialization Vector.
 */
export function generateIv(): Uint8Array {
  const iv = new Uint8Array(IV_LENGTH);
  globalThis.crypto.getRandomValues(iv);
  return iv;
}

export interface AadMetadata {
  notebookId: string;
  version: number;
  chunkIndex: number;
  totalChunks: number;
}

/**
 * Serialize AAD binding string to UTF-8 bytes:
 * notebook_id:version:chunk_index:total_chunks
 */
export function serializeAad(meta: AadMetadata): Uint8Array {
  if (!meta.notebookId || meta.notebookId.trim() === '') {
    throw new Error('notebookId must not be empty in AAD metadata');
  }
  if (!Number.isInteger(meta.version) || meta.version < 0) {
    throw new Error(`version must be a non-negative integer, received ${meta.version}`);
  }
  if (!Number.isInteger(meta.chunkIndex) || meta.chunkIndex < 0) {
    throw new Error(`chunkIndex must be a non-negative integer, received ${meta.chunkIndex}`);
  }
  if (!Number.isInteger(meta.totalChunks) || meta.totalChunks <= 0) {
    throw new Error(`totalChunks must be a positive integer, received ${meta.totalChunks}`);
  }
  if (meta.chunkIndex >= meta.totalChunks) {
    throw new Error(`chunkIndex (${meta.chunkIndex}) cannot be >= totalChunks (${meta.totalChunks})`);
  }

  const aadString = `${meta.notebookId}:${meta.version}:${meta.chunkIndex}:${meta.totalChunks}`;
  return new TextEncoder().encode(aadString);
}

/**
 * Encrypt a plaintext buffer using AES-256-GCM.
 * Returns the ciphertext with appended 16-byte GCM authentication tag.
 */
export async function encryptAesGcm(
  plaintext: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  if (iv.byteLength !== IV_LENGTH) {
    throw new Error(`IV must be exactly ${IV_LENGTH} bytes (96 bits), received ${iv.byteLength} bytes.`);
  }

  const algorithm: AesGcmParams = {
    name: AES_CIPHER,
    iv: iv as unknown as BufferSource,
    tagLength: GCM_TAG_LENGTH_BITS,
    ...(aad ? { additionalData: aad as unknown as BufferSource } : {})
  };

  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    algorithm,
    key,
    plaintext as unknown as BufferSource
  );

  return new Uint8Array(encryptedBuffer);
}

/**
 * Decrypt a ciphertext buffer (including appended 16-byte GCM tag) using AES-256-GCM.
 * Rejects with an error if ciphertext, tag, key, IV, or AAD is tampered with.
 */
export async function decryptAesGcm(
  ciphertextWithTag: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  if (iv.byteLength !== IV_LENGTH) {
    throw new Error(`IV must be exactly ${IV_LENGTH} bytes (96 bits), received ${iv.byteLength} bytes.`);
  }

  if (ciphertextWithTag.byteLength < 16) {
    throw new Error(`Ciphertext must include at least 16 bytes for the GCM tag.`);
  }

  const algorithm: AesGcmParams = {
    name: AES_CIPHER,
    iv: iv as unknown as BufferSource,
    tagLength: GCM_TAG_LENGTH_BITS,
    ...(aad ? { additionalData: aad as unknown as BufferSource } : {})
  };

  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    algorithm,
    key,
    ciphertextWithTag as unknown as BufferSource
  );

  return new Uint8Array(decryptedBuffer);
}
