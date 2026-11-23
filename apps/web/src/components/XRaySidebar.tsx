/**
 * Notebook X-Ray Sidebar
 * Deep structural diagnostics:
 * 1. Hierarchical Table of Contents (TOC) with scroll-spy
 * 2. Automated Dependency & Import Scanner
 * 3. Cell Metrics & Runtime Heatmap
 */

import React, { useState, useEffect } from 'react';
import { NotebookDocument, normalizeSource } from '../types/nbformat';
import { scanNotebookImports, ScannedDependency } from '../utils/imports';
import { slugify } from './MarkdownCell';
import {
  ListTree,
  Package,
  Activity,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
} from 'lucide-react';

interface XRaySidebarProps {
  notebook: NotebookDocument;
  isOpen: boolean;
  onClose: () => void;
  activeCellIndex?: number;
  onSelectCell?: (index: number) => void;
}

interface TocItem {
  level: number;
  title: string;
  anchor: string;
  cellIndex: number;
}

export const XRaySidebar: React.FC<XRaySidebarProps> = ({
  notebook,
  isOpen,
  onClose,
  activeCellIndex = 0,
  onSelectCell,
}) => {
  const [activeTab, setActiveTab] = useState<'toc' | 'imports' | 'metrics'>('toc');
  const [activeHeadingAnchor, setActiveHeadingAnchor] = useState<string>('');

  // 1. Parse Table of Contents
  const tocItems: TocItem[] = React.useMemo(() => {
    const items: TocItem[] = [];
    notebook.cells.forEach((cell, cellIndex) => {
      if (cell.cell_type !== 'markdown') return;
      const text = normalizeSource(cell.source);
      const lines = text.split('\n');

      for (const line of lines) {
        const match = line.match(/^(#{1,3})\s+(.+)$/);
        if (match && match[1] && match[2]) {
          const level = match[1].length;
          const title = match[2].trim();
          items.push({
            level,
            title,
            anchor: slugify(title),
            cellIndex,
          });
        }
      }
    });
    return items;
  }, [notebook]);

  // 2. Scan Python Imports
  const dependencies: ScannedDependency[] = React.useMemo(() => {
    return scanNotebookImports(notebook);
  }, [notebook]);

  // 3. Calculate Cell Metrics
  const cellMetrics = React.useMemo(() => {
    let totalLoc = 0;
    let totalOutputBytes = 0;
    const items = notebook.cells.map((cell, idx) => {
      const src = normalizeSource(cell.source);
      const loc = src.split('\n').filter((l) => l.trim().length > 0).length;
      totalLoc += loc;

      let outputBytes = 0;
      if (cell.cell_type === 'code' && cell.outputs) {
        outputBytes = new TextEncoder().encode(JSON.stringify(cell.outputs)).length;
        totalOutputBytes += outputBytes;
      }

      let durationMs = 0;
      if (cell.cell_type === 'code' && cell.metadata?.jupyter) {
        durationMs = (cell.metadata.jupyter as any)?.execution?.duration_ms || 0;
      }

      return {
        cellIndex: idx,
        type: cell.cell_type,
        loc,
        outputBytes,
        durationMs,
        isOversized: outputBytes > 2 * 1024 * 1024, // > 2MB warning
      };
    });

    return { items, totalLoc, totalOutputBytes };
  }, [notebook]);

  // Scroll-spy observer for headings
  useEffect(() => {
    if (!isOpen || tocItems.length === 0) return;

    const handleScroll = () => {
      const headingElements = tocItems
        .map((item) => document.getElementById(item.anchor))
        .filter((el): el is HTMLElement => el !== null);

      let current = '';
      for (const el of headingElements) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 120) {
          current = el.id;
        }
      }
      if (current) {
        setActiveHeadingAnchor(current);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isOpen, tocItems]);

  const scrollToAnchor = (anchor: string, cellIndex: number) => {
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (onSelectCell) {
      onSelectCell(cellIndex);
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-80 md:w-96 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col transition-transform duration-300"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
      }}
      aria-label="Notebook X-Ray Diagnostics"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-500" />
          <h2 className="font-semibold text-sm tracking-tight text-zinc-900 dark:text-zinc-100">
            Notebook X-Ray
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          title="Close X-Ray (Shortcut: x)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-xs font-medium">
        <button
          onClick={() => setActiveTab('toc')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors border-b-2 ${
            activeTab === 'toc'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-zinc-950 font-semibold'
              : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <ListTree className="w-3.5 h-3.5" />
          <span>TOC ({tocItems.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('imports')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors border-b-2 ${
            activeTab === 'imports'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-zinc-950 font-semibold'
              : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          <span>Imports ({dependencies.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('metrics')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors border-b-2 ${
            activeTab === 'metrics'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-zinc-950 font-semibold'
              : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Metrics</span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Tab 1: Table of Contents */}
        {activeTab === 'toc' && (
          <div className="space-y-1">
            {tocItems.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">No Markdown headings detected.</p>
            ) : (
              tocItems.map((item, idx) => {
                const isActive = activeHeadingAnchor === item.anchor;
                const indent = item.level === 1 ? 'pl-1 font-medium' : item.level === 2 ? 'pl-4 text-xs' : 'pl-7 text-xs';

                return (
                  <button
                    key={idx}
                    onClick={() => scrollToAnchor(item.anchor, item.cellIndex)}
                    className={`w-full text-left py-1.5 px-2 rounded-md transition-colors flex items-center gap-2 group ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-semibold'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                    } ${indent}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 group-hover:bg-blue-500" />
                    <span className="truncate">{item.title}</span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* Tab 2: Dependency Scanner */}
        {activeTab === 'imports' && (
          <div className="space-y-3">
            {dependencies.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">No Python import statements found.</p>
            ) : (
              dependencies.map((dep, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 text-xs"
                >
                  <div className="flex items-center justify-between font-mono font-semibold">
                    <span className="text-zinc-900 dark:text-zinc-100">{dep.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-sans font-medium ${
                        dep.category === 'gpu_heavy'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'
                          : dep.category === 'scientific'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                          : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {dep.categoryLabel}
                    </span>
                  </div>

                  <div className="mt-2 text-[11px] text-zinc-500 space-y-0.5">
                    <div className="flex items-center gap-1">
                      {dep.runnableInPyodide ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                      )}
                      <span>
                        {dep.runnableInPyodide
                          ? 'Runs in browser (Pyodide)'
                          : 'Requires cloud GPU / server'}
                      </span>
                    </div>
                    <div className="text-zinc-400 text-[10px]">
                      Referenced across {dep.cellCount} cell(s)
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 3: Metrics & Heatmap */}
        {activeTab === 'metrics' && (
          <div className="space-y-4">
            {/* Overview Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800">
                <span className="text-zinc-500">Total Cells</span>
                <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {notebook.cells.length}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800">
                <span className="text-zinc-500">Lines of Code</span>
                <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {cellMetrics.totalLoc}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800">
                <span className="text-zinc-500">Output Payload</span>
                <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {(cellMetrics.totalOutputBytes / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800">
                <span className="text-zinc-500">Code / MD Ratio</span>
                <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {Math.round(
                    (notebook.cells.filter((c) => c.cell_type === 'code').length /
                      Math.max(1, notebook.cells.length)) *
                      100
                  )}
                  %
                </p>
              </div>
            </div>

            {/* Cell Heatmap */}
            <div>
              <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span>Cell Execution Heatmap</span>
              </h3>
              <div className="space-y-1.5">
                {cellMetrics.items.map((m) => {
                  const isCurrent = m.cellIndex === activeCellIndex;
                  let badgeColor = 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
                  if (m.type === 'code') {
                    if (m.durationMs > 5000) {
                      badgeColor = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400';
                    } else if (m.durationMs > 1000) {
                      badgeColor = 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400';
                    } else if (m.durationMs > 0) {
                      badgeColor = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400';
                    }
                  }

                  return (
                    <div
                      key={m.cellIndex}
                      onClick={() => onSelectCell && onSelectCell(m.cellIndex)}
                      className={`flex items-center justify-between p-2 rounded text-xs font-mono cursor-pointer border transition-colors ${
                        isCurrent
                          ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100'
                          : 'hover:bg-zinc-100 dark:hover:bg-zinc-900 border-transparent hover:border-zinc-200 dark:hover:border-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-400">#{m.cellIndex + 1}</span>
                        <span className="capitalize text-zinc-600 dark:text-zinc-400">
                          {m.type}
                        </span>
                        {m.isOversized && (
                          <span className="text-red-500 flex items-center" title="Output exceeds 2MB">
                            <AlertTriangle className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-400">{m.loc} lines</span>
                        {m.type === 'code' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-sans font-medium ${badgeColor}`}>
                            {m.durationMs ? `${m.durationMs}ms` : '—'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
