/**
 * Historical prices (Bloomberg HP, owner's spec 7.2): daily bars folded into weeks or months, each row with its close,
 * change from the row before and volume, newest first, plus the period's high / average / low with their dates and
 * the total change. Pure and tested (priceHistory.test.ts); the tab in tabs.ts draws it.
 */
import type { Bar } from '../types';

export type Periodicity = 'daily' | 'weekly' | 'monthly';

export interface PriceRow {
  /** UTC seconds of the row's last trading day. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Change from the previous row's close (fraction), null for the first row. */
  change: number | null;
}

const ymd = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** The bucket a day falls in: the day itself, its ISO week's Monday, or its month. */
export function bucketKey(t: number, p: Periodicity): string {
  if (p === 'daily') return ymd(t);
  const d = new Date(t * 1000);
  if (p === 'monthly') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return ymd(t - dow * 86400);
}

/** Daily bars (oldest first) -> rows for the periodicity, oldest first. */
export function priceRows(bars: Bar[], p: Periodicity): PriceRow[] {
  const rows: PriceRow[] = [];
  let key = '';
  for (const b of bars) {
    if (!Number.isFinite(b.close)) continue;
    const k = bucketKey(b.time, p);
    const last = rows[rows.length - 1];
    if (last && k === key) {
      last.time = b.time;
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume || 0;
    } else {
      rows.push({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0, change: null });
      key = k;
    }
  }
  for (let i = 1; i < rows.length; i++) rows[i].change = rows[i - 1].close ? rows[i].close / rows[i - 1].close - 1 : null;
  return rows;
}

/** Rows from the last `days` calendar days (all when days is 0). */
export function lastDays(rows: PriceRow[], days: number): PriceRow[] {
  if (!days || !rows.length) return rows;
  const from = rows[rows.length - 1].time - days * 86400;
  return rows.filter((r) => r.time > from);
}

export interface PriceSummary {
  high: { value: number; time: number };
  low: { value: number; time: number };
  average: number;
  /** First open to last close of the rows shown. */
  change: number | null;
  rows: number;
}

/** Highest close, lowest close (with dates), average close and the change over the rows. */
export function summarise(rows: PriceRow[]): PriceSummary | null {
  if (!rows.length) return null;
  let hi = rows[0];
  let lo = rows[0];
  let sum = 0;
  for (const r of rows) {
    if (r.close > hi.close) hi = r;
    if (r.close < lo.close) lo = r;
    sum += r.close;
  }
  const first = rows[0];
  const base = first.change != null ? first.close / (1 + first.change) : first.open;
  return { high: { value: hi.close, time: hi.time }, low: { value: lo.close, time: lo.time }, average: sum / rows.length, change: base ? rows[rows.length - 1].close / base - 1 : null, rows: rows.length };
}

/** CSV text of the rows (newest first), for the Download button. */
export function priceCsv(symbol: string, rows: PriceRow[]): string {
  const out = ['Date,Open,High,Low,Close,Change %,Volume'];
  for (const r of [...rows].reverse()) out.push([ymd(r.time), r.open, r.high, r.low, r.close, r.change == null ? '' : (r.change * 100).toFixed(2), r.volume].join(','));
  return `# ${symbol} historical prices\n${out.join('\n')}\n`;
}
