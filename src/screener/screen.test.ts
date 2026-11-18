import { describe, expect, it } from 'vitest';
import { median, passes, runScreen, type ScreenRow } from './screen';

const row = (symbol: string, sector: string, o: Partial<ScreenRow>): ScreenRow => ({ symbol, name: symbol, sector, price: 100, change: 0, m1: 0, m3: 0, ytd: 0, y1: 0, pe: null, divYield: null, offHigh: 0, ...o });
const rows = [
  row('A', 'Software', { ytd: 0.2, pe: 30, offHigh: -0.02 }),
  row('B', 'Software', { ytd: -0.25, pe: 12, divYield: 0.03, offHigh: -0.4 }),
  row('C', 'Consumer', { ytd: 0.05, pe: 18, divYield: 0.02, offHigh: -0.1 }),
  row('D', 'Consumer', { ytd: null, pe: null }),
];

describe('screener', () => {
  it('reads percent fields in percent and never passes a missing value', () => {
    expect(passes(rows[0], { field: 'ytd', op: '>', a: 10 })).toBe(true);
    expect(passes(rows[1], { field: 'ytd', op: '>', a: 10 })).toBe(false);
    expect(passes(rows[3], { field: 'ytd', op: '<', a: 100 })).toBe(false);
    expect(passes(rows[2], { field: 'pe', op: 'between', a: 20, b: 15 })).toBe(true); // bounds in either order
  });
  it('keeps running counts and filters by sector first', () => {
    const r = runScreen(rows, [{ field: 'pe', op: '<', a: 20 }, { field: 'divYield', op: '>', a: 2.5 }]);
    expect(r).toMatchObject({ counts: [2, 1], universe: 4 });
    expect(r.matches.map((x) => x.symbol)).toEqual(['B']);
    expect(runScreen(rows, [], ['Consumer']).matches.map((x) => x.symbol)).toEqual(['C', 'D']);
  });
  it('takes medians', () => {
    expect(median(rows, 'pe')).toBe(18);
    expect(median([], 'pe')).toBeNull();
  });
});
