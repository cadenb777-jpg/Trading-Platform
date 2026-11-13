import { describe, expect, it } from 'vitest';
import { accruals, accrualWords, fScore, fScoreWord, fScoreWords } from './quality';
import type { Statements } from './debtDilution';

// Apple's 10-K figures (SEC company facts, checked live 2026-11-13), $bn; fiscal years end late September.
const B = 1e9;
const aapl: Statements = {
  periods: ['2023-09-30', '2024-09-28', '2025-09-27', '2026-09-26'],
  values: {
    netIncome: [96.995 * B, 93.736 * B, 112.01 * B, 132.175 * B],
    operatingCashFlow: [110.543 * B, 118.254 * B, 111.482 * B, 145.097 * B],
    totalAssets: [352.583 * B, 364.98 * B, 359.241 * B, 404.548 * B],
    currentAssets: [143.566 * B, 152.987 * B, 147.957 * B, 173.857 * B],
    currentLiabilities: [145.308 * B, 176.392 * B, 165.631 * B, 169.915 * B],
    longTermDebt: [95.281 * B, 85.75 * B, 78.328 * B, 68.208 * B],
    grossProfit: [169.148 * B, 180.683 * B, 195.201 * B, 233.602 * B],
    revenue: [383.285 * B, 391.035 * B, 416.161 * B, 478.834 * B],
    dilutedShares: [15812547000, 15408095000, 15004697000, 14720306000],
  },
};

describe('Accruals', () => {
  it('works out (net income - operating cash flow) / average assets per year', () => {
    const x = accruals(aapl)!;
    // FY2024: (93.736 - 118.254) / ((364.980 + 352.583) / 2) = -0.068337
    // FY2025: (112.010 - 111.482) / ((359.241 + 364.980) / 2) = +0.001458
    // FY2026: (132.175 - 145.097) / ((404.548 + 359.241) / 2) = -0.033837
    expect(x.history.map((h) => h.end)).toEqual(['2024-09-28', '2025-09-27', '2026-09-26']);
    expect(x.history[0].accruals).toBeCloseTo(-0.0683369, 6);
    expect(x.history[1].accruals).toBeCloseTo(0.0014581, 6);
    expect(x.latest.accruals).toBeCloseTo(-0.0338366, 6);
    expect(x.percentile).toBeNull(); // fewer than 5 years: no "own range"
    expect(accrualWords(x)).toBe('In FY2026 the business brought in more cash than its reported profit (accruals −3.4% of assets): profit backed by cash.');
  });

  it('places the latest year in the company’s own range and reads high accruals', () => {
    const years = ['2019', '2020', '2021', '2022', '2023', '2024'].map((y) => `${y}-12-31`);
    // assets flat at 100: accruals = (NI - CFO) / 100 -> 1%, 2%, 3%, 4%, 9% (latest)
    const a: Statements = { periods: years, values: { totalAssets: [100, 100, 100, 100, 100, 100], netIncome: [0, 11, 12, 13, 14, 19], operatingCashFlow: [0, 10, 10, 10, 10, 10] } };
    const x = accruals(a)!;
    expect(x.percentile).toBe(100);
    expect(accrualWords(x)).toBe(
      'In FY2024 reported profit was more than the cash the business brought in (accruals +9.0% of assets): part of the profit is accounting entries not yet turned into cash. That is the highest in its 5 years since FY2020; Sloan (1996) found high-accrual profits last less.',
    );
    const low = { ...a, values: { ...a.values, netIncome: [0, 11, 12, 13, 14, 5] } };
    expect(accrualWords(accruals(low)!)).toMatch(/−5\.0% of assets.*That is the lowest in its 5 years since FY2020\.$/);
    const mid = { ...a, values: { ...a.values, netIncome: [0, 11, 12, 13, 14, 12.5] } };
    expect(accrualWords(accruals(mid)!)).toMatch(/Inside its own range over 5 years since FY2020\.$/);
    // ties with the low and the high are said as such (percentile thresholds would have called them "middle")
    const tieLow = { ...a, values: { ...a.values, netIncome: [0, 11, 12, 13, 14, 11] } };
    expect(accrualWords(accruals(tieLow)!)).toMatch(/Level with its lowest in 5 years since FY2020\.$/);
    const tieHigh = { ...a, values: { ...a.values, netIncome: [0, 11, 12, 13, 14, 14] } };
    expect(accrualWords(accruals(tieHigh)!)).toMatch(/Level with its highest in 5 years since FY2020; Sloan/);
    // second-highest of 10 years is not "the highest"
    const ten: Statements = {
      periods: Array.from({ length: 11 }, (_, i) => `${2015 + i}-12-31`),
      values: { totalAssets: Array(11).fill(100), operatingCashFlow: Array(11).fill(10), netIncome: [0, 11, 12, 13, 14, 15, 16, 17, 18, 20, 19] },
    };
    expect(accruals(ten)!.percentile).toBe(90);
    expect(accrualWords(accruals(ten)!)).toMatch(/Inside its own range over 10 years/);
    expect(accruals({ periods: ['2025'], values: {} })).toBeNull();
  });
});

