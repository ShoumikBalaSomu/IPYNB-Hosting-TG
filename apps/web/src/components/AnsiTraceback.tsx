/**
 * ANSI Colorized Terminal Traceback Component
 */

import React from 'react';
import { ansiToHtml } from '../utils/ansi';

interface AnsiTracebackProps {
  ename: string;
  evalue: string;
  traceback: string[];
}

export const AnsiTraceback: React.FC<AnsiTracebackProps> = ({
  ename,
  evalue,
  traceback,
}) => {
  const formattedHtml = React.useMemo(() => {
    if (traceback && traceback.length > 0) {
      return traceback.map((line) => ansiToHtml(line)).join('\n');
    }
    return `<span class="text-red-500 font-bold">${ename}</span>: ${evalue}`;
  }, [ename, evalue, traceback]);

  return (
    <div className="w-full my-2 rounded-lg bg-zinc-950 p-3 text-xs font-mono text-zinc-100 overflow-x-auto border border-red-900/40 shadow-inner">
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-zinc-800 text-red-400 font-semibold">
        <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
        <span>{ename}: {evalue}</span>
      </div>
      <pre
        className="leading-relaxed whitespace-pre font-mono text-zinc-300"
        dangerouslySetInnerHTML={{ __html: formattedHtml }}
      />
    </div>
  );
};
