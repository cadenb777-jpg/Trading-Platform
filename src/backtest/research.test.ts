import { describe, expect, it } from 'vitest';
import { getIndicator } from '../indicators/library';
import { williamsCotIndex } from '../indicators/positioning';
import type { Bar } from '../types';
import { backtest, type BacktestResult, type Trade } from './engine';
import { computeSeries, deepStats, monteCarlo, monthlyReturns, randomWalkBars, randomWalkTest, rangeAround, rng, ruleSignals, suggestRules, sweep, type ChartIndicator } from './research';

function bars(n: number, seed = 1, drift = 0.0004): Bar[] {
  const r = rng(seed);
  let p = 100;
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    p *= Math.exp(drift + (r() - 0.5) * 0.03);
    out.push({ time: 1_600_000_000 + i * 86400, open: o, high: Math.max(o, p) * 1.005, low: Math.min(o, p) * 0.995, close: p, volume: 1000 });
  }
  return out;
}

const inst = (defId: string, params: Record<string, number | string>, uid: string): ChartIndicator => ({ instance: { uid, defId, params, colors: {}, visible: true }, def: getIndicator(defId)! });

describe('chart rules', () => {
  it('suggests a crossover from two moving averages and an RSI filter', () => {
    const inds = [inst('sma', { length: 50, source: 'close' }, 'slow'), inst('sma', { length: 10, source: 'close' }, 'fast'), inst('rsi', { length: 14, source: 'close' }, 'r')];
    const rules = suggestRules(inds);
    expect(rules.entry[0]).toMatchObject({ left: { uid: 'fast' }, op: 'crossAbove', right: { uid: 'slow' } });
    expect(rules.entry).toHaveLength(2);
    expect(rules.exit[0].op).toBe('crossBelow');
    const b = bars(400);
    const sig = ruleSignals(b, computeSeries(b, inds), rules, false);
    expect(sig.enterLong.some(Boolean)).toBe(true);
  });

  it('buys RSI oversold and sells overbought', () => {
    const rules = suggestRules([inst('rsi', { length: 14, source: 'close' }, 'r')]);
    expect(rules.entry[0]).toMatchObject({ op: 'crossAbove', right: { kind: 'value', value: 30 } });
    expect(rules.exit[0]).toMatchObject({ op: 'crossBelow', right: { kind: 'value', value: 70 } });
  });

  it('applies parameter overrides when computing', () => {
    const b = bars(100);
    const inds = [inst('sma', { length: 10, source: 'close' }, 'm')];
    const a = computeSeries(b, inds).get('m:ma')!;
    const c = computeSeries(b, inds, { 'm.length': 20 }).get('m:ma')!;
    expect(Number.isNaN(a[15])).toBe(false);
    expect(Number.isNaN(c[15])).toBe(true);
  });
});

describe('research tools', () => {
  const b = bars(800);
  const inds = [inst('sma', { length: 20, source: 'close' }, 'm')];
  const rules = suggestRules(inds);
  const opts = { capital: 10000, positionSize: 1, commission: 0, slippage: 0 };
  const result = backtest(b, ruleSignals(b, computeSeries(b, inds), rules, false), opts);

  it('monte carlo gives ordered percentiles', () => {
    const mc = monteCarlo(result.trades, 10000, 1, result.stats.maxDrawdown, 500)!;
    expect(mc.finalReturn.p5).toBeLessThanOrEqual(mc.finalReturn.p50);
    expect(mc.finalReturn.p50).toBeLessThanOrEqual(mc.finalReturn.p95);
    expect(mc.histogram.reduce((s, x) => s + x.count, 0)).toBe(500);
    expect(mc.lossChance).toBeGreaterThanOrEqual(0);
  });

  it('random walks keep the same moves and length', () => {
    const fake = randomWalkBars(b, rng(3));
    expect(fake).toHaveLength(b.length);
    expect(fake[fake.length - 1].close).toBeCloseTo(b[b.length - 1].close, 6); // same moves, different order
    for (const x of fake) expect(x.high).toBeGreaterThanOrEqual(Math.max(x.open, x.close) - 1e-9);
    const t = randomWalkTest(b, (bs) => backtest(bs, ruleSignals(bs, computeSeries(bs, inds), rules, false), opts).stats.totalReturn, result.stats.totalReturn, 50);
    expect(t.returns).toHaveLength(50);
    expect(t.pValue).toBeGreaterThan(0);
    expect(t.pValue).toBeLessThanOrEqual(1);
  });

  it('sweeps settings, groups monthly returns and computes deep stats', () => {
    const cells = sweep(b, (ov) => ruleSignals(b, computeSeries(b, inds, ov), rules, false), opts, 'm.length', [10, 20, 30]);
    expect(cells).toHaveLength(3);
    expect(cells[1].totalReturn).toBeCloseTo(result.stats.totalReturn, 10);
    const months = monthlyReturns(result.equity);
    const year = [...months.values()][1];
    const compounded = year.slice(0, 12).reduce<number>((acc, v) => acc * (1 + (v ?? 0)), 1) - 1;
    expect(year[12]).toBeCloseTo(compounded, 8);
    const d = deepStats(result, 10000);
    expect(d.maxConsecutiveLosses).toBeGreaterThanOrEqual(0);
    expect(rangeAround(14)).toContain(14);
  });
});

