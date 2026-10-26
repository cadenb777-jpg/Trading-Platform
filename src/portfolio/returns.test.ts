import { describe, expect, it } from 'vitest';
import { combineHoldings, partKey, receivedPayload } from './account';
import { DEFAULT_PREFS, PREFS_KEY, dayTotal, gainOf, methodLabel, methodOf, readPrefs, savePrefs, showChange, sumGains } from './returns';
import type { Portfolio } from './types';

describe('gainOf', () => {
  it('splits price gain and dividends into a total return', () => {
    const g = gainOf(1200, 1000, 50);
    expect(g.priceGain).toBe(200);
    expect(g.priceGainPct).toBeCloseTo(0.2);
    expect(g.dividends).toBe(50);
    expect(g.total).toBe(250);
    expect(g.totalPct).toBeCloseTo(0.25);
  });

  it('a loss offset by dividends', () => {
    const g = gainOf(900, 1000, 120);
    expect(g.priceGain).toBe(-100);
    expect(g.total).toBe(20);
    expect(g.totalPct).toBeCloseTo(0.02);
  });

  it('missing cost basis: no price gain or total, dividends still known', () => {
    for (const cost of [null, undefined, 0, NaN]) {
      const g = gainOf(500, cost, 10);
      expect(g).toMatchObject({ cost: null, priceGain: null, priceGainPct: null, total: null, totalPct: null, dividends: 10 });
    }
  });

  it('unknown dividends count as none in the total but stay null', () => {
    const g = gainOf(1100, 1000, null);
    expect(g.dividends).toBeNull();
    expect(g.total).toBe(100);
  });

  it('no price: nothing but dividends', () => {
    expect(gainOf(null, 1000, 5)).toMatchObject({ priceGain: null, total: null, dividends: 5 });
  });
});

describe('sumGains', () => {
  it('combined equals the sum of single accounts', () => {
    const a = gainOf(1200, 1000, 50);
    const b = gainOf(450, 500, 10);
    const both = sumGains([a, b]);
    expect(both.cost).toBe(1500);
    expect(both.priceGain).toBe(150);
    expect(both.dividends).toBe(60);
    expect(both.total).toBe(210);
    expect(both.totalPct).toBeCloseTo(210 / 1500);
    expect(both.costCovered).toBe(1);
    expect(sumGains([a])).toMatchObject({ priceGain: a.priceGain, total: a.total, dividends: a.dividends });
  });

  it('holdings without cost: left out of the gain and %, their dividends shown but not in the total', () => {
    const s = sumGains([gainOf(1200, 1000, 50), gainOf(800, null, 30)]);
    expect(s.cost).toBe(1000);
    expect(s.priceGain).toBe(200);
    expect(s.dividends).toBe(80);
    expect(s.total).toBe(250);
    expect(s.totalPct).toBeCloseTo(0.25);
    expect(s.value).toBe(2000);
    expect(s.costCovered).toBeCloseTo(0.6);
  });

  it('nothing known', () => {
    expect(sumGains([gainOf(100, null, null)])).toMatchObject({ priceGain: null, total: null, dividends: null, totalPct: null, costCovered: 0 });
    expect(sumGains([])).toMatchObject({ value: null, total: null, costCovered: null });
  });
});

describe('dividend methods', () => {
  it('labels each method honestly', () => {
    expect(methodLabel({ method: 'tracked', since: '2026-10-01', estimated: 5 })).toBe('since Oct 1, 2026, estimated');
    expect(methodLabel({ method: 'purchase', since: '2024-02-15', estimated: 5 })).toBe('since Feb 15, 2024, estimated');
    expect(methodLabel({ method: 'entered', since: '2026-05-01', estimated: 3 })).toBe('you entered (to May 1, 2026) + estimated since');
    expect(methodLabel({ method: 'statement', since: '2026-05-01', estimated: 0 })).toBe('from your statement (to May 1, 2026)');
    expect(methodLabel({ method: 'none', since: null, estimated: null })).toBe('not known');
    expect(methodLabel(null)).toBe('not known');
  });

  it('mixed methods read as mixed', () => {
    expect(methodOf(['tracked', 'tracked', 'none'])).toBe('tracked');
    expect(methodOf(['tracked', 'entered'])).toBe('mixed');
    expect(methodOf(['none'])).toBe('none');
  });
});

