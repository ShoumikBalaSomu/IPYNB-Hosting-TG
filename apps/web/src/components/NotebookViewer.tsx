/**
 * Notebook Viewer Component
 * Renders the vertical list of cells with keyboard focus and execution handling.
 */

import React from 'react';
import { NotebookDocument } from '../types/nbformat';
import { CellView } from './CellView';

interface NotebookViewerProps {
  notebook: NotebookDocument;
  activeCellIndex: number;
  isReportMode: boolean;
  runningCellId: string | null;
  onSelectCell: (index: number) => void;
  onRunCell: (cellIndex: number, code: string) => void;
  onCodeChange: (cellIndex: number, newCode: string) => void;
}

export const NotebookViewer: React.FC<NotebookViewerProps> = ({
  notebook,
  activeCellIndex,
  isReportMode,
  runningCellId,
  onSelectCell,
  onRunCell,
  onCodeChange,
}) => {
  return (
    <div className="notebook-container max-w-4xl mx-auto px-4 py-6 space-y-4">
      {notebook.cells.map((cell, idx) => {
        const cellId = cell.id || `cell-${idx}`;
        const isRunning = runningCellId === cellId;

        return (
          <CellView
            key={cellId}
            cell={cell}
            cellIndex={idx}
            isFocused={idx === activeCellIndex}
            isReportMode={isReportMode}
            isRunning={isRunning}
            onFocus={() => onSelectCell(idx)}
            onRun={(code) => onRunCell(idx, code)}
            onCodeChange={(newCode) => onCodeChange(idx, newCode)}
          />
        );
      })}
    </div>
  );
};
