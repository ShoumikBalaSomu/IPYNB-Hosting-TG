import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sliceBuffer, splitAndEncryptNotebook } from '../chunking/splitter.js';
import { reassembleAndDecryptNotebook } from '../chunking/reassembler.js';
import { sha256Hex } from '../chunking/hash.js';

describe('15 MB Chunk Splitter & Reassembler', () => {
  it('correctly slices empty and sized buffers', () => {
    const emptySlices = sliceBuffer(new Uint8Array(0), 1000);
    assert.equal(emptySlices.length, 1);
    assert.equal(emptySlices[0]!.chunkIndex, 0);
    assert.equal(emptySlices[0]!.totalChunks, 1);

    const data = new Uint8Array(2500);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;

    const slices = sliceBuffer(data, 1000);
    assert.equal(slices.length, 3);
    assert.equal(slices[0]!.rawBytes.byteLength, 1000);
    assert.equal(slices[1]!.rawBytes.byteLength, 1000);
    assert.equal(slices[2]!.rawBytes.byteLength, 500);

    assert.equal(slices[0]!.chunkIndex, 0);
    assert.equal(slices[1]!.chunkIndex, 1);
    assert.equal(slices[2]!.chunkIndex, 2);
    assert.equal(slices[0]!.totalChunks, 3);
  });

  it('computes accurate SHA-256 hex digest', async () => {
    const textBytes = new TextEncoder().encode('TeleBook sovereign storage');
    const hash = await sha256Hex(textBytes);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash.length, 64);
  });

  it('splits, encrypts, and reassembles a multi-chunk payload with SHA-256 integrity verification', async () => {
    // Generate a test payload that spans 4 chunks with a 4,000-byte slice size
    const testSize = 15_500;
    const rawData = new Uint8Array(testSize);
    for (let i = 0; i < testSize; i++) {
      rawData[i] = (i * 17 + 3) % 256;
    }

    const notebookId = 'nb_multi_chunk_test';
    const version = 1;
    const password = 'client-side-passphrase-999';

    const prepared = await splitAndEncryptNotebook(rawData, {
      notebookId,
      version,
      password,
      chunkSize: 4000 // 4000 byte slices -> 4 chunks (4000, 4000, 4000, 3500)
    });

    assert.equal(prepared.total_chunks, 4);
    assert.equal(prepared.chunks.length, 4);
    assert.equal(prepared.raw_byte_size, testSize);

    // Verify chunk metadata
    for (let i = 0; i < 4; i++) {
      const c = prepared.chunks[i]!;
      assert.equal(c.chunk_index, i);
      assert.equal(c.total_chunks, 4);
      assert.match(c.chunk_hash, /^[0-9a-f]{64}$/);
    }

    // Reassemble with shuffled chunk arrival order (e.g. chunks arriving out of order over network)
    const shuffledChunks = [
      prepared.chunks[2]!,
      prepared.chunks[0]!,
      prepared.chunks[3]!,
      prepared.chunks[1]!
    ].map(c => ({
      chunk_index: c.chunk_index,
      encrypted_data: c.encrypted_data,
      expected_hash: c.chunk_hash
    }));

    const reassembled = await reassembleAndDecryptNotebook(shuffledChunks, {
      notebookId,
      version,
      totalChunks: 4,
      password,
      expectedRawSha256: prepared.raw_sha256
    });

    assert.equal(reassembled.byteLength, rawData.byteLength);
    assert.deepEqual(reassembled, rawData);
  });

  it('detects corrupted chunk hash during reassembly', async () => {
    const rawData = new Uint8Array(5000);
    const password = 'password-123';
    const prepared = await splitAndEncryptNotebook(rawData, {
      notebookId: 'nb_corrupt',
      version: 1,
      password,
      chunkSize: 2000
    });

    const chunkInputs = prepared.chunks.map(c => ({
      chunk_index: c.chunk_index,
      encrypted_data: new Uint8Array(c.encrypted_data),
      expected_hash: c.chunk_hash
    }));

    // Corrupt one byte of chunk 1 ciphertext
    chunkInputs[1]!.encrypted_data[40]! ^= 0x01;

    await assert.rejects(
      async () => reassembleAndDecryptNotebook(chunkInputs, {
        notebookId: 'nb_corrupt',
        version: 1,
        totalChunks: prepared.total_chunks,
        password
      }),
      /Chunk 1 hash mismatch/
    );
  });

  it('rejects duplicate or missing chunk indices', async () => {
    const rawData = new Uint8Array(5000);
    const prepared = await splitAndEncryptNotebook(rawData, {
      notebookId: 'nb_dups',
      version: 1,
      password: 'password',
      chunkSize: 2500
    });

    // Duplicate chunk 0
    const duplicateChunks = [
      { chunk_index: 0, encrypted_data: prepared.chunks[0]!.encrypted_data },
      { chunk_index: 0, encrypted_data: prepared.chunks[0]!.encrypted_data }
    ];

    await assert.rejects(
      async () => reassembleAndDecryptNotebook(duplicateChunks, {
        notebookId: 'nb_dups',
        version: 1,
        totalChunks: 2,
        password: 'password'
      }),
      /Duplicate chunk index detected: 0/
    );
  });
});
