import { describe, expect, it } from 'vitest';
import { readTrade } from './tradeRead';
import type { Setup } from './setupsPanel';

const base = {
  symbol: 'TEST', strategy: 'weekly_swing', strategyName: 'Weekly swing', direction: 1, status: 'ready', statusText: '', signalDate: '2026-10-22',
  price: 99, day: null, week: null, reasons: [], score: 0, tier: 'A', unit: 'day',
  plan: { entryType: 'stop', trigger: 100, validUntil: '2026-10-26', stop: 96, target: 110, targetNote: '', maxHold: 5, exitBy: '2026-10-30', exitRule: '', riskReward: 2.5, riskPct: 0.04, atr: 2, horizon: '' },
  indicators: { z: -1.6, willr: -70, cot: 72, cotView: 'agree', weekly: 1, wadRising: true, rsi2: 20, adx: 25 },
  checks: [], levels: { supports: [], resistances: [] }, stock: { trades: 10, winRate: 0.6, profitFactor: 1.5, expectancy: 0.01, grade: 'proven' },
  strategyStats: { trades: 0, winRate: null, profitFactor: null, expectancy: null, randomEntryP: null },
} as unknown as Setup;
const strat = { name: '', short: '', horizon: '', stocks: 100, stats: { trades: 500, winRate: 0.55, profitFactor: 1.4, expectancy: 0.004 }, randomEntry: { p: 0.02, trades: 500, verdict: 'edge' as const } };

describe('the read', () => {
  it('a clean A setup reads as high conviction with every factor for it', () => {
    const r = readTrade(base, strat, 1);
    expect(r.conviction).toBe('High');
    expect(r.factors.every((f) => f.stance !== 'against')).toBe(true);
    expect(r.action).toContain('normal size');
  });

  it('lists what is against a trade and never rates a C above watch only', () => {
    const r = readTrade({ ...base, tier: 'C', indicators: { ...base.indicators, cotView: 'against', wadRising: false } } as Setup, { ...strat, stats: { ...strat.stats, expectancy: -0.002 } }, -1);
    expect(r.conviction).toBe('Watch only');
    expect(r.againstText).toContain('commercials on the other side');
    expect(r.againstText).toContain('lost money');
    expect(r.action).toContain("Don't trade it");
  });

  it('mirrors for a sell', () => {
    const r = readTrade({ ...base, direction: -1, indicators: { ...base.indicators, weekly: -1, z: 1.4, cotView: 'agree', wadRising: false } } as Setup, strat, -1);
    expect(r.headline).toContain('Bearish');
    expect(r.factors.find((f) => f.key === 'flow')!.stance).toBe('for');
  });
});
