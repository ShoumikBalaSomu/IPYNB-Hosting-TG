/**
 * 15 MB Deterministic Chunk Stream Splitter
 * Slices raw notebook payloads into deterministic segments and encrypts them with TELEBOOK_V1.
 */

import { MAX_CHUNK_RAW_SIZE } from '../constants.js';
import { encryptChunk } from '../crypto/telebook-v1.js';
import { sha256Hex } from './hash.js';

export interface RawChunkSlice {
  chunkIndex: number;
  totalChunks: number;
  rawBytes: Uint8Array;
}

/**
 * Split a raw byte buffer into deterministic slices of at most `chunkSize` bytes.
 */
export function sliceBuffer(
  buffer: Uint8Array,
  chunkSize: number = MAX_CHUNK_RAW_SIZE
): RawChunkSlice[] {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer, received ${chunkSize}`);
  }

  if (buffer.byteLength === 0) {
    return [{
      chunkIndex: 0,
      totalChunks: 1,
      rawBytes: new Uint8Array(0)
    }];
  }

  const totalChunks = Math.ceil(buffer.byteLength / chunkSize);
  const slices: RawChunkSlice[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, buffer.byteLength);
    slices.push({
      chunkIndex: i,
      totalChunks,
      rawBytes: buffer.subarray(start, end)
    });
  }

  return slices;
}

export interface SplitAndEncryptOptions {
  notebookId: string;
  version: number;
  password?: string | Uint8Array;
  key?: CryptoKey;
  chunkSize?: number;
  compress?: boolean;
}

export interface EncryptedChunkOutput {
  chunk_index: number;
  total_chunks: number;
  chunk_hash: string;
  byte_length: number;
  encrypted_data: Uint8Array;
}

export interface PreparedNotebookUpload {
  notebook_id: string;
  version: number;
  total_chunks: number;
  raw_byte_size: number;
  raw_sha256: string;
  chunks: EncryptedChunkOutput[];
}

/**
 * Split raw notebook buffer into 15 MB chunks, encrypt each chunk with TELEBOOK_V1,
 * and calculate chunk SHA-256 integrity digests.
 */
export async function splitAndEncryptNotebook(
  rawNotebook: Uint8Array,
  options: SplitAndEncryptOptions
): Promise<PreparedNotebookUpload> {
  const chunkSize = options.chunkSize ?? MAX_CHUNK_RAW_SIZE;
  const rawSha256 = await sha256Hex(rawNotebook);
  const slices = sliceBuffer(rawNotebook, chunkSize);
  const totalChunks = slices.length;

  const encryptedChunks: EncryptedChunkOutput[] = [];

  for (const slice of slices) {
    const encryptedData = await encryptChunk(slice.rawBytes, {
      password: options.password,
      key: options.key,
      compress: options.compress ?? true,
      aadMeta: {
        notebookId: options.notebookId,
        version: options.version,
        chunkIndex: slice.chunkIndex,
        totalChunks
      }
    });

    const chunkHash = await sha256Hex(encryptedData);

    encryptedChunks.push({
      chunk_index: slice.chunkIndex,
      total_chunks: totalChunks,
      chunk_hash: chunkHash,
      byte_length: encryptedData.byteLength,
      encrypted_data: encryptedData
    });
  }

  return {
    notebook_id: options.notebookId,
    version: options.version,
    total_chunks: totalChunks,
    raw_byte_size: rawNotebook.byteLength,
    raw_sha256: rawSha256,
    chunks: encryptedChunks
  };
}
