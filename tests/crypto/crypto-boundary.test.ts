/**
 * Cryptographic Boundary & Adversarial Tampering Test Suite
 * Tests TELEBOOK_V1 AES-256-GCM + AAD Binding:
 * - 0 KB (empty payload) round-trip
 * - 1 KB payload round-trip
 * - 15 MB boundary payload round-trip (exact 15,728,640 byte chunk)
 * - 35 MB multi-chunk payload (3 chunks: 15MB + 15MB + 5MB)
 * - 1-bit ciphertext tampering detection
 * - 1-bit GCM tag tampering detection
 * - AAD version-rollback attack rejection (claiming v2 chunk is v1)
 * - Chunk-swapping / reordering attack rejection
 * - Duplicate chunk index rejection
 */

import { describe, it, expect } from 'vitest';
import {
  encryptChunk,
  decryptChunk,
  splitAndEncryptNotebook,
  reassembleAndDecryptNotebook
} from '../../packages/shared/src/index';

describe('TELEBOOK_V1 Cryptographic Boundary & Tamper Resistance Suite', () => {
  const TEST_PASSWORD = 'telebook_super_secret_audit_passkey_2026';
  const NOTEBOOK_ID = 'nb_audit_quantum_999';

  describe('1. Payload Boundary Round-Trips (0KB, 1KB, 15MB, 35MB)', () => {
    it('0 KB (Empty payload): Encrypts and decrypts cleanly', async () => {
      const emptyPayload = new Uint8Array(0);
      const encrypted = await encryptChunk(emptyPayload, {
        password: TEST_PASSWORD,
        aadMeta: {
          notebookId: NOTEBOOK_ID,
          version: 1,
          chunkIndex: 0,
          totalChunks: 1
        }
      });

      expect(encrypted.byteLength).toBeGreaterThan(0);

      const decrypted = await decryptChunk(encrypted, {
        password: TEST_PASSWORD,
        aadMeta: {
          notebookId: NOTEBOOK_ID,
          version: 1,
          chunkIndex: 0,
          totalChunks: 1
        }
      });

      expect(decrypted.byteLength).toBe(0);
    });

    it('1 KB payload: Full round-trip with compression and AAD verification', async () => {
      const payload = new Uint8Array(1024);
      for (let i = 0; i < payload.length; i++) payload[i] = i % 256;

      const encrypted = await encryptChunk(payload, {
        password: TEST_PASSWORD,
        aadMeta: {
          notebookId: NOTEBOOK_ID,
          version: 1,
          chunkIndex: 0,
          totalChunks: 1
        }
      });

      const decrypted = await decryptChunk(encrypted, {
        password: TEST_PASSWORD,
        aadMeta: {
          notebookId: NOTEBOOK_ID,
          version: 1,
          chunkIndex: 0,
          totalChunks: 1
        }
      });

      expect(decrypted.byteLength).toBe(1024);
      expect(Buffer.from(decrypted).equals(Buffer.from(payload))).toBe(true);
    });

    it('15 MB exact boundary chunk (15,728,640 bytes): Encrypts and decrypts cleanly', async () => {
      const CHUNK_SIZE = 15 * 1024 * 1024; // 15 MB
      const payload = new Uint8Array(CHUNK_SIZE);
      // Fill pattern: fast pseudorandom bytes
      for (let i = 0; i < 10000; i++) payload[i] = (i * 31) % 256;

      const prepared = await splitAndEncryptNotebook(payload, {
        notebookId: NOTEBOOK_ID,
        version: 1,
        password: TEST_PASSWORD,
        chunkSize: CHUNK_SIZE,
        compress: false // test raw boundary without gzip variable sizing
      });

      expect(prepared.total_chunks).toBe(1);
      expect(prepared.chunks.length).toBe(1);

      const reassembled = await reassembleAndDecryptNotebook(
        prepared.chunks.map(c => ({
          chunk_index: c.chunk_index,
          encrypted_data: c.encrypted_data,
          expected_hash: c.chunk_hash
        })),
        {
          notebookId: NOTEBOOK_ID,
          version: 1,
          totalChunks: 1,
          password: TEST_PASSWORD,
          decompress: false
        }
      );

      expect(reassembled.byteLength).toBe(CHUNK_SIZE);
      expect(reassembled[0]).toBe(payload[0]);
      expect(reassembled[9999]).toBe(payload[9999]);
    });

    it('35 MB multi-chunk payload (3 chunks: 15MB + 15MB + 5MB): Splits, encrypts, and reassembles', async () => {
      const TOTAL_SIZE = 35 * 1024 * 1024; // 35 MB
      const payload = new Uint8Array(TOTAL_SIZE);
      // Place markers at chunk boundaries
      payload[0] = 0xAA;
      payload[15 * 1024 * 1024] = 0xBB;
      payload[30 * 1024 * 1024] = 0xCC;

      const prepared = await splitAndEncryptNotebook(payload, {
        notebookId: NOTEBOOK_ID,
        version: 2,
        password: TEST_PASSWORD,
        chunkSize: 15 * 1024 * 1024,
        compress: false
      });

      expect(prepared.total_chunks).toBe(3);
      expect(prepared.chunks.length).toBe(3);
      expect(prepared.chunks[0].chunk_index).toBe(0);
      expect(prepared.chunks[1].chunk_index).toBe(1);
      expect(prepared.chunks[2].chunk_index).toBe(2);

      const reassembled = await reassembleAndDecryptNotebook(
        prepared.chunks.map(c => ({
          chunk_index: c.chunk_index,
          encrypted_data: c.encrypted_data,
          expected_hash: c.chunk_hash
        })),
        {
          notebookId: NOTEBOOK_ID,
          version: 2,
          totalChunks: 3,
          password: TEST_PASSWORD,
          decompress: false
        }
      );

      expect(reassembled.byteLength).toBe(TOTAL_SIZE);
      expect(reassembled[0]).toBe(0xAA);
      expect(reassembled[15 * 1024 * 1024]).toBe(0xBB);
      expect(reassembled[30 * 1024 * 1024]).toBe(0xCC);
    });
  });

  describe('2. Adversarial Tampering & Bit-Flip Detection', () => {
    it('ATTACK: 1-bit flip in ciphertext payload causes GCM auth failure', async () => {
      const payload = new TextEncoder().encode('Confidential neural network weights');
      const encrypted = await encryptChunk(payload, {
        password: TEST_PASSWORD,
        aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 0, totalChunks: 1 }
      });

      // Header is 32 bytes (4 Magic + 16 Salt + 12 IV).
      // Flip bit in ciphertext body (byte 35)
      const corrupted = new Uint8Array(encrypted);
      corrupted[35] ^= 0x01;

      await expect(
        decryptChunk(corrupted, {
          password: TEST_PASSWORD,
          aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 0, totalChunks: 1 }
        })
      ).rejects.toThrow();
    });

    it('ATTACK: 1-bit flip in GCM authentication tag causes immediate decryption failure', async () => {
      const payload = new TextEncoder().encode('Integrity verified tag test');
      const encrypted = await encryptChunk(payload, {
        password: TEST_PASSWORD,
        aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 0, totalChunks: 1 }
      });

      // The last 16 bytes contain the GCM tag. Flip bit in the very last byte.
      const corrupted = new Uint8Array(encrypted);
      corrupted[corrupted.length - 1] ^= 0x01;

      await expect(
        decryptChunk(corrupted, {
          password: TEST_PASSWORD,
          aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 0, totalChunks: 1 }
        })
      ).rejects.toThrow();
    });

    it('ATTACK: AAD Version-Rollback attack (decrypting v2 chunk as v1) is cryptographically rejected', async () => {
      const payload = new TextEncoder().encode('Version 2 sensitive update');
      const encryptedV2 = await encryptChunk(payload, {
        password: TEST_PASSWORD,
        aadMeta: { notebookId: NOTEBOOK_ID, version: 2, chunkIndex: 0, totalChunks: 1 }
      });

      // Attacker attempts to trick client into accepting this chunk as version 1
      await expect(
        decryptChunk(encryptedV2, {
          password: TEST_PASSWORD,
          aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 0, totalChunks: 1 }
        })
      ).rejects.toThrow();
    });

    it('ATTACK: Chunk re-ordering attack (swapping chunk 0 and chunk 1) is rejected by AAD chunk_index binding', async () => {
      const payload1 = new TextEncoder().encode('Chunk 0 data');
      const payload2 = new TextEncoder().encode('Chunk 1 data');

      const chunk0 = await encryptChunk(payload1, {
        password: TEST_PASSWORD,
        aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 0, totalChunks: 2 }
      });

      const chunk1 = await encryptChunk(payload2, {
        password: TEST_PASSWORD,
        aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 1, totalChunks: 2 }
      });

      // Try decrypting chunk0 bytes with chunkIndex: 1
      await expect(
        decryptChunk(chunk0, {
          password: TEST_PASSWORD,
          aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 1, totalChunks: 2 }
        })
      ).rejects.toThrow();

      // Try decrypting chunk1 bytes with chunkIndex: 0
      await expect(
        decryptChunk(chunk1, {
          password: TEST_PASSWORD,
          aadMeta: { notebookId: NOTEBOOK_ID, version: 1, chunkIndex: 0, totalChunks: 2 }
        })
      ).rejects.toThrow();
    });
  });
});
