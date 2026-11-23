/**
 * TELEBOOK_V1 Chunk Reassembler & Integrity Verifier
 * Verifies chunk digests, decrypts each chunk in index order, and reassembles the full notebook payload.
 */

import { decryptChunk } from '../crypto/telebook-v1.js';
import { sha256Hex } from './hash.js';

export interface EncryptedChunkInput {
  chunk_index: number;
  encrypted_data: Uint8Array;
  expected_hash?: string;
}

export interface ReassembleOptions {
  notebookId: string;
  version: number;
  totalChunks: number;
  password?: string | Uint8Array;
  key?: CryptoKey;
  expectedRawSha256?: string;
  decompress?: boolean;
}

/**
 * Reassemble and decrypt encrypted chunks into the original raw notebook payload.
 */
export async function reassembleAndDecryptNotebook(
  chunks: EncryptedChunkInput[],
  options: ReassembleOptions
): Promise<Uint8Array> {
  if (options.totalChunks <= 0) {
    throw new Error(`totalChunks must be positive, received ${options.totalChunks}`);
  }

  if (chunks.length !== options.totalChunks) {
    throw new Error(
      `Chunk count mismatch: expected ${options.totalChunks} chunks, but received ${chunks.length}`
    );
  }

  // Ensure index uniqueness and complete coverage
  const indexSet = new Set<number>();
  for (const chunk of chunks) {
    if (chunk.chunk_index < 0 || chunk.chunk_index >= options.totalChunks) {
      throw new Error(
        `Chunk index out of bounds: chunk ${chunk.chunk_index} is outside range [0, ${options.totalChunks - 1}]`
      );
    }
    if (indexSet.has(chunk.chunk_index)) {
      throw new Error(`Duplicate chunk index detected: ${chunk.chunk_index}`);
    }
    indexSet.add(chunk.chunk_index);
  }

  if (indexSet.size !== options.totalChunks) {
    throw new Error(`Missing chunks in manifest: received ${indexSet.size} of ${options.totalChunks} chunks`);
  }

  // Sort chunks strictly by chunk_index
  const sortedChunks = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  const decryptedSegments: Uint8Array[] = [];
  let totalDecryptedLength = 0;

  for (const chunk of sortedChunks) {
    // 1. Verify chunk SHA-256 hash if expected_hash provided
    if (chunk.expected_hash) {
      const actualHash = await sha256Hex(chunk.encrypted_data);
      if (actualHash.toLowerCase() !== chunk.expected_hash.toLowerCase()) {
        throw new Error(
          `Chunk ${chunk.chunk_index} hash mismatch: expected ${chunk.expected_hash}, computed ${actualHash}`
        );
      }
    }

    // 2. Decrypt chunk with AAD binding
    const decryptedSegment = await decryptChunk(chunk.encrypted_data, {
      password: options.password,
      key: options.key,
      decompress: options.decompress ?? true,
      aadMeta: {
        notebookId: options.notebookId,
        version: options.version,
        chunkIndex: chunk.chunk_index,
        totalChunks: options.totalChunks
      }
    });

    decryptedSegments.push(decryptedSegment);
    totalDecryptedLength += decryptedSegment.byteLength;
  }

  // 3. Assemble all decrypted segments into one continuous buffer
  const assembled = new Uint8Array(totalDecryptedLength);
  let offset = 0;
  for (const segment of decryptedSegments) {
    assembled.set(segment, offset);
    offset += segment.byteLength;
  }

  // 4. Verify total payload SHA-256 if expectedRawSha256 provided
  if (options.expectedRawSha256) {
    const assembledHash = await sha256Hex(assembled);
    if (assembledHash.toLowerCase() !== options.expectedRawSha256.toLowerCase()) {
      throw new Error(
        `Assembled raw notebook hash mismatch: expected ${options.expectedRawSha256}, computed ${assembledHash}`
      );
    }
  }

  return assembled;
}
