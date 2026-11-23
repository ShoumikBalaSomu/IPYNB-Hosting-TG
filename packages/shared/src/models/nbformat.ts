/**
 * Jupyter Notebook Format (nbformat v4 & v5) Zod Schemas
 * Adheres strictly to the Jupyter Project specification with defensive bounds.
 */

import { z } from 'zod';
import { MAX_NOTEBOOK_CELLS } from '../constants.js';

// --- Outputs ---

export const StreamOutputSchema = z.object({
  output_type: z.literal('stream'),
  name: z.enum(['stdout', 'stderr']),
  text: z.union([z.string(), z.array(z.string())])
});

export const DisplayDataOutputSchema = z.object({
  output_type: z.literal('display_data'),
  data: z.record(z.unknown()),
  metadata: z.record(z.unknown()).default({})
});

export const ExecuteResultOutputSchema = z.object({
  output_type: z.literal('execute_result'),
  execution_count: z.number().int().nullable().default(null),
  data: z.record(z.unknown()),
  metadata: z.record(z.unknown()).default({})
});

export const ErrorOutputSchema = z.object({
  output_type: z.literal('error'),
  ename: z.string(),
  evalue: z.string(),
  traceback: z.array(z.string())
});

export const OutputSchema = z.discriminatedUnion('output_type', [
  StreamOutputSchema,
  DisplayDataOutputSchema,
  ExecuteResultOutputSchema,
  ErrorOutputSchema
]);

export type StreamOutput = z.infer<typeof StreamOutputSchema>;
export type DisplayDataOutput = z.infer<typeof DisplayDataOutputSchema>;
export type ExecuteResultOutput = z.infer<typeof ExecuteResultOutputSchema>;
export type ErrorOutput = z.infer<typeof ErrorOutputSchema>;
export type NotebookOutput = z.infer<typeof OutputSchema>;

// --- Cells ---

export const MarkdownCellSchema = z.object({
  cell_type: z.literal('markdown'),
  id: z.string().min(1).max(128).optional(),
  source: z.union([z.string(), z.array(z.string())]),
  metadata: z.record(z.unknown()).default({}),
  attachments: z.record(z.record(z.unknown())).optional()
});

export const CodeCellSchema = z.object({
  cell_type: z.literal('code'),
  id: z.string().min(1).max(128).optional(),
  source: z.union([z.string(), z.array(z.string())]),
  metadata: z.record(z.unknown()).default({}),
  execution_count: z.number().int().nullable().default(null),
  outputs: z.array(OutputSchema).default([])
});

export const RawCellSchema = z.object({
  cell_type: z.literal('raw'),
  id: z.string().min(1).max(128).optional(),
  source: z.union([z.string(), z.array(z.string())]),
  metadata: z.record(z.unknown()).default({}),
  attachments: z.record(z.record(z.unknown())).optional()
});

export const CellSchema = z.discriminatedUnion('cell_type', [
  MarkdownCellSchema,
  CodeCellSchema,
  RawCellSchema
]);

export type MarkdownCell = z.infer<typeof MarkdownCellSchema>;
export type CodeCell = z.infer<typeof CodeCellSchema>;
export type RawCell = z.infer<typeof RawCellSchema>;
export type NotebookCell = z.infer<typeof CellSchema>;

// --- Metadata ---

export const KernelSpecSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  language: z.string().optional()
});

export const LanguageInfoSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  mimetype: z.string().optional(),
  file_extension: z.string().optional(),
  pygments_lexer: z.string().optional(),
  codemirror_mode: z.union([z.string(), z.record(z.unknown())]).optional()
});

export const NotebookMetadataSchema = z.object({
  kernelspec: KernelSpecSchema.optional(),
  language_info: LanguageInfoSchema.optional()
}).passthrough();

export type NotebookMetadata = z.infer<typeof NotebookMetadataSchema>;

// --- Root Notebook ---

export const NotebookSchema = z.object({
  nbformat: z.number().int().min(4).max(5),
  nbformat_minor: z.number().int().min(0).default(0),
  metadata: NotebookMetadataSchema.default({}),
  cells: z.array(CellSchema).max(
    MAX_NOTEBOOK_CELLS,
    `Notebook exceeds maximum allowed cell limit of ${MAX_NOTEBOOK_CELLS}`
  )
});

export type Notebook = z.infer<typeof NotebookSchema>;

/**
 * Normalized Cell structure ensuring every cell has a non-empty `id`.
 */
export type NormalizedCell = NotebookCell & { id: string };

export type NormalizedNotebook = Omit<Notebook, 'cells'> & {
  cells: NormalizedCell[];
};

/**
 * Simple deterministic pseudo-random ID generator for legacy cells lacking an ID.
 */
function generateDeterministicCellId(index: number, cellType: string, source: string | string[]): string {
  const content = Array.isArray(source) ? source.join('') : source;
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `cell_${cellType}_${index}_${hex}`;
}

/**
 * Helper to convert cell source (string or array of lines) into a unified string.
 */
export function getCellSourceString(source: string | string[]): string {
  if (Array.isArray(source)) {
    return source.join('');
  }
  return source;
}

/**
 * Parse and normalize a notebook object:
 * - Validates schema with Zod
 * - Ensures every cell has a valid `id` (assigns deterministic fallback for legacy v4.0-v4.4 notebooks)
 */
export function normalizeNotebook(raw: unknown): NormalizedNotebook {
  const parsed = NotebookSchema.parse(raw);
  const normalizedCells: NormalizedCell[] = parsed.cells.map((cell, idx) => {
    if (cell.id && cell.id.trim() !== '') {
      return { ...cell, id: cell.id };
    }
    return {
      ...cell,
      id: generateDeterministicCellId(idx, cell.cell_type, cell.source)
    };
  });

  return {
    ...parsed,
    cells: normalizedCells
  };
}
