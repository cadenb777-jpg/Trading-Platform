import { describe, expect, it } from 'vitest';
import type { CompRow } from '../research/comps';
import { linearFit, peerStats, peerWords } from './peers';

const row = (symbol: string, o: Partial<CompRow>): CompRow =>
  ({ symbol, name: symbol, price: 1, shares: 1, marketCap: 1, enterpriseValue: 1, debt: 0, cash: 0, revenue: 1, ebitda: 1, netIncome: 1, equity: 1, eps: 1, evEbitda: null, pe: null, ps: null, pb: null, evSales: null, revenueGrowth: null, grossMargin: null, operatingMargin: null, netMargin: null, fiscalYear: '2026', ...o }) as CompRow;

describe('peers', () => {
  const peers = [row('A', { pe: 20, revenueGrowth: 0.1, operatingMargin: 0.2 }), row('B', { pe: 30, revenueGrowth: 0.05, operatingMargin: 0.3 }), row('C', { pe: -5, revenueGrowth: 0.2, operatingMargin: 0.1 }), row('D', { pe: 40 })];
  it('takes medians and averages, leaving loss-making multiples out', () => {
    expect(peerStats(peers, 'pe')).toEqual({ median: 30, mean: 30, n: 3 });
    expect(peerStats(peers, 'revenueGrowth').median).toBeCloseTo(0.1);
    expect(peerStats([], 'pe')).toEqual({ median: null, mean: null, n: 0 });
  });
  it('fits a line', () => {
    const f = linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])!;
    expect(f.a).toBeCloseTo(1);
    expect(f.b).toBeCloseTo(2);
    expect(f.r2).toBeCloseTo(1);
    expect(linearFit([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }])).toBeNull();
    expect(linearFit([{ x: 1, y: 1 }])).toBeNull();
  });
  it('says how the company compares', () => {
    expect(peerWords(row('Z', { pe: 36, revenueGrowth: 0.06, operatingMargin: 0.31 }), peers)).toBe(
      'Z trades at 36.0× earnings against a peer median of 30.0× (20% above). Sales grew 6.0% against 10.0% for the median peer, with an operating margin of 31.0% against 20.0%.',
    );
  });
});
