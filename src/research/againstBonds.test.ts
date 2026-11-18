import { describe, expect, it } from 'vitest';
import { againstBonds, againstWords, realYieldPlace, type RealYield } from './againstBonds';

// FRED DFII10, checked live 2026-11-18: 2.92% on 2026-11-16, at or above 99.7% of the 5,972 days since 2003-01-02
const real: RealYield = { value: 2.92, date: '2026-11-16', series: 'DFII10', since: '2003-01-02', percentile: 99.69859 };

describe('Earnings yield against the real bond yield', () => {
  it('a P/E of 33.1: earns 3.0%, 0.1 points above the real yield', () => {
    const x = againstBonds(33.1, real)!;
    // 1 / 33.1 = 3.021%; 3.021% - 2.92% = 0.101 points
    expect(x.earningsYield).toBeCloseTo(0.030211, 5);
    expect(x.gap).toBe(0.001); // rounded to a tenth of a point: words, sign and headline agree
    expect(againstWords(x, real)).toBe(
      'At today’s price the company earns 3.0% of its price a year (P/E 33.1 on the last twelve months). A 10-year inflation-protected Treasury pays 2.92% a year above inflation (Nov 16, 2026), higher than on 99% of days since 2003. The stock earns 0.1 points more. If its earnings only keep pace with inflation, that gap is roughly the extra real return it offers for its extra risk; growth above inflation adds to it.',
    );
  });

  it('a P/E of 50 earns less than the safe bond', () => {
    const x = againstBonds(50, real)!; // 2.0% - 2.92% = -0.92 points
    expect(againstWords(x, real)).toMatch(/The stock earns 0\.9 points less, so its price relies on earnings growing faster than inflation to beat the safe bond\.$/);
  });

  it('a gap that rounds to zero, a negative real yield, never "100% of days"', () => {
    const even = againstBonds(34.2, real)!; // 2.924% - 2.92%
    expect(even.gap).toBe(0);
    expect(againstWords(even, real)).toMatch(/The stock earns about the same as the safe bond/);
    const neg = { ...real, value: -0.8, percentile: 3 };
    expect(againstWords(againstBonds(20, neg)!, neg)).toMatch(/pays 0\.80% a year less than inflation \(Nov 16, 2026\), lower than on 97% of days since 2003: a real loss for the safe bond\./);
    expect(realYieldPlace({ ...real, percentile: 100 })).toBe(', higher than on 99% of days since 2003');
  });

  it('no earnings, no comparison; places in the range', () => {
    expect(againstBonds(-12, real)).toBeNull();
    expect(againstBonds(null, real)).toBeNull();
    expect(againstBonds(0, real)).toBeNull();
    expect(realYieldPlace({ ...real, percentile: 4.2 })).toBe(', lower than on 95% of days since 2003');
    expect(realYieldPlace({ ...real, percentile: 50 })).toBe(', in the middle of its range since 2003');
    expect(realYieldPlace({ value: 2, date: '2026-11-16', series: 'DFII10' })).toBe('');
  });
});
