/**
 * Keeping the chart's newest candles current (review, 2026-11-18: "no data delay in the chart times"). The chart loads
 * history once and then folds in live trades; these pure helpers (tested in freshness.test.ts) cover the gaps:
 *   - mergeTail: a quiet re-fetch of recent bars is merged in (after sleep, a dropped stream, or the trades that
 *     happened between the history request and the stream starting), replacing the overlapping bars and adding newer
 *     ones, without undoing a live trade that arrived after the re-fetch began;
 *   - quoteAsTrade: the 30-second official quote moves the last candle when the trade stream has gone quiet;
 *   - needsCatchUp: when a re-fetch is worth doing.
 */
import type { Bar } from '../types';

/** Merges freshly fetched bars into the chart's bars in place; returns the index of the first bar that changed (-1: none). */
export function mergeTail(bars: Bar[], fresh: Bar[], liveAfterFetch: boolean): number {
  if (!fresh.length) return -1;
  const last = bars[bars.length - 1];
  if (!last) {
    bars.push(...fresh);
    return 0;
  }
  // only the recent overlap is touched: fresh bars older than the chart's 300th-from-last bar are ignored
  const floor = bars[Math.max(0, bars.length - 300)].time;
  const index = new Map<number, number>();
  for (let i = Math.max(0, bars.length - 300); i < bars.length; i++) index.set(bars[i].time, i);
  let first = -1;
  const mark = (i: number) => (first = first < 0 ? i : Math.min(first, i));
  for (const f of fresh) {
    if (f.time < floor) continue;
    const i = index.get(f.time);
    if (i == null) {
      if (f.time > bars[bars.length - 1].time) {
        bars.push({ ...f });
        mark(bars.length - 1);
      }
      continue;
    }
    const cur = bars[i];
    const isLast = i === bars.length - 1;
    const next: Bar = isLast
      ? {
          time: cur.time,
          open: f.open,
          high: Math.max(cur.high, f.high),
          low: Math.min(cur.low, f.low),
          // a trade that landed after the re-fetch started is newer than the fetched close
          close: liveAfterFetch ? cur.close : f.close,
          volume: Math.max(cur.volume, f.volume),
        }
      : { ...f };
    if (next.open !== cur.open || next.high !== cur.high || next.low !== cur.low || next.close !== cur.close || next.volume !== cur.volume) {
      bars[i] = next;
      mark(i);
    }
  }
  return first;
}

/**
 * The official quote as a zero-size trade for the last candle, when the trade stream has been quiet: only a quote with
 * its own trade time from the last 2 minutes, newer than the last trade the chart saw by 45 seconds or more.
 */
export function quoteAsTrade(q: { last: number | null; at?: number }, lastTradeAt: number | null, nowSec: number): { price: number; size: number; time: number } | null {
  if (q.last == null || !Number.isFinite(q.last) || q.last <= 0 || !q.at) return null;
  if (nowSec - q.at > 120 || q.at > nowSec + 5) return null;
  if (lastTradeAt != null && q.at - lastTradeAt < 45) return null;
  return { price: q.last, size: 0, time: q.at };
}

/** A quiet re-fetch is due when the newest data is older than two bars (at least 90 s) and the market can trade. */
export function needsCatchUp(o: { lastDataAt: number | null; barSec: number; nowSec: number; marketOpen: boolean }): boolean {
  if (!o.marketOpen || o.barSec >= 86400) return false;
  if (o.lastDataAt == null) return true;
  return o.nowSec - o.lastDataAt > Math.max(90, 2 * o.barSec);
}
