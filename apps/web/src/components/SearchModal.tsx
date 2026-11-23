/**
 * Cmd/Ctrl+K Fast Search Modal
 * Searches across all cells, headings, and code snippets.
 */

import React, { useState, useEffect, useRef } from 'react';
import { NotebookDocument, normalizeSource } from '../types/nbformat';
import { Search, X, Code, FileText, CornerDownLeft } from 'lucide-react';

interface SearchModalProps {
  notebook: NotebookDocument;
  isOpen: boolean;
  onClose: () => void;
  onSelectCell: (cellIndex: number) => void;
}

interface SearchResult {
  cellIndex: number;
  cellType: string;
  snippet: string;
  matchLine?: string;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  notebook,
  isOpen,
  onClose,
  onSelectCell,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const results: SearchResult[] = React.useMemo(() => {
    if (!query.trim()) return [];

    const lower = query.toLowerCase();
    const hits: SearchResult[] = [];

    notebook.cells.forEach((cell, idx) => {
      const src = normalizeSource(cell.source);
      if (src.toLowerCase().includes(lower)) {
        // Find matching line
        const lines = src.split('\n');
        const matchLine = lines.find((l) => l.toLowerCase().includes(lower)) || lines[0] || '';

        hits.push({
          cellIndex: idx,
          cellType: cell.cell_type,
          snippet: src.slice(0, 140).trim(),
          matchLine: matchLine.trim(),
        });
      }
    });

    return hits;
  }, [query, notebook]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        onSelectCell(results[selectedIndex].cellIndex);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 gap-3">
          <Search className="w-5 h-5 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search notebook cells, formulas, code..."
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-zinc-100 dark:divide-zinc-900">
          {query.trim() === '' ? (
            <div className="p-8 text-center text-xs text-zinc-400">
              Type keywords to instantly search cells across this notebook.
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-400">
              No matching cells found for "{query}".
            </div>
          ) : (
            results.map((res, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={idx}
                  onClick={() => {
                    onSelectCell(res.cellIndex);
                    onClose();
                  }}
                  className={`p-3 rounded-lg cursor-pointer transition-colors flex items-start justify-between gap-3 ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <div className="flex items-start gap-2.5 overflow-hidden">
                    <div className="mt-0.5 p-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                      {res.cellType === 'code' ? (
                        <Code className="w-3.5 h-3.5" />
                      ) : (
                        <FileText className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="overflow-hidden">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">
                          Cell #{res.cellIndex + 1}
                        </span>
                        <span className="text-[10px] uppercase font-sans text-zinc-400">
                          {res.cellType}
                        </span>
                      </div>
                      <p className="text-xs font-mono truncate text-zinc-600 dark:text-zinc-400 mt-1">
                        {res.matchLine}
                      </p>
                    </div>
                  </div>

                  {isSelected && (
                    <CornerDownLeft className="w-3.5 h-3.5 text-blue-500 shrink-0 self-center" />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-900/40 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 flex items-center justify-between">
          <span>Navigate with ↑ and ↓</span>
          <span>Press Enter to select</span>
        </div>
      </div>
    </div>
  );
};
