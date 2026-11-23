/**
 * TELEBOOK_V1 Zero-Knowledge Cryptographic Engine
 * AES-256-GCM authenticated encryption with PBKDF2 key derivation,
 * AAD metadata binding, and standard TB01 chunk header.
 */

import {
  TB01_MAGIC,
  SALT_BYTES,
  IV_BYTES,
  TAG_BYTES,
  PBKDF2_ITERATIONS,
  CHUNK_MAX_RAW_BYTES,
  EncryptedChunkData,
} from '../types/crypto';

export class TelebookCryptoError extends Error {
  constructor(message: string) {
    super(`[TELEBOOK_V1 Crypto] ${message}`);
    this.name = 'TelebookCryptoError';
  }
}

/**
 * Format Additional Authenticated Data (AAD)
 * AAD = notebook_id:version:chunk_index:total_chunks
 */
export function buildAAD(
  notebookId: string,
  version: number,
  chunkIndex: number,
  totalChunks: number
): Uint8Array {
  const aadString = `${notebookId}:${version}:${chunkIndex}:${totalChunks}`;
  return new TextEncoder().encode(aadString);
}

/**
 * Derive AES-256-GCM CryptoKey using PBKDF2-HMAC-SHA256 (100,000 iterations)
 */
export async function deriveKeyFromPasskey(
  passkey: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passkeyBuffer = enc.encode(passkey);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passkeyBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Compress raw plaintext bytes using Gzip CompressionStream
 */
export async function compressBytes(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    await writer.write(data as unknown as BufferSource);
    await writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(compressed);
  }
  // Universal fallback: uncompressed
  return data;
}

/**
 * Decompress gzip bytes using DecompressionStream
 */
export async function decompressBytes(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      await writer.write(data as unknown as BufferSource);
      await writer.close();
      const decompressed = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(decompressed);
    } catch {
      // If decompression fails, data might have been stored uncompressed
      return data;
    }
  }
  return data;
}

/**
 * Compute SHA-256 hash string (hex) of binary data
 */
export async function computeSha256Hex(data: Uint8Array): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypt a single chunk and format into TB01 binary wire layout:
 * [4B 'TB01'][16B Salt][12B IV][Ciphertext + 16B GCM Tag]
 */
export async function encryptChunkTB01(
  payloadBytes: Uint8Array,
  passkey: string,
  notebookId: string,
  version: number,
  chunkIndex: number,
  totalChunks: number
): Promise<EncryptedChunkData> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aad = buildAAD(notebookId, version, chunkIndex, totalChunks);

  const derivedKey = await deriveKeyFromPasskey(passkey, salt);

  const compressed = await compressBytes(payloadBytes);

  const ciphertextWithTagBuf = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      additionalData: aad as unknown as BufferSource,
      tagLength: TAG_BYTES * 8, // 128-bit tag
    },
    derivedKey,
    compressed as unknown as BufferSource
  );

  const ciphertextWithTag = new Uint8Array(ciphertextWithTagBuf);

  // Construct binary chunk: 4 + 16 + 12 + length
  const totalLength = TB01_MAGIC.length + SALT_BYTES + IV_BYTES + ciphertextWithTag.length;
  const binaryPayload = new Uint8Array(totalLength);

  binaryPayload.set(TB01_MAGIC, 0);
  binaryPayload.set(salt, TB01_MAGIC.length);
  binaryPayload.set(iv, TB01_MAGIC.length + SALT_BYTES);
  binaryPayload.set(ciphertextWithTag, TB01_MAGIC.length + SALT_BYTES + IV_BYTES);

  const chunkHashHex = await computeSha256Hex(binaryPayload);

  return {
    notebookId,
    version,
    chunkIndex,
    totalChunks,
    binaryPayload,
    chunkHashHex,
    byteLength: binaryPayload.byteLength,
  };
}

/**
 * Decrypt a TB01 formatted chunk and verify AAD binding:
 * [4B 'TB01'][16B Salt][12B IV][Ciphertext + 16B GCM Tag]
 */
