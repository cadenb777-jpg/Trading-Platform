import { describe, expect, it } from 'vitest';
import { percentileNow, regime, sparkPoints, valueAgo, type Point } from './monitor';

const series = (vals: number[], start = '2020-01-01'): Point[] =>
  vals.map((v, i) => ({ time: new Date(Date.parse(`${start}T00:00:00Z`) + i * 30 * 86400000).toISOString().slice(0, 10), value: v }));

describe('macro monitor maths', () => {
  it('ranks the latest reading in its history', () => {
    expect(percentileNow(series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe(1);
    expect(percentileNow(series([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]))).toBeCloseTo(1 / 12);
    expect(percentileNow(series([1, 2, 3]))).toBeNull();
  });

  it('finds the value a set time ago', () => {
    const s = series([1, 2, 3, 4, 5]);
    expect(valueAgo(s, 60)).toBe(3);
    expect(valueAgo(s, 1000)).toBeNull();
  });

  it('draws a trend line inside its box', () => {
    const pts = sparkPoints(series([5, 10, 0]), 100, 20, 3650, new Date('2020-04-01T00:00:00Z')).split(' ');
    expect(pts[0]).toBe('0.0,10.0');
    expect(pts[1]).toBe('50.0,1.0');
    expect(pts[2]).toBe('100.0,19.0');
    expect(sparkPoints(series([1]), 10, 10)).toBe('');
  });

  it('names the regime from votes', () => {
    const r = regime(
      [{ name: 'Jobs', change: 50, threshold: 20 }, { name: 'Claims', change: 30000, threshold: 10000, sign: -1 }, { name: 'Retail', change: -1, threshold: 0.5 }],
      [{ name: 'CPI', change: -0.4, threshold: 0.15 }, { name: 'Core PCE', change: -0.2, threshold: 0.15 }],
    );
    // growth: rising, falling, falling -> -1/3 -> falling; inflation both falling
    expect(r.growth).toBe('falling');
    expect(r.inflation).toBe('falling');
    expect(r.label).toBe('Disinflationary slowdown');
    expect(r.votes).toHaveLength(5);
    const hot = regime([{ name: 'Jobs', change: 50, threshold: 20 }], [{ name: 'CPI', change: 0.5, threshold: 0.15 }]);
    expect(hot.label).toBe('Reflation');
    expect(regime([{ name: 'Jobs', change: null, threshold: 20 }], []).label).toBe('Goldilocks');
  });
});
