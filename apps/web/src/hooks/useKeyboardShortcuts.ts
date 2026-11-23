/**
 * Keyboard Shortcuts Hook for Calm Desktop/Mobile Navigation
 * Shortcuts: /, Cmd+K, j/k, c, d, r, x, Shift+Enter, ?
 */

import { useEffect } from 'react';

export interface ShortcutHandlers {
  onSearch: () => void;
  onNextCell: () => void;
  onPrevCell: () => void;
  onToggleCollapse: () => void;
  onToggleDiff: () => void;
  onToggleReportMode: () => void;
  onToggleXRay: () => void;
  onRunActiveCell: () => void;
  onHelp: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable);

      // Cmd+K or Ctrl+K (Global search modal)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlers.onSearch();
        return;
      }

      // Shift+Enter (Run active cell)
      if (e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        handlers.onRunActiveCell();
        return;
      }

      // If user is currently typing in an input/textarea, do not intercept single letter shortcuts
      if (isInput) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          handlers.onSearch();
          break;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          handlers.onNextCell();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          handlers.onPrevCell();
          break;
        case 'c':
          e.preventDefault();
          handlers.onToggleCollapse();
          break;
        case 'd':
          e.preventDefault();
          handlers.onToggleDiff();
          break;
        case 'r':
          e.preventDefault();
          handlers.onToggleReportMode();
          break;
        case 'x':
          e.preventDefault();
          handlers.onToggleXRay();
          break;
        case '?':
          e.preventDefault();
          handlers.onHelp();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
