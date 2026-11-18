import { describe, expect, it } from 'vitest';
import type { Statements } from './debtDilution';
import { cashTax, leverageWords, operatingLeverage, taxWords, type CashTax, type Leverage } from './taxLeverage';

// SEC company facts as research.statements builds them (helper 84), checked live 2026-11-18 ($bn).
const B = 1e9;
function company(periods: string[], v: Record<string, (number | null)[]>): Statements {
  return { periods, values: Object.fromEntries(Object.entries(v).map(([k, xs]) => [k, xs.map((x) => (x == null ? null : x * B))])) };
}
const msft = company(['2017-06-30', '2018-06-30', '2019-06-30', '2020-06-30', '2021-06-30', '2022-06-30', '2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30'], {
  revenue: [96.571, 110.36, 125.843, 143.015, 168.088, 198.27, 211.915, 245.122, 281.724, 331.839],
  operatingIncome: [29.025, 35.058, 42.959, 52.959, 69.916, 83.383, 88.523, 109.433, 128.528, 155.237],
  pretaxIncome: [29.901, 36.474, 43.688, 53.036, 71.102, 83.716, 89.311, 107.787, 123.627, 165.934],
  incomeTax: [4.412, 19.903, 4.448, 8.755, 9.831, 10.978, 16.95, 19.651, 21.795, 32.185],
  taxesPaid: [2.4, 5.5, 8.4, 12.5, 13.4, 16.0, 23.1, 23.4, 28.7, 21.188],
});
const amzn = company(['2016-12-31', '2017-12-31', '2018-12-31', '2019-12-31', '2020-12-31', '2021-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'], {
  revenue: [135.987, 177.866, 232.887, 280.522, 386.064, 469.822, 513.983, 574.785, 637.959, 716.924],
  operatingIncome: [4.186, 4.106, 12.421, 14.541, 22.899, 24.879, 12.248, 36.852, 68.593, 79.975],
  pretaxIncome: [3.892, 3.806, 11.261, 13.976, 24.178, 38.151, -5.936, 37.557, 68.614, 97.311],
  incomeTax: [1.425, 0.769, 1.197, 2.374, 2.863, 4.791, -3.217, 7.12, 9.265, 19.087],
  taxesPaid: [0.412, 0.957, 1.184, 0.881, 1.713, 3.688, 6.035, 11.179, 12.308, 8.295],
});

describe('Cash tax rate', () => {
  it('Microsoft FY2026: one year low, five years about the same as the book rate', () => {
    const t = cashTax(msft) as CashTax;
    // 21.188 / 165.934 = 12.77%; 32.185 / 165.934 = 19.40%
    expect(t.cashRate).toBeCloseTo(0.127689, 5);
    expect(t.bookRate).toBeCloseTo(0.193963, 5);
    // FY2022-26: paid 112.388 / pre-tax 570.375 = 19.70%; charged 101.559 / 570.375 = 17.81%
    expect(t.window.map((r) => r.end)[0]).toBe('2022-06-30');
    expect(t.longCash).toBeCloseTo(0.197042, 5);
    expect(t.longBook).toBeCloseTo(0.178057, 5);
    expect(taxWords(t)).toBe(
      'In FY2026 the company paid $21.2 billion of income tax in cash: 12.8% of its pre-tax profit, against 19.4% charged in its income statement. Over 5 years (FY2022–FY2026) it paid 19.7% in cash and charged 17.8%: about the same. The federal rate is 21%; state and foreign taxes and credits move a company’s rate either way.',
    );
  });

  it('Amazon FY2025: a loss year included in the sums; a gap under 2 points reads as about the same', () => {
    const t = cashTax(amzn) as CashTax;
    // FY2021-25 includes FY2022's pre-tax loss: paid 41.505 / pre-tax 235.697 = 17.61%; charged 37.046 / 235.697 = 15.72%
    expect(t.longCash).toBeCloseTo(0.176095, 5);
    expect(t.longBook).toBeCloseTo(0.157176, 5);
    expect(taxWords(t)).toMatch(/In FY2025 the company paid \$8\.3 billion of income tax in cash: 8\.5% of its pre-tax profit, against 19\.6% charged.* it paid 17\.6% in cash and charged 15\.7%: about the same\./);
    const more = company(['2023-12-31', '2024-12-31', '2025-12-31'], { revenue: [1, 1, 1], pretaxIncome: [10, 10, 10], incomeTax: [1, 1, 1], taxesPaid: [2, 2, 2] });
    expect(taxWords(cashTax(more) as CashTax)).toMatch(/it paid 20\.0% in cash but charged 10\.0%: it paid more than its accounts charged/);
  });

  it('a loss year and deferred tax are said plainly; stale and missing lines', () => {
    const loss = company(['2024-12-31', '2025-12-31'], { revenue: [10, 11], pretaxIncome: [1, -2], incomeTax: [0.2, -0.3], taxesPaid: [0.2, 0.1] });
    expect(taxWords(cashTax(loss) as CashTax)).toBe('In FY2025 the company paid $100 million of income tax in cash with no pre-tax profit (−$2.0 billion), so no rate can be worked out for the year.');
    const deferred = company(['2023-12-31', '2024-12-31', '2025-12-31'], { revenue: [1, 1, 1], pretaxIncome: [10, 10, 10], incomeTax: [2, 2, 2], taxesPaid: [1, 1, 1] });
    expect(taxWords(cashTax(deferred) as CashTax)).toMatch(/it paid 10\.0% in cash but charged 20\.0%: part of the tax in its accounts hasn’t been paid yet/);
    const gone = { ...msft, values: { ...msft.values, taxesPaid: msft.values.taxesPaid.map((x, i) => (i === 9 ? null : x)) } };
    expect(cashTax(gone)).toEqual({ lastShown: '2025-06-30', missing: 'income taxes paid' });
    const noPretax = { ...msft, values: { ...msft.values, pretaxIncome: msft.values.pretaxIncome.map((x, i) => (i === 9 ? null : x)) } };
    expect(cashTax(noPretax)).toEqual({ lastShown: '2025-06-30', missing: 'pre-tax profit' });
    expect(cashTax({ periods: ['2025-12-31'], values: { revenue: [1] } })).toBeNull();
    // a net refund is said as one; losses that cancel most of the profit give no long-run rate
    const refund = company(['2023-12-31', '2024-12-31', '2025-12-31'], { revenue: [1, 1, 1], pretaxIncome: [10, -9, 0.5], incomeTax: [2, -1, 0.1], taxesPaid: [2, 1, -0.1] });
    const r = cashTax(refund) as CashTax;
    expect(r.cashRate).toBeNull();
    expect(r.longCash).toBeNull(); // pre-tax 1.5 against 10.5 of profitable years
    expect(taxWords(r)).toBe('In FY2025 the company received a net income tax refund of $100 million in cash (refunds were bigger than payments).');
  });
});

