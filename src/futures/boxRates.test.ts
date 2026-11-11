import { describe, expect, it } from 'vitest';
import { benchmarkRow, bp, months, rate, reading } from './boxRates';

// The hand-worked box of helper/tests/test_boxrates.py: 91 days, mid 4.37998%, lend at asks 3.80692%, T-bill 4.30%.
const row = { days: 91, midRate: 0.0437998, lend: 0.0380692, bill: 0.043, extraPer100k: 19.941 };
// (the 'less' case below reuses extraPer100k's size: only its sign comes from the rates)

describe('box-spread readings', () => {
  it('formats', () => {
    expect(rate(0.0437998)).toBe('4.38%');
    expect(bp(7.998)).toBe('+8 bp');
    expect(bp(-3.2)).toBe('-3 bp');
    expect(months(35)).toBe('5 weeks');
    expect(months(91)).toBe('3 months');
    expect(months(730)).toBe('2.0 years');
  });

  it('reads the 3-month box against the T-bill, and what paying the asks costs', () => {
    expect(reading(row)).toBe(
      'Lending through S&P 500 box spreads for 3 months pays 4.38% at the mid, more than a Treasury bill of the same length (4.30%) (about $20 more per $100,000). Paying every ask instead: 3.81%, below the T-bill, so only a patient limit order near the mid captures the gap.',
    );
  });

  it('says so when it is the same or there is no data', () => {
    expect(reading({ ...row, midRate: 0.04301 })).toContain('the same as a Treasury bill');
    expect(reading({ ...row, bill: null })).toBe('Not enough quotes for a reading yet.');
    // boxes paying less than bills: nothing to capture, so no limit-order advice
    expect(reading({ ...row, midRate: 0.042, lend: 0.039 })).toBe('Lending through S&P 500 box spreads for 3 months pays 4.20% at the mid, less than a Treasury bill of the same length (4.30%) (about $20 less per $100,000). Paying every ask instead: 3.90%.');
  });

  it('picks the expiry nearest 3 months', () => {
    expect(benchmarkRow([{ days: 30 }, { days: 85 }, { days: 120 }])?.days).toBe(85);
    expect(benchmarkRow([])).toBeNull();
  });
});
