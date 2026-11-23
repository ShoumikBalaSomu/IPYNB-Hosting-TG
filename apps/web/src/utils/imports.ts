/**
 * Python Dependency & Import Scanner
 * Tokenizes code cells, extracts imports, and categorizes them.
 */

import { NotebookDocument, normalizeSource } from '../types/nbformat';

export type DependencyCategory = 'stdlib' | 'scientific' | 'gpu_heavy' | 'external';

export interface ScannedDependency {
  name: string;
  category: DependencyCategory;
  categoryLabel: string;
  importStatements: string[];
  cellCount: number;
  runnableInPyodide: boolean;
}

const STDLIB_MODULES = new Set([
  'abc', 'argparse', 'array', 'asyncio', 'base64', 'bisect', 'builtins',
  'collections', 'contextlib', 'copy', 'csv', 'dataclasses', 'datetime',
  'decimal', 'enum', 'errno', 'functools', 'gc', 'glob', 'gzip', 'hashlib',
  'heapq', 'inspect', 'io', 'itertools', 'json', 'logging', 'math', 'operator',
  'os', 'pathlib', 'pickle', 'platform', 'queue', 'random', 're', 'shutil',
  'socket', 'sqlite3', 'string', 'struct', 'sys', 'tempfile', 'time',
  'traceback', 'types', 'typing', 'unittest', 'urllib', 'uuid', 'warnings', 'zipfile'
]);

const CORE_SCIENTIFIC = new Set([
  'numpy', 'np', 'pandas', 'pd', 'scipy', 'matplotlib', 'plt', 'seaborn',
  'sns', 'sklearn', 'scikit-learn', 'sympy', 'micropip'
]);

const GPU_HEAVY = new Set([
  'torch', 'torchvision', 'torchaudio', 'tensorflow', 'tf', 'jax',
  'transformers', 'huggingface_hub', 'datasets', 'accelerate', 'deepspeed',
  'diffusers', 'vllm', 'flash_attn', 'bitsandbytes'
]);

export function scanNotebookImports(notebook: NotebookDocument): ScannedDependency[] {
  const importMap = new Map<string, { statements: Set<string>; cells: Set<number> }>();

  // Regular expressions to capture import statements
  // e.g. import numpy as np, pandas as pd
  // from sklearn.model_selection import train_test_split
  const importRegex = /^[^\S\r\n]*import[^\S\r\n]+([a-zA-Z0-9_., \t]+)/gm;
  const fromImportRegex = /^[^\S\r\n]*from[^\S\r\n]+([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_]+)*[^\S\r\n]+import[^\S\r\n]+/gm;

  notebook.cells.forEach((cell, cellIdx) => {
    if (cell.cell_type !== 'code') return;
    const source = normalizeSource(cell.source);

    // Scan `from <module> import ...`
    let fromMatch: RegExpExecArray | null;
    while ((fromMatch = fromImportRegex.exec(source)) !== null) {
      const moduleName = fromMatch[1]!;
      const fullLine = fromMatch[0].trim();
      addImport(importMap, moduleName, fullLine, cellIdx);
    }

    // Scan `import <module> [as alias]`
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const line = match[0].trim();
      const rawModules = match[1]!.split(',');
      for (const raw of rawModules) {
        const parts = raw.trim().split(/\s+as\s+/);
        const moduleName = parts[0]?.trim().split('.')[0];
        if (moduleName) {
          addImport(importMap, moduleName, line, cellIdx);
        }
      }
    }
  });

  const results: ScannedDependency[] = [];

  importMap.forEach((val, name) => {
    let category: DependencyCategory = 'external';
    let categoryLabel = 'Third-Party Package';
    let runnableInPyodide = true;

    if (STDLIB_MODULES.has(name)) {
      category = 'stdlib';
      categoryLabel = 'Standard Library';
      runnableInPyodide = true;
    } else if (CORE_SCIENTIFIC.has(name)) {
      category = 'scientific';
      categoryLabel = 'Core Scientific (WASM Ready)';
      runnableInPyodide = true;
    } else if (GPU_HEAVY.has(name)) {
      category = 'gpu_heavy';
      categoryLabel = 'ML / GPU Heavy (Requires Cloud)';
      runnableInPyodide = false;
    }

    results.push({
      name,
      category,
      categoryLabel,
      importStatements: Array.from(val.statements),
      cellCount: val.cells.size,
      runnableInPyodide,
    });
  });

  // Sort: GPU Heavy first (warnings), then Scientific, then External, then Stdlib
  const order: Record<DependencyCategory, number> = {
    gpu_heavy: 0,
    scientific: 1,
    external: 2,
    stdlib: 3,
  };

  return results.sort((a, b) => order[a.category] - order[b.category] || a.name.localeCompare(b.name));
}

function addImport(
  map: Map<string, { statements: Set<string>; cells: Set<number> }>,
  moduleName: string,
  statement: string,
  cellIdx: number
) {
  if (!moduleName || moduleName.startsWith('_')) return;
  const existing = map.get(moduleName) || { statements: new Set(), cells: new Set() };
  existing.statements.add(statement);
  existing.cells.add(cellIdx);
  map.set(moduleName, existing);
}
