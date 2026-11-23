import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSalt,
  deriveAesKeyFromPassword,
  importRawAesKey
} from '../crypto/kdf.js';
import {
  generateIv,
  serializeAad,
  encryptAesGcm,
  decryptAesGcm
} from '../crypto/aes.js';
import {
  packTb01Chunk,
  unpackTb01Chunk,
  encryptChunk,
  decryptChunk
} from '../crypto/telebook-v1.js';
import { gzipCompress, gzipDecompress } from '../crypto/compression.js';

describe('PBKDF2 Key Derivation', () => {
  it('derives a valid 256-bit AES-GCM key from password and 16-byte salt', async () => {
    const salt = generateSalt();
    assert.equal(salt.byteLength, 16);

    const key = await deriveAesKeyFromPassword('super-secret-password-123!', salt);
    assert.equal(key.algorithm.name, 'AES-GCM');
    assert.equal((key.algorithm as AesKeyAlgorithm).length, 256);
  });

  it('rejects salt shorter than 16 bytes', async () => {
    const shortSalt = new Uint8Array(15);
    await assert.rejects(
      async () => deriveAesKeyFromPassword('pass', shortSalt),
      /Salt must be at least 16 bytes/
    );
  });

  it('imports raw 32-byte key', async () => {
    const rawKey = new Uint8Array(32);
    rawKey.fill(42);
    const key = await importRawAesKey(rawKey);
    assert.equal(key.algorithm.name, 'AES-GCM');
  });

  it('rejects raw key that is not 32 bytes', async () => {
    const invalidKey = new Uint8Array(31);
    await assert.rejects(
      async () => importRawAesKey(invalidKey),
      /Raw key must be exactly 32 bytes/
    );
  });
});

describe('AES-256-GCM & AAD Binding', () => {
  it('serializes AAD according to specification: notebook_id:version:chunk_index:total_chunks', () => {
    const aad = serializeAad({
      notebookId: 'nb_xyz123',
      version: 2,
      chunkIndex: 0,
      totalChunks: 3
    });
    const expected = 'nb_xyz123:2:0:3';
    assert.equal(new TextDecoder().decode(aad), expected);
  });

  it('rejects invalid AAD parameters', () => {
    assert.throws(() => serializeAad({
      notebookId: '',
      version: 1,
      chunkIndex: 0,
      totalChunks: 1
    }), /notebookId must not be empty/);

    assert.throws(() => serializeAad({
      notebookId: 'nb_1',
      version: 1,
      chunkIndex: 2,
      totalChunks: 2 // chunkIndex >= totalChunks
    }), /chunkIndex \(2\) cannot be >= totalChunks/);
  });

  it('encrypts and decrypts with matching key, IV, and AAD', async () => {
    const salt = generateSalt();
    const key = await deriveAesKeyFromPassword('password-123', salt);
    const iv = generateIv();
    const aad = serializeAad({
      notebookId: 'nb_test',
      version: 1,
      chunkIndex: 0,
      totalChunks: 1
    });

    const plaintext = new TextEncoder().encode('Hello, sovereign zero-knowledge notebook!');
    const ciphertext = await encryptAesGcm(plaintext, key, iv, aad);

    const decrypted = await decryptAesGcm(ciphertext, key, iv, aad);
    assert.equal(new TextDecoder().decode(decrypted), 'Hello, sovereign zero-knowledge notebook!');
  });

  it('rejects decryption when AAD is tampered with (chunk-swapping / version rollback simulation)', async () => {
    const salt = generateSalt();
    const key = await deriveAesKeyFromPassword('password-123', salt);
    const iv = generateIv();

    const originalAad = serializeAad({
      notebookId: 'nb_test',
      version: 2,
      chunkIndex: 1,
      totalChunks: 3
    });

    const plaintext = new TextEncoder().encode('Sensitive trading alpha');
    const ciphertext = await encryptAesGcm(plaintext, key, iv, originalAad);

    // Tampered: Attacker swaps chunk index 1 with chunk index 0
    const tamperedChunkIndexAad = serializeAad({
      notebookId: 'nb_test',
      version: 2,
      chunkIndex: 0,
      totalChunks: 3
    });

    await assert.rejects(
      async () => decryptAesGcm(ciphertext, key, iv, tamperedChunkIndexAad),
      /operation failed|tag/i
    );

    // Tampered: Attacker attempts version rollback (version 2 -> version 1)
    const tamperedVersionAad = serializeAad({
      notebookId: 'nb_test',
      version: 1,
      chunkIndex: 1,
      totalChunks: 3
    });

    await assert.rejects(
      async () => decryptAesGcm(ciphertext, key, iv, tamperedVersionAad),
      /operation failed|tag/i
    );

    // Tampered: Attacker substitutes another notebook ID
    const tamperedNotebookAad = serializeAad({
      notebookId: 'nb_other',
      version: 2,
      chunkIndex: 1,
      totalChunks: 3
    });

    await assert.rejects(
      async () => decryptAesGcm(ciphertext, key, iv, tamperedNotebookAad),
      /operation failed|tag/i
    );
  });

  it('detects 1-bit tampering in ciphertext or GCM tag', async () => {
    const salt = generateSalt();
    const key = await deriveAesKeyFromPassword('password-123', salt);
    const iv = generateIv();
    const aad = serializeAad({
      notebookId: 'nb_test',
      version: 1,
      chunkIndex: 0,
      totalChunks: 1
    });

    const plaintext = new TextEncoder().encode('Immutable audit trail record');
    const ciphertext = await encryptAesGcm(plaintext, key, iv, aad);

    // Flip 1 bit in ciphertext payload
    const tamperedCiphertext = new Uint8Array(ciphertext);
    tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 0x01; // 1-bit flip

    await assert.rejects(
      async () => decryptAesGcm(tamperedCiphertext, key, iv, aad),
      /operation failed|tag/i
    );

    // Flip 1 bit in GCM authentication tag (last byte)
    const tamperedTag = new Uint8Array(ciphertext);
    const lastIdx = tamperedTag.byteLength - 1;
    tamperedTag[lastIdx] = (tamperedTag[lastIdx] ?? 0) ^ 0x01; // 1-bit flip in tag

    await assert.rejects(
      async () => decryptAesGcm(tamperedTag, key, iv, aad),
      /operation failed|tag/i
    );
  });
});

