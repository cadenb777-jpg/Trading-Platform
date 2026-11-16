import { describe, expect, it } from 'vitest';
import type { Statements } from './debtDilution';
import { buildRate, buildStaleWords, buildWords, pace, payStaleWords, payWords, stockPay, type Build, type StockPay } from './buildPay';

// SEC company facts, checked live 2026-11-16 ($bn), as research.statements builds them (helper 81).
const B = 1e9;
function company(periods: string[], v: Record<string, (number | null)[]>): Statements {
  const values: Record<string, (number | null)[]> = {};
  for (const [k, xs] of Object.entries(v)) values[k] = xs.map((x) => (x == null ? null : x * B));
  values.freeCashFlow = values.operatingCashFlow.map((o, i) => (o == null ? null : o - (values.capex[i] ?? 0)));
  return { periods, values };
}
const msft = company(['2021-06-30', '2022-06-30', '2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30'], {
  revenue: [168.088, 198.27, 211.915, 245.122, 281.724, 331.839],
  operatingCashFlow: [76.74, 89.035, 87.582, 118.548, 136.162, 182.935],
  capex: [20.622, 23.886, 28.107, 44.477, 64.551, 115.948],
  depreciation: [9.3, 12.6, 11.0, 15.2, 22.0, 34.3],
  dna: [null, null, null, null, null, null],
  stockComp: [6.118, 7.502, 9.611, 10.734, 11.974, 12.405],
});
const aapl = company(['2021-09-25', '2022-09-24', '2023-09-30', '2024-09-28', '2025-09-27', '2026-09-26'], {
  revenue: [365.817, 394.328, 383.285, 391.035, 416.161, 478.834],
  operatingCashFlow: [104.038, 122.151, 110.543, 118.254, 111.482, 145.097],
  capex: [11.085, 10.708, 10.959, 9.447, 12.715, 9.041],
  depreciation: [9.5, 8.7, 8.5, 8.2, 8.0, 8.7],
  dna: [11.284, 11.104, 11.519, 11.445, 11.698, 13.423],
  stockComp: [7.906, 9.038, 10.833, 11.688, 12.863, 13.789],
});
const amzn = company(['2020-12-31', '2021-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'], {
  revenue: [386.064, 469.822, 513.983, 574.785, 637.959, 716.924],
  operatingCashFlow: [66.064, 46.327, 46.752, 84.946, 115.877, 139.514],
  capex: [40.14, 61.053, 63.645, 52.729, 82.999, 131.819],
  depreciation: [16.239, 22.909, 24.924, 30.225, 32.067, 41.86],
  dna: [25.18, 34.433, 41.921, 48.663, 52.795, 65.756],
  stockComp: [9.208, 12.757, 19.621, 24.023, 22.011, 19.467],
});
// Exxon tags no depreciation line of its own: the D&A line (with depletion) stands in
const xom = company(['2023-12-31', '2024-12-31', '2025-12-31'], {
  revenue: [344.582, 349.585, 332.238],
  operatingCashFlow: [55.369, 55.022, 51.97],
  capex: [21.919, 24.306, 28.358],
  dna: [20.641, 23.442, 25.993],
  stockComp: [null, null, null],
});

describe('Spending vs depreciation', () => {
  it('Microsoft FY2026: building well ahead of what wears out', () => {
    const b = buildRate(msft) as Build;
    // 115.948 / 34.3 = 3.3804; 115.948 / 331.839 = 34.94% of sales; net 115.948 - 34.3 = 81.648
    expect(b.basis).toBe('depreciation');
    expect(b.latest.ratio).toBeCloseTo(3.380408, 5);
    expect(b.ofSales).toBeCloseTo(0.349411, 5);
    expect(b.net / B).toBeCloseTo(81.648, 6);
    // five years, oldest first: FY2022 23.886 / 12.6 = 1.8957
    expect(b.history.map((y) => y.end)).toEqual(['2022-06-30', '2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30']);
    expect(b.history[0].ratio).toBeCloseTo(1.895714, 5);
    expect(pace(b.latest.ratio)).toBe('ahead');
    expect(buildWords(b)).toBe(
      'In FY2026 the company spent $116 billion on property and equipment, 3.4× its depreciation ($34.3 billion): it is building well ahead of what wears out. The new assets are written off over the coming years, so depreciation, a cost in profit, tends to keep rising after spending like this. Spending was 34.9% of sales. Up from 1.9× in FY2022.',
    );
  });

  it('Apple FY2026: replacing what wears out (depreciation alone, not D&A)', () => {
    const b = buildRate(aapl) as Build;
    // 9.041 / 8.7 = 1.0392 (on D&A 13.423 it would read 0.67: amortization isn't what capex buys)
    expect(b.latest.ratio).toBeCloseTo(1.039195, 5);
    expect(pace(b.latest.ratio)).toBe('replacing');
    // FY2022 10.708 / 8.7 = 1.2308, down 15.6%
    expect(buildWords(b)).toBe(
      'In FY2026 the company spent $9.0 billion on property and equipment, 1.0× its depreciation ($8.7 billion): about what wears out each year, so it is replacing rather than growing its assets. Spending was 1.9% of sales. Down from 1.2× in FY2022.',
    );
  });

  it('Amazon FY2025 and the bands', () => {
    const b = buildRate(amzn) as Build;
    expect(b.latest.ratio).toBeCloseTo(3.149044, 5); // 131.819 / 41.86
    expect(pace(1.5)).toBe('ahead');
    expect(pace(1.2)).toBe('growing');
    expect(pace(1.1)).toBe('replacing');
    expect(pace(0.9)).toBe('replacing');
    expect(pace(0.85)).toBe('shrinking');
  });

  it('uses D&A only when there is no depreciation line, and says so', () => {
    const b = buildRate(xom) as Build;
    expect(b.basis).toBe('dna');
    expect(b.latest.ratio).toBeCloseTo(1.090986, 5); // 28.358 / 25.993
    expect(buildWords(b)).toMatch(/1\.1× its depreciation and amortization \(\$26\.0 billion\)/);
    expect(buildWords(b)).toMatch(/About the same pace as in FY2023 \(1\.1×\)\.$/); // 21.919 / 20.641 = 1.062, +2.7%
  });

  it('never shows an old year as today’s', () => {
    const gone = { ...msft, values: { ...msft.values, depreciation: [9.3, 12.6, 11.0, 15.2, null, null].map((x) => (x == null ? null : x * B)) } };
    const s = buildRate(gone);
    expect(s).toEqual({ lastShown: '2024-06-30' });
    expect(buildStaleWords(s as { lastShown: string })).toBe(
      'The newest cash-flow statement doesn’t show both capital spending and depreciation; they were last shown together for FY2024, so today’s pace can’t be read from the filings.',
    );
    expect(buildRate({ periods: ['2025-12-31'], values: { operatingCashFlow: [1], capex: [1] } })).toBeNull();
  });
});

