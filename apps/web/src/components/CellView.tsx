/**
 * Unified Cell View Component
 */

import React from 'react';
import { NotebookCell } from '../types/nbformat';
import { CodeCell } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';

interface CellViewProps {
  cell: NotebookCell;
  cellIndex: number;
  isFocused: boolean;
  isReportMode: boolean;
  isRunning?: boolean;
  onFocus: () => void;
  onRun?: (code: string) => void;
  onCodeChange?: (newCode: string) => void;
}

export const CellView: React.FC<CellViewProps> = ({
  cell,
  cellIndex,
  isFocused,
  isReportMode,
  isRunning = false,
  onFocus,
  onRun,
  onCodeChange,
}) => {
  const cellId = cell.id || `cell-${cellIndex}`;

  return (
    <div
      id={cellId}
      tabIndex={0}
      onClick={onFocus}
      onFocus={onFocus}
      className={`focus:outline-none transition-shadow rounded-xl ${
        isFocused ? 'ring-1 ring-blue-500/40' : ''
      }`}
    >
      {cell.cell_type === 'markdown' ? (
        <div className="px-2 py-1">
          <MarkdownCell source={cell.source} cellId={cellId} />
        </div>
      ) : cell.cell_type === 'code' ? (
        <CodeCell
          cell={cell}
          cellIndex={cellIndex}
          isFocused={isFocused}
          isReportMode={isReportMode}
          isRunning={isRunning}
          onRun={onRun}
          onCodeChange={onCodeChange}
        />
      ) : (
        <pre className="p-3 bg-zinc-100 dark:bg-zinc-900 rounded text-xs font-mono">
          {Array.isArray(cell.source) ? cell.source.join('') : cell.source}
        </pre>
      )}
    </div>
  );
};
