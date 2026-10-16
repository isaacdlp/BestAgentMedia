// Word-level diff of two plain texts for side-by-side comparisons (current vs proposed copy).

export type DiffSegment = { text: string; changed: boolean };

// Above this many token pairs the comparison is shown without highlights.
const MAX_CELLS = 4_000_000;

function tokenize(text: string) {
  return text.split(/(\s+)/).filter((token) => token !== "");
}

function merge(tokens: string[], changed: boolean[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  tokens.forEach((token, index) => {
    // Whitespace between two changed words is shown as part of the change.
    const isChanged = /^\s+$/.test(token)
      ? Boolean(changed[index - 1] && changed[index + 1])
      : changed[index];
    const last = segments[segments.length - 1];
    if (last && last.changed === isChanged) last.text += token;
    else segments.push({ text: token, changed: isChanged });
  });
  return segments;
}

/**
 * Splits both texts into segments flagged as removed (`before`) or added (`after`), using the
 * longest common subsequence of words. Returns null when the texts are too long to compare.
 */
export function diffWords(beforeText: string, afterText: string): { before: DiffSegment[]; after: DiffSegment[] } | null {
  const a = tokenize(beforeText);
  const b = tokenize(afterText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  // lcs[i * (m + 1) + j]: LCS length of a[start + i..endA) and b[start + j..endB)
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[start + i] === b[start + j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const changedA = new Array<boolean>(a.length).fill(false);
  const changedB = new Array<boolean>(b.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      changedA[start + i++] = true;
    } else {
      changedB[start + j++] = true;
    }
  }
  return { before: merge(a, changedA), after: merge(b, changedB) };
}
