import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMS, rangeText, yourRevenue } from './revenue';

describe('prospect revenue', () => {
  it('works out what a prospect is worth to you', () => {
    // $500M x 5% won x 1% fee = $250K a year if won; x 10% close rate = $25K expected
    const r = yourRevenue(500e6, DEFAULT_TERMS)!;
    expect(r.ifWon).toBeCloseTo(250_000);
    expect(r.expected).toBeCloseTo(25_000);
    expect(yourRevenue(null, DEFAULT_TERMS)).toBeNull();
  });
  it('writes a range', () => {
    expect(rangeText({ low: 3.375e6, likely: 4.5e6, high: 5.625e6 })).toContain('–');
  });
});
