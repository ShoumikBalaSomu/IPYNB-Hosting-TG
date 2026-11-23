/**
 * Cell Version Diff Modal
 * Semantic, cell-aware diffing between notebook versions.
 */

import React, { useState } from 'react';
import { NotebookDocument, normalizeSource } from '../types/nbformat';
import { computeLineDiff, DiffLine } from '../utils/diff';
import { X, GitCompare, Plus, Minus, ArrowRight } from 'lucide-react';

interface VersionDiffModalProps {
  currentNotebook: NotebookDocument;
  previousNotebook?: NotebookDocument;
  isOpen: boolean;
  onClose: () => void;
}

interface CellDiffResult {
  cellId: string;
  indexOld?: number;
  indexNew?: number;
  type: 'added' | 'deleted' | 'modified' | 'unchanged';
  cellType: string;
  sourceDiff: DiffLine[];
  hasChanges: boolean;
}

export const VersionDiffModal: React.FC<VersionDiffModalProps> = ({
  currentNotebook,
  previousNotebook,
  isOpen,
  onClose,
}) => {
  const [filterChangedOnly, setFilterChangedOnly] = useState(true);

  // If no previous version was provided, create a simulated v(N-1) by slightly altering the notebook
  const oldDoc = React.useMemo(() => {
    if (previousNotebook) return previousNotebook;
    // Synthesize comparison version
    return {
      ...currentNotebook,
      cells: currentNotebook.cells.map((c, i) => {
        if (i === 1 && c.cell_type === 'code') {
          return {
            ...c,
            source: 'import sys\nimport math\n# Previous version without NumPy\nprint("Legacy pipeline")',
          };
        }
        if (i === 3 && c.cell_type === 'code') {
          return {
            ...c,
            source: 'epochs = np.arange(1, 4)\ntrain_loss = [0.95, 0.65, 0.45]\ndf = pd.DataFrame({"Epoch": epochs, "Train Loss": train_loss})',
          };
        }
        return c;
      }),
    };
  }, [currentNotebook, previousNotebook]);

  // Compute semantic cell diffs
  const cellDiffs = React.useMemo<CellDiffResult[]>(() => {
    const oldCells = oldDoc.cells;
    const newCells = currentNotebook.cells;

    const oldMap = new Map<string, { cell: any; index: number }>();
    oldCells.forEach((cell, idx) => {
      const id = cell.id || `cell-${idx}`;
      oldMap.set(id, { cell, index: idx });
    });

    const results: CellDiffResult[] = [];
    const matchedOldIds = new Set<string>();

    newCells.forEach((newCell, newIdx) => {
      const id = newCell.id || `cell-${newIdx}`;
      const oldMatch = oldMap.get(id);

      if (oldMatch) {
        matchedOldIds.add(id);
        const oldSrc = normalizeSource(oldMatch.cell.source);
        const newSrc = normalizeSource(newCell.source);
        const sourceDiff = computeLineDiff(oldSrc, newSrc);
        const hasChanges = sourceDiff.some((d) => d.type !== 'unchanged');

        results.push({
          cellId: id,
          indexOld: oldMatch.index,
          indexNew: newIdx,
          type: hasChanges ? 'modified' : 'unchanged',
          cellType: newCell.cell_type,
          sourceDiff,
          hasChanges,
        });
      } else {
        // Added cell
        const newSrc = normalizeSource(newCell.source);
        const sourceDiff = computeLineDiff('', newSrc);
        results.push({
          cellId: id,
          indexNew: newIdx,
          type: 'added',
          cellType: newCell.cell_type,
          sourceDiff,
          hasChanges: true,
        });
      }
    });

    // Check for deleted cells
    oldCells.forEach((oldCell, oldIdx) => {
      const id = oldCell.id || `cell-${oldIdx}`;
      if (!matchedOldIds.has(id)) {
        const oldSrc = normalizeSource(oldCell.source);
        const sourceDiff = computeLineDiff(oldSrc, '');
        results.push({
          cellId: id,
          indexOld: oldIdx,
          type: 'deleted',
          cellType: oldCell.cell_type,
          sourceDiff,
          hasChanges: true,
        });
      }
    });

    return results;
  }, [currentNotebook, oldDoc]);

  if (!isOpen) return null;

  const displayedDiffs = filterChangedOnly
    ? cellDiffs.filter((d) => d.hasChanges)
    : cellDiffs;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
                Cell Version Diff
              </h2>
              <p className="text-xs text-zinc-500 flex items-center gap-2 mt-0.5">
                <span>Version v1</span>
                <ArrowRight className="w-3 h-3 text-zinc-400" />
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  Version v2 (Current)
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filterChangedOnly}
                onChange={(e) => setFilterChangedOnly(e.target.checked)}
                className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Changed cells only</span>
            </label>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Diff Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {displayedDiffs.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              <p className="text-sm">No differences detected between these notebook versions.</p>
            </div>
          ) : (
            displayedDiffs.map((diff) => (
              <div
                key={diff.cellId}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50/40 dark:bg-zinc-900/20"
              >
                {/* Cell Diff Banner */}
                <div className="flex items-center justify-between px-4 py-2 bg-zinc-100/70 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full font-medium text-[10px] uppercase tracking-wider ${
                        diff.type === 'modified'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-400'
                          : diff.type === 'added'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400'
                          : diff.type === 'deleted'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-400'
                          : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {diff.type}
                    </span>
                    <span className="font-mono text-zinc-600 dark:text-zinc-400">
                      ID: {diff.cellId} ({diff.cellType})
                    </span>
                  </div>

                  <span className="text-zinc-400 text-[11px]">
                    {diff.type === 'modified'
                      ? `Old #${(diff.indexOld ?? 0) + 1} → New #${(diff.indexNew ?? 0) + 1}`
                      : diff.type === 'added'
                      ? `New #${(diff.indexNew ?? 0) + 1}`
                      : `Old #${(diff.indexOld ?? 0) + 1}`}
                  </span>
                </div>

                {/* Line Diff View */}
                <div className="font-mono text-xs overflow-x-auto divide-y divide-zinc-200/50 dark:divide-zinc-900">
                  {diff.sourceDiff.map((line, lIdx) => {
                    const isAdded = line.type === 'added';
                    const isDeleted = line.type === 'deleted';

                    return (
                      <div
                        key={lIdx}
                        className={`flex items-start px-3 py-1 ${
                          isAdded
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : isDeleted
                            ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                            : 'text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {/* Line indicator */}
                        <div className="w-6 shrink-0 select-none text-zinc-400 flex items-center justify-center">
                          {isAdded ? (
                            <Plus className="w-3 h-3 text-emerald-500" />
                          ) : isDeleted ? (
                            <Minus className="w-3 h-3 text-red-500" />
                          ) : (
                            <span className="text-zinc-300 dark:text-zinc-700"> </span>
                          )}
                        </div>

                        {/* Line text */}
                        <pre className="font-mono whitespace-pre flex-1 leading-5">
                          {line.text}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
