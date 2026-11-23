import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NotebookSchema,
  normalizeNotebook,
  getCellSourceString
} from '../models/nbformat.js';
import {
  ChunkManifestItemSchema,
  NotebookVersionManifestSchema
} from '../models/manifest.js';
import {
  NotebookSummarySchema,
  MagicTokenCreateResponseSchema,
  RevokeResponseSchema,
  ShareTicketCreateRequestSchema
} from '../models/api.js';

describe('nbformat Models & Normalization', () => {
  it('validates a complete nbformat v4.5 notebook with varied cell types and outputs', () => {
    const rawNotebook = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: {
          name: 'python3',
          display_name: 'Python 3 (ipykernel)'
        },
        language_info: {
          name: 'python',
          version: '3.11.4'
        }
      },
      cells: [
        {
          cell_type: 'markdown',
          id: 'cell_md_01',
          source: ['# Analysis\n', 'Welcome to the notebook.']
        },
        {
          cell_type: 'code',
          id: 'cell_code_01',
          source: 'print("computing...")\n1 + 1',
          execution_count: 1,
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: 'computing...\n'
            },
            {
              output_type: 'execute_result',
              execution_count: 1,
              data: {
                'text/plain': '2'
              },
              metadata: {}
            }
          ]
        },
        {
          cell_type: 'code',
          id: 'cell_error_01',
          source: '1 / 0',
          execution_count: 2,
          outputs: [
            {
              output_type: 'error',
              ename: 'ZeroDivisionError',
              evalue: 'division by zero',
              traceback: ['Traceback (most recent call last):', 'ZeroDivisionError: division by zero']
            }
          ]
        },
        {
          cell_type: 'raw',
          id: 'cell_raw_01',
          source: '\\newpage',
          metadata: { format: 'text/latex' }
        }
      ]
    };

    const parsed = NotebookSchema.parse(rawNotebook);
    assert.equal(parsed.cells.length, 4);
    assert.equal(parsed.cells[0]?.cell_type, 'markdown');
    assert.equal(parsed.cells[1]?.cell_type, 'code');
    assert.equal(parsed.cells[2]?.cell_type, 'code');
    assert.equal(parsed.cells[3]?.cell_type, 'raw');
  });

  it('normalizes legacy v4.0 notebooks without IDs by generating deterministic fallback IDs', () => {
    const legacyNotebook = {
      nbformat: 4,
      nbformat_minor: 2,
      metadata: {},
      cells: [
        { cell_type: 'markdown', source: '# Title' },
        { cell_type: 'code', source: 'import math', execution_count: null, outputs: [] }
      ]
    };

    const normalized = normalizeNotebook(legacyNotebook);
    assert.equal(normalized.cells.length, 2);
    assert.ok(normalized.cells[0]!.id.startsWith('cell_markdown_0_'));
    assert.ok(normalized.cells[1]!.id.startsWith('cell_code_1_'));

    // Check that ID generation is deterministic for same content and index
    const secondPass = normalizeNotebook(legacyNotebook);
    assert.equal(normalized.cells[0]!.id, secondPass.cells[0]!.id);
  });

  it('formats cell source strings consistently', () => {
    assert.equal(getCellSourceString('hello world'), 'hello world');
    assert.equal(getCellSourceString(['line 1\n', 'line 2']), 'line 1\nline 2');
  });

  it('rejects unsupported nbformat versions', () => {
    const invalidNotebook = {
      nbformat: 3, // Unsupported legacy v3
      nbformat_minor: 0,
      metadata: {},
      cells: []
    };

    assert.throws(() => NotebookSchema.parse(invalidNotebook));
  });
});

describe('Manifest Models', () => {
  it('validates chunk manifest items with strict SHA-256 hash regex', () => {
    const validChunk = {
      notebook_id: 'nb_123',
      version: 1,
      chunk_index: 0,
      total_chunks: 1,
      telegram_file_id: 'BQACAgIAAxkBAAI...',
      telegram_message_id: 42,
      chunk_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byte_length: 1024
    };

    const parsed = ChunkManifestItemSchema.parse(validChunk);
    assert.equal(parsed.chunk_index, 0);

    // Reject non-hex hash
    assert.throws(() => ChunkManifestItemSchema.parse({
      ...validChunk,
      chunk_hash: 'not-a-valid-sha256-hash'
    }));

    // Reject wrong length hash
    assert.throws(() => ChunkManifestItemSchema.parse({
      ...validChunk,
      chunk_hash: 'e3b0c442'
    }));
  });

  it('validates full version manifest descriptor', () => {
    const manifest = {
      notebook_id: 'nb_manifest_test',
      version: 2,
      total_chunks: 1,
      byte_size: 4096,
      sha256_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      commit_message: 'Updated model metrics',
      chunks: [
        {
          notebook_id: 'nb_manifest_test',
          version: 2,
          chunk_index: 0,
          total_chunks: 1,
          telegram_file_id: 'BQACAgI...',
          telegram_message_id: 101,
          chunk_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          byte_length: 4096
        }
      ]
    };

    const parsed = NotebookVersionManifestSchema.parse(manifest);
    assert.equal(parsed.version, 2);
    assert.equal(parsed.chunks.length, 1);
  });
});

describe('API Wire Models', () => {
  it('validates notebook summary and magic token contracts', () => {
    const summary = NotebookSummarySchema.parse({
      id: 'nb_01',
      title: 'Attention Heatmaps',
      description: 'Layer 6 attention heads',
      current_version: 1,
      total_chunks: 1,
      byte_size: 1024,
      is_starred: true,
      tags: ['nlp', 'transformers'],
      created_at: 1740000000,
      updated_at: 1740000000
    });
    assert.equal(summary.title, 'Attention Heatmaps');

    const magic = MagicTokenCreateResponseSchema.parse({
      token_id: 'mt_abcdef12',
      deep_link: 'https://t.me/TeleBookBot?start=auth_abcdef12',
      expires_at: 1740000120
    });
    assert.equal(magic.token_id, 'mt_abcdef12');

    const revoke = RevokeResponseSchema.parse({
      revoked: true,
      new_epoch: 2
    });
    assert.equal(revoke.new_epoch, 2);

    const shareTicket = ShareTicketCreateRequestSchema.parse({
      notebook_id: 'nb_01',
      version: 1,
      expires_in_seconds: 3600
    });
    assert.equal(shareTicket.expires_in_seconds, 3600);
  });
});
