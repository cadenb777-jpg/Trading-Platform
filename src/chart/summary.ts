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
  /** Volume-weighted average price of the day (dollar volume / volume); null without volume. */
  vwap: number | null;
  /**
   * Volume against normal: intraday, today's volume so far against the average of up to 20 earlier days up to the
   * same time of day (relative volume); daily and longer bars, the newest bar against the average of the 20 before.
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
  const relVolume = TIMEFRAME_SECONDS[tf] < 86400 ? intradayRelVolume(bars, start, volume, timeZone) : dailyRelVolume(bars);
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
    vwap: volume > 0 ? value / volume : null,
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

/** Seconds since the start of a bar's day: earlier days are compared up to the same clock time. */
function intradayRelVolume(bars: Bar[], todayStart: number, todayVolume: number, timeZone: string): number | null {
  const cutoff = bars[bars.length - 1].time - bars[todayStart].time;
  const totals: number[] = [];
  let i = todayStart - 1;
  while (i >= 0 && totals.length < 20) {
    const key = dayKey(bars[i].time, timeZone);
    let first = i;
    while (first > 0 && dayKey(bars[first - 1].time, timeZone) === key) first--;
    let sum = 0;
    for (let j = first; j <= i; j++) if (bars[j].time - bars[first].time <= cutoff) sum += bars[j].volume || 0;
    totals.push(sum);
    i = first - 1;
  }
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  return avg > 0 ? todayVolume / avg : null;
}

const nyClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });

/**
 * The US stock session clock at `now` (unix seconds): "Closes in 2h 05m" during regular hours, "Opens in 45m" before
 * 9:30 on a weekday, "Closed" otherwise (market holidays are not known here). Null for markets that never close.
 */
export function sessionClock(now: number, market: string): string | null {
  if (market !== 'schwab') return null;
  const parts = Object.fromEntries(nyClock.formatToParts(now * 1000).map((p) => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'Closed';
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const span = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
  if (minutes < 570) return `Opens in ${span(570 - minutes)}`;
  if (minutes < 960) return `Closes in ${span(960 - minutes)}`;
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
