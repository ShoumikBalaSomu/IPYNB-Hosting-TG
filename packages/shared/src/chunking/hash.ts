/**
 * Cryptographic Hash Utilities (Web Crypto API)
 */

/**
 * Compute the SHA-256 hash of a Uint8Array buffer and return as 64-character lowercase hex string.
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digestBuffer = await globalThis.crypto.subtle.digest(
    'SHA-256',
    data as unknown as BufferSource
  );
  const bytes = new Uint8Array(digestBuffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Compute the SHA-256 hash of a Uint8Array buffer and return as Uint8Array (32 bytes).
 */
export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const digestBuffer = await globalThis.crypto.subtle.digest(
    'SHA-256',
    data as unknown as BufferSource
  );
  return new Uint8Array(digestBuffer);
}
