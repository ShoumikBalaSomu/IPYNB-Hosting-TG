/**
 * TELEBOOK_V1 Cryptographic Specifications & Types.
 */

export const TB01_MAGIC = new Uint8Array([0x54, 0x42, 0x30, 0x31]); // 'TB01'
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const PBKDF2_ITERATIONS = 100_000;
export const CHUNK_MAX_RAW_BYTES = 15 * 1024 * 1024; // 15 MB threshold

export interface TelebookChunkHeader {
  magic: string;
  salt: Uint8Array;
  iv: Uint8Array;
}

export interface EncryptedChunkData {
  notebookId: string;
  version: number;
  chunkIndex: number;
  totalChunks: number;
  binaryPayload: Uint8Array;
  chunkHashHex: string;
  byteLength: number;
}

export interface ChunkManifestItem {
  chunk_index: number;
  chunk_hash: string;
  byte_length: number;
  download_url?: string;
  telegram_file_id?: string;
}

export interface VersionManifest {
  notebook_id: string;
  version: number;
  total_chunks: number;
  byte_size: number;
  chunks: ChunkManifestItem[];
}
