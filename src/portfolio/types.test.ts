import { describe, expect, it } from 'vitest';
import { analysisSymbol, holdingsPayload, positions, unpricedSymbols, type Portfolio } from './types';

const base: Omit<Portfolio, 'holdings' | 'mode'> = { name: 'Test', benchmark: 'SPY', rebalance: 'quarterly' };

describe('portfolio positions', () => {
  it('values shares at live prices, cash and alternatives at their amounts', () => {
    const p: Portfolio = {
      ...base,
      mode: 'shares',
      holdings: [
        { symbol: 'VTI', shares: 100, weight: 0, assetClass: 'US stocks', kind: 'security' },
        { symbol: 'CASH', amount: 5000, weight: 0, assetClass: 'Cash', kind: 'cash' },
        { symbol: 'BCRED', amount: 25000, weight: 0, assetClass: 'Private credit', kind: 'alt' },
      ],
    };
    const { rows, total } = positions(p, { VTI: 300 });
    expect(total).toBe(60000);
    expect(rows.map((r) => r.weight)).toEqual([0.5, 5000 / 60000, 25000 / 60000]);
    // Cash and the alternative are modelled with their stand-ins; weights are percentages.
    expect(holdingsPayload(p, { VTI: 300 })).toEqual([
      { symbol: 'VTI', weight: 50 },
      { symbol: 'BIL', weight: +((5000 / 60000) * 100).toFixed(4) },
      { symbol: 'BIZD', weight: +((25000 / 60000) * 100).toFixed(4) },
    ]);
  });

  it('refuses to analyse shares without prices instead of treating them as cash', () => {
    const p: Portfolio = { ...base, mode: 'shares', holdings: [{ symbol: 'TSLA', shares: 10, weight: 0, assetClass: 'US stocks' }, { symbol: 'CASH', amount: 5000, weight: 0, assetClass: 'Cash', kind: 'cash' }] };
    expect(unpricedSymbols(p, {})).toEqual(['TSLA']);
    expect(() => holdingsPayload(p, {})).toThrow(/No live price for TSLA/);
  });

  it('merges holdings that share a stand-in and uses percent weights in percent mode', () => {
    const p: Portfolio = {
      ...base,
      mode: 'weight',
      holdings: [
        { symbol: 'BCRED', weight: 10, assetClass: 'Private credit', kind: 'alt' },
        { symbol: 'OCIC', weight: 10, assetClass: 'Private credit', kind: 'alt' },
        { symbol: 'VTI', weight: 80, assetClass: 'US stocks' },
      ],
    };
    expect(holdingsPayload(p)).toEqual([
      { symbol: 'BIZD', weight: 20 },
      { symbol: 'VTI', weight: 80 },
    ]);
    expect(analysisSymbol({ symbol: 'X', weight: 0, assetClass: 'Private equity', kind: 'alt', proxy: 'psp ' })).toBe('PSP');
  });
});
