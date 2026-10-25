import { describe, expect, it } from 'vitest';
import { allocation, combineHoldings, combinedValue, dividendPayload, myPortfolios, todayChange } from './account';
import { isMine, type Portfolio } from './types';

const base = { benchmark: 'SPY', rebalance: 'none' as const };
const schwab: Portfolio = {
  ...base,
  name: 'Schwab IRA',
  mode: 'shares',
  mine: true,
  holdings: [
    { symbol: 'SCHD', shares: 100, cost: 2500, weight: 0, assetClass: 'US stocks', kind: 'security' },
    { symbol: 'KO', shares: 10, weight: 0, assetClass: 'US stocks', kind: 'security' },
    { symbol: 'CASH', amount: 1000, weight: 0, assetClass: 'Cash', kind: 'cash' },
  ],
};
const webull: Portfolio = {
  ...base,
  name: 'Webull 5MV2',
  mode: 'shares',
  webullAccount: '246',
  holdings: [
    { symbol: 'schd ', shares: 40, cost: 1100, weight: 0, assetClass: 'US stocks', kind: 'security' },
    { symbol: 'CASH', name: 'Webull cash', amount: 300, weight: 0, assetClass: 'Cash', kind: 'cash' },
  ],
};
const client: Portfolio = { ...base, name: 'Smith family', mode: 'shares', holdings: [{ symbol: 'SCHD', shares: 999, weight: 0, assetClass: 'US stocks' }] };
const model: Portfolio = { ...base, name: 'Model 60/40', mode: 'weight', mine: true, holdings: [{ symbol: 'VTI', weight: 60, assetClass: 'US stocks' }] };

describe('the mine flag', () => {
  it('is set explicitly, or by default for live Webull syncs only', () => {
    expect(isMine(schwab)).toBe(true);
    expect(isMine(webull)).toBe(true);
    expect(isMine({ ...webull, webullEnv: 'test' })).toBe(false);
    expect(isMine({ ...webull, mine: false })).toBe(false);
    expect(isMine(client)).toBe(false);
  });

  it('keeps client and percent-only portfolios out of the account', () => {
    expect(myPortfolios([schwab, client, webull, model]).map((p) => p.name)).toEqual(['Schwab IRA', 'Webull 5MV2']);
  });
});

describe('combineHoldings', () => {
  const rows = combineHoldings([schwab, webull]);
  const by = (s: string) => rows.find((r) => r.symbol === s)!;

  it('merges the same symbol and all cash across accounts, keeping each part', () => {
    expect(rows.map((r) => r.symbol)).toEqual(['SCHD', 'KO', 'CASH']);
    expect(by('SCHD')).toMatchObject({ shares: 140, cost: 3600 });
    expect(by('SCHD').parts).toEqual([
      { account: 'Schwab IRA', shares: 100, amount: 0, cost: 2500 },
      { account: 'Webull 5MV2', shares: 40, amount: 0, cost: 1100 },
    ]);
    expect(by('CASH')).toMatchObject({ amount: 1300, shares: 0, kind: 'cash' });
    expect(by('KO').cost).toBeNull();
  });

  it('sends only share holdings to the dividends request', () => {
    expect(dividendPayload(rows)).toEqual([
      { symbol: 'SCHD', shares: 140, costBasis: 3600 },
      { symbol: 'KO', shares: 10, costBasis: undefined },
    ]);
  });

  it('values holdings and today’s change', () => {
    expect(combinedValue(by('SCHD'), 28)).toBe(3920);
    expect(combinedValue(by('SCHD'), null)).toBeNull();
    expect(combinedValue(by('CASH'), null)).toBe(1300);
    expect(todayChange(110, 0.1)).toBeCloseTo(10);
    expect(todayChange(110, null)).toBeNull();
  });

  it('groups values for allocation, largest first', () => {
    const a = allocation(rows, (r) => r.assetClass, (r) => combinedValue(r, r.symbol === 'SCHD' ? 28 : 70));
    expect(a.map((x) => x.label)).toEqual(['US stocks', 'Cash']);
    expect(a[0].value).toBe(3920 + 700);
    expect(a[0].weight + a[1].weight).toBeCloseTo(1);
  });
});
