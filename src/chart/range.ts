/**
 * The range bar (Bloomberg's 1D 3D 1M 6M YTD 1Y 5Y Max): which part of the history to show. Pure date maths, so the
 * tricky cases (YTD, 3 trading days across a weekend, Max) are tested in range.test.ts.
 */
import { TIMEFRAME_SECONDS, type Timeframe } from '../types';

export type RangeId = '1D' | '3D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'MAX';

export const RANGES: { id: RangeId; label: string; title: string }[] = [
  { id: '1D', label: '1D', title: 'The last trading day' },
  { id: '1M', label: '1M', title: 'One month' },
  { id: '6M', label: '6M', title: 'Six months' },
  { id: 'YTD', label: 'YTD', title: 'Since 1 January' },
  { id: '1Y', label: '1Y', title: 'One year' },
  { id: '5Y', label: '5Y', title: 'Five years' },
  { id: 'MAX', label: 'Max', title: 'All the history there is' },
];

const DAY = 86400;
const TRADING_DAYS: Partial<Record<RangeId, number>> = { '1D': 1, '3D': 3 };
const MONTHS: Partial<Record<RangeId, number>> = { '1M': 1, '6M': 6, '1Y': 12, '5Y': 60 };
/** Rough length of each range, to grey out ranges that would show only a bar or two at this timeframe. */
const SPAN: Record<RangeId, number> = { '1D': DAY, '3D': 3 * DAY, '1M': 30 * DAY, '6M': 182 * DAY, YTD: 0, '1Y': 365 * DAY, '5Y': 1826 * DAY, MAX: Infinity };

const dayFormats = new Map<string, Intl.DateTimeFormat>();
const dayMemo = new Map<string, string>();
/** The calendar day (YYYY-MM-DD) of a time in a time zone: trading days are counted in the market's own zone. */
export function dayKey(t: number, timeZone = 'UTC'): string {
  if (timeZone === 'UTC') return new Date(t * 1000).toISOString().slice(0, 10);
  const memoKey = `${timeZone}|${t}`;
  const hit = dayMemo.get(memoKey);
  if (hit) return hit;
  let f = dayFormats.get(timeZone);
  if (!f) dayFormats.set(timeZone, (f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })));
  const key = f.format(t * 1000);
  if (dayMemo.size > 200_000) dayMemo.clear();
  dayMemo.set(memoKey, key);
  return key;
}

/** Stocks trade on New York days; crypto never closes, so its days are UTC days. */
export const marketTimeZone = (market: string) => (market === 'schwab' ? 'America/New_York' : 'UTC');

/** A range is offered when it would show at least 3 bars at this timeframe (1D on daily bars would be one candle). */
export function rangeFits(range: RangeId, tf: Timeframe): boolean {
  const span = range === 'YTD' ? 30 * DAY : SPAN[range];
  return span / TIMEFRAME_SECONDS[tf] >= 3;
}

/** `months` calendar months before a time (UTC), the day clamped to the shorter month (31 Mar - 1M = 28/29 Feb). */
function monthsBack(t: number, months: number): number {
  const d = new Date(t * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last)) / 1000;
}

/** Midnight UTC `n` weekdays before the day of `t` (an estimate of n trading days when the bars don't reach). */
function weekdaysBack(t: number, n: number): number {
  let day = Math.floor(t / DAY) * DAY;
  for (let left = n; left > 0; ) {
    day -= DAY;
    const wd = new Date(day * 1000).getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return day;
}

export interface RangeStart {
  /** The first time to show (unix seconds). */
  from: number;
  /** True when the loaded bars reach back that far (otherwise more history should be fetched). */
  covered: boolean;
}

/**
 * Where a range starts, given the bars' times (ascending). 1D/3D count trading days that have bars (so 3D on a
 * Monday shows Thursday, Friday and Monday); months count back from the last bar's date; YTD starts on 1 January of
 * the last bar's year; Max starts at the first bar and is never "covered" (there may always be more to fetch).
 */
export function rangeStart(range: RangeId, times: number[], timeZone = 'UTC'): RangeStart | null {
  if (!times.length) return null;
  const last = times[times.length - 1];
  const first = times[0];
  if (range === 'MAX') return { from: first, covered: false };
  const days = TRADING_DAYS[range];
  if (days) {
    let seen = 0;
    let key = '';
    for (let i = times.length - 1; i >= 0; i--) {
      const k = dayKey(times[i], timeZone);
      if (k !== key) {
        key = k;
        if (++seen > days) return { from: times[i + 1], covered: true };
      }
    }
    // Fewer trading days loaded than asked for: estimate on the calendar, skipping weekends.
    return seen === days ? { from: first, covered: true } : { from: weekdaysBack(last, days - 1), covered: false };
  }
  const from = range === 'YTD' ? Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000 : monthsBack(last, MONTHS[range]!);
  // A month or more back: the first bar may sit a day or two after the start (a weekend or holiday), which still counts.
  return { from, covered: first <= from + 4 * DAY };
}

/** Calendar days of history (counted back from `now`) a range needs; Infinity for Max. */
export function daysNeeded(range: RangeId, now: number): number {
  if (range === 'MAX') return Infinity;
  const n = TRADING_DAYS[range];
  const from = n ? weekdaysBack(now, n) : rangeStart(range, [now])!.from;
  // a few days' margin for holidays and a last bar older than today
  return Math.ceil((now - from) / DAY) + (n ? 3 : 4);
}

/** The first bar index at or after a time (bars.length when every bar is earlier). */
export function firstIndexFrom(times: number[], from: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------- The choice, remembered per timeframe (a per-viewer convenience, so plain localStorage) ----------

const KEY = 'tp-chart-range';

function readAll(): Partial<Record<Timeframe, RangeId>> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function savedRange(tf: Timeframe): RangeId | null {
  const id = readAll()[tf];
  return RANGES.some((r) => r.id === id) ? (id as RangeId) : null;
}

export function saveRange(tf: Timeframe, range: RangeId | null) {
  try {
    const all = readAll();
    if (range) all[tf] = range;
    else delete all[tf];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // private window: the choice just isn't remembered
  }
}

/** The timeframe a range is read on when the current one can't show it (as trading platforms do: 1Y -> daily). */
export function timeframeFor(range: RangeId): Timeframe {
  return ({ '1D': '5m', '3D': '15m', '1M': '1h', '6M': '1D', YTD: '1D', '1Y': '1D', '5Y': '1W', MAX: '1W' } as Record<RangeId, Timeframe>)[range];
}