describe('Operating leverage', () => {
  it('the words follow the multiple shown, and a negative one is the opposite direction', () => {
    const base: Leverage = { slope: 1.18, years: 6, from: '2020-12-31', to: '2025-12-31', history: [] };
    expect(leverageWords(base)).toMatch(/about a 1\.2% change.* Above 1 means fixed costs magnify/); // shows 1.2: "above"
    expect(leverageWords({ ...base, slope: 1.12 })).toMatch(/about a 1\.1% change.* About 1 means/);
    expect(leverageWords({ ...base, slope: -0.6 })).toMatch(/Below zero means profit has moved the opposite way to sales/);
  });

  it('Microsoft: 10-year slope and the newest year', () => {
    const l = operatingLeverage(msft) as Leverage;
    // ln(operating income) on ln(sales), FY2017-26: 1.369 (numpy.polyfit); FY2026 +20.78% on +17.79% = 1.17x
    expect(l.slope).toBeCloseTo(1.369127, 5);
    expect(l.years).toBe(10);
    expect(l.history.length).toBe(5);
    expect(l.history[4].dol).toBeCloseTo(1.168197, 5);
    expect(leverageWords(l)).toBe(
      'Over 10 years (FY2017–FY2026) each 1% change in sales came with about a 1.4% change in operating profit. Above 1 means fixed costs magnify the swings: profit rises faster than sales in good years and falls faster in bad ones. Mandelker and Rhee (1984) found that higher operating leverage goes with higher market risk. In FY2026 operating profit grew 20.8% while sales grew 17.8% (1.17×).',
    );
  });

  it('Amazon and the small-move rule', () => {
    const l = operatingLeverage(amzn) as Leverage;
    expect(l.slope).toBeCloseTo(1.633493, 5);
    const flat = company(['2021-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'], { revenue: [100, 110, 120, 130, 131], operatingIncome: [10, 12, 14, 16, 17] });
    const f = operatingLeverage(flat) as Leverage;
    expect(f.history[3].dol).toBeNull(); // sales +0.8%: no ratio
    expect(leverageWords(f)).toMatch(/\(sales barely moved, so no ratio\)\.$/);
    const short = company(['2024-12-31', '2025-12-31'], { revenue: [100, 110], operatingIncome: [10, 12] });
    expect((operatingLeverage(short) as Leverage).slope).toBeNull();
    expect(leverageWords(operatingLeverage(short) as Leverage)).toMatch(/^Five years in a row with an operating profit are needed/);
  });
});
