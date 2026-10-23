import { describe, expect, it } from 'vitest';
import { holdingStats, mapColumns, parseCsv, parseMoney, rowsToHoldings, totals } from './holdings';
import { searchCatalog } from './catalog';

describe('alternative holdings', () => {
  it('computes unfunded, TVPI and DPI', () => {
    const s = holdingStats({ commitment: 250000, contributed: 150000, distributed: 30000, value: 160000 });
    expect(s.unfunded).toBe(100000);
    expect(s.tvpi).toBeCloseTo(190000 / 150000, 10);
    expect(s.dpi).toBeCloseTo(0.2, 10);
    expect(s.gain).toBe(40000);
    expect(totals([{ fund: 'A', commitment: 100, contributed: 50, distributed: 0, value: 60 }, { fund: 'B', commitment: null, contributed: 100, distributed: 10, value: 100 }]).tvpi).toBeCloseTo(170 / 150, 10);
  });

  it('reads money in statement formats', () => {
    expect(parseMoney('$1,234.50')).toBe(1234.5);
    expect(parseMoney('(2,000)')).toBe(-2000);
    expect(parseMoney('1.5M')).toBe(1500000);
    expect(parseMoney('—')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });

  it('parses CSV with quotes', () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,2,3\n')).toEqual([['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  });

  it('imports an iCapital-style export', () => {
    const csv = [
      'Account Summary,,,,,,',
      'Fund Name,Investor,Commitment,Paid-In Capital,Unfunded Commitment,Distributions,NAV,NAV Date',
      'Blackstone Private Credit Fund,Smith Trust,"$250,000","$250,000",$0,"$18,250.00","$262,100.00",2026-09-30',
      'KKR Private Equity Conglomerate,Smith Trust,"100,000","60,000","40,000",0,"64,500",2026-09-30',
      'Total,,,,,,,',
    ].join('\n');
    const cols = mapColumns(parseCsv(csv)[1]);
    expect(cols).toMatchObject({ fund: 0, account: 1, commitment: 2, contributed: 3, distributed: 5, value: 6, valueDate: 7 });
    const { holdings } = rowsToHoldings(parseCsv(csv));
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({ fund: 'Blackstone Private Credit Fund', commitment: 250000, contributed: 250000, distributed: 18250, value: 262100, account: 'Smith Trust' });
    expect(holdingStats(holdings[1]).unfunded).toBe(40000);
  });
});

describe('investments search', () => {
  it('finds symbols and private funds', () => {
    const r = searchCatalog('blue owl');
    expect(r.funds.map((f) => f.short)).toContain('OCIC');
    expect(r.symbols.map((s) => s.symbol)).toContain('OWL');
    expect(searchCatalog('tlt').symbols[0].symbol).toBe('TLT');
    expect(searchCatalog('').funds).toHaveLength(0);
  });
});
