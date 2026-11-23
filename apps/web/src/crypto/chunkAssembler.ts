/**
 * Chunk Assembler: Streamlined multi-chunk fetching and validation
 */

import { VersionManifest } from '../types/crypto';
import { decryptAndReassembleDocument } from './telebookCrypto';

export interface ChunkFetchProgress {
  loadedChunks: number;
  totalChunks: number;
  percent: number;
}

export async function fetchAndDecryptNotebook(
  manifest: VersionManifest,
  passkey: string,
  fetchChunkFn: (url: string) => Promise<Uint8Array>,
  onProgress?: (progress: ChunkFetchProgress) => void
): Promise<string> {
  const downloadedChunks: Array<{
    chunkIndex: number;
    binaryPayload: Uint8Array;
    expectedHash: string;
  }> = [];

  for (let i = 0; i < manifest.chunks.length; i++) {
    const chunkInfo = manifest.chunks[i]!;
    const url = chunkInfo.download_url || `/api/notebooks/${manifest.notebook_id}/versions/${manifest.version}/chunks/${chunkInfo.chunk_index}`;
    
    const binary = await fetchChunkFn(url);
    downloadedChunks.push({
      chunkIndex: chunkInfo.chunk_index,
      binaryPayload: binary,
      expectedHash: chunkInfo.chunk_hash,
    });

    if (onProgress) {
      onProgress({
        loadedChunks: i + 1,
        totalChunks: manifest.total_chunks,
        percent: Math.round(((i + 1) / manifest.total_chunks) * 100),
      });
    }
  }

  return decryptAndReassembleDocument(
    downloadedChunks,
    passkey,
    manifest.notebook_id,
    manifest.version
  );
}