describe('received payload', () => {
  const roth: Portfolio & { id: string } = {
    id: 'r1',
    name: 'Roth',
    benchmark: 'SPY',
    rebalance: 'none',
    mode: 'shares',
    holdings: [{ symbol: 'ko', weight: 0, assetClass: 'US stocks', kind: 'security', shares: 10, purchaseDate: '2020-01-02', seen: [{ date: '2026-10-01', shares: 10 }] }],
  };
  const taxable: Portfolio & { id: string } = { ...roth, id: 't1', name: 'Taxable', holdings: [{ symbol: 'KO', weight: 0, assetClass: 'US stocks', kind: 'security', shares: 5, dividends: 40, dividendsAsOf: '2026-09-01', dividendsSource: 'entered' }] };

  it('one entry per account holding, keyed by portfolio id', () => {
    const rows = combineHoldings([roth, taxable]);
    const out = receivedPayload(rows);
    expect(out.map((e) => e.key)).toEqual(['r1:KO', 't1:KO']);
    expect(out[0]).toMatchObject({ portfolioId: 'r1', symbol: 'KO', purchaseDate: '2020-01-02', seen: [{ date: '2026-10-01', shares: 10 }] });
    expect(out[1]).toMatchObject({ dividends: 40, dividendsSource: 'entered' });
    expect(partKey(rows[0].parts[1], 'KO')).toBe('t1:KO');
  });
});

describe('display choices', () => {
  const store = (raw: string | null) => ({ getItem: () => raw });

  it('falls back to both for anything missing or broken', () => {
    expect(readPrefs(store(null))).toEqual(DEFAULT_PREFS);
    expect(readPrefs(store('not json'))).toEqual(DEFAULT_PREFS);
    expect(readPrefs(store('{"day":"usd","gain":"weird"}'))).toEqual({ day: 'usd', gain: 'both' });
    expect(readPrefs({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('saves and reads back; a blocked store is ignored', () => {
    const mem: Record<string, string> = {};
    savePrefs({ setItem: (k, v) => (mem[k] = v) }, { day: 'pct', gain: 'usd' });
    expect(readPrefs({ getItem: (k) => mem[k] ?? null })).toEqual({ day: 'pct', gain: 'usd' });
    expect(Object.keys(mem)).toEqual([PREFS_KEY]);
    expect(() => savePrefs({ setItem: () => { throw new Error('quota'); } }, DEFAULT_PREFS)).not.toThrow();
  });

  it('shows a change as $, % or both', () => {
    expect(showChange(12.3, 0.0125, 'both')).toBe('+$12.30 (+1.25%)');
    expect(showChange(12.3, 0.0125, 'usd')).toBe('+$12.30');
    expect(showChange(-1234, -0.05, 'pct', 1)).toBe('−5.0%');
    expect(showChange(-1234, -0.05, 'usd')).toBe('−$1,234');
    expect(showChange(5, null, 'both')).toBe('+$5.00');
    expect(showChange(null, null, 'both')).toBe('—');
    expect(showChange(5, null, 'pct')).toBe('—');
  });

  it("totals today's change against yesterday's value", () => {
    const t = dayTotal([{ value: 110, today: 10 }, { value: 90, today: -10 }, { value: 50, today: null }]);
    expect(t.usd).toBe(0);
    expect(t.pct).toBe(0);
    expect(dayTotal([{ value: 105, today: 5 }]).pct).toBeCloseTo(0.05);
    expect(dayTotal([{ value: 5, today: null }])).toEqual({ usd: null, pct: null });
  });
});