describe('deep statistics on hand-made trades', () => {
  const trade = (returnPct: number, bars = 2): Trade => ({ side: 'long', entryTime: 0, entryPrice: 100, exitTime: 1, exitPrice: 100 * (1 + returnPct), shares: 1, pnl: returnPct * 100, returnPct, bars, reason: 'signal' });
  const trades = [trade(0.1), trade(-0.05), trade(0.1), trade(-0.05)];
  const result = { trades, equity: [{ time: 0, value: 100 }, { time: 86400, value: 110 }, { time: 172800, value: 104.5 }], buyHold: [], stats: { cagr: null, maxDrawdown: -0.05 } } as unknown as BacktestResult;

  it('computes expectancy, Kelly and losing streaks exactly', () => {
    const d = deepStats(result, 100);
    expect(d.expectancy).toBeCloseTo(0.5 * 0.1 - 0.5 * 0.05, 12);
    expect(d.kelly).toBeCloseTo(0.5 - 0.5 / 2, 12);
    expect(d.maxConsecutiveLosses).toBe(1);
    expect(d.avgBars).toBe(2);
    expect(d.bestTrade).toBe(0.1);
    expect(d.worstTrade).toBe(-0.05);
  });

  it('monte carlo of identical trades has no spread and includes commission', () => {
    const same = Array.from({ length: 10 }, () => trade(0.02));
    const mc = monteCarlo(same, 1000, 1, 0, 200, 1, 0.001)!;
    const expected = ((1.02 * (1 - 0.002)) ** 10) - 1;
    expect(mc.finalReturn.p5).toBeCloseTo(expected, 10);
    expect(mc.finalReturn.p95).toBeCloseTo(expected, 10);
    expect(mc.lossChance).toBe(0);
  });
});

describe('Williams indicators', () => {
  it('scales COT net positions 0-100 over the look-back', () => {
    const pts = [10, 20, 30, 40, 25].map((v, i) => ({ time: i, values: { commNet: v } }));
    const idx = williamsCotIndex(pts, 'commNet', 3);
    expect(Number.isNaN(idx[1])).toBe(true);
    expect(idx[2]).toBe(100);
    expect(idx[4]).toBeCloseTo(((25 - 25) / (40 - 25)) * 100, 8);
  });

  it('stays fast on 10 years of weekly data with a 3-year look-back', () => {
    const def = getIndicator('williamscot')!;
    const pts = Array.from({ length: 520 }, (_, i) => ({ time: i * 7 * 86400, values: { commNet: Math.sin(i / 9) * 1000, specNet: Math.cos(i / 7) * 800, smallNet: i % 13 } }));
    const bs: Bar[] = Array.from({ length: 2000 }, (_, i) => ({ time: i * 86400, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    const start = performance.now();
    const out = def.compute(bs, { weeks: 156 }, pts);
    expect(performance.now() - start).toBeLessThan(150);
    expect(out.comm.some(Number.isFinite)).toBe(true);
  });

  it('accumulates Williams A/D from true highs and lows', () => {
    const def = getIndicator('wad')!;
    const bs: Bar[] = [
      { time: 0, open: 10, high: 11, low: 9, close: 10, volume: 1 },
      { time: 1, open: 10, high: 12, low: 10.5, close: 11.5, volume: 1 }, // up: 11.5 - min(10.5, 10) = 1.5
      { time: 2, open: 11, high: 11.2, low: 10, close: 10.5, volume: 1 }, // down: 10.5 - max(11.2, 11.5) = -1
    ];
    expect(def.compute(bs, { length: 2 }).wad).toEqual([0, 1.5, 0.5]);
  });
});
