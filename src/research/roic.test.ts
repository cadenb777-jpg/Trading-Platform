import { describe, expect, it } from 'vitest';
import type { Statements } from './debtDilution';
import { investedCapital, overBaa, research, researchStaleWords, researchWords, returnOnCapital, roicStaleWords, roicWords, taxRate, yearsBefore, type Research, type Roic } from './roic';

// SEC company facts, checked live 2026-11-17 ($bn), as research.statements builds them (helper 83).
const B = 1e9;
function company(periods: string[], v: Record<string, (number | null)[]>): Statements {
  const values: Record<string, (number | null)[]> = {};
  for (const [k, xs] of Object.entries(v)) values[k] = xs.map((x) => (x == null ? null : x * B));
  return { periods, values };
}
const msft = company(['2020-06-30', '2021-06-30', '2022-06-30', '2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30'], {
  revenue: [143.015, 168.088, 198.27, 211.915, 245.122, 281.724, 331.839],
  operatingIncome: [52.959, 69.916, 83.383, 88.523, 109.433, 128.528, 155.237],
  pretaxIncome: [53.036, 71.102, 83.716, 89.311, 107.787, 123.627, 165.934],
  incomeTax: [8.755, 9.831, 10.978, 16.95, 19.651, 21.795, 32.185],
  rnd: [19.269, 20.716, 24.512, 27.195, 29.51, 32.488, 35.562],
  totalAssets: [301.311, 333.779, 364.84, 411.976, 512.163, 619.003, 758.376],
  cash: [13.576, 14.224, 13.931, 34.704, 18.315, 30.242, 20.935],
  shortInvestments: [122.951, 116.11, 90.826, 76.558, 57.228, 64.323, 55.908],
  longInvestments: [null, null, null, null, null, null, null],
  currentLiabilities: [72.31, 88.657, 95.082, 104.149, 125.286, 141.218, 168.825],
  currentDebt: [3.749, 8.072, 2.749, 5.247, 8.942, 2.999, 9.227],
});
const aapl = company(['2020-09-26', '2021-09-25', '2022-09-24', '2023-09-30', '2024-09-28', '2025-09-27', '2026-09-26'], {
  revenue: [274.515, 365.817, 394.328, 383.285, 391.035, 416.161, 478.834],
  operatingIncome: [66.288, 108.949, 119.437, 114.301, 123.216, 133.05, 158.063],
  pretaxIncome: [67.091, 109.207, 119.103, 113.736, 123.485, 132.729, 159.237],
  incomeTax: [9.68, 14.527, 19.3, 16.741, 29.749, 20.719, 27.062],
  rnd: [18.752, 21.914, 26.251, 29.915, 31.37, 34.55, 45.765],
  totalAssets: [323.888, 351.002, 352.755, 352.583, 364.98, 359.241, 404.548],
  cash: [38.016, 34.94, 23.646, 29.965, 29.943, 35.934, 36.305],
  shortInvestments: [52.927, 27.699, 24.658, 31.59, 35.228, 18.763, 20.417],
  longInvestments: [100.887, 127.877, 120.805, 100.544, 91.479, 77.723, 80.213],
  currentLiabilities: [105.392, 125.481, 153.982, 145.308, 176.392, 165.631, 169.915],
  currentDebt: [13.769, 15.613, 21.11, 15.807, 20.879, 20.329, 11.903],
});
const ko = company(['2019-12-31', '2020-12-31', '2021-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'], {
  revenue: [37.266, 33.014, 38.655, 43.004, 45.754, 47.061, 47.941],
  operatingIncome: [10.086, 8.997, 10.308, 10.909, 11.311, 9.992, 13.762],
  pretaxIncome: [10.786, 9.749, 12.425, 11.686, 12.952, 13.086, 15.998],
  incomeTax: [1.801, 1.981, 2.621, 2.115, 2.249, 2.437, 2.861],
  rnd: [null, null, null, null, null, null, null],
  totalAssets: [86.381, 87.296, 94.354, 92.763, 97.703, 100.549, 104.816],
  cash: [6.48, 6.795, 9.684, 9.519, 9.366, 10.828, 10.27],
  shortInvestments: [3.228, 2.348, 1.242, 1.043, 2.997, 2.02, 3.602],
  currentLiabilities: [26.973, 14.601, 19.95, 19.724, 23.571, 25.249, 21.281],
  currentDebt: [25.254, 3.997, 7.107, 4.918, 6.169, 1.787, 3.317],
});
// FRED BAA, October 2026 (published monthly)
const baa = { value: 6.59, date: '2026-10-01', series: 'BAA' };

