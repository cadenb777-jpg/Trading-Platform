/**
 * Shared year rules for the Research reading panels: which column is the newest fiscal year, whether two columns are
 * whole fiscal years apart, and the newest run of consecutive years. One copy, so every panel picks the same years.
 */
import type { Statements } from './debtDilution';
import { at } from './quality';

/** The newest year can't be read from the filings any more; the reading was last worked out for this year-end. */
export type Stale = { lastShown: string };

/** Period j ends about k fiscal years before period i (within a month): a missing year or a short transition
 * period never passes for one year. */
export function yearsBefore(a: Statements, i: number, j: number, k: number): boolean {
  if (j < 0 || i >= a.periods.length) return false;
  const days = (Date.parse(`${a.periods[i]}T00:00:00Z`) - Date.parse(`${a.periods[j]}T00:00:00Z`)) / 86_400_000;
  return Math.abs(days - 365.25 * k) <= 31;
}

/** Newest fiscal year the filings show (revenue or total assets), or -1. */
export function newestYear(a: Statements): number {
  let n = a.periods.length - 1;
  while (n >= 0 && at(a, 'revenue', n) == null && at(a, 'totalAssets', n) == null) n--;
  return n;
}

/** The newest run of rows a fiscal year apart (at most `span`), oldest first. */
export function lastRun<T extends { end: string }>(a: Statements, rows: T[], span: number): T[] {
  if (!rows.length) return [];
  const idx = new Map(a.periods.map((p, i) => [p, i]));
  const run = [rows[rows.length - 1]];
  for (let k = rows.length - 2; k >= 0 && run.length < span; k--) {
    if (!yearsBefore(a, idx.get(run[run.length - 1].end)!, idx.get(rows[k].end)!, 1)) break;
    run.push(rows[k]);
  }
  return run.reverse();
}
