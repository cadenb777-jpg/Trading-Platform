/**
 * The stock screener (Bloomberg EQS, owner's spec 7.10): a universe, criteria rows (field, operator, value) each with
 * a running count of how many stocks still pass, and the results with one column per criterion plus median rows.
 * Pure and tested (screen.test.ts). Data: invest.board (Schwab quotes and daily closes) + the sector lists.
 */

export interface ScreenRow {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  change: number | null;
  m1: number | null;
  m3: number | null;
  ytd: number | null;
  y1: number | null;
  pe: number | null;
  divYield: number | null;
  /** How far below its 52-week high, as a negative fraction (0 = at the high). */
  offHigh: number | null;
}

export type FieldKey = Exclude<keyof ScreenRow, 'symbol' | 'name' | 'sector'>;
export type Op = '>' | '<' | 'between';

export interface Criterion {
  field: FieldKey;
  op: Op;
  /** Percent fields are typed in percent (5 = 5%). */
  a: number;
  b?: number;
}

export const FIELDS: { key: FieldKey; label: string; pct: boolean; tip: string }[] = [
  { key: 'change', label: 'Today', pct: true, tip: 'Change since yesterday’s close' },
  { key: 'm1', label: '1 month', pct: true, tip: 'Price change over 1 month' },
  { key: 'm3', label: '3 months', pct: true, tip: 'Price change over 3 months' },
  { key: 'ytd', label: 'Year to date', pct: true, tip: 'Price change since 1 January' },
  { key: 'y1', label: '1 year', pct: true, tip: 'Price change over 1 year' },
  { key: 'offHigh', label: 'Off 52-wk high', pct: true, tip: '0% = at its high; −20% = 20% below it' },
  { key: 'pe', label: 'P/E', pct: false, tip: 'Price ÷ earnings per share' },
  { key: 'divYield', label: 'Dividend yield', pct: true, tip: 'Yearly dividend ÷ price' },
  { key: 'price', label: 'Price', pct: false, tip: 'Last price in dollars' },
];

export const fieldOf = (k: FieldKey) => FIELDS.find((f) => f.key === k)!;

/** Whether one row passes one criterion (a missing value never passes). */
export function passes(row: ScreenRow, c: Criterion): boolean {
  const v = row[c.field];
  if (v == null || !Number.isFinite(v)) return false;
  const scale = fieldOf(c.field).pct ? 100 : 1;
  const x = v * scale;
  if (c.op === '>') return x > c.a;
  if (c.op === '<') return x < c.a;
  const lo = Math.min(c.a, c.b ?? c.a);
  const hi = Math.max(c.a, c.b ?? c.a);
  return x >= lo && x <= hi;
}

/** Runs the criteria in order: the rows left after each one (the running counts) and the final matches. */
export function runScreen(rows: ScreenRow[], criteria: Criterion[], sectors: string[] = []): { counts: number[]; matches: ScreenRow[]; universe: number } {
  let left = sectors.length ? rows.filter((r) => sectors.includes(r.sector)) : rows;
  const universe = left.length;
  const counts: number[] = [];
  for (const c of criteria) {
    left = left.filter((r) => passes(r, c));
    counts.push(left.length);
  }
  return { counts, matches: left, universe };
}

/** Median of a field over rows (missing values left out). */
export function median(rows: ScreenRow[], k: FieldKey): number | null {
  const v = rows.map((r) => r[k]).filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Ready-made screens, in plain words. */
export const PRESETS: { name: string; criteria: Criterion[] }[] = [
  { name: 'Near their high, rising', criteria: [{ field: 'offHigh', op: '>', a: -5 }, { field: 'm3', op: '>', a: 5 }] },
  { name: 'Beaten down this year', criteria: [{ field: 'ytd', op: '<', a: -15 }] },
  { name: 'Cheap and paying', criteria: [{ field: 'pe', op: 'between', a: 1, b: 20 }, { field: 'divYield', op: '>', a: 1.5 }] },
  { name: 'Big movers today', criteria: [{ field: 'change', op: '>', a: 3 }] },
];
