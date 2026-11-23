/**
 * TELEBOOK_V1 Zero-Knowledge Chunk Wire Protocol
 * Binary chunk packing, unpacking, full encryption and decryption.
 * Header: [4 bytes: 'TB01'][16 bytes: Salt][12 bytes: IV][Ciphertext][16 bytes: GCM Tag]
 */

import {
  TB01_MAGIC_BYTES,
  MAGIC_LENGTH,
  SALT_LENGTH,
  IV_LENGTH,
  HEADER_LENGTH,
  MIN_CHUNK_WIRE_LENGTH
} from '../constants.js';
import { generateSalt, deriveAesKeyFromPassword } from './kdf.js';
import { generateIv, serializeAad, encryptAesGcm, decryptAesGcm, AadMetadata } from './aes.js';
import { gzipCompress, gzipDecompress } from './compression.js';

export interface UnpackedTb01Chunk {
  salt: Uint8Array;
  iv: Uint8Array;
  encryptedPayload: Uint8Array;
}

/**
 * Verify that the header starts with 'TB01'.
 */
export function isTb01Chunk(data: Uint8Array): boolean {
  if (data.byteLength < MAGIC_LENGTH) return false;
  for (let i = 0; i < MAGIC_LENGTH; i++) {
    if (data[i] !== TB01_MAGIC_BYTES[i]) return false;
  }
  return true;
}

/**
 * Pack salt, IV, and encrypted payload (ciphertext + tag) into the TB01 binary wire format.
 */
export function packTb01Chunk(
  salt: Uint8Array,
  iv: Uint8Array,
  encryptedPayload: Uint8Array
): Uint8Array {
  if (salt.byteLength !== SALT_LENGTH) {
    throw new Error(`Salt must be exactly ${SALT_LENGTH} bytes, received ${salt.byteLength}`);
  }
  if (iv.byteLength !== IV_LENGTH) {
    throw new Error(`IV must be exactly ${IV_LENGTH} bytes, received ${iv.byteLength}`);
  }
  if (encryptedPayload.byteLength < 16) {
    throw new Error(`Encrypted payload must be at least 16 bytes (GCM tag), received ${encryptedPayload.byteLength}`);
  }

  const wire = new Uint8Array(HEADER_LENGTH + encryptedPayload.byteLength);
  wire.set(TB01_MAGIC_BYTES, 0);
  wire.set(salt, MAGIC_LENGTH);
  wire.set(iv, MAGIC_LENGTH + SALT_LENGTH);
  wire.set(encryptedPayload, HEADER_LENGTH);

  return wire;
}

/**
 * Unpack a TB01 chunk into its header components and encrypted payload.
 */
export function unpackTb01Chunk(data: Uint8Array): UnpackedTb01Chunk {
  if (data.byteLength < MIN_CHUNK_WIRE_LENGTH) {
    throw new Error(
      `Invalid TB01 chunk length: expected at least ${MIN_CHUNK_WIRE_LENGTH} bytes, received ${data.byteLength}`
    );
  }

  if (!isTb01Chunk(data)) {
    throw new Error('Invalid TB01 magic header: missing "TB01" signature');
  }

  const salt = data.subarray(MAGIC_LENGTH, MAGIC_LENGTH + SALT_LENGTH);
  const iv = data.subarray(MAGIC_LENGTH + SALT_LENGTH, HEADER_LENGTH);
  const encryptedPayload = data.subarray(HEADER_LENGTH);

  return {
    salt: new Uint8Array(salt),
    iv: new Uint8Array(iv),
    encryptedPayload: new Uint8Array(encryptedPayload)
  };
}

export interface EncryptChunkOptions {
  password?: string | Uint8Array;
  key?: CryptoKey;
  salt?: Uint8Array;
  iv?: Uint8Array;
  aadMeta: AadMetadata;
  compress?: boolean;
}

export interface DecryptChunkOptions {
  password?: string | Uint8Array;
  key?: CryptoKey;
  aadMeta: AadMetadata;
  decompress?: boolean;
}

/**
 * Encrypt a raw notebook chunk according to the TELEBOOK_V1 specification:
 * 1. Optional gzip compression
 * 2. AES-256-GCM encryption with AAD binding (notebook_id:version:chunk_index:total_chunks)
 * 3. Pack into TB01 binary chunk header
 */
export async function encryptChunk(
  rawChunk: Uint8Array,
  options: EncryptChunkOptions
): Promise<Uint8Array> {
  const compress = options.compress ?? true;
  const payloadToEncrypt = compress ? await gzipCompress(rawChunk) : rawChunk;

  const salt = options.salt ?? generateSalt(SALT_LENGTH);
  const iv = options.iv ?? generateIv();

  let key = options.key;
  if (!key) {
    if (!options.password) {
      throw new Error('Either "key" or "password" must be provided for encryptChunk');
    }
    key = await deriveAesKeyFromPassword(options.password, salt);
  }

  const aad = serializeAad(options.aadMeta);
  const encryptedPayload = await encryptAesGcm(payloadToEncrypt, key, iv, aad);

  return packTb01Chunk(salt, iv, encryptedPayload);
}

/**
 * Decrypt a TB01 binary chunk according to the TELEBOOK_V1 specification:
 * 1. Unpack header (Magic, Salt, IV)
 * 2. AES-256-GCM authenticated decryption with verified AAD
 * 3. Optional gzip decompression
 */
export async function decryptChunk(
  chunkBytes: Uint8Array,
  options: DecryptChunkOptions
): Promise<Uint8Array> {
  const unpacked = unpackTb01Chunk(chunkBytes);

  let key = options.key;
  if (!key) {
    if (!options.password) {
      throw new Error('Either "key" or "password" must be provided for decryptChunk');
    }
    key = await deriveAesKeyFromPassword(options.password, unpacked.salt);
  }

  const aad = serializeAad(options.aadMeta);
  const decryptedPayload = await decryptAesGcm(
    unpacked.encryptedPayload,
    key,
    unpacked.iv,
    aad
  );

  const decompress = options.decompress ?? true;
  if (decompress) {
    return gzipDecompress(decryptedPayload);
  }

  return decryptedPayload;
}
