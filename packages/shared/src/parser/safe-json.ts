/**
 * Prototype-Pollution-Proof JSON Parser with Strict Security Limits
 * Protects against __proto__ injection, nesting bombs (ReDoS / Stack Overflow),
 * cell count flooding, and oversized payloads.
 */

import {
  MAX_SAFE_JSON_DEPTH,
  MAX_SAFE_JSON_PAYLOAD_BYTES,
  MAX_SAFE_JSON_KEYS,
  MAX_NOTEBOOK_CELLS
} from '../constants.js';
import { normalizeNotebook, NormalizedNotebook } from '../models/nbformat.js';

export class JsonSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonSecurityError';
  }
}

export interface SafeJsonParseOptions {
  maxDepth?: number;
  maxPayloadBytes?: number;
  maxKeys?: number;
  disallowedKeys?: string[];
  actionOnDisallowed?: 'reject' | 'strip';
  maxCellCount?: number;
}

const DEFAULT_DISALLOWED_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Perform a linear single-pass verification of JSON structural depth without executing code.
 * Prevents V8 stack overflow from deeply nested objects or arrays.
 */
export function verifyJsonDepth(jsonText: string, maxDepth: number = MAX_SAFE_JSON_DEPTH): void {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < jsonText.length; i++) {
    const char = jsonText[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth++;
      if (depth > maxDepth) {
        throw new JsonSecurityError(
          `JSON nesting depth exceeded safety threshold of ${maxDepth} levels`
        );
      }
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth < 0) {
        throw new JsonSecurityError('Malformed JSON: unexpected closing bracket or brace');
      }
    }
  }

  if (inString) {
    throw new JsonSecurityError('Malformed JSON: unclosed string literal');
  }
}

/**
 * Safely parse JSON with prototype-pollution prevention and resource limits.
 */
export function safeJsonParse<T = unknown>(
  jsonText: string,
  options: SafeJsonParseOptions = {}
): T {
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_SAFE_JSON_PAYLOAD_BYTES;
  const maxDepth = options.maxDepth ?? MAX_SAFE_JSON_DEPTH;
  const maxKeys = options.maxKeys ?? MAX_SAFE_JSON_KEYS;
  const disallowedKeys = options.disallowedKeys ?? DEFAULT_DISALLOWED_KEYS;
  const actionOnDisallowed = options.actionOnDisallowed ?? 'reject';

  // 1. Enforce payload size limit
  const byteLength = new TextEncoder().encode(jsonText).byteLength;
  if (byteLength > maxPayloadBytes) {
    throw new JsonSecurityError(
      `JSON payload size (${byteLength} bytes) exceeds maximum limit of ${maxPayloadBytes} bytes`
    );
  }

  // 2. Enforce maximum recursion / nesting depth
  verifyJsonDepth(jsonText, maxDepth);

  // 3. Parse with prototype pollution guard and key counter
  let keyCount = 0;

  const parsed = JSON.parse(jsonText, (key, value) => {
    keyCount++;
    if (keyCount > maxKeys) {
      throw new JsonSecurityError(
        `JSON key/node count exceeded safety threshold of ${maxKeys} nodes`
      );
    }

    if (disallowedKeys.includes(key)) {
      if (actionOnDisallowed === 'reject') {
        throw new JsonSecurityError(
          `Dangerous prototype pollution key detected in JSON: "${key}"`
        );
      }
      // 'strip' mode
      return undefined;
    }

    return value;
  });

  return parsed as T;
}

/**
 * Safely parse a Jupyter Notebook JSON string, enforcing notebook cell limits
 * and normalizing cells with deterministic IDs.
 */
export function safeParseNotebook(
  jsonText: string,
  options: SafeJsonParseOptions = {}
): NormalizedNotebook {
  const maxCellCount = options.maxCellCount ?? MAX_NOTEBOOK_CELLS;
  const raw = safeJsonParse<Record<string, unknown>>(jsonText, options);

  if (raw && typeof raw === 'object' && Array.isArray(raw['cells'])) {
    if (raw['cells'].length > maxCellCount) {
      throw new JsonSecurityError(
        `Notebook cell count (${raw['cells'].length}) exceeds safety limit of ${maxCellCount}`
      );
    }
  }

  return normalizeNotebook(raw);
}
