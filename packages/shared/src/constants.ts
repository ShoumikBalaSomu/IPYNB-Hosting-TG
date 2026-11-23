/**
 * TeleBook Shared Constants
 * Strict cryptographic parameters and protocol limits.
 */

// Binary Chunk Wire Format ('TB01')
export const TB01_MAGIC_STRING = 'TB01';
export const TB01_MAGIC_BYTES = new Uint8Array([0x54, 0x42, 0x30, 0x31]); // 'T', 'B', '0', '1'
export const MAGIC_LENGTH = 4;
export const SALT_LENGTH = 16; // 128-bit random salt
export const IV_LENGTH = 12; // 96-bit CSPRNG IV
export const TAG_LENGTH = 16; // 128-bit GCM tag
export const HEADER_LENGTH = MAGIC_LENGTH + SALT_LENGTH + IV_LENGTH; // 32 bytes
export const MIN_CHUNK_WIRE_LENGTH = HEADER_LENGTH + TAG_LENGTH; // 48 bytes (0-length ciphertext)

// Cryptographic Parameters
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_HASH = 'SHA-256';
export const AES_CIPHER = 'AES-GCM';
export const AES_KEY_BITS = 256;
export const GCM_TAG_LENGTH_BITS = 128;

// Chunking & Telegram Protocol Limits
export const MAX_CHUNK_RAW_SIZE = 15 * 1024 * 1024; // 15 MB = 15,728,640 bytes
export const TELEGRAM_GET_FILE_LIMIT = 20 * 1024 * 1024; // 20 MB

// Security and Parsing Bounds
export const MAX_SAFE_JSON_DEPTH = 50;
export const MAX_SAFE_JSON_PAYLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_SAFE_JSON_KEYS = 100_000;
export const MAX_NOTEBOOK_CELLS = 5_000;
