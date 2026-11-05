/**
 * Comparable companies: peer multiples summarised (median, mean, quartiles) and turned into a value per share for
 * the company being researched, one range per multiple (the football field). Data comes from quant.comps (SEC XBRL
 * statements + Schwab prices); this file is the display maths, so dropping a peer updates the range at once.
 */

export interface CompRow {
  symbol: string;
  name: string;
  price: number | null;
  shares: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  debt: number;
  cash: number;
  revenue: number | null;
  ebitda: number | null;
  netIncome: number | null;
  equity: number | null;
  eps: number | null;
  evEbitda: number | null;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  evSales: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  fiscalYear: string;
}

export interface CompsReply {
  symbol: string;
  sic: string;
  industry: string;
  peerSource: string;
  target: CompRow;
  peers: CompRow[];
  failed: { symbol: string; error: string }[];
  asOf: string;
  sources: string;
}

export type Multiple = 'evEbitda' | 'evSales' | 'pe' | 'ps' | 'pb';

/** Each multiple: label, the target's figure it multiplies, and whether it values the whole firm (EV) or the shares. */
export const MULTIPLES: { key: Multiple; label: string; base: 'ebitda' | 'revenue' | 'eps' | 'equity'; ev: boolean }[] = [
  { key: 'evEbitda', label: 'EV / EBITDA', base: 'ebitda', ev: true },
  { key: 'evSales', label: 'EV / Sales', base: 'revenue', ev: true },
  { key: 'pe', label: 'P / E', base: 'eps', ev: false },
  { key: 'ps', label: 'P / S', base: 'revenue', ev: false },
  { key: 'pb', label: 'P / B', base: 'equity', ev: false },
];

/** Quantile with linear interpolation between the closest ranks (numpy's default), on finite values only. */
export function quantile(values: (number | null | undefined)[], p: number): number | null {
  const xs = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

export interface Summary {
  n: number;
  low: number | null;
  q1: number | null;
  median: number | null;
  mean: number | null;
  q3: number | null;
  high: number | null;
}

export function summarise(values: (number | null | undefined)[]): Summary {
  const xs = values.filter((x): x is number => x != null && Number.isFinite(x));
  return {
    n: xs.length,
    low: xs.length ? Math.min(...xs) : null,
    q1: quantile(xs, 0.25),
    median: quantile(xs, 0.5),
    mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
    q3: quantile(xs, 0.75),
    high: xs.length ? Math.max(...xs) : null,
  };
}

/**
 * The target's value per share at a given multiple. EV multiples: multiple x figure = enterprise value, minus debt
 * plus cash = equity, over shares. Equity multiples: multiple x figure (EPS is already per share). Null when the
 * figure is missing or not positive (a multiple of a loss means nothing).
 */
export function impliedPrice(t: CompRow, m: Multiple, multiple: number | null): number | null {
  const def = MULTIPLES.find((x) => x.key === m)!;
  const base = t[def.base];
  if (multiple == null || base == null || base <= 0) return null;
  if (def.base === 'eps') return multiple * base;
  if (!t.shares || t.shares <= 0) return null;
  const value = multiple * base;
  return (def.ev ? value - t.debt + t.cash : value) / t.shares;
}

export interface FieldRow {
  key: Multiple;
  label: string;
  peers: number;
  /** Value per share at the peers' 25th percentile, median and 75th percentile multiple. */
  low: number | null;
  mid: number | null;
  high: number | null;
  /** The target's own multiple today, for comparison. */
  own: number | null;
}

/** One football-field row per multiple, from the peers left in (`excluded` symbols dropped). */
export function footballField(target: CompRow, peers: CompRow[], excluded: Set<string> = new Set()): FieldRow[] {
  const kept = peers.filter((p) => !excluded.has(p.symbol));
  return MULTIPLES.map(({ key, label }) => {
    const s = summarise(kept.map((p) => p[key]).filter((x) => x != null && x > 0));
    const a = impliedPrice(target, key, s.q1);
    const b = impliedPrice(target, key, s.q3);
    return {
      key,
      label,
      peers: s.n,
      low: a != null && b != null ? Math.min(a, b) : a,
      mid: impliedPrice(target, key, s.median),
      high: a != null && b != null ? Math.max(a, b) : b,
      own: target[key],
    };
  });
}

/** The overall range across multiples (lowest low, highest high) and the median of the mid values. */
export function blendedRange(rows: FieldRow[]): { low: number; mid: number; high: number } | null {
  const usable = rows.filter((r) => r.low != null && r.high != null && r.mid != null);
  if (!usable.length) return null;
  return { low: Math.min(...usable.map((r) => r.low!)), mid: quantile(usable.map((r) => r.mid), 0.5)!, high: Math.max(...usable.map((r) => r.high!)) };
}
