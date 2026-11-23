/**
 * TeleBook Main Application Entry Component
 */

import React, { useState, useCallback } from 'react';
import { NotebookDocument, CodeCell as ICodeCell } from './types/nbformat';
import { SAMPLE_NOTEBOOK } from './utils/sampleNotebooks';
import { useTelegramWebApp } from './hooks/useTelegramWebApp';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePyodideWorker } from './hooks/usePyodideWorker';
import { Header } from './components/Header';
import { NotebookViewer } from './components/NotebookViewer';
import { XRaySidebar } from './components/XRaySidebar';
import { SearchModal } from './components/SearchModal';
import { VersionDiffModal } from './components/VersionDiffModal';
import { PasskeyModal } from './components/PasskeyModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { NotebookUpload } from './components/NotebookUpload';
export const App: React.FC = () => {
  const { haptic } = useTelegramWebApp();
  const [notebook, setNotebook] = useState<NotebookDocument>(SAMPLE_NOTEBOOK);
  const [previousNotebook, setPreviousNotebook] = useState<NotebookDocument | undefined>(undefined);

  const [activeCellIndex, setActiveCellIndex] = useState<number>(0);
  const [isReportMode, setIsReportMode] = useState<boolean>(false);
  const [isXRayOpen, setIsXRayOpen] = useState<boolean>(false);
  const [isDiffOpen, setIsDiffOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isPasskeyModalOpen, setIsPasskeyModalOpen] = useState<boolean>(false);
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);

  const { runningCellId, runCode } = usePyodideWorker();

  // Run a cell via Pyodide WebAssembly isolate
  const handleRunCell = useCallback(
    async (cellIndex: number, code: string) => {
      const targetCell = notebook.cells[cellIndex];
      if (!targetCell || targetCell.cell_type !== 'code') return;

      const cellId = targetCell.id || `cell-${cellIndex}`;
      try {
        const outputs = await runCode(cellId, code);

        setNotebook((prev) => {
          const newCells = [...prev.cells];
          const curr = newCells[cellIndex] as ICodeCell;
          if (curr) {
            newCells[cellIndex] = {
              ...curr,
              execution_count: (curr.execution_count || 0) + 1,
              outputs,
              source: code,
            };
          }
          return { ...prev, cells: newCells };
        });
        haptic.notification('success');
      } catch (err) {
        haptic.notification('error');
      }
    },
    [notebook.cells, runCode, haptic]
  );

  const handleRunActiveCell = useCallback(() => {
    const cell = notebook.cells[activeCellIndex];
    if (cell && cell.cell_type === 'code') {
      const src = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
      handleRunCell(activeCellIndex, src);
    }
  }, [activeCellIndex, notebook.cells, handleRunCell]);

  const handleCodeChange = useCallback((cellIndex: number, newCode: string) => {
    setNotebook((prev) => {
      const newCells = [...prev.cells];
      const curr = newCells[cellIndex];
      if (curr) {
        newCells[cellIndex] = { ...curr, source: newCode };
      }
      return { ...prev, cells: newCells };
    });
  }, []);

  // Keyboard navigation shortcuts
  useKeyboardShortcuts({
    onSearch: () => setIsSearchOpen(true),
    onNextCell: () => {
      setActiveCellIndex((prev) => Math.min(notebook.cells.length - 1, prev + 1));
      haptic.selection();
    },
    onPrevCell: () => {
      setActiveCellIndex((prev) => Math.max(0, prev - 1));
      haptic.selection();
    },
    onToggleCollapse: () => {
      // Toggle collapse on active cell if applicable
      haptic.impact('light');
    },
    onToggleDiff: () => {
      setIsDiffOpen((prev) => !prev);
      haptic.impact('light');
    },
    onToggleReportMode: () => {
      setIsReportMode((prev) => !prev);
      haptic.impact('light');
    },
    onToggleXRay: () => {
      setIsXRayOpen((prev) => !prev);
      haptic.impact('light');
    },
    onRunActiveCell: handleRunActiveCell,
    onHelp: () => setIsHelpOpen(true),
  });

  const handleSelectCell = (idx: number) => {
    setActiveCellIndex(idx);
    const cellId = notebook.cells[idx]?.id || `cell-${idx}`;
    const el = document.getElementById(cellId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const handleLoadNewNotebook = (newDoc: NotebookDocument) => {
    setPreviousNotebook(notebook);
    setNotebook(newDoc);
    setActiveCellIndex(0);
    setIsUploadOpen(false);
  };

  const handleVersionSaved = (newVersion: number) => {
    setPreviousNotebook(notebook);
    setNotebook((prev) => ({
      ...prev,
      metadata: {
        ...prev.metadata,
        telebook: {
          ...prev.metadata?.telebook,
          version: newVersion,
        },
      },
    }));
  };

  const title = notebook.metadata?.telebook?.title || 'Notebook';
  const version = notebook.metadata?.telebook?.version || 1;
  const tags = notebook.metadata?.telebook?.tags || [];

  return (
    <div className="min-h-screen bg-tg-bg text-tg-text flex flex-col font-sans selection:bg-blue-500/20 selection:text-blue-600 transition-colors">
      {/* Top Application Header */}
      <Header
        title={title}
        version={version}
        tags={tags}
        isReportMode={isReportMode}
        isXRayOpen={isXRayOpen}
        onToggleReportMode={() => setIsReportMode(!isReportMode)}
        onToggleXRay={() => setIsXRayOpen(!isXRayOpen)}
        onOpenDiff={() => setIsDiffOpen(true)}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenPasskeyModal={() => setIsPasskeyModalOpen(true)}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      {/* Main Content Area */}
      <main
        className="flex-1 w-full max-w-5xl mx-auto px-2 sm:px-4 pb-16 transition-all"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 16px)',
        }}
      >
        {isUploadOpen ? (
          <div className="py-8">
            <NotebookUpload
              onLoadNotebook={handleLoadNewNotebook}
              onLoadSample={() => {
                handleLoadNewNotebook(SAMPLE_NOTEBOOK);
              }}
            />
          </div>
        ) : (
          <NotebookViewer
            notebook={notebook}
            activeCellIndex={activeCellIndex}
            isReportMode={isReportMode}
            runningCellId={runningCellId}
            onSelectCell={handleSelectCell}
            onRunCell={handleRunCell}
            onCodeChange={handleCodeChange}
          />
        )}
      </main>

      {/* Notebook X-Ray Sidebar */}
      <XRaySidebar
        notebook={notebook}
        isOpen={isXRayOpen}
        onClose={() => setIsXRayOpen(false)}
        activeCellIndex={activeCellIndex}
        onSelectCell={handleSelectCell}
      />

      {/* Cmd+K Search Modal */}
      <SearchModal
        notebook={notebook}
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectCell={handleSelectCell}
      />

      {/* Cell Version Diff Modal */}
      <VersionDiffModal
        currentNotebook={notebook}
        previousNotebook={previousNotebook}
        isOpen={isDiffOpen}
        onClose={() => setIsDiffOpen(false)}
      />

      {/* Passkey & Save-Back Modal */}
      <PasskeyModal
        notebook={notebook}
        isOpen={isPasskeyModalOpen}
        onClose={() => setIsPasskeyModalOpen(false)}
        onVersionSaved={handleVersionSaved}
      />

      {/* Keyboard Shortcuts Reference */}
      <ShortcutsModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
};

export default App;
