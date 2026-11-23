/**
 * Comprehensive Unit Test Suite for TeleBook Frontend Core
 * Tests crypto round-trips, AAD tamper resistance, import scanning,
 * ANSI tracebacks, and semantic line diffing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptChunkTB01,
  decryptChunkTB01,
  encryptDocument,
  decryptAndReassembleDocument,
} from '../crypto/telebookCrypto';
import { scanNotebookImports } from '../utils/imports';
import { ansiToHtml } from '../utils/ansi';
import { computeLineDiff } from '../utils/diff';
import { SAMPLE_NOTEBOOK } from '../utils/sampleNotebooks';
import { NotebookDocument } from '../types/nbformat';

test('TELEBOOK_V1: encrypt and decrypt single TB01 chunk round-trip', async () => {
  const payload = new TextEncoder().encode('Hello TeleBook Zero-Knowledge Storage!');
  const passkey = 'master_secret_passkey_123';
  const notebookId = 'nb_test_1';
  const version = 1;
  const chunkIndex = 0;
  const totalChunks = 1;

  const encrypted = await encryptChunkTB01(
    payload,
    passkey,
    notebookId,
    version,
    chunkIndex,
    totalChunks
  );

  assert.equal(encrypted.notebookId, notebookId);
  assert.equal(encrypted.version, version);
  assert.equal(encrypted.chunkIndex, 0);
  assert.ok(encrypted.binaryPayload.length > payload.length);
  // Verify TB01 magic bytes
  assert.equal(encrypted.binaryPayload[0], 0x54); // 'T'
  assert.equal(encrypted.binaryPayload[1], 0x42); // 'B'
  assert.equal(encrypted.binaryPayload[2], 0x30); // '0'
  assert.equal(encrypted.binaryPayload[3], 0x31); // '1'

  const decrypted = await decryptChunkTB01(
    encrypted.binaryPayload,
    passkey,
    notebookId,
    version,
    chunkIndex,
    totalChunks
  );

  const decryptedText = new TextDecoder().decode(decrypted);
  assert.equal(decryptedText, 'Hello TeleBook Zero-Knowledge Storage!');
});

test('TELEBOOK_V1: AAD tampering rejection (version rollback attack prevention)', async () => {
  const payload = new TextEncoder().encode('Sensitive financial data');
  const passkey = 'correct_passkey';
  const notebookId = 'nb_auth_test';

  const encrypted = await encryptChunkTB01(
    payload,
    passkey,
    notebookId,
    2, // version 2
    0,
    1
  );

  // Attempt to decrypt chunk claiming it is version 1 (version rollback attack)
  await assert.rejects(
    async () => {
      await decryptChunkTB01(
        encrypted.binaryPayload,
        passkey,
        notebookId,
        1, // mismatched version in AAD
        0,
        1
      );
    },
    (err: Error) => {
      assert.match(err.message, /Decryption failed/i);
      return true;
    }
  );
});

test('TELEBOOK_V1: 1-bit ciphertext corruption rejection', async () => {
  const payload = new TextEncoder().encode('Integrity test payload');
  const passkey = 'passkey_tamper';

  const encrypted = await encryptChunkTB01(
    payload,
    passkey,
    'nb_tamper',
    1,
    0,
    1
  );

  // Flip 1 bit in ciphertext payload
  const corrupted = new Uint8Array(encrypted.binaryPayload);
  const lastIdx = corrupted.length - 1;
  corrupted[lastIdx] = (corrupted[lastIdx] ?? 0) ^ 0x01;

  await assert.rejects(
    async () => {
      await decryptChunkTB01(corrupted, passkey, 'nb_tamper', 1, 0, 1);
    },
    (err: Error) => {
      assert.match(err.message, /Decryption failed/i);
      return true;
    }
  );
});

test('TELEBOOK_V1: multi-chunk document encryption and reassembly', async () => {
  const docJson = JSON.stringify(SAMPLE_NOTEBOOK);
  const passkey = 'quantum_safe_passkey_2026';
  const notebookId = 'nb_doc_test';
  const version = 3;

  const chunks = await encryptDocument(docJson, passkey, notebookId, version);
  assert.ok(chunks.length >= 1);

  const reassembled = await decryptAndReassembleDocument(
    chunks,
    passkey,
    notebookId,
    version
  );

  assert.equal(reassembled, docJson);
  const parsed = JSON.parse(reassembled);
  assert.equal(parsed.cells.length, SAMPLE_NOTEBOOK.cells.length);
});

test('Python Dependency Scanner: categorizes modules accurately', () => {
  const testDoc: NotebookDocument = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: [
          'import os, sys\n',
          'import numpy as np\n',
          'from torch.nn import functional as F\n',
          'import requests\n',
        ],
        outputs: [],
      },
    ],
  };

  const deps = scanNotebookImports(testDoc);
  const depMap = new Map(deps.map((d) => [d.name, d]));

  assert.ok(depMap.has('os'));
  assert.equal(depMap.get('os')?.category, 'stdlib');

  assert.ok(depMap.has('numpy'));
  assert.equal(depMap.get('numpy')?.category, 'scientific');
  assert.equal(depMap.get('numpy')?.runnableInPyodide, true);

  assert.ok(depMap.has('torch'));
  assert.equal(depMap.get('torch')?.category, 'gpu_heavy');
  assert.equal(depMap.get('torch')?.runnableInPyodide, false);

  assert.ok(depMap.has('requests'));
  assert.equal(depMap.get('requests')?.category, 'external');
});

test('ANSI Color Parser: parses escape sequences into styled spans', () => {
  const ansiText = '\u001b[31mError:\u001b[0m \u001b[32mSuccess\u001b[0m';
  const html = ansiToHtml(ansiText);

  assert.ok(html.includes('color: #dc2626;'));
  assert.ok(html.includes('Error:'));
  assert.ok(html.includes('color: #16a34a;'));
  assert.ok(html.includes('Success'));
});

test('Line Diff Engine: detects additions, deletions, and unchanged lines', () => {
  const oldText = 'line1\nline2\nline3';
  const newText = 'line1\nline2_modified\nline3\nline4_added';

  const diff = computeLineDiff(oldText, newText);

  const added = diff.filter((d) => d.type === 'added');
  const deleted = diff.filter((d) => d.type === 'deleted');
  const unchanged = diff.filter((d) => d.type === 'unchanged');

  assert.ok(added.some((d) => d.text === 'line4_added'));
  assert.ok(deleted.some((d) => d.text === 'line2'));
  assert.ok(unchanged.some((d) => d.text === 'line1'));
  assert.ok(unchanged.some((d) => d.text === 'line3'));
});
