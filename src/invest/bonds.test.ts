import { describe, expect, it } from 'vitest';
import { accruedInterest, analyze, buildLadder, calculatorProblems, isRealisticYield, ladderProblem, interpolateCurve, labelYears, priceChangeEstimate, priceFromYield, taxEquivalentYield, yieldFromPrice } from './bonds';

describe('bond maths', () => {
  it('prices a bond at par when the coupon equals the yield', () => {
    expect(priceFromYield({ coupon: 0.05, years: 10, frequency: 2 }, 0.05)).toBeCloseTo(100, 8);
  });

  it('matches textbook prices', () => {
    // 10-year 5% semi-annual bond yielding 6%: 92.56
    expect(priceFromYield({ coupon: 0.05, years: 10, frequency: 2 }, 0.06)).toBeCloseTo(92.5613, 3);
    // 10-year zero yielding 4% (semi-annual): 100 / 1.02^20 = 67.297
    expect(priceFromYield({ coupon: 0, years: 10, frequency: 2 }, 0.04)).toBeCloseTo(67.2971, 3);
  });

  it('solves the yield back from the price', () => {
    const b = { coupon: 0.0425, years: 7.3, frequency: 2 };
    const price = priceFromYield(b, 0.0461);
    expect(yieldFromPrice(b, price)).toBeCloseTo(0.0461, 8);
  });

  it('computes accrued interest between coupons', () => {
    // 9.75 years left = 0.25 of a year (half a period) since the last coupon on a semi-annual 6% bond: 1.50
    expect(accruedInterest({ coupon: 0.06, years: 9.75, frequency: 2 })).toBeCloseTo(1.5, 8);
    expect(accruedInterest({ coupon: 0.06, years: 10, frequency: 2 })).toBeCloseTo(0, 8);
  });

  it('computes duration and convexity', () => {
    const a = analyze({ coupon: 0.05, years: 10, frequency: 2 }, 0.05);
    expect(a.macaulayDuration).toBeCloseTo(7.9894, 3);
    expect(a.modifiedDuration).toBeCloseTo(7.7946, 3);
    expect(a.convexity).toBeCloseTo(73.63, 1);
    const zero = analyze({ coupon: 0, years: 5, frequency: 2 }, 0.04);
    expect(zero.macaulayDuration).toBeCloseTo(5, 8);
    // duration + convexity estimate is close to the real repricing for a 1% move
    const est = priceChangeEstimate(a, 0.01);
    const real = priceFromYield({ coupon: 0.05, years: 10, frequency: 2 }, 0.06) / 100 - 1;
    expect(est).toBeCloseTo(real, 3);
  });

  it('computes tax-equivalent yields', () => {
    expect(taxEquivalentYield(0.035, 0.35)).toBeCloseTo(0.053846, 5);
    expect(taxEquivalentYield(0.035, 0.35, 0.05)).toBeCloseTo(0.035 / (1 - 0.35 - 0.05 * 0.65), 8);
  });

  it('interpolates the curve and builds a ladder', () => {
    const curve = ['1Y', '2Y', '5Y', '10Y'].map((l, i) => ({ years: labelYears(l)!, yield: [0.04, 0.038, 0.039, 0.042][i] }));
    expect(labelYears('3M')).toBeCloseTo(0.25, 8);
    expect(interpolateCurve(curve, 3.5)).toBeCloseTo(0.0385, 8);
    expect(interpolateCurve(curve, 30)).toBe(0.042);
    const ladder = buildLadder(100000, 1, 5, curve);
    expect(ladder).toHaveLength(5);
    expect(ladder[0].amount).toBe(20000);
    expect(ladder[2].yield).toBeCloseTo(0.03833, 4);
  });
});

describe('bond input checks', () => {
  const ok = { coupon: 0.045, years: 10, mode: 'price' as const, price: 98, yield: 0.047 };
  it('accepts normal inputs', () => {
    expect(calculatorProblems(ok)).toEqual([]);
  });
  it('rejects impossible years, prices and coupons', () => {
    expect(calculatorProblems({ ...ok, years: 0 })).toHaveLength(1);
    expect(calculatorProblems({ ...ok, years: -1 })).toHaveLength(1);
    expect(calculatorProblems({ ...ok, price: 0 })).toHaveLength(1);
    expect(calculatorProblems({ ...ok, price: 1e6 })).toHaveLength(1);
    expect(calculatorProblems({ ...ok, coupon: 10 })).toHaveLength(1);
    expect(calculatorProblems({ ...ok, coupon: -0.01 })).toHaveLength(1);
    expect(calculatorProblems({ ...ok, years: NaN })).toHaveLength(1);
  });
  it('only checks the field the user is solving from', () => {
    expect(calculatorProblems({ ...ok, mode: 'yield', price: 0 })).toEqual([]);
    expect(calculatorProblems({ ...ok, mode: 'yield', yield: 2 })).toHaveLength(1);
  });
  it('treats the solver limits as not a real yield', () => {
    expect(isRealisticYield(0.05)).toBe(true);
    expect(isRealisticYield(2)).toBe(false);
    expect(isRealisticYield(-0.73)).toBe(false);
    expect(isRealisticYield(NaN)).toBe(false);
  });
  it('explains bad ladder plans', () => {
    expect(ladderProblem(100000, 1, 5)).toBe('');
    expect(ladderProblem(-1000, 1, 5)).toMatch(/amount/);
    expect(ladderProblem(100000, 10, 5)).toMatch(/earlier/);
    expect(ladderProblem(100000, 1, 40)).toMatch(/30 years/);
  });
});
