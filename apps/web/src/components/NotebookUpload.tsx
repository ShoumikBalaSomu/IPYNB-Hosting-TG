/**
 * Drag-and-Drop Notebook Upload Component
 */

import React, { useState, useRef } from 'react';
import { NotebookDocument } from '../types/nbformat';
import { UploadCloud, Sparkles, AlertCircle } from 'lucide-react';
import { useTelegramWebApp } from '../hooks/useTelegramWebApp';

interface NotebookUploadProps {
  onLoadNotebook: (notebook: NotebookDocument) => void;
  onLoadSample: () => void;
}

export const NotebookUpload: React.FC<NotebookUploadProps> = ({
  onLoadNotebook,
  onLoadSample,
}) => {
  const { haptic } = useTelegramWebApp();
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processFile = (file: File) => {
    setErrorMsg(null);
    if (!file.name.endsWith('.ipynb') && file.type !== 'application/json') {
      setErrorMsg('Please upload a valid Jupyter Notebook (.ipynb) file.');
      haptic.notification('error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);

        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cells)) {
          throw new Error('Malformed notebook format: missing cells array.');
        }

        haptic.notification('success');
        onLoadNotebook(parsed as NotebookDocument);
      } catch (err: any) {
        setErrorMsg(`Failed to parse notebook JSON: ${err.message}`);
        haptic.notification('error');
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto my-6 p-6 rounded-2xl border-2 border-dashed transition-all duration-200 text-center bg-white dark:bg-zinc-950/60 shadow-sm border-zinc-300 dark:border-zinc-800 hover:border-blue-500/60">
      <input
        ref={fileInputRef}
        type="file"
        accept=".ipynb,application/json"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
          }
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`cursor-pointer transition-colors p-4 rounded-xl ${
          isDragging ? 'bg-blue-50/50 dark:bg-blue-950/30' : ''
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3">
          <UploadCloud className="w-6 h-6" />
        </div>

        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Drop your .ipynb notebook here
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto mb-4">
          Client-side encrypted with AES-256-GCM before storage. No plaintext ever leaves your browser.
        </p>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        >
          Browse Local Files
        </button>
      </div>

      {errorMsg && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 justify-center">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-center gap-2 text-xs text-zinc-500">
        <span>Want to test immediately?</span>
        <button
          type="button"
          onClick={onLoadSample}
          className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Load Neural Optimization Showcase</span>
        </button>
      </div>
    </div>
  );
};
