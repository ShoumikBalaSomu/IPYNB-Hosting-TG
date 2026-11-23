/**
 * Jupyter Notebook Format (nbformat v4 & v5) TypeScript definitions.
 */

export type CellType = 'code' | 'markdown' | 'raw';

export interface BaseCell {
  id?: string;
  cell_type: CellType;
  metadata: Record<string, unknown>;
  source: string | string[];
}

export interface StreamOutput {
  output_type: 'stream';
  name: 'stdout' | 'stderr';
  text: string | string[];
}

export interface DisplayDataOutput {
  output_type: 'display_data';
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ExecuteResultOutput {
  output_type: 'execute_result';
  execution_count: number | null;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ErrorOutput {
  output_type: 'error';
  ename: string;
  evalue: string;
  traceback: string[];
}

export type CellOutput =
  | StreamOutput
  | DisplayDataOutput
  | ExecuteResultOutput
  | ErrorOutput;

export interface CodeCell extends BaseCell {
  cell_type: 'code';
  execution_count: number | null;
  outputs: CellOutput[];
}

export interface MarkdownCell extends BaseCell {
  cell_type: 'markdown';
}

export interface RawCell extends BaseCell {
  cell_type: 'raw';
}

export type NotebookCell = CodeCell | MarkdownCell | RawCell;

export interface NotebookMetadata {
  kernelspec?: {
    name?: string;
    display_name?: string;
    language?: string;
  };
  language_info?: {
    name?: string;
    version?: string;
    mimetype?: string;
    codemirror_mode?: unknown;
    file_extension?: string;
    pygments_lexer?: string;
  };
  authors?: Array<{ name: string }>;
  telebook?: {
    notebook_id?: string;
    version?: number;
    title?: string;
    tags?: string[];
    last_saved_at?: string;
  };
  [key: string]: unknown;
}

export interface NotebookDocument {
  nbformat: number;
  nbformat_minor: number;
  metadata: NotebookMetadata;
  cells: NotebookCell[];
}

export function normalizeSource(source: string | string[]): string {
  if (Array.isArray(source)) {
    return source.join('');
  }
  return source || '';
}

export function normalizeText(text: string | string[]): string {
  if (Array.isArray(text)) {
    return text.join('');
  }
  return text || '';
}