describe('Invested capital and tax', () => {
  it('works out operating capital (Microsoft FY2026)', () => {
    // 758.376 - 20.935 - 55.908 - (168.825 - 9.227) = 521.935; no long-term securities ever tagged = 0
    const c = investedCapital(msft, 6)!;
    expect(c.value / B).toBeCloseTo(521.935, 6);
    expect(c.missing).toEqual([]);
    // Apple FY2026 also leaves out $80.2B of long-term securities: 404.548 - 36.305 - 20.417 - 80.213 - (169.915 - 11.903)
    expect(investedCapital(aapl, 6)!.value / B).toBeCloseTo(109.601, 6);
  });

  it('effective tax rate, held to 0-50%, else the federal 21%', () => {
    expect(taxRate(msft, 6).rate).toBeCloseTo(0.193963, 5); // 32.185 / 165.934
    expect(taxRate(msft, 6).statutory).toBe(false);
    const loss = company(['2025-12-31'], { incomeTax: [0.5], pretaxIncome: [-2] });
    expect(taxRate(loss, 0)).toEqual({ rate: 0.21, statutory: true });
    expect(taxRate(company(['2025-12-31'], { incomeTax: [9], pretaxIncome: [10] }), 0).rate).toBe(0.5);
  });

  it('names a cash-like line tagged before but not this year (counted as zero)', () => {
    const gap = { ...msft, values: { ...msft.values, shortInvestments: msft.values.shortInvestments.map((x, i) => (i === 6 ? null : x)) } };
    expect(investedCapital(gap, 6)!.missing).toEqual(['short-term investments']);
    const r = returnOnCapital(gap) as Roic;
    expect(roicWords(r)).toMatch(/The filings don’t tag short-term investments for every year used, so it counts as zero and the figure may be off\.$/);
  });
});

describe('Return on invested capital', () => {
  it('Microsoft FY2026 against its own record and the Baa yield', () => {
    const r = returnOnCapital(msft) as Roic;
    // NOPAT 155.237 x (1 - 0.193963) = 125.127; capital (521.935 + 386.219) / 2 = 454.077; ROIC 27.56%
    expect(r.latest.nopat / B).toBeCloseTo(125.1268, 3);
    expect(r.latest.capital / B).toBeCloseTo(454.077, 6);
    expect(r.latest.roic).toBeCloseTo(0.275563, 5);
    expect(r.history.map((y) => y.end)[0]).toBe('2021-06-30');
    // six years 55.0, 49.9, 38.8, 34.3, 30.0, 27.6: median (38.81 + 34.28) / 2 = 36.55%
    expect(r.median).toBeCloseTo(0.365467, 5);
    expect(overBaa(r, baa)).toBeCloseTo(0.275563 - 0.0659, 5);
    expect(roicWords(r, baa)).toBe(
      'In FY2026 the business earned 27.6% after tax on the $454 billion tied up in its operations (operating profit after tax $125 billion). Below its median since FY2021 (36.5%). Medium-grade companies pay 6.59% to borrow (Moody’s Baa, Oct 2026): it earns 21.0 points more. Shareholders expect more than lenders, so this is a floor, not the full cost of capital.',
    );
  });

  it('Coca-Cola FY2025 and a company earning less than borrowing costs', () => {
    const r = returnOnCapital(ko) as Roic;
    // 13.762 x (1 - 2.861 / 15.998) / ((72.980 + 64.239) / 2) = 16.47%
    expect(r.latest.roic).toBeCloseTo(0.164713, 5);
    expect(roicWords(r, baa)).toMatch(/Above its median since FY2020 \(12\.6%\)/);
    expect(roicWords(r, { ...baa, value: 18 })).toMatch(/it earns 1\.5 points less, so it isn’t covering even what borrowing would cost\.$/);
    expect(roicWords(r)).not.toMatch(/Baa/);
  });

  it('never shows an old year as today’s; needs operating income', () => {
    const gone = { ...msft, values: { ...msft.values, totalAssets: msft.values.totalAssets.map((x, i) => (i === 6 ? null : x)) } };
    const s = returnOnCapital(gone);
    expect(s).toEqual({ lastShown: '2025-06-30' });
    expect(roicStaleWords(s as { lastShown: string })).toBe('The newest filings don’t show everything return on capital needs; it was last worked out for FY2025.');
    expect(returnOnCapital({ periods: ['2025-12-31'], values: {} })).toBeNull();
    // newest year without operating income: stale, never last year's figure as today's
    const noOi = { ...msft, values: { ...msft.values, operatingIncome: msft.values.operatingIncome.map((x, i) => (i === 6 ? null : x)) } };
    expect(returnOnCapital(noOi)).toEqual({ lastShown: '2025-06-30' });
  });

  it('only averages capital over whole fiscal years next to each other', () => {
    expect(yearsBefore(msft, 6, 5, 1)).toBe(true);
    expect(yearsBefore(msft, 6, 1, 5)).toBe(true);
    // a missing year: FY2024 sits next to FY2022 in the columns but is 2 years on
    const gap = { periods: msft.periods.filter((_, i) => i !== 3), values: Object.fromEntries(Object.entries(msft.values).map(([k, v]) => [k, v.filter((_, i) => i !== 3)])) };
    const r = returnOnCapital(gap) as Roic;
    expect(r.history.map((y) => y.end)).toEqual(['2021-06-30', '2022-06-30', '2025-06-30', '2026-06-30']);
    expect((research(gap) as Research).missing).toBe('history');
  });

  it('untagged current debt is none that year, not a warning', () => {
    const repaid = { ...msft, values: { ...msft.values, currentDebt: msft.values.currentDebt.map((x, i) => (i === 6 ? null : x)) } };
    expect(investedCapital(repaid, 6)!.missing).toEqual([]);
    expect(investedCapital(repaid, 6)!.value / B).toBeCloseTo(521.935 - 9.227, 6);
  });
});

