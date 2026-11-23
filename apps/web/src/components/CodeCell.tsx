/**
 * Code Cell Component
 * Features syntax highlighting, line numbers, live Pyodide execution,
 * copy-to-clipboard with haptics, and collapsible code view.
 */

import React, { useState } from 'react';
import { CodeCell as ICodeCell, normalizeSource } from '../types/nbformat';
import { highlightPythonCode } from '../utils/syntaxHighlight';
import { OutputView } from './OutputView';
import { Play, Copy, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useTelegramWebApp } from '../hooks/useTelegramWebApp';

interface CodeCellProps {
  cell: ICodeCell;
  cellIndex: number;
  isFocused?: boolean;
  isReportMode?: boolean;
  isRunning?: boolean;
  onRun?: (code: string) => void;
  onCodeChange?: (newCode: string) => void;
}

export const CodeCell: React.FC<CodeCellProps> = ({
  cell,
  cellIndex: _cellIndex,
  isFocused = false,
  isReportMode = false,
  isRunning = false,
  onRun,
  onCodeChange,
}) => {
  const { haptic } = useTelegramWebApp();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const rawCode = normalizeSource(cell.source);
  const highlightedCode = React.useMemo(() => highlightPythonCode(rawCode), [rawCode]);
  const lines = rawCode.split('\n');

  const durationMs = typeof (cell.metadata?.jupyter as any)?.execution?.duration_ms === 'number'
    ? ((cell.metadata?.jupyter as any).execution.duration_ms as number)
    : null;

  // In Report Mode, hide code cell completely if it has outputs or is folded
  if (isReportMode && !isFocused) {
    if (cell.outputs && cell.outputs.length > 0) {
      return (
        <div className="py-2">
          <OutputView outputs={cell.outputs} />
        </div>
      );
    }
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setIsCopied(true);
      haptic.notification('success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleRun = () => {
    haptic.impact('light');
    if (onRun) {
      onRun(rawCode);
    }
  };

  return (
    <div
      className={`group relative rounded-xl border transition-all duration-150 ${
        isFocused
          ? 'border-blue-500/80 ring-2 ring-blue-500/20 shadow-sm'
          : 'border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700'
      } bg-white dark:bg-zinc-950 overflow-hidden my-3`}
    >
      {/* Cell Header Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 select-none">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsCollapsed(!isCollapsed);
              haptic.impact('light');
            }}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            title={isCollapsed ? 'Expand cell' : 'Collapse cell'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <span className="font-mono text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
            {isRunning ? (
              <span className="text-amber-500 flex items-center gap-1 font-semibold">
                <Loader2 className="w-3 h-3 animate-spin" /> In [*]
              </span>
            ) : cell.execution_count ? (
              `In [${cell.execution_count}]`
            ) : (
              'In [ ]'
            )}
          </span>

          {durationMs !== null && (
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800 text-[10px] text-zinc-500">
              {durationMs}ms
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 font-medium transition-colors text-[11px]"
            title="Run Cell (Shift+Enter)"
          >
            {isRunning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3 fill-current" />
            )}
            <span className="hidden sm:inline">Run</span>
          </button>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            title="Copy code"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Code Area */}
      {!isCollapsed && (
        <div className="relative flex text-xs font-mono bg-zinc-50/50 dark:bg-zinc-950/50">
          {/* Line Numbers */}
          <div className="py-2.5 px-3 select-none text-right font-mono text-zinc-400 dark:text-zinc-600 border-r border-zinc-200/60 dark:border-zinc-900 bg-zinc-100/30 dark:bg-zinc-900/20 text-[11px]">
            {lines.map((_, i) => (
              <div key={i} className="leading-5">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code Content */}
          <div className="flex-1 p-2.5 overflow-x-auto">
            {isEditing ? (
              <textarea
                value={rawCode}
                onChange={(e) => onCodeChange && onCodeChange(e.target.value)}
                onBlur={() => setIsEditing(false)}
                autoFocus
                className="w-full bg-transparent font-mono text-xs leading-5 focus:outline-none resize-none text-zinc-900 dark:text-zinc-100"
                rows={lines.length}
              />
            ) : (
              <pre
                onClick={() => setIsEditing(true)}
                className="leading-5 font-mono text-zinc-900 dark:text-zinc-100 cursor-text"
                dangerouslySetInnerHTML={{ __html: highlightedCode }}
              />
            )}
          </div>
        </div>
      )}

      {/* Outputs */}
      {cell.outputs && cell.outputs.length > 0 && (
        <div className="p-3 bg-white dark:bg-zinc-950">
          <OutputView outputs={cell.outputs} />
        </div>
      )}
    </div>
  );
};
