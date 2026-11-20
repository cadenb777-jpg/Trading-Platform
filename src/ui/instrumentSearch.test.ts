import { describe, expect, it } from 'vitest';
import { hrefFor, isCusip, localHits, mergeHits, schwabHits } from './instrumentSearch';

describe('research search', () => {
  it('opens each kind where it lives', () => {
    expect(hrefFor({ kind: 'stock', id: 'AAPL', label: '', sub: '' })).toBe('#sec/AAPL');
    expect(hrefFor({ kind: 'mutual_fund', id: 'VFIAX', label: '', sub: '' })).toBe('#sec/VFIAX');
    expect(hrefFor({ kind: 'bond', id: '91282CLW9', label: '', sub: '' })).toBe('#invest/bonds/lookup/91282CLW9');
    expect(hrefFor({ kind: 'alt', id: 'breit', label: '', sub: '' })).toBe('#invest/alts/fund/breit');
    expect(hrefFor({ kind: 'alt', id: 'search', label: '', sub: '', query: 'apollo credit' })).toBe('#invest/alts/search/apollo%20credit');
  });
  it('knows a CUSIP and the private-fund directory without asking Schwab', () => {
    expect(isCusip('91282clw9')).toBe(true);
    expect(isCusip('AAPL')).toBe(false);
    expect(localHits('91282CLW9')[0].kind).toBe('bond');
    expect(localHits('blackstone').some((x) => x.kind === 'alt' && x.id === 'breit')).toBe(true);
  });
  it('labels Schwab results by kind (old helpers send only the asset type) and groups them', () => {
    const remote = schwabHits([
      { symbol: 'AAPL', name: 'APPLE INC', assetType: 'EQUITY' },
      { symbol: 'VFIAX', name: 'VANGUARD 500 INDEX ADMIRAL', assetType: 'MUTUAL_FUND' },
      { symbol: 'VOO', name: 'VANGUARD S&P 500 ETF', assetType: 'EQUITY', kind: 'etf' },
    ]);
    expect(remote.map((x) => x.kind)).toEqual(['stock', 'mutual_fund', 'etf']);
    expect(mergeHits([], remote, 'all').map((g) => g.kind)).toEqual(['stock', 'etf', 'mutual_fund']);
    expect(mergeHits([], remote, 'mutual_fund').map((g) => g.hits.map((x) => x.id))).toEqual([['VFIAX']]);
  });
});

import { looksLikeTicker } from './instrumentSearch';
describe('an exact ticker always comes first', () => {
  it('offers "Open QYLD" before anything else, replaced by Schwab’s own result when it comes', () => {
    expect(looksLikeTicker('qyld')).toBe(true);
    expect(looksLikeTicker('BRK.B')).toBe(true);
    expect(looksLikeTicker('bank of america')).toBe(false);
    const local = localHits('QYLD');
    expect(local[0]).toMatchObject({ kind: 'ticker', id: 'QYLD' });
    expect(mergeHits(local, [], 'all')[0].hits[0].id).toBe('QYLD');
    const withSchwab = mergeHits(local, schwabHits([{ symbol: 'QYLD', name: 'GLOBAL X NASDAQ 100 COVERED CALL ETF', assetType: 'ETF' }]), 'all');
    expect(withSchwab.map((g) => g.kind)).toEqual(['etf', 'alt']);
    expect(hrefFor(local[0])).toBe('#sec/QYLD');
  });
});
