/**
 * TeleBook Main Application Header
 */

import React from 'react';
import {
  Search,
  Layers,
  GitCompare,
  Lock,
  BookOpen,
  Code2,
  HelpCircle,
  Sun,
  Moon,
  FolderOpen,
} from 'lucide-react';
import { useTelegramWebApp } from '../hooks/useTelegramWebApp';

interface HeaderProps {
  title: string;
  version: number;
  tags?: string[];
  isReportMode: boolean;
  isXRayOpen: boolean;
  onToggleReportMode: () => void;
  onToggleXRay: () => void;
  onOpenDiff: () => void;
  onOpenSearch: () => void;
  onOpenPasskeyModal: () => void;
  onOpenUpload: () => void;
  onOpenHelp: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  version,
  tags = [],
  isReportMode,
  isXRayOpen,
  onToggleReportMode,
  onToggleXRay,
  onOpenDiff,
  onOpenSearch,
  onOpenPasskeyModal,
  onOpenUpload,
  onOpenHelp,
}) => {
  const { isTMA, user } = useTelegramWebApp();

  const toggleTheme = () => {
    const root = document.documentElement;
    const isDark = root.classList.contains('dark');
    if (isDark) {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    } else {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    }
  };

  return (
    <header
      className="sticky top-0 z-30 w-full bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 transition-colors"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        {/* Left Branding & Title */}
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm font-bold text-xs tracking-wider">
              TB
            </div>
            <span className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-100 hidden sm:inline">
              TeleBook
            </span>
          </div>

          <div className="h-4 w-[1px] bg-zinc-200 dark:bg-zinc-800 shrink-0 hidden sm:block" />

          <div className="flex items-center gap-2 overflow-hidden">
            <h1 className="text-xs sm:text-sm font-semibold truncate text-zinc-800 dark:text-zinc-200">
              {title}
            </h1>
            <span className="px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-mono text-[10px] font-semibold shrink-0">
              v{version}
            </span>
            {user && (
              <span className="hidden xl:inline-block px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-500 font-mono">
                @{user.username || user.firstName}
              </span>
            )}
            {tags.length > 0 && (
              <span className="hidden 2xl:inline-block text-[10px] text-zinc-400 truncate">
                #{tags[0]}
              </span>
            )}
          </div>
        </div>

        {/* Center / Right Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Report Mode vs Code Mode Toggle */}
          <button
            onClick={onToggleReportMode}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              isReportMode
                ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-800'
            }`}
            title="Toggle Report Mode (Hotkey: r)"
          >
            {isReportMode ? (
              <>
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Report Mode</span>
              </>
            ) : (
              <>
                <Code2 className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Code Mode</span>
              </>
            )}
          </button>

          {/* Quick Search */}
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 text-xs transition-colors"
            title="Search Cells (Cmd+K or /)"
          >
            <Search className="w-3.5 h-3.5" />
            <kbd className="hidden lg:inline text-[10px] px-1 bg-zinc-200 dark:bg-zinc-800 rounded font-mono">
              /
            </kbd>
          </button>

          {/* Notebook X-Ray Sidebar Toggle */}
          <button
            onClick={onToggleXRay}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors ${
              isXRayOpen
                ? 'bg-blue-600 text-white font-medium shadow-sm'
                : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
            title="Toggle X-Ray Diagnostics (Hotkey: x)"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">X-Ray</span>
          </button>

          {/* Version Diff */}
          <button
            onClick={onOpenDiff}
            className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 text-xs transition-colors"
            title="View Cell Version Diff (Hotkey: d)"
          >
            <GitCompare className="w-3.5 h-3.5" />
          </button>

          {/* Save v(N+1) & Passkey */}
          <button
            onClick={onOpenPasskeyModal}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors shadow-sm"
            title="Encrypt & Save as Version v(N+1)"
          >
            <Lock className="w-3 h-3" />
            <span className="hidden sm:inline">Save v{version + 1}</span>
          </button>

          {/* Open / Upload Notebook */}
          <button
            onClick={onOpenUpload}
            className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 text-xs transition-colors"
            title="Upload or Open Notebook"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          {/* Theme Toggle for Desktop Browser */}
          {!isTMA && (
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              title="Toggle Dark/Light Mode"
            >
              <Moon className="w-3.5 h-3.5 hidden dark:block" />
              <Sun className="w-3.5 h-3.5 block dark:hidden" />
            </button>
          )}

          {/* Keyboard Shortcuts Help */}
          <button
            onClick={onOpenHelp}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            title="Keyboard Shortcuts (?)"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
