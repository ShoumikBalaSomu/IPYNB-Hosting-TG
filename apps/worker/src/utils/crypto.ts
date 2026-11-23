// Native Web Crypto API utilities for TeleBook Worker (< 0.2ms execution)

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Constant-time comparison between two strings to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  if (bufA.byteLength !== bufB.byteLength) {
    // Constant time dummy iteration to mitigate length timing leaks
    let diff = 1;
    for (let i = 0; i < bufA.byteLength; i++) {
      diff |= bufA[i]! ^ 0;
    }
    return false;
  }

  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= bufA[i]! ^ bufB[i]!;
  }
  return diff === 0;
}

/**
 * Compute SHA-256 digest returning a lowercase hexadecimal string.
 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute HMAC-SHA256 signature using native SubtleCrypto.
 */
export async function hmacSha256(
  keyBytes: Uint8Array | ArrayBuffer,
  data: string | Uint8Array
): Promise<Uint8Array> {
  const dataBytes = typeof data === 'string' ? encoder.encode(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes as unknown as BufferSource);
  return new Uint8Array(sigBuffer);
}

/**
 * Generates cryptographically secure random hexadecimal string (default 32 bytes = 256 bits).
 */
export function generateSecureRandomHex(byteCount = 32): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Standard Base64URL string encoding without padding.
 */
export function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64URL string decoding.
 */
export function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Minimal, native HMAC-SHA256 JWT Signer.
 */
export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sigBytes = await hmacSha256(encoder.encode(secret), signingInput);
  const encodedSig = base64UrlEncode(sigBytes);

  return `${signingInput}.${encodedSig}`;
}

/**
 * Minimal, native HMAC-SHA256 JWT Verifier.
 */
export async function verifyJwt<T extends Record<string, unknown>>(
  token: string,
  secret: string
): Promise<{ valid: boolean; payload?: T; error?: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed JWT structure' };
  }

  const [encodedHeader, encodedPayload, encodedSig] = parts as [string, string, string];
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSigBytes = await hmacSha256(encoder.encode(secret), signingInput);
  const expectedSig = base64UrlEncode(expectedSigBytes);

  if (!timingSafeEqual(encodedSig, expectedSig)) {
    return { valid: false, error: 'Invalid JWT signature' };
  }

  try {
    const payloadJson = decoder.decode(base64UrlDecode(encodedPayload));
    const payload = JSON.parse(payloadJson) as T;

    // Check expiration timestamp
    if (typeof payload['exp'] === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (payload['exp'] < now) {
        return { valid: false, error: 'JWT has expired' };
      }
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Invalid payload JSON encoding' };
  }
}
