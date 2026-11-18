import { describe, expect, it } from 'vitest';
import { mergeTail, needsCatchUp, quoteAsTrade } from './freshness';

const bar = (time: number, close: number, o: Partial<{ open: number; high: number; low: number; volume: number }> = {}) => ({ time, open: o.open ?? close, high: o.high ?? close, low: o.low ?? close, close, volume: o.volume ?? 100 });

describe('chart freshness', () => {
  it('adds missed bars and corrects the overlap', () => {
    const bars = [bar(0, 10), bar(60, 11), bar(120, 12)];
    const first = mergeTail(bars, [bar(60, 11.5), bar(120, 12.5, { high: 13 }), bar(180, 13), bar(240, 14)], false);
    expect(first).toBe(1);
    expect(bars.map((b) => b.close)).toEqual([10, 11.5, 12.5, 13, 14]);
    expect(bars[2].high).toBe(13);
  });
  it('keeps a live trade newer than the re-fetch on the last bar', () => {
    const bars = [bar(0, 10), bar(60, 12, { high: 12.4, low: 11.8, volume: 900 })];
    mergeTail(bars, [bar(60, 11.9, { high: 12.1, low: 11.5, volume: 500, open: 11.6 })], true);
    expect(bars[1]).toEqual({ time: 60, open: 11.6, high: 12.4, low: 11.5, close: 12, volume: 900 });
  });
  it('reports nothing when nothing changed, and fills an empty chart', () => {
    const bars = [bar(0, 10)];
    expect(mergeTail(bars, [bar(0, 10)], false)).toBe(-1);
    expect(mergeTail(bars, [], false)).toBe(-1);
    const empty: ReturnType<typeof bar>[] = [];
    expect(mergeTail(empty, [bar(0, 1), bar(60, 2)], false)).toBe(0);
    expect(empty).toHaveLength(2);
  });
  it('lets a recent quote move the candle only when trades have gone quiet', () => {
    expect(quoteAsTrade({ last: 101, at: 1000 }, 900, 1010)).toEqual({ price: 101, size: 0, time: 1000 });
    expect(quoteAsTrade({ last: 101, at: 1000 }, 980, 1010)).toBeNull(); // a trade 20 s earlier: the stream is alive
    expect(quoteAsTrade({ last: 101, at: 800 }, null, 1010)).toBeNull(); // quote too old
    expect(quoteAsTrade({ last: 101 }, null, 1010)).toBeNull(); // no time of its own
    expect(quoteAsTrade({ last: null, at: 1000 }, null, 1010)).toBeNull();
  });
  it('re-fetches when data is older than two bars, only while the market can trade', () => {
    expect(needsCatchUp({ lastDataAt: 1000, barSec: 60, nowSec: 1200, marketOpen: true })).toBe(true);
    expect(needsCatchUp({ lastDataAt: 1000, barSec: 60, nowSec: 1060, marketOpen: true })).toBe(false);
    expect(needsCatchUp({ lastDataAt: 1000, barSec: 300, nowSec: 1500, marketOpen: true })).toBe(false); // < 2 bars
    expect(needsCatchUp({ lastDataAt: 1000, barSec: 60, nowSec: 9000, marketOpen: false })).toBe(false);
    expect(needsCatchUp({ lastDataAt: 1000, barSec: 86400, nowSec: 99999, marketOpen: true })).toBe(false); // daily bars
  });
});
