import { describe, expect, it } from 'vitest';
import { canTrade, ownerConflict, readTrade, tradeBlock } from './tradeRead';
import { takeProfit, type Setup } from './setupsPanel';

const base = {
  symbol: 'TEST', strategy: 'weekly_swing', strategyName: 'Pullback', direction: 1, status: 'ready', statusText: '', signalDate: '2026-10-22',
  price: 99, day: null, week: null, reasons: [], score: 0, tier: 'A', unit: 'day',
  plan: { entryType: 'stop', trigger: 100, validUntil: '2026-10-26', stop: 96, target: 110, targetNote: '', maxHold: 5, exitBy: '2026-10-30', exitRule: '', riskReward: 2.5, riskPct: 0.04, atr: 2, horizon: '' },
  indicators: { z: -1.6, cot: 72, cotView: 'neutral', weekly: 0, trendRule: 'none', rsi2: 20 },
  checks: [], levels: { supports: [], resistances: [] }, stock: { trades: 25, winRate: 0.6, profitFactor: 1.5, expectancy: 0.01, grade: 'proven' },
  strategyStats: { trades: 0, winRate: null, profitFactor: null, expectancy: null, randomEntryP: null },
} as unknown as Setup;
const rec = { stats: { trades: 500, winRate: 0.55, profitFactor: 1.4, expectancy: 0.004 }, randomEntry: { p: 0.01, pAdjusted: 0.05, trades: 500, verdict: 'edge' as const },
  robust: { costs: true, halves: true, costsExpectancy: 0.002, firstHalf: { trades: 250, expectancy: 0.004, tStat: 2 }, secondHalf: { trades: 250, expectancy: 0.004, tStat: 2 } } };
const strat = { name: '', short: '', horizon: '', stocks: 100, ...rec, sides: { long: rec, short: { ...rec, stats: { ...rec.stats, expectancy: -0.002 } } } };

describe('the read', () => {
  it('a clean A setup reads as high conviction with nothing against it', () => {
    const r = readTrade(base, strat, 1);
    expect(r.conviction).toBe('High');
    expect(r.factors.every((f) => f.stance !== 'against')).toBe(true);
    expect(r.action).toContain('normal size');
  });

  it("a scanner paper trade is the strategy's signal, never the owner's position", () => {
    const r = readTrade({ ...base, status: 'in trade', trade: { entry: 100.3, filled: '2026-10-22', pnl: 0.01, daysHeld: 2 } } as Setup, strat, 1);
    expect(r.action).toContain("The strategy's signal triggered at $100.30");
    expect(r.action).not.toMatch(/you('|’)re (already )?in|Already triggered/i);
  });

  it('Trade this: blocked for sells, forming signals and setups that are over, never by the scanner paper trade', () => {
    const d = '2026-10-23';
    expect(canTrade({ ...base, status: 'in trade', trade: { entry: 100, filled: '2026-10-22', pnl: 0, daysHeld: 1 } } as Setup, 99, d)).toBe(true);
    expect(tradeBlock({ ...base, status: 'forming' } as Setup, 99, d)).toMatch(/Don.t act yet/);
    expect(tradeBlock({ ...base, direction: -1 } as Setup, 99, d)).toMatch(/Short selling/);
    expect(tradeBlock(base, 99, d)).toBeNull();
    // judged at the live price: through the stop, at the target, or the entry window closed
    expect(tradeBlock(base, 95.5, d)).toBe('This setup is over (stop hit / target reached / window closed).');
    expect(tradeBlock(base, 111, d)).toMatch(/is over/);
    expect(tradeBlock(base, 99, '2026-10-27')).toMatch(/is over/);
  });

  it('only the owner holding it or an open buy order of theirs stops a new ticket', () => {
    expect(ownerConflict('NVDA', [{ symbol: 'AAPL', shares: 5 }], [])).toBeNull();
    expect(ownerConflict('NVDA', [{ symbol: 'NVDA', shares: 0 }], [{ symbol: 'NVDA', side: 'SELL', qty: 1 }])).toBeNull();
    expect(ownerConflict('nvda', [{ symbol: 'NVDA', shares: 3 }], [])).toContain('You already hold 3 NVDA');
    expect(ownerConflict('NVDA', [], [{ symbol: 'NVDA', side: 'BUY', qty: 10 }])).toBe('You already have an open buy order for 10 NVDA in Webull (see Trade › Orders).');
  });

  it('COT is a neutral reading unless it counts in the grade', () => {
    expect(readTrade(base, strat, 1).factors.find((f) => f.key === 'cot')!.stance).toBe('neutral');
    const gated = { ...base, indicators: { ...base.indicators, cotView: 'against', cotGate: { weeks: 156, hi: 75, lo: 25, sign: 1, value: 20 } } } as Setup;
    expect(readTrade(gated, strat, 1).factors.find((f) => f.key === 'cot')!.stance).toBe('against');
    const reverse = { ...base, indicators: { ...base.indicators, cotView: 'agree', cotGate: { weeks: 26, hi: 80, lo: 20, sign: -1, value: 10 } } } as Setup;
    const f = readTrade(reverse, strat, 1).factors.find((x) => x.key === 'cot')!;
    expect(f.text).toContain('reverse');
    expect(f.text).not.toContain('confirm it');
  });

  it('lists what is against a trade and never rates a C above watch only', () => {
    const r = readTrade({ ...base, direction: -1, tier: 'C' } as Setup, strat, 1);
    expect(r.conviction).toBe('Watch only');
    expect(r.againstText).toContain('lost money');
    expect(r.action).toContain("Don't trade it");
  });

  it('a profitable record that fails the robustness check is not counted for the trade', () => {
    const weak = { ...strat, sides: { long: { ...rec, robust: { ...rec.robust, costs: false } } } };
    expect(readTrade(base, weak, 1).factors.find((f) => f.key === 'record')!.stance).toBe('neutral');
  });
});

describe('take profit', () => {
  it('a pullback uses its tested target and the read says it', () => {
    expect(takeProfit(base)).toMatchObject({ price: 110, tested: true });
    expect(readTrade(base, strat, 1).action).toContain('Take profit at $110.00');
  });
  it('a trailing exit shows +2R as a guide, long and short', () => {
    const trail = { ...base, strategy: 'breakout', plan: { ...base.plan, target: null } } as Setup;
    expect(takeProfit(trail)).toMatchObject({ price: 108, tested: false });
    expect(takeProfit({ ...trail, direction: -1, plan: { ...trail.plan, trigger: 100, stop: 104 } } as Setup).price).toBe(92);
    expect(readTrade(trail, strat, 1).action).toContain('not part of the tested rule');
  });
});
