/**
 * Lightweight, High-Performance Python Syntax Highlighter
 * Zero heavy grammar dependencies to keep bundle size < 250 KB gzipped.
 */

const KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
  'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'True', 'False', 'None'
]);

const BUILTINS = new Set([
  'abs', 'all', 'any', 'bin', 'bool', 'bytes', 'callable', 'chr',
  'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod',
  'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset',
  'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input',
  'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals',
  'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open',
  'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round',
  'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum',
  'super', 'tuple', 'type', 'vars', 'zip'
]);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function highlightPythonCode(code: string): string {
  if (!code) return '';

  const lines = code.split('\n');
  const highlightedLines = lines.map((line) => highlightLine(line));
  return highlightedLines.join('\n');
}

function highlightLine(line: string): string {
  let result = '';
  let i = 0;
  const len = line.length;

  while (i < len) {
    const char = line[i]!;

    // 1. Comments: '#' to end of line
    if (char === '#') {
      const comment = line.substring(i);
      result += `<span class="text-zinc-500 dark:text-zinc-500 italic">${escapeHtml(comment)}</span>`;
      break;
    }

    // 2. Triple or single quoted strings
    if (char === '"' || char === "'") {
      const isTriple = line.substring(i, i + 3) === char.repeat(3);
      const quote = isTriple ? char.repeat(3) : char;
      const endIdx = line.indexOf(quote, i + quote.length);
      if (endIdx !== -1) {
        const str = line.substring(i, endIdx + quote.length);
        result += `<span class="text-emerald-600 dark:text-emerald-400">${escapeHtml(str)}</span>`;
        i = endIdx + quote.length;
        continue;
      } else {
        // Unclosed string on this line
        const str = line.substring(i);
        result += `<span class="text-emerald-600 dark:text-emerald-400">${escapeHtml(str)}</span>`;
        break;
      }
    }

    // 3. Decorators
    if (char === '@' && (i === 0 || /\s/.test(line[i - 1]!))) {
      const match = line.substring(i).match(/^@[a-zA-Z0-9_.]+/);
      if (match) {
        result += `<span class="text-amber-600 dark:text-amber-400 font-medium">${escapeHtml(match[0])}</span>`;
        i += match[0].length;
        continue;
      }
    }

    // 4. Numbers (decimal, float, hex)
    if (/[0-9]/.test(char) && (i === 0 || /[\s,([+\-*/%=<>&|^~:]/.test(line[i - 1]!))) {
      const match = line.substring(i).match(/^(?:0[xX][0-9a-fA-F]+|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
      if (match) {
        result += `<span class="text-amber-600 dark:text-amber-300">${escapeHtml(match[0])}</span>`;
        i += match[0].length;
        continue;
      }
    }

    // 5. Identifiers, Keywords, Builtins, Functions
    if (/[a-zA-Z_]/.test(char)) {
      const match = line.substring(i).match(/^[a-zA-Z0-9_]+/);
      if (match) {
        const word = match[0];
        const nextChar = line[i + word.length];

        if (KEYWORDS.has(word)) {
          result += `<span class="text-purple-600 dark:text-purple-400 font-semibold">${escapeHtml(word)}</span>`;
        } else if (BUILTINS.has(word)) {
          result += `<span class="text-cyan-600 dark:text-cyan-400">${escapeHtml(word)}</span>`;
        } else if (nextChar === '(') {
          result += `<span class="text-blue-600 dark:text-blue-400 font-medium">${escapeHtml(word)}</span>`;
        } else {
          result += escapeHtml(word);
        }
        i += word.length;
        continue;
      }
    }

    // 6. Operators & Punctuation
    result += escapeHtml(char);
    i++;
  }

  return result;
}
