/**
 * Numbers for the chart's header row and legend box: the trading day's open/high/low/volume, and the high, low and
 * average of the bars on screen. Pure, tested in summary.test.ts.
 */
import { TIMEFRAME_SECONDS, type Bar, type Timeframe } from '../types';
import { dayKey } from './range';

export interface VisibleStats {
  /** Close of the last bar on screen (the latest price when the chart shows the newest bars). */
  last: number;
  high: number;
  highTime: number;
  low: number;
  lowTime: number;
  /** Mean of the closes on screen. */
  average: number;
  count: number;
}

/** High, low (with their bar times) and average close of bars[from..to] (fractional indexes are rounded inward). */
export function visibleStats(bars: Bar[], from: number, to: number): VisibleStats | null {
  const start = Math.max(0, Math.ceil(from));
  const end = Math.min(bars.length - 1, Math.floor(to));
  if (start > end) return null;
  let high = -Infinity;
  let low = Infinity;
  let highTime = 0;
  let lowTime = 0;
  let sum = 0;
  for (let i = start; i <= end; i++) {
    const b = bars[i];
    if (b.high > high) (high = b.high), (highTime = b.time);
    if (b.low < low) (low = b.low), (lowTime = b.time);
    sum += b.close;
  }
  const count = end - start + 1;
  return { last: bars[end].close, high, highTime, low, lowTime, average: sum / count, count };
}

export interface DaySummary {
  last: number;
  /** Change from the previous close (null when there is none loaded). */
  change: number | null;
  changePct: number | null;
  open: number;
  high: number;
  low: number;
  prevClose: number | null;
  volume: number;
  /** Dollar volume: each bar's typical price (high + low + close) / 3 times its volume. */
  value: number;
  /** Start time of the newest bar. */
  time: number;
  /**
   * Volume-weighted average price, on bars of 1 hour or less only. Stocks: anchored at the 09:30 New York open
   * (regular session); crypto: the UTC day. Null without volume or on longer bars.
   */
  vwap: number | null;
  /** Stocks: the pre-market VWAP of today (04:00-09:30 New York), shown separately; null when there is none. */
  preVwap: number | null;
  /**
   * Volume against normal: intraday, today's volume so far against the average of up to 20 earlier days up to the
   * same New York (crypto: UTC) clock time (relative volume); daily and longer bars, the newest bar against the
   * average of the 20 before.
   */
  relVolume: number | null;
}

/**
 * The latest trading day from the chart's bars. Intraday bars are grouped by the market's day (`timeZone`), so the
 * open is the day's first bar and the previous close is the last bar of the day before; daily and longer bars use
 * the newest bar and the one before it.
 */
export function daySummary(bars: Bar[], tf: Timeframe, timeZone = 'UTC'): DaySummary | null {
  const n = bars.length;
  if (!n) return null;
  const lastBar = bars[n - 1];
  let start = n - 1;
  if (TIMEFRAME_SECONDS[tf] < 86400) {
    const day = dayKey(lastBar.time, timeZone);
    while (start > 0 && dayKey(bars[start - 1].time, timeZone) === day) start--;
  }
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let value = 0;
  for (let i = start; i < n; i++) {
    const b = bars[i];
    high = Math.max(high, b.high);
    low = Math.min(low, b.low);
    volume += b.volume || 0;
    value += (((b.high + b.low + b.close) / 3) * (b.volume || 0));
  }
  const prevClose = start > 0 ? bars[start - 1].close : null;
  const change = prevClose === null ? null : lastBar.close - prevClose;
  const intraday = TIMEFRAME_SECONDS[tf] < 86400;
  const relVolume = intraday ? intradayRelVolume(bars, start, volume, timeZone) : dailyRelVolume(bars);
  const vw = TIMEFRAME_SECONDS[tf] <= 3600 ? sessionVwaps(bars, start, timeZone) : { vwap: null, preVwap: null };
  return {
    last: lastBar.close,
    change,
    changePct: change === null || !prevClose ? null : (change / prevClose) * 100,
    open: bars[start].open,
    high,
    low,
    prevClose,
    volume,
    value,
    time: lastBar.time,
    ...vw,
    relVolume,
  };
}

