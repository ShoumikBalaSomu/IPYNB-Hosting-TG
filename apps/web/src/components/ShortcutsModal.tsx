/**
 * Keyboard Shortcuts Modal
 */

import React from 'react';
import { X, Command } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Cmd+K / /', desc: 'Open quick search across cells' },
    { key: 'j / ↓', desc: 'Select next cell' },
    { key: 'k / ↑', desc: 'Select previous cell' },
    { key: 'Shift+Enter', desc: 'Run active cell in Pyodide Web Worker' },
    { key: 'r', desc: 'Toggle Report Mode (hide/show code)' },
    { key: 'x', desc: 'Toggle Notebook X-Ray sidebar' },
    { key: 'd', desc: 'Toggle Cell Version Diff' },
    { key: 'c', desc: 'Collapse / expand active cell' },
    { key: '?', desc: 'Show this shortcuts cheatsheet' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden p-6">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Command className="w-4 h-4 text-blue-500" />
            <h2 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
              Keyboard Navigation
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2.5 text-xs">
          {shortcuts.map((sc, i) => (
            <div key={i} className="flex items-center justify-between py-1">
              <span className="text-zinc-600 dark:text-zinc-400">{sc.desc}</span>
              <kbd className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