describe('Piotroski F-score', () => {
  it('scores Apple FY2026 9 of 9 on the paper’s definitions', () => {
    const f = fScore(aapl)!;
    expect([f.end, f.previousEnd, f.score, f.checked]).toEqual(['2026-09-26', '2025-09-27', 9, 9]);
    const c = Object.fromEntries(f.checks.map((x) => [x.key, x]));
    // ROA over beginning assets: 132.175 / 359.241 = 0.367928; FY2025 112.010 / 364.980 = 0.306894
    expect(c.roa.now).toBeCloseTo(0.3679285, 6);
    expect(c.droa.before).toBeCloseTo(0.3068935, 6);
    // CFO 145.097 / 359.241 = 0.403899
    expect(c.cfo.now).toBeCloseTo(0.4038988, 6);
    // long-term debt / average assets: 68.208 / 381.8945 = 0.178604 vs 78.328 / 362.1105 = 0.216310
    expect(c.dlever.now).toBeCloseTo(0.1786043, 6);
    expect(c.dlever.before).toBeCloseTo(0.2163097, 6);
    // current ratio 1.0232 vs 0.8933; gross margin 0.48786 vs 0.46905; turnover 1.33290 vs 1.14023
    expect(c.dliquid.now).toBeCloseTo(1.0231998, 6);
    expect(c.dmargin.before).toBeCloseTo(0.4690516, 6);
    expect(c.dturn.now).toBeCloseTo(1.3329047, 6);
    expect(fScoreWord(f)).toBe('strong');
    expect(fScoreWords(f)).toBe('Passes 9 of 9 in FY2026 vs FY2025. In Piotroski’s study, cheap stocks scoring 8-9 went on to beat those scoring 0-1.');
  });

  it('names what failed and never counts a missing figure', () => {
    // FY2025 vs FY2024: ROA 112.010/364.980 = 0.3069 up from 93.736/352.583 = 0.2659 (pass); CFO 111.482 < NI 112.010
    // (fail); gross margin 46.9% up from 46.2% (pass); current ratio 0.893 up from 0.867 (pass); turnover 416.161/364.980
    // = 1.140 up from 391.035/352.583 = 1.109 (pass); LTD/avg assets 78.328/362.11 = 0.2163 down from 85.75/358.78 =
    // 0.2390 (pass); shares down (pass)
    const cut = { periods: aapl.periods.slice(0, 3), values: Object.fromEntries(Object.entries(aapl.values).map(([k, v]) => [k, v.slice(0, 3)])) };
    const f = fScore(cut)!;
    expect([f.end, f.score, f.checked]).toEqual(['2025-09-27', 8, 9]);
    expect(f.checks.find((c) => c.key === 'accrual')!.pass).toBe(false);
    expect(fScoreWords(f)).toBe(
      'Passes 8 of 9 in FY2025 vs FY2024. In Piotroski’s study, cheap stocks scoring 8-9 went on to beat those scoring 0-1. Missed: cash from operations beat profit.',
    );
    // no gross profit line (many banks and some service firms): that check is unjudged
    const noGp = { ...aapl, values: { ...aapl.values, grossProfit: [null, null, null, null] } };
    const g = fScore(noGp)!;
    expect([g.score, g.checked, fScoreWord(g)]).toEqual([8, 8, 'incomplete']);
    expect(fScoreWords(g)).toMatch(/^Passes 8 of 8 checks it has data for \(of 9\) in FY2026 vs FY2025\..*fewer checks\.$/);
    expect(fScore({ periods: ['2025'], values: { netIncome: [1] } })).toBeNull();
  });

  it('treats a company with no long-term debt as debt-free, and never reads a split as dilution', () => {
    const noDebt = { ...aapl, values: { ...aapl.values, longTermDebt: [null, null, null, null] } };
    const f = fScore(noDebt)!;
    const d = f.checks.find((c) => c.key === 'dlever')!;
    expect([d.label, d.pass, d.now, f.checked, f.score]).toEqual(['No long-term debt either year', true, 0, 9, 9]);
    // one missing year among reported ones stays unjudged
    const gap = { ...aapl, values: { ...aapl.values, longTermDebt: [95.281 * B, 85.75 * B, 78.328 * B, null] } };
    expect(fScore(gap)!.checks.find((c) => c.key === 'dlever')!.pass).toBeNull();
    // a 4-for-1 split left unrestated (3.81x, Apple FY2017 -> FY2018) is unjudged, not a "miss"
    const split = { ...aapl, values: { ...aapl.values, dilutedShares: [null, null, 5251692000, 20000435000] } };
    expect(fScore(split)!.checks.find((c) => c.key === 'shares')!.pass).toBeNull();
  });

  it('calls 0-1 weak', () => {
    const a: Statements = {
      periods: ['2023', '2024', '2025'].map((y) => `${y}-12-31`),
      values: {
        netIncome: [0, 5, -4], operatingCashFlow: [0, 6, -6], totalAssets: [100, 100, 100], currentAssets: [0, 50, 40], currentLiabilities: [0, 40, 45],
        longTermDebt: [0, 20, 30], grossProfit: [0, 30, 20], revenue: [0, 100, 90], dilutedShares: [0, 10, 12],
      },
    };
    const f = fScore(a)!;
    expect([f.score, f.checked, fScoreWord(f)]).toEqual([0, 9, 'weak']);
  });
});
