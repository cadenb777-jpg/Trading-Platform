import { describe, expect, it } from 'vitest';
import { coinbase } from '../data/coinbase';
import { positionStats } from '../chart/drawings';
import { applyTrade, bucketStart, regroupBars, type Bar } from '../types';
import { INDICATORS, defaultParams, getIndicator } from './library';
import { ema, rsi, sma, stdev, wma } from './math';

const round = (values: number[], dp = 2) => values.map((v) => (Number.isNaN(v) ? NaN : Number(v.toFixed(dp))));

describe('math', () => {
  it('sma', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
  });

  it('sma skips leading NaNs', () => {
    expect(sma([NaN, 1, 2, 3], 2)).toEqual([NaN, NaN, 1.5, 2.5]);
  });

  it('ema is seeded with the sma', () => {
    // alpha = 0.5 for length 3: seed 2, then 0.5*4 + 0.5*2 = 3, then 0.5*5 + 0.5*3 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
    expect(ema([1, 2, 3, 10], 3)[3]).toBe(6);
  });

  it('wma', () => {
    // (1*1 + 2*2 + 3*3) / 6
    expect(wma([1, 2, 3], 3)[2]).toBeCloseTo(14 / 6);
  });

  it('stdev is the population standard deviation', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)[7]).toBe(2);
  });

  it('rsi matches the StockCharts reference example', () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41,
      46.22, 45.64,
    ];
    const out = round(rsi(closes, 14));
    expect(out.slice(0, 14).every(Number.isNaN)).toBe(true);
    expect(out.slice(14)).toEqual([70.46, 66.25, 66.48, 69.35, 66.29, 57.92]);
  });

  it('rsi is 100 for only gains and 50 for a flat line', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
    expect(rsi([5, 5, 5, 5, 5], 3).at(-1)).toBe(50);
  });
});

function makeBars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + Math.sin(i / 5) * 10 + i * 0.1;
    return { time: i * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 + i };
  });
}

describe('indicator library', () => {
  const bars = makeBars(300);

  for (const def of INDICATORS) {
    it(`${def.name} returns one finite series per plot`, () => {
      const out = def.compute(bars, defaultParams(def));
      for (const plot of def.plots) {
        expect(out[plot.key]).toHaveLength(bars.length);
        expect(Number.isFinite(out[plot.key].at(-1))).toBe(true);
      }
    });
  }

  it('indicator ids are unique', () => {
    expect(new Set(INDICATORS.map((d) => d.id)).size).toBe(INDICATORS.length);
  });

  it('bollinger bands are symmetric around the basis', () => {
    const def = getIndicator('bb')!;
    const out = def.compute(bars, defaultParams(def));
    const i = 250;
    expect(out.upper[i] - out.basis[i]).toBeCloseTo(out.basis[i] - out.lower[i]);
  });

  it('macd histogram is macd minus signal', () => {
    const def = getIndicator('macd')!;
    const out = def.compute(bars, defaultParams(def));
    expect(out.hist[299]).toBeCloseTo(out.macd[299] - out.signal[299]);
  });

  it('stochastic and williams %R stay in range', () => {
    const stoch = getIndicator('stoch')!.compute(bars, defaultParams(getIndicator('stoch')!));
    const willr = getIndicator('willr')!.compute(bars, defaultParams(getIndicator('willr')!));
    for (const v of stoch.k.filter(Number.isFinite)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
    for (const v of willr.r.filter(Number.isFinite)) expect(v).toBeGreaterThanOrEqual(-100), expect(v).toBeLessThanOrEqual(0);
  });
});

describe('applyTrade', () => {
  it('updates the current bar and starts new ones', () => {
    const bars: Bar[] = [{ time: 60, open: 10, high: 10, low: 10, close: 10, volume: 1 }];
    expect(applyTrade(bars, '1m', 12, 2, 90)).toMatchObject({ isNew: false });
    expect(bars[0]).toMatchObject({ high: 12, close: 12, volume: 3 });
    expect(applyTrade(bars, '1m', 9, 1, 185)).toMatchObject({ isNew: true });
    expect(bars[1]).toMatchObject({ time: 180, open: 9, close: 9 });
    expect(applyTrade(bars, '1m', 9, 1, 100)).toBeNull();
  });

  it('keeps daily bars aligned to the provider timestamp', () => {
    const fourAm = 4 * 3600;
    const bars: Bar[] = [{ time: fourAm, open: 1, high: 1, low: 1, close: 1, volume: 0 }];
    applyTrade(bars, '1D', 2, 1, fourAm + 86400 + 10 * 3600);
    expect(bars[1].time).toBe(fourAm + 86400);
  });
});

describe('symbols', () => {
  it('normalizes crypto symbols for Coinbase', () => {
    expect(coinbase.normalizeSymbol('btc')).toBe('BTC-USD');
    expect(coinbase.normalizeSymbol('ethusdt')).toBe('ETH-USDT');
    expect(coinbase.normalizeSymbol('sol/usd')).toBe('SOL-USD');
  });
});

describe('timeframes', () => {
  const mk = (time: number, close: number): Bar => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 10 });

  it('regroups 1-minute bars into 3-minute bars', () => {
    const bars = [0, 60, 120, 180, 240].map((t, i) => mk(t, 10 + i));
    const out = regroupBars(bars, '3m');
    expect(out.map((b) => b.time)).toEqual([0, 180]);
    expect(out[0]).toMatchObject({ open: 10, close: 12, high: 13, low: 9, volume: 30 });
  });

  it('starts weeks on Monday and months on the 1st', () => {
    const wed = Date.UTC(2026, 9, 21) / 1000; // Wednesday 21 Oct 2026
    expect(new Date(bucketStart(wed, '1W') * 1000).getUTCDay()).toBe(1);
    expect(bucketStart(wed + 3600, '1M')).toBe(Date.UTC(2026, 9, 1) / 1000);
  });

  it('starts a new monthly bar in a new calendar month', () => {
    const bars: Bar[] = [mk(Date.UTC(2026, 8, 1) / 1000, 5)];
    expect(applyTrade(bars, '1M', 6, 1, Date.UTC(2026, 8, 30) / 1000)).toMatchObject({ isNew: false });
    expect(applyTrade(bars, '1M', 7, 1, Date.UTC(2026, 9, 2) / 1000)).toMatchObject({ isNew: true });
    expect(bars[1].time).toBe(Date.UTC(2026, 9, 1) / 1000);
  });

  it('builds second bars from trades with no history', () => {
    const bars: Bar[] = [];
    applyTrade(bars, '5s', 1, 1, 1003);
    applyTrade(bars, '5s', 2, 1, 1004.9);
    applyTrade(bars, '5s', 3, 1, 1011);
    expect(bars.map((b) => b.time)).toEqual([1000, 1010]);
    expect(bars[0]).toMatchObject({ open: 1, close: 2 });
  });
});

describe('position tool', () => {
  it('computes risk/reward for a long position', () => {
    const stats = positionStats({ id: 'x', type: 'long', color: '', points: [{ time: 0, price: 100 }, { time: 1, price: 110 }, { time: 1, price: 95 }] });
    expect(stats.ratio).toBe(2);
    expect(stats.targetPct).toBeCloseTo(10);
    expect(stats.stopPct).toBeCloseTo(-5);
  });
});
