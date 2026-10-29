/**
 * Trading-session calendar for indicators that reset each day (VWAP) or compare the same time of day (RVOL).
 * Stocks follow New York time, so Schwab's extended-hours bars (04:00-20:00 ET) stay on their own trading day
 * across daylight-saving changes; crypto (Coinbase) trades around the clock and uses UTC days.
 * ChartView passes the chart's market to compute() as the reserved `_market` param.
 */
import type { IndicatorParams } from './types';

export const MARKET_PARAM = '_market';

/** True when the bars follow UTC days (crypto); everything else (stocks, unknown) uses New York time. */
export const usesUtcDays = (p: IndicatorParams | undefined) => p?.[MARKET_PARAM] === 'coinbase';

let formatter: Intl.DateTimeFormat | null | undefined;
function nyFormatter(): Intl.DateTimeFormat | null {
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    } catch {
      formatter = null; // no time-zone data: fall back to Eastern Standard Time
    }
  }
  return formatter;
}

const offsets = new Map<number, number>();
/** New York's offset from UTC in seconds (-18000 EST, -14400 EDT) at `time`; changes only on whole hours. */
export function newYorkOffset(time: number): number {
  const hour = Math.floor(time / 3600);
  let off = offsets.get(hour);
  if (off === undefined) {
    const f = nyFormatter();
    if (!f) off = -18000;
    else {
      const parts = Object.fromEntries(f.formatToParts(new Date(hour * 3600 * 1000)).map((x) => [x.type, x.value]));
      const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute)) / 1000;
      off = local - hour * 3600;
    }
    if (offsets.size > 50000) offsets.clear();
    offsets.set(hour, off);
  }
  return off;
}

/** Seconds since 1970 in New York local time (for day and time-of-day arithmetic). */
const newYorkLocal = (time: number) => time + newYorkOffset(time);

/** The trading day a bar belongs to (days since 1970): New York date for stocks, UTC date for crypto. */
export function sessionDay(time: number, p?: IndicatorParams): number {
  return Math.floor((usesUtcDays(p) ? time : newYorkLocal(time)) / 86400);
}

/** Seconds after local midnight (New York for stocks, UTC for crypto): the bar's time-of-day slot. */
export function sessionSlot(time: number, p?: IndicatorParams): number {
  const t = usesUtcDays(p) ? time : newYorkLocal(time);
  return ((t % 86400) + 86400) % 86400;
}
