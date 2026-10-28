import { describe, expect, it } from 'vitest';
import { accountsBrief, alertAttention, readySetups, todaysEvents } from './brief';
import type { CombinedHolding } from '../portfolio/account';
import type { HelperAlert } from '../ui/alertsLogic';
import type { Setup } from './setupsPanel';

const row = (symbol: string, shares: number, amount = 0): CombinedHolding => ({ symbol, name: '', kind: shares ? 'security' : 'cash', assetClass: 'US stocks', shares, amount, cost: null, parts: [] });

describe('accounts brief', () => {
  it('adds up value and today, and ranks movers by dollars', () => {
    const r = accountsBrief(
      [row('AAPL', 10), row('MSFT', 2), row('CASH', 0, 1000), row('KO', 100)],
      { AAPL: { price: 110, change: 0.1 }, MSFT: { price: 400, change: -0.0099 }, KO: { price: 70, change: 0 } },
    );
    expect(r.total).toBeCloseTo(1100 + 800 + 1000 + 7000);
    // AAPL: 1100 now, 1000 yesterday -> +100; MSFT: 800 / 0.9901 = 807.98 -> -7.98
    expect(r.today).toBeCloseTo(100 - 7.9992, 2);
    expect(r.movers.map((m) => m.symbol)).toEqual(['AAPL', 'MSFT']); // KO didn't move
    expect(r.movers[0].pct).toBeCloseTo(10);
    expect(r.todayPct).toBeCloseTo((r.today! / (r.total! - r.today!)) * 100);
  });
  it('leaves unpriced holdings out and says which', () => {
    const r = accountsBrief([row('AAPL', 10), row('ZZZ', 5)], { AAPL: { price: 100, change: null } });
    expect(r.total).toBe(1000);
    expect(r.today).toBeNull();
    expect(r.unpriced).toEqual(['ZZZ']);
    expect(accountsBrief([], {}).total).toBeNull();
  });
});

const alert = (a: Partial<HelperAlert>): HelperAlert => ({ id: a.symbol ?? 'x', kind: 'price', symbol: 'AAPL', note: '', repeat: false, active: true, created: 0, ...a });

describe('alerts that need attention', () => {
  const now = 1_000_000;
  const d = (a: HelperAlert) => `${a.symbol} ${a.condition} ${a.price}`;
  it('lists alerts fired in the last day, newest first, then near ones closest first', () => {
    const list = [
      alert({ id: 'old', symbol: 'OLD', firedAt: now - 2 * 86400, active: false }),
      alert({ id: 'f1', symbol: 'AAPL', firedAt: now - 3600, active: false }),
      alert({ id: 'f2', symbol: 'TSLA', firedAt: now - 60, active: true, repeat: true }),
      alert({ id: 'n1', symbol: 'MSFT', condition: 'below', price: 395 }), // price 400: 1.25% away
      alert({ id: 'n2', symbol: 'NVDA', condition: 'above', price: 101 }), // price 100: 1% away
      alert({ id: 'far', symbol: 'AMD', condition: 'above', price: 200 }), // price 100: far
      alert({ id: 'past', symbol: 'KO', condition: 'above', price: 60 }), // already above: not "near"
    ];
    const out = alertAttention(list, { MSFT: 400, NVDA: 100, AMD: 100, KO: 70 }, now, d);
    expect(out.map((x) => x.id)).toEqual(['f2', 'f1', 'n2', 'n1']);
    expect(out[2].kind).toBe('near');
    expect(out[2].distance).toBeCloseTo(0.01);
  });
});

const setup = (symbol: string, tier: 'A' | 'B' | 'C', price: number, extra: Partial<Setup> = {}): Setup =>
  ({ symbol, tier, direction: 1, status: 'waiting', price, score: 1, plan: { entryType: 'stop', trigger: 100, stop: 95, target: 110, validUntil: '2099-01-01', atr: 2 }, ...extra }) as unknown as Setup;

describe('setups ready to act on', () => {
  it('keeps A/B buy setups at or near their entry (never a sell: long only), entry first, then by grade', () => {
    const out = readySetups(
      {
        swing: { setups: [setup('NEAR', 'A', 99.7), setup('IN', 'B', 100.5), setup('FAR', 'A', 90), setup('C', 'C', 100.5), setup('FORM', 'A', 100.5, { status: 'forming' }), setup('SHORT', 'A', 94.5, { direction: -1, plan: { entryType: 'stop', trigger: 95, stop: 100, target: 85, validUntil: '2099-01-01', atr: 2 } as Setup['plan'] })] },
        position: { setups: [setup('INA', 'A', 100.2)] },
      },
      '2026-10-28',
    );
    expect(out.map((r) => r.setup.symbol)).toEqual(['INA', 'IN', 'NEAR']);
    expect(out[0].horizon).toBe('position');
    expect(out[2].zone).toBe('approaching');
  });
});

describe("today's events", () => {
  it('keeps high-impact US events from an hour ago to midnight', () => {
    const now = new Date(2026, 9, 28, 9, 0);
    const t = (h: number, day = 28) => new Date(2026, 9, day, h, 0).getTime() / 1000;
    const ev = [
      { time: t(14), country: 'USD', impact: 'high', title: 'FOMC' },
      { time: t(8, 28) + 1800, country: 'USD', impact: 'high', title: 'Earlier (within the hour)' },
      { time: t(6), country: 'USD', impact: 'high', title: 'Too early' },
      { time: t(10), country: 'EUR', impact: 'high', title: 'ECB' },
      { time: t(11), country: 'USD', impact: 'medium', title: 'Medium' },
      { time: t(9, 29), country: 'USD', impact: 'high', title: 'Tomorrow' },
    ];
    expect(todaysEvents(ev, now).map((e) => e.title)).toEqual(['Earlier (within the hour)', 'FOMC']);
  });
});
