/**
 * Secure Markdown Cell Renderer
 * Features:
 * - KaTeX LaTeX math rendering ($...$ and $$...$$)
 * - Strict DOMPurify sanitization
 * - Enforces rel="noopener noreferrer nofollow" and target="_blank"
 * - Heading ID anchors for TOC scroll-spy
 */

import React from 'react';
import DOMPurify from 'dompurify';
import { renderMathInMarkdown } from '../utils/katexRenderer';
import { normalizeSource } from '../types/nbformat';

interface MarkdownCellProps {
  source: string | string[];
  cellId?: string;
}

export const MarkdownCell: React.FC<MarkdownCellProps> = ({ source, cellId }) => {
  const rawText = normalizeSource(source);

  const sanitizedHtml = React.useMemo(() => {
    // 1. Process math equations with KaTeX first
    const withMath = renderMathInMarkdown(rawText);

    // 2. Simple, robust Markdown parser
    const html = parseMarkdownBasic(withMath);

    // 3. Strict DOMPurify sanitization (as mandated by security-ipynb rule)
    const clean = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      ADD_ATTR: ['target', 'rel', 'class', 'id', 'aria-hidden'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base', 'style'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'data-*'],
      SANITIZE_DOM: true,
    });

    return clean;
  }, [rawText]);

  return (
    <div
      id={cellId}
      className="prose prose-zinc dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100 py-2 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};

/**
 * Lightweight, zero-dependency Markdown parser
 */
function parseMarkdownBasic(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let inCodeBlock = false;
  let codeBlockBuffer = '';
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        out.push(
          `<pre class="bg-zinc-100 dark:bg-zinc-900 p-3 rounded-lg overflow-x-auto text-sm font-mono text-zinc-800 dark:text-zinc-200"><code>${escapeHtml(codeBlockBuffer.trim())}</code></pre>`
        );
        codeBlockBuffer = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockBuffer += line + '\n';
      continue;
    }

    // Tables
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (!inTable) {
        inTable = true;
        out.push('<div class="overflow-x-auto my-3"><table class="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded text-sm">');
      }
      // Check if delimiter row
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) {
        continue;
      }
      const cells = line.trim().slice(1, -1).split('|');
      out.push('<tr>');
      cells.forEach(c => {
        out.push(`<td class="px-3 py-2 border-r border-zinc-200 dark:border-zinc-800 last:border-r-0">${inlineStyles(c.trim())}</td>`);
      });
      out.push('</tr>');
      continue;
    } else if (inTable) {
      inTable = false;
      out.push('</table></div>');
    }

    // Headings
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match && h1Match[1]) {
      const headingText = h1Match[1];
      const anchor = slugify(headingText);
      out.push(`<h1 id="${anchor}" class="text-2xl font-bold tracking-tight mt-6 mb-3 scroll-mt-20 border-b border-zinc-200 dark:border-zinc-800 pb-2">${inlineStyles(headingText)}</h1>`);
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match && h2Match[1]) {
      const headingText = h2Match[1];
      const anchor = slugify(headingText);
      out.push(`<h2 id="${anchor}" class="text-xl font-semibold tracking-tight mt-5 mb-2 scroll-mt-20">${inlineStyles(headingText)}</h2>`);
      continue;
    }

    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match && h3Match[1]) {
      const headingText = h3Match[1];
      const anchor = slugify(headingText);
      out.push(`<h3 id="${anchor}" class="text-lg font-medium tracking-tight mt-4 mb-2 scroll-mt-20">${inlineStyles(headingText)}</h3>`);
      continue;
    }

    // Lists
    const listMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (listMatch && listMatch[1]) {
      if (!inList) {
        out.push('<ul class="list-disc list-inside my-2 space-y-1">');
        inList = true;
      }
      out.push(`<li>${inlineStyles(listMatch[1])}</li>`);
      continue;
    } else if (inList) {
      out.push('</ul>');
      inList = false;
    }

    // Blockquotes
    if (line.startsWith('>')) {
      const quoteText = line.replace(/^>\s?/, '');
      out.push(`<blockquote class="border-l-4 border-blue-500 pl-4 py-1 my-2 italic text-zinc-600 dark:text-zinc-400">${inlineStyles(quoteText)}</blockquote>`);
      continue;
    }

    // Empty lines
    if (!line.trim()) {
      continue;
    }

    // Normal paragraph
    out.push(`<p class="my-2 leading-relaxed">${inlineStyles(line)}</p>`);
  }

  if (inList) out.push('</ul>');
  if (inTable) out.push('</table></div>');
  if (inCodeBlock) {
    out.push(`<pre class="bg-zinc-100 dark:bg-zinc-900 p-3 rounded-lg overflow-x-auto text-sm font-mono"><code>${escapeHtml(codeBlockBuffer)}</code></pre>`);
  }

  return out.join('\n');
}

function inlineStyles(text: string): string {
  // If text already has KaTeX rendered spans, leave them intact
  // 1. Links: [text](url) -> enforce target="_blank" and rel="noopener noreferrer nofollow"
  let res = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow" class="text-blue-600 dark:text-blue-400 underline font-medium hover:text-blue-700">${escapeHtml(label)}</a>`;
  });

  // 2. Bold: **text**
  res = res.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 3. Italic: *text*
  res = res.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  // 4. Inline code: `text` (if not already part of KaTeX)
  res = res.replace(/`([^`]+)`/g, '<code class="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono text-pink-600 dark:text-pink-400">$1</code>');

  return res;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
