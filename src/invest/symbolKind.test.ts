import { describe, expect, it } from 'vitest';
import { CATALOG_ETFS } from './catalog';
import { symbolKind } from './symbolKind';

describe('symbolKind', () => {
  it('keeps stocks with "Trust" in their names as stocks', () => {
    expect(symbolKind('NTRS', 'EQUITY', 'COE')).toBe('stock'); // Northern Trust
    expect(symbolKind('DLR', 'EQUITY', 'COE')).toBe('stock'); // Digital Realty Trust
    expect(symbolKind('NTRS', 'EQUITY')).toBe('stock'); // older helper: not in the catalog's ETF groups
    expect(symbolKind('DLR', 'EQUITY')).toBe('stock');
  });

  it("uses Schwab's assetSubType when the helper sends it", () => {
    expect(symbolKind('SPY', 'EQUITY', 'ETF')).toBe('fund');
  });

  it("falls back to the catalog's ETF groups without a subtype", () => {
    expect(CATALOG_ETFS.has('XLF')).toBe(true);
    expect(symbolKind('XLF', 'EQUITY')).toBe('fund');
    expect(symbolKind('XLF')).toBe('fund');
  });

  it('treats an unknown symbol with no subtype as a stock', () => {
    expect(symbolKind('ZZZQ', 'EQUITY')).toBe('stock');
    expect(symbolKind('ZZZQ')).toBe('stock');
  });

  it('indexes and futures', () => {
    expect(symbolKind('$SPX')).toBe('index');
    expect(symbolKind('/GC')).toBe('future');
    expect(symbolKind('VFIAX', 'MUTUAL_FUND')).toBe('fund');
  });
});