function dailyRelVolume(bars: Bar[]): number | null {
  const n = bars.length;
  const prior = bars.slice(Math.max(0, n - 21), n - 1).filter((b) => b.volume > 0);
  if (!prior.length) return null;
  const avg = prior.reduce((s, b) => s + b.volume, 0) / prior.length;
  return avg > 0 ? bars[n - 1].volume / avg : null;
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();
const clockMemo = new Map<string, number>();
/** Minutes after midnight of a time in a zone (memoised: the same bars are read on every repaint). */
export function minuteOfDay(t: number, timeZone: string): number {
  if (timeZone === 'UTC') return Math.floor((t % 86400) / 60);
  const key = `${timeZone}|${t}`;
  const hit = clockMemo.get(key);
  if (hit !== undefined) return hit;
  let f = clockFormats.get(timeZone);
  if (!f) clockFormats.set(timeZone, (f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })));
  const p = Object.fromEntries(f.formatToParts(t * 1000).map((x) => [x.type, x.value]));
  const m = Number(p.hour) * 60 + Number(p.minute);
  if (clockMemo.size > 200_000) clockMemo.clear();
  clockMemo.set(key, m);
  return m;
}

/** Today's volume so far against earlier days' volume up to the same clock time in the market's zone. */
function intradayRelVolume(bars: Bar[], todayStart: number, todayVolume: number, timeZone: string): number | null {
  const cutoff = minuteOfDay(bars[bars.length - 1].time, timeZone);
  const totals: number[] = [];
  let i = todayStart - 1;
  while (i >= 0 && totals.length < 20) {
    const key = dayKey(bars[i].time, timeZone);
    let sum = 0;
    while (i >= 0 && dayKey(bars[i].time, timeZone) === key) {
      if (minuteOfDay(bars[i].time, timeZone) <= cutoff) sum += bars[i].volume || 0;
      i--;
    }
    totals.push(sum);
  }
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  return avg > 0 ? todayVolume / avg : null;
}

const OPEN = 570; // 09:30
const CLOSE = 960; // 16:00

/** VWAP of today's bars: stocks from the 09:30 open (and the pre-market apart); other markets the whole day. */
function sessionVwaps(bars: Bar[], start: number, timeZone: string): { vwap: number | null; preVwap: number | null } {
  const stocks = timeZone === 'America/New_York';
  let pv = 0;
  let v = 0;
  let prePv = 0;
  let preV = 0;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    const vol = b.volume || 0;
    const typical = ((b.high + b.low + b.close) / 3) * vol;
    const m = stocks ? minuteOfDay(b.time, timeZone) : OPEN;
    if (m < OPEN) (prePv += typical), (preV += vol);
    else if (m < CLOSE) (pv += typical), (v += vol);
  }
  return { vwap: v > 0 ? pv / v : null, preVwap: stocks && preV > 0 ? prePv / preV : null };
}

/** NYSE full-day holidays and 13:00 early closes (New York dates), 2026-2027. Update each year. */
export const NYSE_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
export const NYSE_EARLY_CLOSES = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

const nyClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });

/**
 * The US stock session clock at `now` (unix seconds): "Closes in 2h 05m" during regular hours ("Closes 13:00 in
 * 45m" on an early-close day), "Opens in 45m" before 9:30 on a trading day, "Market closed (holiday)" on NYSE
 * holidays, "Closed" otherwise. Null for markets that never close.
 */
export function sessionClock(now: number, market: string): string | null {
  if (market !== 'schwab') return null;
  const parts = Object.fromEntries(nyClock.formatToParts(now * 1000).map((p) => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'Closed';
  const day = dayKey(now, 'America/New_York');
  if (NYSE_HOLIDAYS.has(day)) return 'Market closed (holiday)';
  const early = NYSE_EARLY_CLOSES.has(day);
  const close = early ? 780 : CLOSE;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const span = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
  if (minutes < OPEN) return `Opens in ${span(OPEN - minutes)}`;
  if (minutes < close) return early ? `Closes 13:00 in ${span(close - minutes)}` : `Closes in ${span(close - minutes)}`;
  return 'Closed';
}

/** 1,234.56 / 0.0123 / 68,012.50: grouped, with the decimals a price of that size needs. */
export function formatPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 12.3K, 4.56M, 7.89B. */
export function formatCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(abs >= 1 || abs === 0 ? 0 : 2);
}
