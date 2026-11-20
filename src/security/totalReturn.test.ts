import { describe, expect, it } from 'vitest';
import { coversFundLife, fundAgeYears, labelYears, totalReturns, ychartsPctScale, type Dated } from './totalReturn';

describe('totalReturns (hand-worked)', () => {
  // 100 at the end of last year, 102 the day before the ex-date, 1.00 paid, price drops to 101, ends at 103
  const closes: Dated[] = [
    ['2025-12-31', 100],
    ['2026-03-30', 102],
    ['2026-03-31', 101], // ex-date: 1.00 per share
    ['2026-11-19', 103],
  ];
  const divs: Dated[] = [['2026-03-31', 1]];

  it('reinvests the distribution on its ex-date', () => {
    const ytd = totalReturns(closes, divs).find((r) => r.label === 'Year to date')!;
    // growth = 102/100 x (101 + 1)/102 x 103/101 = 1.04 x ... worked out: 1.02 x 1.0 x 1.0198019... = 1.0401980
    expect(ytd.total).toBeCloseTo((102 / 100) * (102 / 102) * (103 / 101) - 1, 10);
    expect(ytd.total).toBeCloseTo(0.040198, 5);
    expect(ytd.price).toBeCloseTo(0.03, 10); // price only: 103 / 100 - 1
    expect(ytd.from).toBe('2025-12-31');
  });

  it('leaves out a period the history does not reach', () => {
    const labels = totalReturns(closes, divs).map((r) => r.label);
    expect(labels).toEqual(['Year to date']); // starts 2025-12-31: no full year yet
  });

  it('ignores a distribution paid before the start', () => {
    const r = totalReturns(closes, [['2025-06-01', 5], ...divs]).find((x) => x.label === 'Year to date')!;
    expect(r.total).toBeCloseTo(0.040198, 5);
  });

  it('annualises three years', () => {
    const c: Dated[] = [['2023-11-19', 100], ['2024-11-19', 110], ['2025-11-19', 121], ['2026-11-19', 133.1]];
    const r = totalReturns(c, []).find((x) => x.label === '3 years (a year)')!;
    expect(r.total).toBeCloseTo(0.1, 10);
  });
});

describe('fund age and long figures', () => {
  it('reads years from labels', () => {
    expect(labelYears('3 years (a year)')).toBe(3);
    expect(labelYears('Sharpe ratio (3 years)')).toBe(3);
    expect(labelYears('Worst drop (5 years)')).toBe(5);
    expect(labelYears('1 year')).toBe(1);
    expect(labelYears('Net expense ratio')).toBeNull();
  });

  it('hides 3/5/10-year figures for a fund started 29 Dec 2023', () => {
    const age = fundAgeYears('2023-12-29', new Date('2026-11-20T12:00:00Z'))!;
    expect(age).toBeCloseTo(2.9, 1);
    expect(coversFundLife('1 year', age)).toBe(true);
    expect(coversFundLife('3 years (a year)', age)).toBe(false);
    expect(coversFundLife('10 years (a year)', age)).toBe(false);
    expect(coversFundLife('Net expense ratio', age)).toBe(true);
    expect(coversFundLife('3 years (a year)', null)).toBe(true); // no inception date: keep
  });
});

describe('ychartsPctScale', () => {
  it('Excel sends fractions: 0.0169 against a 1.69% expense ratio', () => {
    expect(ychartsPctScale('excel', 0.0169, 0.0169)).toEqual({ scale: 100, checked: true });
  });
  it('the API sends percent units', () => {
    expect(ychartsPctScale('api', 1.69, 0.0169)).toEqual({ scale: 1, checked: true });
  });
  it('the check wins over the source rule', () => {
    expect(ychartsPctScale('excel', 1.69, 0.0169)).toEqual({ scale: 1, checked: true });
  });
  it('falls back to the source rule without a second expense ratio', () => {
    expect(ychartsPctScale('excel', 0.0169, null)).toEqual({ scale: 100, checked: false });
    expect(ychartsPctScale('api', undefined, 0.01)).toEqual({ scale: 1, checked: false });
  });
});
