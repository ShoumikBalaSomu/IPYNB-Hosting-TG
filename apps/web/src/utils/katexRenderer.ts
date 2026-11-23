/**
 * Safe LaTeX Math Renderer with KaTeX
 */

import katex from 'katex';

const KATEX_SAFE_OPTIONS = {
  throwOnError: false,
  trust: false,
  maxSize: 500,
  maxExpand: 1000,
  strict: false,
};

export function renderMathInMarkdown(content: string): string {
  if (!content) return '';

  // 1. Replace block math $$...$$
  let processed = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    try {
      return `<div class="katex-display my-2 overflow-x-auto">${katex.renderToString(math.trim(), {
        ...KATEX_SAFE_OPTIONS,
        displayMode: true,
      })}</div>`;
    } catch {
      return `<code>$$${math}$$</code>`;
    }
  });

  // 2. Replace inline math $...$ (ensuring no leading/trailing space inside $)
  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), {
        ...KATEX_SAFE_OPTIONS,
        displayMode: false,
      });
    } catch {
      return `<code>$${math}$</code>`;
    }
  });

  return processed;
}
