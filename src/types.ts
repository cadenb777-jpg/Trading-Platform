/** One candlestick. `time` is a UTC unix timestamp in seconds marking the start of the bar. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TimeframeGroup = 'Seconds' | 'Minutes' | 'Hours' | 'Days';

export interface TimeframeDef {
  id: Timeframe;
  label: string;
  /** Nominal bar length. Months vary, so '1M' uses 30 days here and calendar months for bucketing. */
  seconds: number;
  group: TimeframeGroup;
}

export type Timeframe =
  | '5s' | '10s' | '15s' | '30s'
  | '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '30m' | '45m'
  | '1h' | '2h' | '3h' | '4h'
  | '1D' | '1W' | '1M';

const tf = (id: Timeframe, label: string, seconds: number, group: TimeframeGroup): TimeframeDef => ({ id, label, seconds, group });

export const TIMEFRAME_DEFS: TimeframeDef[] = [
  tf('5s', '5 seconds', 5, 'Seconds'),
  tf('10s', '10 seconds', 10, 'Seconds'),
  tf('15s', '15 seconds', 15, 'Seconds'),
  tf('30s', '30 seconds', 30, 'Seconds'),
  tf('1m', '1 minute', 60, 'Minutes'),
  tf('2m', '2 minutes', 120, 'Minutes'),
  tf('3m', '3 minutes', 180, 'Minutes'),
  tf('5m', '5 minutes', 300, 'Minutes'),
  tf('10m', '10 minutes', 600, 'Minutes'),
  tf('15m', '15 minutes', 900, 'Minutes'),
  tf('30m', '30 minutes', 1800, 'Minutes'),
  tf('45m', '45 minutes', 2700, 'Minutes'),
  tf('1h', '1 hour', 3600, 'Hours'),
  tf('2h', '2 hours', 7200, 'Hours'),
  tf('3h', '3 hours', 10800, 'Hours'),
  tf('4h', '4 hours', 14400, 'Hours'),
  tf('1D', '1 day', 86400, 'Days'),
  tf('1W', '1 week', 604800, 'Days'),
  tf('1M', '1 month', 2592000, 'Days'),
];

export const TIMEFRAMES: Timeframe[] = TIMEFRAME_DEFS.map((d) => d.id);

export const TIMEFRAME_SECONDS = Object.fromEntries(TIMEFRAME_DEFS.map((d) => [d.id, d.seconds])) as Record<Timeframe, number>;

export const DEFAULT_FAVORITE_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'];

/** 1970-01-05 was a Monday; weekly bars start on Mondays. */
const MONDAY_OFFSET = 4 * 86400;

/** Start time of the bar that `time` falls into, aligned to UTC clock/calendar boundaries. */
export function bucketStart(time: number, timeframe: Timeframe): number {
  if (timeframe === '1M') {
    const d = new Date(time * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }
  if (timeframe === '1W') return Math.floor((time - MONDAY_OFFSET) / 604800) * 604800 + MONDAY_OFFSET;
  const s = TIMEFRAME_SECONDS[timeframe];
  return Math.floor(time / s) * s;
}

/** Combines smaller bars (e.g. 1-minute) into bars of a larger timeframe (e.g. 3-minute). */
/**
 * Makes bars safe to draw: drops bars with missing or invalid prices, puts them in time order and merges
 * bars that share a time. The chart refuses a whole data set if even one bar breaks these rules.
 */
export function cleanBars(bars: Bar[]): Bar[] {
  const valid = bars.filter((b) => b && Number.isFinite(b.time) && b.time > 0 && [b.open, b.high, b.low, b.close].every((v) => typeof v === 'number' && Number.isFinite(v)));
  valid.sort((a, b) => a.time - b.time);
  const out: Bar[] = [];
  for (const b of valid) {
    const bar = { time: Math.floor(b.time), open: b.open, high: Math.max(b.high, b.open, b.close), low: Math.min(b.low, b.open, b.close), close: b.close, volume: Number.isFinite(b.volume) ? b.volume : 0 };
    const last = out[out.length - 1];
    if (last && last.time === bar.time) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume;
    } else out.push(bar);
  }
  return out;
}

export function regroupBars(bars: Bar[], timeframe: Timeframe): Bar[] {
  const out: Bar[] = [];
  for (const bar of bars) {
    const start = bucketStart(bar.time, timeframe);
    const last = out[out.length - 1];
    if (last && last.time === start) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume;
    } else {
      out.push({ ...bar, time: start });
    }
  }
  return out;
}

/**
 * Folds a single trade into the bar list, either extending the last bar or starting a new one.
 * New bars are aligned relative to the last bar so that daily bars from providers that stamp
 * them at exchange midnight (e.g. 05:00 UTC) stay consistent. Months use calendar boundaries.
 * Returns the affected bar and whether it is new, or null if the trade is older than the last bar.
 */
export function applyTrade(
  bars: Bar[],
  timeframe: Timeframe,
  price: number,
  size: number,
  timeSec: number,
): { bar: Bar; isNew: boolean } | null {
  const last = bars[bars.length - 1];
  const newBar = (time: number) => {
    const bar = { time, open: price, high: price, low: price, close: price, volume: size };
    bars.push(bar);
    return { bar, isNew: true };
  };
  if (!last) return newBar(bucketStart(timeSec, timeframe));
  if (timeSec < last.time) return null;

  let sameBar: boolean;
  let nextTime: number;
  if (timeframe === '1M') {
    nextTime = bucketStart(timeSec, timeframe);
    sameBar = nextTime <= last.time;
  } else {
    const s = TIMEFRAME_SECONDS[timeframe];
    sameBar = timeSec < last.time + s;
    nextTime = last.time + Math.floor((timeSec - last.time) / s) * s;
  }
  if (!sameBar) return newBar(nextTime);
  last.high = Math.max(last.high, price);
  last.low = Math.min(last.low, price);
  last.close = price;
  last.volume += size;
  return { bar: last, isNew: false };
}