describe('Free cash flow after stock pay', () => {
  it('Microsoft FY2026', () => {
    const s = stockPay(msft, 3.5e12) as StockPay;
    // FCF 182.935 - 115.948 = 66.987; stock pay 12.405 = 18.52% of it; after 54.582
    expect(s.latest.fcf / B).toBeCloseTo(66.987, 6);
    expect(s.share).toBeCloseTo(0.185185, 5);
    expect(s.after / B).toBeCloseTo(54.582, 6);
    // FY2022-26: stock pay 52.226 / FCF 337.293 = 15.48%
    expect(s.window.length).toBe(5);
    expect(s.share5).toBeCloseTo(0.154839, 5);
    // yields on a $3.5 trillion market value: 66.987 / 3500 = 1.91%, 54.582 / 3500 = 1.56%
    expect(s.fcfYield).toBeCloseTo(0.019139, 5);
    expect(s.afterYield).toBeCloseTo(0.015595, 5);
    expect(payWords(s)).toBe(
      'In FY2026 free cash flow was $67.0 billion. Paying staff in stock cost another $12.4 billion, 19% of it, which free cash flow doesn’t count because no cash left the company. After stock pay: $54.6 billion. Over 5 years (FY2022–FY2026) stock pay came to 15% of free cash flow. At today’s market value that is a free-cash-flow yield of 1.9%, or 1.6% after stock pay.',
    );
  });

  it('Apple FY2026 without a market value', () => {
    const s = stockPay(aapl, null) as StockPay;
    expect(s.share).toBeCloseTo(0.101348, 5); // 13.789 / 136.056
    expect(s.fcfYield).toBeNull();
    expect(payWords(s)).not.toMatch(/market value/);
  });

  it('Amazon FY2025: stock pay larger than free cash flow', () => {
    const s = stockPay(amzn, null) as StockPay;
    // FCF 139.514 - 131.819 = 7.695; stock pay 19.467 = 253% of it; after -11.772
    expect(s.share).toBeCloseTo(2.529825, 5);
    expect(s.after / B).toBeCloseTo(-11.772, 6);
    // FY2021-25: FCF -14.726 - 16.893 + 32.217 + 32.878 + 7.695 = 41.171; stock pay 97.879 -> 237.7%
    expect(s.share5).toBeCloseTo(2.377378, 5);
    expect(payWords(s)).toBe(
      'In FY2025 free cash flow was $7.7 billion. Paying staff in stock cost another $19.5 billion, 253% of it, which free cash flow doesn’t count because no cash left the company. After stock pay: −$11.8 billion. Over 5 years (FY2021–FY2025) stock pay came to 238% of free cash flow.',
    );
  });

  it('negative free cash flow is said plainly, never as a percentage', () => {
    const neg = { ...amzn, periods: amzn.periods.slice(0, 3), values: Object.fromEntries(Object.entries(amzn.values).map(([k, v]) => [k, v.slice(0, 3)])) };
    const s = stockPay(neg, null) as StockPay;
    // FY2022: 46.752 - 63.645 = -16.893
    expect(s.share).toBeNull();
    expect(s.share5).toBeNull(); // 25.924 - 14.726 - 16.893 = -5.695
    expect(payWords(s)).toBe(
      'In FY2022 free cash flow was negative (−$16.9 billion), and paying staff in stock cost another $19.6 billion: −$36.5 billion after stock pay. Over 3 years (FY2020–FY2022) free cash flow added up to nothing or less.',
    );
  });

  it('no stock pay reported = nothing to show; an old year is never today’s', () => {
    expect(stockPay(xom, 4e11)).toBeNull();
    const gone = { ...msft, values: { ...msft.values, stockComp: [6.118, 7.502, 9.611, 10.734, 11.974, null].map((x) => (x == null ? null : x * B)) } };
    const s = stockPay(gone, null);
    expect(s).toEqual({ lastShown: '2025-06-30' });
    expect(payStaleWords(s as { lastShown: string })).toBe('The newest cash-flow statement doesn’t show free cash flow and stock pay together; they were last shown for FY2025.');
  });
});
