import { describe, expect, it } from 'vitest';
import { allIndicators, defaultParams } from '../indicators/library';
import { MARKET_PARAM } from '../indicators/session';
import { applyTrade, type Bar } from '../types';
import { FIRST_WINDOW, firstDifference, newTailState, sameValue, tailUpdate, type Values } from './incremental';

/** 1,400 five-minute bars (seeded random walk) and a stream of live trades: some update the last bar, some open new ones. */
function fixture(count = 1400): Bar[] {
  let seed = 4242;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bars: Bar[] = [];
  let close = 100;
  const t0 = 1736170200; // Monday 6 January 2025 13:30 UTC (08:30 New York)
  for (let i = 0; i < count; i++) {
    const open = close + (rand() - 0.5) * 0.4;
    close = Math.max(1, open + (rand() - 0.49) * 0.8);
    bars.push({ time: t0 + i * 300, open, close, high: Math.max(open, close) + rand() * 0.3, low: Math.min(open, close) - rand() * 0.3, volume: Math.round(500 + rand() * 5000) });
  }
  return bars;
}

function trades(bars: Bar[], count: number) {
  let seed = 99;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let price = bars[bars.length - 1].close;
  let t = bars[bars.length - 1].time + 10;
  return Array.from({ length: count }, (_, i) => {
    price *= 1 + (rand() - 0.5) * 0.004;
    t += i % 4 === 3 ? 300 : 20; // every fourth trade starts a new bar
    return { price, size: Math.round(1 + rand() * 50), time: t };
  });
}

const allMatch = (a: Values, b: Values) =>
  Object.keys(b).every((k) => a[k]?.length === b[k].length && b[k].every((v, i) => sameValue(a[k][i], v)));

describe('incremental indicator updates', () => {
  const defs = allIndicators().filter((d) => !d.external);

  it('equal a full recompute for every indicator on live tail updates', () => {
    const MUST = ['ema', 'sma', 'rsi', 'macd', 'atr', 'vwap', 'bb', 'stoch', 'obv', 'cdl_engulfing', 'zigzag', 'supertrend', 'psar', 'ichimoku'];
    expect(defs.length).toBeGreaterThanOrEqual(50);
    for (const id of MUST) expect(defs.some((d) => d.id === id)).toBe(true);
    let incremental = 0;
    const bad = new Set<string>();
    for (const def of defs) {
      const params = { ...defaultParams(def), [MARKET_PARAM]: 'schwab' };
      const compute = (b: Bar[]) => def.compute(b, params);
      const bars = fixture();
      let values = compute(bars);
      const state = newTailState();
      for (const trade of trades(bars, 12)) {
        const before = bars.length;
        applyTrade(bars, '5m', trade.price, trade.size, trade.time);
        const changedFrom = Math.min(before - 1, bars.length - 1);
        const full = compute(bars);
        const tail = tailUpdate(compute, bars, values, changedFrom, state);
        if (tail) {
          incremental++;
          if (!allMatch(tail, full)) bad.add(def.id);
        }
        values = tail ?? full;
      }
    }
    expect([...bad]).toEqual([]);
    console.log("INCR", incremental, defs.length * 12);
    // Most indicators settle into the fast path (the rest fall back to full recomputes, which are always right).
    expect(incremental).toBeGreaterThan(defs.length * 12 * 0.5);
  }, 120_000);

  it('falls back and widens the window when the tail does not match', () => {
    const bars = fixture();
    // A cumulative sum never matches from a later start: always full.
    const cumulative = (b: Bar[]) => {
      let s = 0;
      return { v: b.map((x) => (s += x.volume)) };
    };
    const state = newTailState();
    expect(tailUpdate(cumulative, bars, cumulative(bars), bars.length - 1, state)).toBeNull();
    expect(state.window).toBe(FIRST_WINDOW * 2);
    expect(state.fullOnly).toBe(true); // 1,024 x 2 > 1,400 bars: no point trying again
    expect(tailUpdate(cumulative, bars, cumulative(bars), bars.length - 1, state)).toBeNull();
  });

  it('leaves short histories and old changes to the full recompute', () => {
    const sma = (b: Bar[]) => ({ v: b.map((x) => x.close) });
    expect(tailUpdate(sma, fixture(600), sma(fixture(600)), 599, newTailState())).toBeNull();
    const bars = fixture();
    expect(tailUpdate(sma, bars, sma(bars), 10, newTailState())).toBeNull();
    expect(tailUpdate(sma, bars, sma(bars), bars.length - 1, newTailState())?.v).toEqual(sma(bars).v);
  });

  it('finds the first changed value', () => {
    expect(firstDifference({ a: [1, 2, 3] }, { a: [1, 2, 3] })).toBe(Infinity);
    expect(firstDifference({ a: [1, 2, 3] }, { a: [1, 5, 3] })).toBe(1);
    expect(firstDifference({ a: [1, 2] }, { a: [1, 2, 4] })).toBe(2);
    expect(firstDifference({ a: [NaN] }, { a: [NaN] })).toBe(Infinity);
    expect(firstDifference({}, { a: [1] })).toBe(0);
  });
});