describe('R&D as an investment', () => {
  it('Microsoft FY2026', () => {
    const r = research(msft) as Research;
    // 35.562 / 331.839 = 10.72% of sales; (35.562 / 20.716)^(1/5) - 1 = 11.41% a year
    expect(r.ofSales).toBeCloseTo(0.107166, 5);
    expect(r.growth5).toBeCloseTo(0.11413, 5);
    // asset = 35.562 + 32.488 x 0.8 + 29.51 x 0.6 + 27.195 x 0.4 + 24.512 x 0.2 = 95.039; write-off (32.488 + 29.51 + 27.195 + 24.512 + 20.716) / 5 = 26.884
    expect(r.asset! / B).toBeCloseTo(95.0388, 3);
    expect(r.amortization! / B).toBeCloseTo(26.8842, 3);
    expect(r.adjusted).toBeCloseTo(0.242524, 5);
    expect(r.reported).toBeCloseTo(0.275563, 5);
    expect(researchWords(r)).toBe(
      'In FY2026 the company spent $35.6 billion on research and development, 10.7% of sales, up 11.4% a year over 5 years. Accounting counts it as a cost, but it is spent to earn for years. Counted as an investment written off over 5 years (a research asset of $95.0 billion), the return on capital is 24.3% instead of 27.6%: lower, because the capital the business really uses is larger.',
    );
  });

  it('Apple: capitalising research roughly halves a very high return', () => {
    const r = research(aapl) as Research;
    expect(r.reported).toBeCloseTo(1.372965, 5);
    expect(r.adjusted).toBeCloseTo(0.739273, 5);
    // 131.2005 / 95.560 = 137.3%: explained, not hidden
    expect(roicWords(returnOnCapital(aapl) as Roic)).toMatch(/^In FY2026 the business earned 137\.3% after tax on the \$95\.6 billion tied up in its operations \(operating profit after tax \$131 billion\)\. Above 100% means the business runs on very little capital of its own: customers and suppliers fund much of it\./);
  });

  it('no R&D line = nothing; a dropped line, too short a history or no return on capital say so', () => {
    expect(research(ko)).toBeNull();
    const dropped = { ...msft, values: { ...msft.values, rnd: msft.values.rnd.map((x, i) => (i === 6 ? null : x)) } };
    const st = research(dropped);
    expect(st).toEqual({ lastShown: '2025-06-30' });
    expect(researchStaleWords(st as { lastShown: string })).toBe('The filings stopped showing research and development on a line of its own after FY2025.');
    const noCl = { ...msft, values: { ...msft.values, currentLiabilities: msft.values.currentLiabilities.map((x, i) => (i === 6 ? null : x)) } };
    const nc = research(noCl) as Research;
    expect(nc.missing).toBe('capital');
    expect(researchWords(nc)).toMatch(/also needs the year’s return on capital, which these filings don’t allow working out\.$/);
    const short = { periods: msft.periods.slice(3), values: Object.fromEntries(Object.entries(msft.values).map(([k, v]) => [k, v.slice(3)])) };
    const r = research(short) as Research;
    expect(r.adjusted).toBeNull();
    expect(r.growth5).toBeNull();
    expect(researchWords(r)).toMatch(/needs 6 years of R&D in a row, which the filings don’t show\.$/);
  });
});