export async function decryptChunkTB01(
  chunkBytes: Uint8Array,
  passkey: string,
  notebookId: string,
  version: number,
  chunkIndex: number,
  totalChunks: number
): Promise<Uint8Array> {
  const headerOffset = TB01_MAGIC.length + SALT_BYTES + IV_BYTES;
  if (chunkBytes.length < headerOffset + TAG_BYTES) {
    throw new TelebookCryptoError(
      `Invalid chunk size: ${chunkBytes.length} bytes is shorter than the minimum TB01 header.`
    );
  }

  // 1. Verify Magic Header
  for (let i = 0; i < TB01_MAGIC.length; i++) {
    if (chunkBytes[i] !== TB01_MAGIC[i]) {
      throw new TelebookCryptoError('Invalid magic header. Expected TB01 signature.');
    }
  }

  // 2. Extract Salt and IV
  const salt = chunkBytes.slice(TB01_MAGIC.length, TB01_MAGIC.length + SALT_BYTES);
  const iv = chunkBytes.slice(
    TB01_MAGIC.length + SALT_BYTES,
    TB01_MAGIC.length + SALT_BYTES + IV_BYTES
  );
  const ciphertextWithTag = chunkBytes.slice(headerOffset);

  // 3. Derive key and compute expected AAD
  const derivedKey = await deriveKeyFromPasskey(passkey, salt);
  const aad = buildAAD(notebookId, version, chunkIndex, totalChunks);

  // 4. Decrypt with AES-GCM (verifies 128-bit tag and AAD)
  let decryptedBuf: ArrayBuffer;
  try {
    decryptedBuf = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
        tagLength: TAG_BYTES * 8,
      },
      derivedKey,
      ciphertextWithTag as unknown as BufferSource
    );
  } catch (err) {
    throw new TelebookCryptoError(
      'Decryption failed. Invalid passkey, corrupted chunk, or tampered AAD metadata.'
    );
  }

  // 5. Decompress
  return decompressBytes(new Uint8Array(decryptedBuf));
}

/**
 * Slices a raw document into <= 15 MB chunks and encrypts each with TB01.
 */
export async function encryptDocument(
  documentJson: string,
  passkey: string,
  notebookId: string,
  version: number
): Promise<EncryptedChunkData[]> {
  const enc = new TextEncoder();
  const rawBytes = enc.encode(documentJson);

  const chunksCount = Math.max(1, Math.ceil(rawBytes.length / CHUNK_MAX_RAW_BYTES));
  const encryptedChunks: EncryptedChunkData[] = [];

  for (let i = 0; i < chunksCount; i++) {
    const start = i * CHUNK_MAX_RAW_BYTES;
    const end = Math.min(rawBytes.length, start + CHUNK_MAX_RAW_BYTES);
    const slice = rawBytes.subarray(start, end);

    const chunk = await encryptChunkTB01(
      slice,
      passkey,
      notebookId,
      version,
      i,
      chunksCount
    );
    encryptedChunks.push(chunk);
  }

  return encryptedChunks;
}

/**
 * Decrypts all chunks sequentially, verifies hashes, and reassembles document JSON.
 */
export async function decryptAndReassembleDocument(
  chunks: Array<{ chunkIndex: number; binaryPayload: Uint8Array; expectedHash?: string }>,
  passkey: string,
  notebookId: string,
  version: number
): Promise<string> {
  const totalChunks = chunks.length;
  // Sort by chunkIndex ascending
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  const decryptedParts: Uint8Array[] = [];
  let totalRawLength = 0;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]!;
    if (item.chunkIndex !== i) {
      throw new TelebookCryptoError(
        `Missing chunk sequence. Expected index ${i}, received ${item.chunkIndex}.`
      );
    }

    // Verify SHA-256 hash if provided
    if (item.expectedHash) {
      const hash = await computeSha256Hex(item.binaryPayload);
      if (hash.toLowerCase() !== item.expectedHash.toLowerCase()) {
        throw new TelebookCryptoError(
          `Chunk ${i} hash verification failed. Expected ${item.expectedHash}, got ${hash}.`
        );
      }
    }

    const decryptedSlice = await decryptChunkTB01(
      item.binaryPayload,
      passkey,
      notebookId,
      version,
      i,
      totalChunks
    );

    decryptedParts.push(decryptedSlice);
    totalRawLength += decryptedSlice.byteLength;
  }

  // Reassemble full byte array
  const fullBytes = new Uint8Array(totalRawLength);
  let offset = 0;
  for (const part of decryptedParts) {
    fullBytes.set(part, offset);
    offset += part.byteLength;
  }

  return new TextDecoder().decode(fullBytes);
}
