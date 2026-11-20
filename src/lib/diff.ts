// Shared logic diff; change this helper here and update callers if its contract changes.
export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
}

const MAX_LINES = 600;

/**
 * Line diff via LCS. Deliberately simple: previews are small, and a compact
 * table beats pulling a diff library into the bundle.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n").slice(0, MAX_LINES);
  const b = after.split("\n").slice(0, MAX_LINES);
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? (table[i + 1][j + 1] ?? 0) + 1 : Math.max(table[i + 1][j] ?? 0, table[i][j + 1] ?? 0);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] as string, oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if ((table[i + 1][j] ?? 0) >= (table[i][j + 1] ?? 0)) {
      out.push({ type: "del", text: a[i] as string, oldLine: i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j] as string, newLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i] as string, oldLine: i + 1 });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j] as string, newLine: j + 1 });
    j++;
  }
  return out;
}

export interface DiffStat {
  added: number;
  removed: number;
}

export function diffStat(lines: DiffLine[]): DiffStat {
  return lines.reduce(
    (acc, line) => {
      if (line.type === "add") acc.added++;
      if (line.type === "del") acc.removed++;
      return acc;
    },
    { added: 0, removed: 0 },
  );
}
