import { describe, expect, it } from 'vitest';
import type { Statements } from './debtDilution';
import { cashCycle, coverWord, coverWords, cycleWords, dividendCover, type Cycle, type CycleMissing } from './cashHealth';

// SEC company facts, checked live 2026-11-13 ($bn). Apple fiscal years end late September, Coca-Cola in December.
const B = 1e9;
const aapl: Statements = {
  periods: ['2021-09-25', '2022-09-24', '2023-09-30', '2024-09-28', '2025-09-27', '2026-09-26'],
  values: {
    freeCashFlow: [92.953, 111.443, 99.584, 108.807, 98.767, 136.056].map((x) => x * B),
    capex: [11.085, 10.708, 10.959, 9.447, 12.715, 9.041].map((x) => x * B),
    dividends: [14.467, 14.841, 15.025, 15.234, 15.421, 15.721].map((x) => x * B),
    buybacks: [85.971, 89.402, 77.55, 94.949, 90.711, 86.39].map((x) => x * B),
    revenue: [365.817, 394.328, 383.285, 391.035, 416.161, 478.834].map((x) => x * B),
    costOfRevenue: [212.981, 223.546, 214.137, 210.352, 220.96, 245.232].map((x) => x * B),
    receivables: [26.278, 28.184, 29.508, 33.41, 39.777, 43.817].map((x) => x * B),
    inventory: [6.58, 4.946, 6.331, 7.286, 5.718, 14.541].map((x) => x * B),
    payables: [54.763, 64.115, 62.611, 68.96, 69.86, 82.252].map((x) => x * B),
  },
};
const ko: Statements = {
  periods: ['2021-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'],
  values: {
    freeCashFlow: [11.258, 9.534, 9.747, 4.741, 5.296].map((x) => x * B),
    capex: [1.367, 1.484, 1.852, 2.064, 2.112].map((x) => x * B),
    dividends: [7.252, 7.616, 7.952, 8.359, 8.779].map((x) => x * B),
    buybacks: [0.111, 1.418, 2.289, 1.795, 0.746].map((x) => x * B),
    revenue: [38.655, 43.004, 45.754, 47.061, 47.941].map((x) => x * B),
    costOfRevenue: [15.357, 18.0, 18.52, 18.324, 18.397].map((x) => x * B),
    receivables: [3.512, 3.487, 3.41, 3.569, 3.038].map((x) => x * B),
    inventory: [3.414, 4.233, 4.424, 4.728, 4.425].map((x) => x * B),
    payables: [null, null, null, null, null], // only a combined payables-and-accrued line
  },
};

