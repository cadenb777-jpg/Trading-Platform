import { describe, expect, it } from 'vitest';
import { lendingWords, paperWords, reservesWords, trendWords, type Lending, type Paper, type Reserves } from './systemDesk';

// Live values (FRED, Nov 9-11, 2026)
const reserves: Reserves = {
  date: '2026-11-11', reserves: 2960603e6, ratio: 8.9688, gdpEstimated: true, gdpQuarter: '2026-10-01', stressRatio: 6.4194, stressDate: '2019-09-18',
  aboveStress: 841.54, ratio3m: 8.9187, ratio12m: 9.0983, from: '2002-12-18', series: [],
};
const paper: Paper = { date: '2026-11-09', cp: 4.03, bill: 4.06, spreadBp: -3, percentile: 0.52, monthAgoBp: 3, high1yBp: 39, stressed: false, from: '1997-01-02', series: [] };
const lending: Lending = { date: '2026-10-01', netTightening: 1.7, previous: 0, percentile: 52.7, reading: 'about steady', from: '1990-04-01', series: [] };

describe('Credit and reserves', () => {
  it('reads reserves against September 2019', () => {
    expect(reservesWords(reserves)).toBe(
      'Banks hold $2.96 trillion of reserves at the Fed, 9.0% of the economy (GDP). That is $842 billion above the level of September 2019 (6.4% of GDP), when overnight money markets broke.',
    );
    expect(reservesWords({ ...reserves, aboveStress: -120 })).toMatch(/\$120 billion below .* scarce by that yardstick\.$/);
    expect(trendWords(reserves)).toBe('Down 0.1 points of GDP in a year.');
    expect(trendWords({ ...reserves, ratio12m: 8.95 })).toBe('About the same share of GDP as a year ago.');
  });

  it('reads the commercial paper spread', () => {
    expect(paperWords(paper)).toBe(
      'Big financial companies borrow for 3 months at 4.03%, 3 bp less than the Treasury (3-month bill 4.06%). Lower than on 99% of days since 1997: lenders ask almost nothing extra for company paper over T-bills.',
    );
    expect(paperWords({ ...paper, spreadBp: 12, cp: 4.18, percentile: 60 })).toMatch(/12 bp more than .* no sign of short-term credit stress\.$/);
    const stressed = { ...paper, spreadBp: 85, cp: 4.91, percentile: 97.4, stressed: true };
    expect(paperWords(stressed)).toMatch(/Higher than on 97% of days since 1997: short-term credit is under stress/);
  });

  it('reads lending standards', () => {
    expect(lendingWords(lending)).toBe('A net 1.7% of banks tightened their standards for loans to large and mid-sized companies in the October 2026 survey (previous survey: 0.0%). About steady.');
    expect(lendingWords({ ...lending, netTightening: 32.5, reading: 'tightening' })).toMatch(/A net 32.5% of banks tightened.*come before weaker lending/);
    expect(lendingWords({ ...lending, netTightening: -12.1, previous: -2, reading: 'easing' })).toMatch(/A net 12.1% of banks eased.*\(previous survey: −2.0%\).*easier to get\.$/);
    expect(lendingWords({ ...lending, netTightening: -5.1, reading: 'about steady' })).toMatch(/A net 5.1% of banks eased.* About steady\.$/);
  });
});
