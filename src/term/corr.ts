/**
 * Correlations between markets from daily closes: the last 20 sessions against the last year, so a relationship
 * that has broken down stands out (e.g. stocks and bonds moving together when they usually don't).
 */

export type Closes = [number, number][];

const dayKey = (t: number) => Math.floor(t / 86400);

/** Daily returns aligned on the days every series has, oldest first. */
export function alignedReturns(series: Record<string, Closes>): { names: string[]; rows: number[][] } {
  const names = Object.keys(series).filter((k) => series[k]?.length > 2);
  if (names.length < 2) return { names, rows: [] };
  const maps = names.map((k) => new Map(series[k].map(([t, c]) => [dayKey(t), c])));
  const days = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort((a, b) => a - b);
  const rows: number[][] = [];
  for (let i = 1; i < days.length; i++) {
    const r = maps.map((m) => m.get(days[i])! / m.get(days[i - 1])! - 1);
    if (r.every(Number.isFinite)) rows.push(r);
  }
  return { names, rows };
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) (sa += a[i]), (sb += b[i]);
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    cov += x * y;
    va += x * x;
    vb += y * y;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

/** Correlation matrix over the last `window` aligned days (all days when window is 0). */
export function corrMatrix(names: string[], rows: number[][], window = 0): (number | null)[][] {
  const use = window ? rows.slice(-window) : rows;
  const col = (j: number) => use.map((r) => r[j]);
  return names.map((_, i) => names.map((__, j) => (i === j ? 1 : pearson(col(i), col(j)))));
}