describe('Dividend cover by free cash flow', () => {
  it('covers Apple’s dividend many times, but not dividends plus buybacks by much', () => {
    const c = dividendCover(aapl)!;
    // FY2026: 136.056 / 15.721 = 8.6544; 5 years FY2022-FY2026: 554.657 / 76.242 = 7.2750
    expect(c.cover).toBeCloseTo(8.654411, 5);
    expect([c.years, c.from]).toEqual([5, '2022-09-24']);
    expect(c.cover5).toBeCloseTo(7.274953, 5);
    // with buybacks, 5 years: 554.657 / (76.242 + 439.002) = 1.0765; the table rows are exactly the window
    expect(c.window.map((r) => r.end)).toEqual(aapl.periods.slice(1));
    expect(c.totalCover5).toBeCloseTo(1.076494, 5);
    expect(coverWord(c)).toBe('covered');
    expect(coverWords(c)).toBe(
      'In FY2026 free cash flow ($136 billion) covered the dividend ($15.7 billion) 8.7 times. Over 5 years (FY2022–FY2026) it covered it 7.3 times, every year. With buybacks added, 1.1 times over those years.',
    );
  });

  it('says when free cash flow fell short (Coca-Cola FY2025)', () => {
    const c = dividendCover(ko)!;
    // FY2025: 5.296 / 8.779 = 0.6033; 5 years: 40.576 / 39.958 = 1.0155; short in FY2024 and FY2025
    expect(c.cover).toBeCloseTo(0.603258, 5);
    expect(c.cover5).toBeCloseTo(1.015466, 5);
    expect(c.shortYears).toEqual(['2024-12-31', '2025-12-31']);
    // with buybacks: 40.576 / (39.958 + 6.359) = 0.8761
    expect(c.totalCover5).toBeCloseTo(0.876050, 5);
    expect(coverWord(c)).toBe('thin');
    expect(coverWords(c)).toBe(
      'In FY2025 free cash flow ($5.3 billion) paid only 60% of the dividend ($8.8 billion): the rest came from cash on hand or borrowing. Over 5 years (FY2021–FY2025) it covered it 1.0 times, falling short in FY2024 and FY2025. With buybacks added the company paid out more than its free cash flow over those years (88% covered).',
    );
  });

  it('stops the window at a missing year and ignores non-payers', () => {
    const gap = { ...aapl, values: { ...aapl.values, freeCashFlow: [92.953 * B, 111.443 * B, null, 108.807 * B, 98.767 * B, 136.056 * B] } };
    const c = dividendCover(gap)!;
    expect([c.years, c.from]).toEqual([3, '2024-09-28']);
    expect(dividendCover({ periods: ['2025'], values: { freeCashFlow: [1e9], dividends: [0], capex: [0] } })).toBeNull();
    expect(dividendCover({ periods: ['2025-12-31'], values: { freeCashFlow: [1e9], dividends: [0.5e9], capex: [0.1e9] } })!.cover5).toBeNull();
    // a year without a capital spending line is never used (free cash flow would count capex as zero)
    const noCapex = { ...aapl, values: { ...aapl.values, capex: [11.085 * B, 10.708 * B, 10.959 * B, 9.447 * B, 12.715 * B, null] } };
    expect(dividendCover(noCapex)!.end).toBe('2025-09-27');
  });

  it('reads negative free cash flow plainly, and buybacks over the whole window', () => {
    const neg: Statements = {
      periods: ['2023-12-31', '2024-12-31', '2025-12-31'],
      values: { freeCashFlow: [-1e9, -2e9, -2e9], dividends: [4e9, 4e9, 4e9], capex: [1e9, 1e9, 1e9], buybacks: [3e9, 1e9, 0] },
    };
    const c = dividendCover(neg)!;
    expect(coverWords(c)).toBe(
      'In FY2025 free cash flow was negative (−$2.0 billion): none of the dividend ($4.0 billion) came from it, so it was paid from cash on hand or borrowing. Over 3 years (FY2023–FY2025) free cash flow added up to less than nothing, so none of the dividends came from it. With buybacks added, all of the payout came from elsewhere over those years.',
    );
    expect(coverWord(c)).toBe('not covered');
    // no buybacks in the newest year, but earlier ones still count
    const late: Statements = { ...neg, values: { ...neg.values, freeCashFlow: [5e9, 5e9, 5e9] } };
    expect(coverWords(dividendCover(late)!)).toMatch(/With buybacks added the company paid out more than its free cash flow over those years \(94% covered\)\.$/);
  });
});

describe('Cash conversion cycle', () => {
  it('works out Apple’s days from year-end balances', () => {
    const c = cashCycle(aapl) as Cycle;
    // FY2026: DSO 43.817/478.834*365 = 33.400; DIO 14.541/245.232*365 = 21.643; DPO 82.252/245.232*365 = 122.423
    expect(c.latest.dso).toBeCloseTo(33.400312, 5);
    expect(c.latest.dio).toBeCloseTo(21.642628, 5);
    expect(c.latest.dpo).toBeCloseTo(122.422767, 5);
    expect(c.latest.ccc).toBeCloseTo(-67.379827, 5);
    // FY2025: 34.887 + 9.445 - 115.401 = -71.068
    expect(c.previous!.ccc).toBeCloseTo(-71.068069, 5);
    expect(cycleWords(c)).toBe(
      'In FY2026 customers pay in about 33 days, stock sits 22 days and it pays suppliers in 122 days, so it is paid 67 days before it pays: suppliers fund its working capital. That is 4 days longer than in FY2025 (more cash tied up).',
    );
  });

  it('never guesses payables, and counts no inventory only when none is ever reported', () => {
    expect(cashCycle(ko) as CycleMissing).toEqual({ missing: 'payables' });
    const svc = { ...aapl, values: { ...aapl.values, inventory: Array(6).fill(null) } };
    const c = cashCycle(svc) as Cycle;
    expect(c.noInventory).toBe(true);
    expect(c.latest.dio).toBe(0);
    expect(cycleWords(c)).toMatch(/^In FY2026 customers pay in about 33 days and it pays suppliers in 122 days, .*The filings have no inventory line, so this counts only customer and supplier days/);
    // one missing inventory year among reported ones: that year is left out, not counted as zero
    const gap = { ...aapl, values: { ...aapl.values, inventory: [6.58 * B, 4.946 * B, 6.331 * B, 7.286 * B, 5.718 * B, null] } };
    const g = cashCycle(gap) as Cycle;
    expect([g.latest.end, g.noInventory]).toEqual(['2025-09-27', false]);
    // positive cycle wording
    const slow: Statements = { periods: ['2024-12-31', '2025-12-31'], values: { revenue: [100, 100], costOfRevenue: [60, 60], receivables: [20, 20], inventory: [15, 15], payables: [5, 5] } };
    expect(cycleWords(cashCycle(slow) as Cycle)).toMatch(/cash is tied up for 134 days between paying suppliers and being paid\. About the same as in FY2024\.$/);
  });
});
