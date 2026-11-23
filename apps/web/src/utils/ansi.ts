/**
 * ANSI Color & Style Escape Sequence Parser
 * Safely converts terminal ANSI escape sequences into styled HTML spans.
 */

interface StyleState {
  color?: string;
  bgColor?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const ANSI_COLORS_LIGHT: Record<number, string> = {
  30: '#18181b', // black
  31: '#dc2626', // red
  32: '#16a34a', // green
  33: '#d97706', // yellow
  34: '#2563eb', // blue
  35: '#9333ea', // magenta
  36: '#0891b2', // cyan
  37: '#71717a', // white
  90: '#71717a', // bright black / gray
  91: '#ef4444', // bright red
  92: '#22c55e', // bright green
  93: '#f59e0b', // bright yellow
  94: '#3b82f6', // bright blue
  95: '#a855f7', // bright magenta
  96: '#06b6d4', // bright cyan
  97: '#f4f4f5', // bright white
};

export function ansiToHtml(text: string): string {
  // Regex matches ANSI escape sequences: \u001b[...m
  const ansiRegex = /\u001b\[([0-9;]*)m/g;
  let html = '';
  let lastIndex = 0;
  let state: StyleState = {};

  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const buildStyle = (s: StyleState): string => {
    const parts: string[] = [];
    if (s.color) parts.push(`color: ${s.color};`);
    if (s.bold) parts.push('font-weight: 600;');
    if (s.dim) parts.push('opacity: 0.7;');
    if (s.italic) parts.push('font-style: italic;');
    if (s.underline) parts.push('text-decoration: underline;');
    return parts.length > 0 ? ` style="${parts.join(' ')}"` : '';
  };

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(text)) !== null) {
    const rawChunk = text.substring(lastIndex, match.index);
    if (rawChunk) {
      const styleAttr = buildStyle(state);
      if (styleAttr) {
        html += `<span${styleAttr}>${escapeHtml(rawChunk)}</span>`;
      } else {
        html += escapeHtml(rawChunk);
      }
    }

    const codes = match[1] ? match[1].split(';').map(Number) : [0];
    for (const code of codes) {
      if (code === 0) {
        state = {};
      } else if (code === 1) {
        state.bold = true;
      } else if (code === 2) {
        state.dim = true;
      } else if (code === 3) {
        state.italic = true;
      } else if (code === 4) {
        state.underline = true;
      } else if (code === 22) {
        state.bold = false;
        state.dim = false;
      } else if (code === 23) {
        state.italic = false;
      } else if (code === 24) {
        state.underline = false;
      } else if (ANSI_COLORS_LIGHT[code]) {
        state.color = ANSI_COLORS_LIGHT[code];
      } else if (code === 39) {
        state.color = undefined;
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  const trailing = text.substring(lastIndex);
  if (trailing) {
    const styleAttr = buildStyle(state);
    if (styleAttr) {
      html += `<span${styleAttr}>${escapeHtml(trailing)}</span>`;
    } else {
      html += escapeHtml(trailing);
    }
  }

  return html;
}