describe('TELEBOOK_V1 TB01 Chunk Packaging & End-to-End Crypto', () => {
  it('correctly packs and unpacks TB01 header components', () => {
    const salt = generateSalt(16);
    const iv = generateIv();
    const payload = new Uint8Array(32); // 16 bytes ciphertext + 16 bytes tag
    payload.fill(0xaa);

    const wire = packTb01Chunk(salt, iv, payload);
    assert.equal(wire.byteLength, 4 + 16 + 12 + 32);

    // Check magic bytes 'TB01'
    assert.equal(wire[0], 0x54); // 'T'
    assert.equal(wire[1], 0x42); // 'B'
    assert.equal(wire[2], 0x30); // '0'
    assert.equal(wire[3], 0x31); // '1'

    const unpacked = unpackTb01Chunk(wire);
    assert.deepEqual(unpacked.salt, salt);
    assert.deepEqual(unpacked.iv, iv);
    assert.deepEqual(unpacked.encryptedPayload, payload);
  });

  it('rejects invalid TB01 chunks missing magic header or truncated', () => {
    const truncated = new Uint8Array(30);
    assert.throws(() => unpackTb01Chunk(truncated), /Invalid TB01 chunk length/);

    const invalidMagic = new Uint8Array(50);
    invalidMagic.set([0x4e, 0x4f, 0x50, 0x45]); // 'NOPE'
    assert.throws(() => unpackTb01Chunk(invalidMagic), /Invalid TB01 magic header/);
  });

  it('performs full encryptChunk -> decryptChunk round-trip with compression and password', async () => {
    const sampleNotebookContent = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      cells: [
        { cell_type: 'code', source: 'import numpy as np\nprint("hello")' }
      ]
    });
    const rawBuffer = new TextEncoder().encode(sampleNotebookContent);

    const aadMeta = {
      notebookId: 'nb_roundtrip',
      version: 1,
      chunkIndex: 0,
      totalChunks: 1
    };

    const encrypted = await encryptChunk(rawBuffer, {
      password: 'master-encryption-key-777',
      aadMeta,
      compress: true
    });

    const decrypted = await decryptChunk(encrypted, {
      password: 'master-encryption-key-777',
      aadMeta,
      decompress: true
    });

    assert.equal(new TextDecoder().decode(decrypted), sampleNotebookContent);
  });

  it('performs full encryptChunk -> decryptChunk with pre-derived CryptoKey', async () => {
    const salt = generateSalt();
    const key = await deriveAesKeyFromPassword('cached-password', salt);
    const rawBuffer = new TextEncoder().encode('Raw data stream test with pre-derived CryptoKey');

    const aadMeta = {
      notebookId: 'nb_cached_key',
      version: 3,
      chunkIndex: 0,
      totalChunks: 1
    };

    const encrypted = await encryptChunk(rawBuffer, {
      key,
      salt,
      aadMeta,
      compress: false
    });

    const decrypted = await decryptChunk(encrypted, {
      key,
      aadMeta,
      decompress: false
    });

    assert.equal(new TextDecoder().decode(decrypted), 'Raw data stream test with pre-derived CryptoKey');
  });

  it('fails decryption when wrong password is supplied', async () => {
    const rawBuffer = new TextEncoder().encode('Protected content');
    const aadMeta = {
      notebookId: 'nb_pw_test',
      version: 1,
      chunkIndex: 0,
      totalChunks: 1
    };

    const encrypted = await encryptChunk(rawBuffer, {
      password: 'correct-password',
      aadMeta
    });

    await assert.rejects(
      async () => decryptChunk(encrypted, {
        password: 'wrong-password',
        aadMeta
      }),
      /operation failed|tag/i
    );
  });
});

describe('Gzip Compression & Decompression', () => {
  it('round-trips empty and non-empty byte buffers', async () => {
    const empty = new Uint8Array(0);
    const compressedEmpty = await gzipCompress(empty);
    const decompressedEmpty = await gzipDecompress(compressedEmpty);
    assert.equal(decompressedEmpty.byteLength, 0);

    const originalText = 'Repeat repeat repeat '.repeat(500);
    const originalBytes = new TextEncoder().encode(originalText);
    const compressed = await gzipCompress(originalBytes);

    // Highly repetitive text should compress significantly
    assert.ok(compressed.byteLength < originalBytes.byteLength / 5);

    const decompressed = await gzipDecompress(compressed);
    assert.equal(new TextDecoder().decode(decompressed), originalText);
  });
});
