import { describe, expect, it } from 'vitest';
import { entryZone, isLive, isOver } from './entryZone';
import type { Setup } from './setupsPanel';

function setup(over: Partial<Setup> = {}, plan: Partial<Setup['plan']> = {}): Setup {
  return {
    symbol: 'TEST', strategy: 'weekly_swing', strategyName: 'Weekly swing', direction: 1, status: 'ready', statusText: 'Ready', signalDate: '2026-10-22',
    price: 99, day: null, week: null, reasons: [], score: 0, tier: 'B', unit: 'day',
    plan: { entryType: 'stop', trigger: 100, validUntil: '2026-10-26', stop: 96, target: 110, targetNote: '', maxHold: 5, exitBy: '2026-10-30', exitRule: '', riskReward: 2.5, riskPct: 0.04, atr: 2, horizon: '1 week', ...plan },
    indicators: { z: null, willr: null, cot: null, cotView: null, weekly: null, wadRising: null, rsi2: null, adx: null },
    checks: [], levels: { supports: [], resistances: [] }, stock: { trades: 0, winRate: null, profitFactor: null, expectancy: null },
    strategyStats: { trades: 0, winRate: null, profitFactor: null, expectancy: null, randomEntryP: null },
    ...over,
  } as Setup;
}

const today = '2026-10-23';

describe('entry zone', () => {
  it('walks a long setup from waiting to entry to too far', () => {
    expect(entryZone(setup(), 97, today).zone).toBe('waiting');
    expect(entryZone(setup(), 99.5, today).zone).toBe('approaching'); // within 0.3 ATR (0.6) of 100
    expect(entryZone(setup(), 100.5, today).zone).toBe('entry'); // risk 4, chase limit 1
    expect(entryZone(setup(), 101.5, today).zone).toBe('extended');
    expect(entryZone(setup(), 110, today).zone).toBe('target');
    expect(entryZone(setup(), 95, today).zone).toBe('invalid');
  });

  it('mirrors for a short and respects the entry window and forming bars', () => {
    const short = setup({ direction: -1 }, { trigger: 100, stop: 104, target: 90 });
    expect(entryZone(short, 99.5, today).zone).toBe('entry');
    expect(entryZone(short, 100.4, today).zone).toBe('approaching');
    expect(entryZone(short, 105, today).zone).toBe('invalid');
    expect(entryZone(setup({}, { validUntil: '2026-10-22' }), 100.2, today).zone).toBe('expired');
    expect(entryZone(setup({ status: 'forming' }), 100.2, today).zone).toBe('forming');
  });

  it('a scanner paper trade reads as triggered (never waiting or "you are in"), judged against its fill', () => {
    const open = setup({ status: 'in trade', trade: { entry: 100.3, filled: '2026-10-22', pnl: 0, daysHeld: 1 } });
    const fair = entryZone(open, 100.8, today);
    expect(fair.zone).toBe('triggered');
    expect(fair.tone).toBe('up');
    expect(fair.label).toBe('Triggered at $100.30');
    expect(fair.detail).toContain("The strategy's signal triggered at $100.30");
    expect(fair.detail).not.toMatch(/you('|’)re (already )?in/i);
    expect(entryZone(open, 103, today).label).toBe('Triggered · too far to chase');
    // back below the fill (the NVDA case): still triggered, not "waiting for trigger"
    const back = entryZone(open, 98, today);
    expect(back.zone).toBe('triggered');
    expect(back.label).not.toMatch(/waiting/i);
    expect(entryZone(open, 95, today).zone).toBe('invalid');
  });

  it('stop hit, at target and expired setups are over: left out of the counts and the open risk', () => {
    const z = (s: Setup, p: number) => entryZone(s, p, today).zone;
    const over = [z(setup(), 95), z(setup(), 111), z(setup({}, { validUntil: '2026-10-01' }), 99)];
    expect(over).toEqual(['invalid', 'target', 'expired']);
    expect(over.every(isOver) && !over.some(isLive)).toBe(true);
    const live = [z(setup(), 97), z(setup(), 99.6), z(setup(), 100.2), z(setup({ status: 'in trade', trade: { entry: 100.3, filled: '2026-10-22', pnl: 0, daysHeld: 1 } }), 98)];
    expect(live).toEqual(['waiting', 'approaching', 'entry', 'triggered']);
    expect(live.every(isLive) && !live.some(isOver)).toBe(true);
  });
});
