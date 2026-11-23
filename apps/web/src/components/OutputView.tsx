/**
 * Notebook Cell Output Renderer
 * Handles stream (stdout/stderr), execute_result, display_data, and error.
 * Enforces strict XSS isolation, SVG img data URIs, and opaque sandboxed iframes.
 */

import React, { useState } from 'react';
import { CellOutput, normalizeText } from '../types/nbformat';
import { AnsiTraceback } from './AnsiTraceback';
import { SandboxedIframe } from './SandboxedIframe';
import { ansiToHtml } from '../utils/ansi';
import DOMPurify from 'dompurify';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface OutputViewProps {
  outputs: CellOutput[];
}

export const OutputView: React.FC<OutputViewProps> = ({ outputs }) => {
  if (!outputs || outputs.length === 0) return null;

  return (
    <div className="w-full mt-2 space-y-2 border-t border-zinc-100 dark:border-zinc-800/80 pt-2" aria-live="polite">
      {outputs.map((out, idx) => (
        <SingleOutput key={idx} output={out} />
      ))}
    </div>
  );
};

const SingleOutput: React.FC<{ output: CellOutput }> = ({ output }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // 1. Error Output
  if (output.output_type === 'error') {
    return (
      <AnsiTraceback
        ename={output.ename}
        evalue={output.evalue}
        traceback={output.traceback}
      />
    );
  }

  // 2. Stream Output (stdout / stderr)
  if (output.output_type === 'stream') {
    const rawText = normalizeText(output.text);
    const lines = rawText.split('\n');
    const isTruncated = lines.length > 50 && !isExpanded;
    const displayLines = isTruncated ? lines.slice(0, 50).join('\n') : rawText;

    const formattedHtml = ansiToHtml(displayLines);
    const isStderr = output.name === 'stderr';

    return (
      <div className={`rounded p-2 text-xs font-mono overflow-x-auto ${isStderr ? 'bg-amber-950/20 text-amber-300 border-l-2 border-amber-500' : 'bg-zinc-50 dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200'}`}>
        <pre
          className="leading-relaxed whitespace-pre font-mono"
          dangerouslySetInnerHTML={{ __html: formattedHtml }}
        />
        {lines.length > 50 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" /> Collapse output
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" /> Expand remaining {lines.length - 50} lines
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  // 3. Display Data & Execute Result MIME Bundles
  if (output.output_type === 'display_data' || output.output_type === 'execute_result') {
    const data = output.data || {};

    // HTML payload
    if (data['text/html']) {
      const rawHtml = normalizeText(data['text/html'] as string | string[]);

      // Check if payload contains interactive JavaScript (Plotly, Bokeh, or scripts)
      const hasScript = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(rawHtml) || /plotly|bokeh|canvas/i.test(rawHtml);

      if (hasScript) {
        // Enforce strictly isolated opaque iframe
        return <SandboxedIframe htmlContent={rawHtml} />;
      }

      // Safe static HTML: sanitize with DOMPurify
      const cleanHtml = DOMPurify.sanitize(rawHtml, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_ATTR: ['target', 'rel', 'class', 'id', 'aria-hidden'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base', 'style'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'data-*'],
        SANITIZE_DOM: true,
      });

      return (
        <div
          className="my-1 overflow-x-auto text-sm"
          dangerouslySetInnerHTML={{ __html: cleanHtml }}
        />
      );
    }

    // Image PNG / JPEG
    if (data['image/png'] || data['image/jpeg']) {
      const mime = data['image/png'] ? 'image/png' : 'image/jpeg';
      const b64 = normalizeText((data['image/png'] || data['image/jpeg']) as string | string[]).trim();
      const src = `data:${mime};base64,${b64}`;

      return (
        <div className="my-2 flex justify-center bg-white dark:bg-zinc-950 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <img
            src={src}
            alt="Notebook Output Chart"
            className="max-w-full h-auto rounded object-contain shadow-sm"
            loading="lazy"
          />
        </div>
      );
    }

    // Image SVG: Mandated by security-ipynb rule to isolate via <img> or DOMPurify
    if (data['image/svg+xml']) {
      const rawSvg = normalizeText(data['image/svg+xml'] as string | string[]);
      const b64Svg = btoa(unescape(encodeURIComponent(rawSvg)));
      const src = `data:image/svg+xml;base64,${b64Svg}`;

      return (
        <div className="my-2 flex justify-center bg-white dark:bg-zinc-950 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <img
            src={src}
            alt="Vector Chart Output"
            className="max-w-full h-auto rounded object-contain"
            loading="lazy"
          />
        </div>
      );
    }

    // JavaScript Output: Isolated strictly in opaque sandboxed iframe
    if (data['application/javascript']) {
      const rawJs = normalizeText(data['application/javascript'] as string | string[]);
      return <SandboxedIframe htmlContent={`<script>${rawJs}</script>`} />;
    }

    // JSON Payload
    if (data['application/json']) {
      const jsonStr = JSON.stringify(data['application/json'], null, 2);
      return (
        <pre className="my-1 rounded bg-zinc-100 dark:bg-zinc-900 p-2 text-xs font-mono text-zinc-800 dark:text-zinc-200 overflow-x-auto">
          {jsonStr}
        </pre>
      );
    }

    // Fallback: text/plain
    if (data['text/plain']) {
      const plain = normalizeText(data['text/plain'] as string | string[]);
      return (
        <pre className="my-1 rounded bg-zinc-50 dark:bg-zinc-900/60 p-2 text-xs font-mono text-zinc-800 dark:text-zinc-200 overflow-x-auto whitespace-pre-wrap">
          {plain}
        </pre>
      );
    }
  }

  return null;
};
