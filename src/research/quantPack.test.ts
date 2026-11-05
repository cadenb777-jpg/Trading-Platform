import { describe, expect, it } from 'vitest';
import { blendedRange, footballField, impliedPrice, quantile, summarise, type CompRow } from './comps';
import { irr, lbo, lboSensitivity, type LboInputs } from './lbo';
import { merger, mergerSensitivity, type MergerInputs } from './merger';
import { keyRateDurations, portfolioKeyRates, portfolioRisk, tent, KEY_RATES } from '../invest/bondRisk';
import { analyze } from '../invest/bonds';
import { heat, heatScale, heatStyle } from '../portfolio/heat';

const row = (o: Partial<CompRow>): CompRow => ({
  symbol: 'X', name: 'X', price: 40, shares: 10, marketCap: 400, enterpriseValue: 420, debt: 30, cash: 10, revenue: 100, ebitda: 25, netIncome: 10,
  equity: 50, eps: 1, evEbitda: 16.8, pe: 40, ps: 4, pb: 8, evSales: 4.2, revenueGrowth: 0.25, grossMargin: 0.4, operatingMargin: 0.2, netMargin: 0.1, fiscalYear: '2025-12-31', ...o,
});

describe('comparable companies', () => {
  it('quantiles match numpy (linear interpolation)', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile([4, 1, 3, 2], 0.5)).toBeCloseTo(2.5, 12);
    expect(quantile([null, 7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBeNull();
    const s = summarise([10, 12, 14, null, 20]);
    expect(s).toMatchObject({ n: 4, low: 10, median: 13, mean: 14, high: 20 });
  });

  it('implied value per share: EV multiples subtract net debt, equity multiples do not', () => {
    const t = row({});
    expect(impliedPrice(t, 'evEbitda', 10)).toBeCloseTo((10 * 25 - 30 + 10) / 10, 12); // 23
    expect(impliedPrice(t, 'evSales', 2)).toBeCloseTo((200 - 20) / 10, 12);
    expect(impliedPrice(t, 'pe', 15)).toBe(15);
    expect(impliedPrice(t, 'ps', 3)).toBeCloseTo(30, 12);
    expect(impliedPrice(t, 'pb', 2)).toBeCloseTo(10, 12);
    expect(impliedPrice(row({ ebitda: -5 }), 'evEbitda', 10)).toBeNull();
    expect(impliedPrice(t, 'pe', null)).toBeNull();
  });

  it('football field uses the peer quartiles and drops excluded peers', () => {
    const peers = [8, 10, 12, 14, 100].map((m, i) => row({ symbol: `P${i}`, evEbitda: m }));
    const field = footballField(row({}), peers);
    const ev = field.find((r) => r.key === 'evEbitda')!;
    expect(ev.peers).toBe(5);
    expect(ev.mid).toBeCloseTo((12 * 25 - 20) / 10, 12);
    expect(ev.low).toBeCloseTo((10 * 25 - 20) / 10, 12);
    expect(ev.high).toBeCloseTo((14 * 25 - 20) / 10, 12);
    const without = footballField(row({}), peers, new Set(['P4'])).find((r) => r.key === 'evEbitda')!;
    expect(without.peers).toBe(4);
    expect(without.mid).toBeCloseTo((11 * 25 - 20) / 10, 12);
    const all = blendedRange(field)!;
    expect(all.low).toBeLessThanOrEqual(all.mid);
    expect(all.mid).toBeLessThanOrEqual(all.high);
  });
});

const simple: LboInputs = {
  ebitda: 100, entryMultiple: 10, exitMultiple: 10, years: 1, growth: 0, daPct: 0, capexPct: 0, nwcPct: 0, taxRate: 0, feesPct: 0, sweepPct: 1,
  tranches: [{ name: 'Term loan', multiple: 5, rate: 0.1, amortization: 0, sweep: true }],
};

describe('LBO', () => {
  it('IRR of a textbook cash-flow stream (Brealey, Myers & Allen: -4,000, +2,000, +4,000 -> 28.08%)', () => {
    expect(irr([-4000, 2000, 4000])!).toBeCloseTo(0.2808, 4);
    expect(irr([-100, 0, 0, 0, 0, 250])!).toBeCloseTo(2.5 ** 0.2 - 1, 10); // 2.5x in 5 years = 20.11% a year
    expect(irr([100, 50])).toBeNull();
  });

  it('a hand-worked one-year deal: all cash flow repays 10% debt, so equity earns 10%', () => {
    const r = lbo(simple);
    expect(r.entryEv).toBe(1000);
    expect(r.equity).toBe(500);
    expect(r.years[0].interest).toBeCloseTo(50, 10);
    expect(r.years[0].sweep).toBeCloseTo(50, 10);
    expect(r.years[0].debt).toBeCloseTo(450, 10);
    expect(r.exitEquity).toBeCloseTo(550, 10);
    expect(r.moic).toBeCloseTo(1.1, 12);
    expect(r.irr!).toBeCloseTo(0.1, 8);
    const two = lbo({ ...simple, years: 2 }); // year 2: interest 45, debt 395, equity 605 = 1.21x
    expect(two.years[1].debt).toBeCloseTo(395, 10);
    expect(two.moic).toBeCloseTo(1.21, 12);
    expect(two.irr!).toBeCloseTo(0.1, 8);
  });

  it('taxes, fees, amortisation, unswept cash and growth', () => {
    const taxed = lbo({ ...simple, taxRate: 0.25 }); // pre-tax 50, tax 12.5, repay 37.5
    expect(taxed.years[0].taxes).toBeCloseTo(12.5, 10);
    expect(taxed.moic).toBeCloseTo(537.5 / 500, 12);
    const fees = lbo({ ...simple, feesPct: 0.02 });
    expect(fees.equity).toBeCloseTo(520, 10);
    const kept = lbo({ ...simple, sweepPct: 0 }); // cash builds up instead; same equity at exit
    expect(kept.years[0].cash).toBeCloseTo(50, 10);
    expect(kept.exitEquity).toBeCloseTo(550, 10);
    const amort = lbo({ ...simple, sweepPct: 0, tranches: [{ ...simple.tranches[0], amortization: 0.1 }] });
    expect(amort.years[0].mandatory).toBeCloseTo(50, 10);
    expect(amort.years[0].debt).toBeCloseTo(450, 10);
    expect(amort.years[0].cash).toBeCloseTo(0, 10);
    const grow = lbo({ ...simple, growth: 0.1, daPct: 0.2, capexPct: 0.2, nwcPct: 0.5 }); // EBITDA 110: D&A 22, interest 50, NWC 5
    const y = grow.years[0];
    expect(y.ebitda).toBeCloseTo(110, 10);
    expect(y.netIncome).toBeCloseTo(110 - 22 - 50, 10);
    expect(y.freeCashFlow).toBeCloseTo(38 + 22 - 22 - 5, 10);
    expect(grow.exitEv).toBeCloseTo(1100, 10);
  });

  it('a partial sweep uses only that year’s spare cash (reviewer case: 50%, year 2 sweeps 26.25)', () => {
    const r = lbo({ ...simple, years: 2, sweepPct: 0.5 });
    // year 1: free cash 50, sweep 25, debt 475, cash 25; year 2: interest 47.5, free cash 52.5, sweep 26.25
    expect(r.years[0].sweep).toBeCloseTo(25, 10);
    expect(r.years[1].sweep).toBeCloseTo(26.25, 10);
    expect(r.years[1].debt).toBeCloseTo(448.75, 10);
    expect(r.years[1].cash).toBeCloseTo(51.25, 10);
  });

  it('sensitivity: paying more lowers the IRR, selling higher raises it', () => {
    const grid = lboSensitivity({ ...simple, years: 5 }, [9, 10, 11], [9, 10, 11]);
    expect(grid[1][1]).toBeCloseTo(lbo({ ...simple, years: 5 }).irr!, 12);
    expect(grid[0][1]!).toBeGreaterThan(grid[2][1]!);
    expect(grid[1][2]!).toBeGreaterThan(grid[1][0]!);
  });
});

// Buyer: earnings 100, 50 shares at $40 (EPS 2, P/E 20). Target: earnings 20, 10 shares at $30 (P/E 15).
const deal: MergerInputs = { acquirerPrice: 40, acquirerShares: 50, acquirerNetIncome: 100, targetPrice: 30, targetShares: 10, targetNetIncome: 20, premium: 0, cashShare: 0, debtRate: 0.06, taxRate: 0.25, synergies: 0 };

describe('merger model', () => {
  it('all-stock purchase of a lower-P/E target is accretive (textbook rule)', () => {
    const r = merger(deal);
    expect(r.newShares).toBeCloseTo(7.5, 12); // $300 / $40
    expect(r.proFormaEps).toBeCloseTo(120 / 57.5, 12);
    expect(r.accretion).toBeCloseTo(120 / 57.5 / 2 - 1, 12); // +4.35%
    expect(r.accretion).toBeCloseTo(0.0435, 4);
    expect(r.targetOwnership).toBeCloseTo(7.5 / 57.5, 12);
  });

  it('cash at a premium, synergies and the breakeven', () => {
    const r = merger({ ...deal, premium: 0.5, cashShare: 1, synergies: 4 });
    // price $45 x 10 = 450 borrowed at 6% after 25% tax = 20.25; earnings 100 + 20 + 3 - 20.25 = 102.75 on 50 shares
    expect(r.financingCost).toBeCloseTo(20.25, 10);
    expect(r.proFormaEps).toBeCloseTo(102.75 / 50, 12);
    const even = merger({ ...deal, premium: 0.5, cashShare: 1, synergies: r.breakevenSynergies });
    expect(even.accretion).toBeCloseTo(0, 12);
    expect(r.breakevenSynergies).toBeCloseTo((2 * 50 - 120 + 20.25) / 0.75, 10);
  });

  it('sensitivity grid', () => {
    const grid = mergerSensitivity(deal, [0, 0.5], [0, 1]);
    expect(grid[0][0]).toBeCloseTo(merger(deal).accretion, 12);
    expect(grid[1][0]).toBeLessThan(grid[0][0]);
  });
});

describe('bond portfolio and key rates', () => {
  const curve = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30].map((years, i) => ({ years, yield: 0.04 + i * 0.001 }));

  it('tents add up to a parallel shift', () => {
    for (const t of [0.1, 0.25, 0.8, 4, 9.9, 15, 30, 40]) expect(KEY_RATES.reduce((s, _, k) => s + tent(KEY_RATES, k, t), 0)).toBeCloseTo(1, 12);
    expect(tent(KEY_RATES, 5, 5)).toBe(1);
    expect(tent(KEY_RATES, 5, 4)).toBeCloseTo(0.5, 12);
  });

  it('a 5-year zero has all its key-rate duration at 5 years: about maturity / (1 + y/2)', () => {
    const r = keyRateDurations({ name: 'Z', coupon: 0, years: 5, frequency: 0, face: 1000, yield: 0.05 }, curve);
    const k5 = r.keys.indexOf(5);
    r.durations.forEach((d, k) => (k === k5 ? expect(d).toBeCloseTo(5 / (1 + (0.045 + r.spread) / 2), 3) : expect(Math.abs(d)).toBeLessThan(1e-6)));
    expect(r.effective).toBeCloseTo(analyze({ coupon: 0, years: 5, frequency: 0 }, 0.05).modifiedDuration, 3);
  });

  it('key-rate durations add up to the effective duration, which matches modified duration', () => {
    const bond = { name: '10y', coupon: 0.045, years: 10, frequency: 2, face: 10000, yield: 0.047 };
    const r = keyRateDurations(bond, curve);
    expect(r.durations.reduce((a, b) => a + b, 0)).toBeCloseTo(r.effective, 4);
    expect(r.effective).toBeCloseTo(analyze(bond, 0.047).modifiedDuration, 1);
  });

  it('portfolio duration is the value-weighted average; DV01 adds up in dollars', () => {
    const bonds = [
      { name: 'A', coupon: 0.05, years: 2, frequency: 2, face: 10000, yield: 0.05 },
      { name: 'B', coupon: 0.05, years: 10, frequency: 2, face: 10000, yield: 0.05 },
    ];
    const r = portfolioRisk(bonds);
    const a = analyze(bonds[0], 0.05);
    const b = analyze(bonds[1], 0.05);
    expect(r.marketValue).toBeCloseTo(20000, 6); // par bonds on a coupon date
    expect(r.modifiedDuration).toBeCloseTo((a.modifiedDuration + b.modifiedDuration) / 2, 10);
    expect(r.dv01).toBeCloseTo(10000 * (a.modifiedDuration + b.modifiedDuration) * 0.0001, 8);
    const k = portfolioKeyRates(bonds, curve);
    expect(k.durations.reduce((s, x) => s + x, 0)).toBeCloseTo(k.effective, 4);
  });
});

describe('heat map shading', () => {
  it('scales and caps', () => {
    expect(heat(0.05, 0.1)).toEqual({ tone: 'up', strength: 35 });
    expect(heat(-0.5, 0.1)).toEqual({ tone: 'down', strength: 70 });
    expect(heat(null, 0.1)).toEqual({ tone: '', strength: 0 });
    expect(heatStyle(0.1, 0.1)).toContain('var(--up) 70%');
    expect(heatStyle(0.1, 0.1, true)).toContain('var(--down)');
    expect(heatScale([0.01, -0.02, 0.03, 0.5])).toBe(0.03);
  });
});
