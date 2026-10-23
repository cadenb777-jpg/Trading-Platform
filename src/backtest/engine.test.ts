import { describe, expect, it } from 'vitest';
import type { Bar } from '../types';
import { backtest } from './engine';
import { STRATEGIES } from './strategies';

const day = 86400;
const mk = (closes: number[]): Bar[] => closes.map((c, i) => ({ time: i * day, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1 }));
const opts = { capital: 1000, positionSize: 1, commission: 0, slippage: 0 };
const flags = (n: number, at: number[]) => Array.from({ length: n }, (_, i) => at.includes(i));

describe('backtest', () => {
  it('fills at the next open and tracks P&L', () => {
    const bars = mk([10, 10, 12, 15, 15]);
    const r = backtest(bars, { enterLong: flags(5, [0]), exitLong: flags(5, [2]) }, opts);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].entryPrice).toBe(10); // bar 1 open
    expect(r.trades[0].exitPrice).toBe(15); // bar 3 open
    expect(r.stats.totalReturn).toBeCloseTo(0.5);
    expect(r.equity[r.equity.length - 1].value).toBeCloseTo(1500);
  });

  it('charges commission and slippage', () => {
    const bars = mk([10, 10, 10, 10]);
    const r = backtest(bars, { enterLong: flags(4, [0]), exitLong: flags(4, [1]) }, { ...opts, commission: 0.001, slippage: 0.001 });
    expect(r.stats.totalReturn).toBeLessThan(0);
    expect(r.stats.costs).toBeGreaterThan(0);
  });

  it('exits at the stop-loss', () => {
    const bars = mk([10, 10, 10, 8, 8]);
    const r = backtest(bars, { enterLong: flags(5, [0]), exitLong: flags(5, []) }, { ...opts, stopLoss: 0.1 });
    expect(r.trades[0].reason).toBe('stop');
    expect(r.trades[0].exitPrice).toBe(8); // gapped below the stop: filled at the open
  });

  it('closes open trades at the end and short trades profit from falls', () => {
    const bars = mk([10, 10, 8, 6]);
    const r = backtest(bars, { enterLong: flags(4, []), exitLong: flags(4, []), enterShort: flags(4, [0]), exitShort: flags(4, []) }, opts);
    expect(r.trades[0].side).toBe('short');
    expect(r.trades[0].reason).toBe('end');
    expect(r.trades[0].pnl).toBeCloseTo(400);
  });

  it('every strategy runs on a random walk', () => {
    let p = 100;
    const bars = mk(Array.from({ length: 600 }, (_, i) => (p *= 1 + Math.sin(i / 17) * 0.01 + 0.0005)));
    for (const s of STRATEGIES) {
      const params = Object.fromEntries(s.params.map((x) => [x.key, x.default]));
      const r = backtest(bars, s.signals(bars, params, false), opts);
      expect(Number.isFinite(r.stats.totalReturn)).toBe(true);
    }
  });
});
