/**
 * Line Diff Engine using Longest Common Subsequence (LCS)
 */

export interface DiffLine {
  type: 'added' | 'deleted' | 'unchanged';
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const n = oldLines.length;
  const m = newLines.length;

  // DP table for LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to build diff
  let i = n;
  let j = m;
  const diffRev: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffRev.push({
        type: 'unchanged',
        text: oldLines[i - 1]!,
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      diffRev.push({
        type: 'added',
        text: newLines[j - 1]!,
        newLineNumber: j,
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i]![j - 1]! < dp[i - 1]![j]!)) {
      diffRev.push({
        type: 'deleted',
        text: oldLines[i - 1]!,
        oldLineNumber: i,
      });
      i--;
    }
  }

  return diffRev.reverse();
}
