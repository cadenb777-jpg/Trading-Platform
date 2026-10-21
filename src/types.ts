/** One candlestick. `time` is a UTC unix timestamp in seconds marking the start of the bar. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D';

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1D'];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1D': 86400,
};

/**
 * Folds a single trade into the bar list, either extending the last bar or starting a new one.
 * New bars are aligned relative to the last bar so that daily bars from providers that stamp
 * them at exchange midnight (e.g. 04:00 UTC) stay consistent.
 * Returns the affected bar and whether it is new, or null if the trade is older than the last bar.
 */
export function applyTrade(
  bars: Bar[],
  timeframe: Timeframe,
  price: number,
  size: number,
  timeSec: number,
): { bar: Bar; isNew: boolean } | null {
  const tf = TIMEFRAME_SECONDS[timeframe];
  const last = bars[bars.length - 1];
  if (!last) {
    const bar = { time: Math.floor(timeSec / tf) * tf, open: price, high: price, low: price, close: price, volume: size };
    bars.push(bar);
    return { bar, isNew: true };
  }
  if (timeSec < last.time) return null;
  if (timeSec < last.time + tf) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += size;
    return { bar: last, isNew: false };
  }
  const time = last.time + Math.floor((timeSec - last.time) / tf) * tf;
  const bar = { time, open: price, high: price, low: price, close: price, volume: size };
  bars.push(bar);
  return { bar, isNew: true };
}
