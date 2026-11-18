import { describe, expect, it } from 'vitest';
import { bucketKey, lastDays, priceCsv, priceRows, summarise } from './priceHistory';

const day = (iso: string) => Date.parse(`${iso}T21:00:00Z`) / 1000;
const bar = (iso: string, close: number, volume = 100) => ({ time: day(iso), open: close - 1, high: close + 1, low: close - 2, close, volume });
// Mon 2 Nov .. Fri 13 Nov 2026 (two weeks), then Mon 30 Nov and Tue 1 Dec
const bars = [
  bar('2026-11-02', 10), bar('2026-11-03', 11), bar('2026-11-04', 12), bar('2026-11-05', 11), bar('2026-11-06', 13),
  bar('2026-11-09', 14), bar('2026-11-10', 12), bar('2026-11-13', 15),
  bar('2026-11-30', 16), bar('2026-12-01', 18),
];

describe('historical prices', () => {
  it('buckets days into ISO weeks and months', () => {
    expect(bucketKey(day('2026-11-06'), 'weekly')).toBe('2026-11-02');
    expect(bucketKey(day('2026-11-08'), 'weekly')).toBe('2026-11-02'); // Sunday belongs to the week before
    expect(bucketKey(day('2026-12-01'), 'monthly')).toBe('2026-12');
  });
  it('folds daily bars into weeks with high, low, volume and change', () => {
    const w = priceRows(bars, 'weekly');
    expect(w.map((r) => r.close)).toEqual([13, 15, 18]);
    expect(w[0]).toMatchObject({ open: 9, high: 14, low: 8, volume: 500, change: null });
    expect(w[1].change).toBeCloseTo(15 / 13 - 1);
    expect(priceRows(bars, 'monthly').map((r) => r.close)).toEqual([16, 18]);
    expect(priceRows(bars, 'daily')).toHaveLength(10);
  });
  it('summarises the rows shown and keeps a window', () => {
    const d = priceRows(bars, 'daily');
    const s = summarise(d)!;
    expect(s.high).toEqual({ value: 18, time: day('2026-12-01') });
    expect(s.low).toEqual({ value: 10, time: day('2026-11-02') });
    expect(s.average).toBeCloseTo(13.2);
    expect(s.change).toBeCloseTo(18 / 9 - 1); // first open 9 to last close 18
    expect(lastDays(d, 7).map((r) => r.close)).toEqual([16, 18]);
    expect(summarise([])).toBeNull();
  });
  it('writes CSV newest first', () => {
    const csv = priceCsv('AAPL', priceRows(bars.slice(0, 2), 'daily'));
    expect(csv.split('\n').slice(1, 4)).toEqual(['Date,Open,High,Low,Close,Change %,Volume', '2026-11-03,10,12,9,11,10.00,100', '2026-11-02,9,11,8,10,,100']);
  });
});
