import { describe, expect, it } from 'vitest';
import { allocationDrift, defaultTolerance, incomeEstimate, riskFit, sinceStart } from './review';

describe('risk vs tolerance', () => {
  it('maps objectives to a default level', () => {
    expect(defaultTolerance('Capital preservation')).toBe(1);
    expect(defaultTolerance('Growth')).toBe(4);
    expect(defaultTolerance(undefined)).toBe(3);
  });
  it('says within, above or below the band', () => {
    expect(riskFit(0.11, 3).status).toBe('within');
    const hot = riskFit(0.19, 3);
    expect(hot.status).toBe('above');
    expect(hot.actual.label).toBe('Aggressive');
    expect(hot.text).toMatch(/19\.0%/);
    expect(riskFit(0.04, 3).status).toBe('below');
    expect(riskFit(0.3, 5).status).toBe('within'); // no upper limit for Aggressive
    expect(riskFit(0.09, 2).status).toBe('above'); // the top of a band belongs to the next one
  });
});

describe('allocation drift', () => {
  it('compares asset-class shares with the target and works out the trades', () => {
    const r = allocationDrift(
      [{ label: 'US stocks', value: 70000 }, { label: 'Bonds', value: 25000 }, { label: 'Cash', value: 5000 }],
      [{ label: 'US stocks', weight: 60 }, { label: 'Bonds', weight: 35 }, { label: 'Cash', weight: 5 }],
    );
    expect(r.total).toBe(100000);
    expect(r.rows.map((x) => x.label)).toEqual(['Bonds', 'US stocks', 'Cash']); // both 10 points; alphabetical tie-break
    const us = r.rows.find((x) => x.label === 'US stocks')!;
    expect(us.drift).toBeCloseTo(0.1);
    expect(us.status).toBe('over');
    expect(us.trade).toBe(-10000);
    expect(r.rows.find((x) => x.label === 'Cash')!.status).toBe('ok');
    expect(r.outside).toBe(2);
    expect(r.maxDrift).toBeCloseTo(0.1);
  });
  it('treats a class missing on one side as 0% there, and exactly the band as ok', () => {
    const r = allocationDrift([{ label: 'A', value: 95 }, { label: 'Gold', value: 5 }], [{ label: 'A', weight: 1 }]);
    expect(r.rows.find((x) => x.label === 'Gold')!).toMatchObject({ target: 0, status: 'ok' });
    expect(r.rows.find((x) => x.label === 'A')!.drift).toBeCloseTo(-0.05);
    const missing = allocationDrift([{ label: 'A', value: 100 }], [{ label: 'A', weight: 50 }, { label: 'B', weight: 50 }]);
    expect(missing.rows.find((x) => x.label === 'B')!).toMatchObject({ current: 0, status: 'under', trade: 50 });
  });
});

describe('income estimate', () => {
  it('adds up income from yields and lists the biggest payers', () => {
    const r = incomeEstimate([
      { symbol: 'SCHD', value: 10000, yld: 0.035 },
      { symbol: 'BND', value: 20000, yld: 0.04 },
      { symbol: 'NVDA', value: 5000, yld: 0 },
      { symbol: 'ALT', value: 5000, yld: null },
    ]);
    expect(r.annual).toBeCloseTo(1150);
    expect(r.monthly).toBeCloseTo(1150 / 12);
    expect(r.yield).toBeCloseTo(1150 / 40000);
    expect(r.top.map((x) => x.symbol)).toEqual(['BND', 'SCHD']);
    expect(r.unknown).toEqual(['ALT']);
  });
});

describe('since start', () => {
  it('gives the yearly and the cumulative return, and what the investment grew to', () => {
    // the QA case: +41.2% a year from 2023-01-03 to 2026-10-28 is about +273% in all, so $100,000 grows to about $374,000
    const years = (Date.parse('2026-10-28') - Date.parse('2023-01-03')) / (365.25 * 86400000);
    const cum = Math.pow(1.412, years) - 1;
    const s = sinceStart({ start: '2023-01-03', end: '2026-10-28', stats: { totalReturn: cum }, trailing: { inception: { portfolio: 0.412 } } }, 100000)!;
    expect(s.perYear).toBe(0.412);
    expect(s.years).toBeCloseTo(3.82, 2);
    expect(s.cumulative).toBeCloseTo(2.74, 1);
    expect(s.endValue! / 1000).toBeCloseTo(374, -1);
    expect(sinceStart(null, 1000)).toBeNull();
  });
});
