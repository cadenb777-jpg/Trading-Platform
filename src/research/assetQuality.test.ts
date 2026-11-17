import { describe, expect, it } from 'vitest';
import type { Statements } from './debtDilution';
import { ahead, assetGrowth, dollars, gpWords, grossProfitability, growthWords, staleWords, type AssetGrowth, type GrossProfitability } from './assetQuality';

// SEC company facts as research.statements builds them, checked live 2026-11-17 ($bn).
const B = 1e9;
function company(periods: string[], v: Record<string, (number | null)[]>): Statements {
  return { periods, values: Object.fromEntries(Object.entries(v).map(([k, xs]) => [k, xs.map((x) => (x == null ? null : x * B))])) };
}
const msft = company(['2017-06-30', '2018-06-30', '2019-06-30', '2020-06-30', '2021-06-30', '2022-06-30', '2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30'], {
  revenue: [96.571, 110.36, 125.843, 143.015, 168.088, 198.27, 211.915, 245.122, 281.724, 331.839],
  grossProfit: [62.31, 72.007, 82.933, 96.937, 115.856, 135.62, 146.052, 171.008, 193.893, 225.465],
  totalAssets: [250.312, 258.848, 286.556, 301.311, 333.779, 364.84, 411.976, 512.163, 619.003, 758.376],
});
const nvda = company(['2017-01-29', '2018-01-28', '2019-01-27', '2020-01-26', '2021-01-31', '2022-01-30', '2023-01-29', '2024-01-28', '2025-01-26', '2026-01-25'], {
  revenue: [6.91, 9.714, 11.716, 10.918, 16.675, 26.914, 26.974, 60.922, 130.497, 215.938],
  grossProfit: [4.063, 5.822, 7.171, 6.768, 10.396, 17.475, 15.356, 44.301, 97.858, 153.463],
  totalAssets: [9.841, 11.241, 13.292, 17.315, 28.791, 44.187, 41.182, 65.728, 111.601, 206.803],
});
const ko = company(['2023-12-31', '2024-12-31', '2025-12-31'], {
  revenue: [45.754, 47.061, 47.941],
  grossProfit: [27.234, 28.737, 29.544],
  totalAssets: [97.703, 100.549, 104.816],
});

describe('Gross profitability', () => {
  it('Microsoft FY2026 in the middle of its own range', () => {
    const g = grossProfitability(msft) as GrossProfitability;
    // 225.465 / 758.376 = 0.2973; range 62.31 / 250.312 = 0.2489 (FY2017) to 135.62 / 364.84 = 0.3717 (FY2022)
    expect(g.latest.ratio).toBeCloseTo(0.2973, 4);
    expect(g.low).toBeCloseTo(0.248929, 5);
    expect(g.high).toBeCloseTo(0.371725, 5);
    expect(g.place).toBe('middle'); // (0.2973 - 0.2489) / (0.3717 - 0.2489) = 0.39
    expect(gpWords(g)).toBe(
      'In FY2026 the company made $0.30 of gross profit for every dollar of assets ($225 billion ÷ $758 billion). Since FY2017 it has ranged from $0.25 to $0.37; this year sits in the middle third of that range. Novy-Marx (2013) found that US companies earning more gross profit per dollar of assets went on to earn higher returns than those earning less (1963–2010).',
    );
  });

  it('NVIDIA FY2026 in the upper third; short histories get no place', () => {
    const g = grossProfitability(nvda) as GrossProfitability;
    expect(g.latest.ratio).toBeCloseTo(0.742078, 5); // 153.463 / 206.803
    expect(g.place).toBe('upper'); // range 0.3611 (FY2021) to 0.8769 (FY2025): 0.74
    const k = grossProfitability(ko) as GrossProfitability;
    expect(k.place).toBeNull();
    expect(gpWords(k)).not.toMatch(/ranged/);
  });

  it('never an old year as today’s; nothing without gross profit', () => {
    const gone = { ...msft, values: { ...msft.values, grossProfit: msft.values.grossProfit.map((x, i) => (i === 9 ? null : x)) } };
    const s = grossProfitability(gone);
    expect(s).toEqual({ lastShown: '2025-06-30', missing: 'gross profit' });
    expect(staleWords(s as { lastShown: string; missing: string })).toBe('The newest filings don’t show gross profit; it was last worked out for FY2025.');
    // the line actually missing is named: here total assets, not gross profit
    const noAssets = { ...msft, values: { ...msft.values, totalAssets: msft.values.totalAssets.map((x, i) => (i === 9 ? null : x)) } };
    expect(grossProfitability(noAssets)).toEqual({ lastShown: '2025-06-30', missing: 'total assets' });
    expect(grossProfitability({ periods: ['2025-12-31'], values: { totalAssets: [1] } })).toBeNull();
  });

  it('a gross loss is said as one, with a real minus sign', () => {
    expect(dollars(-0.05)).toBe('−$0.05');
    expect(dollars(0.3)).toBe('$0.30');
    const loss = company(['2025-12-31'], { revenue: [0.228], grossProfit: [-0.012], totalAssets: [0.24] });
    expect(gpWords(grossProfitability(loss) as GrossProfitability)).toMatch(/^In FY2025 the company sold its goods for less than they cost to make: a gross loss of \$0\.05 for every dollar of assets \(−\$12 million on \$240 million\)\./);
  });
});

describe('Asset growth', () => {
  it('Microsoft FY2026: assets growing faster than sales', () => {
    const g = assetGrowth(msft) as AssetGrowth;
    // 758.376 / 619.003 - 1 = 22.52%; sales 331.839 / 281.724 - 1 = 17.79%; 4.73 points faster
    expect(g.latest.assetGrowth).toBeCloseTo(0.225157, 5);
    expect(g.latest.salesGrowth).toBeCloseTo(0.177887, 5);
    expect(g.latest.gap).toBeCloseTo(0.04727, 4);
    expect(g.history.map((y) => y.end)).toEqual(['2022-06-30', '2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30']);
    expect(ahead(g.latest)).toBe(true);
    expect(growthWords(g)).toBe(
      'Total assets grew 22.5% in FY2026 to $758 billion while sales grew 17.8%: asset growth was 4.7 points above sales growth, so each dollar of sales needs more capital than a year before. Cooper, Gulen and Schill (2008) found that US companies whose assets grew fastest went on to earn lower returns than the slowest growers.',
    );
  });

  it('Coca-Cola FY2025 and the in-step band', () => {
    const g = assetGrowth(ko) as AssetGrowth;
    // 104.816 / 100.549 - 1 = 4.24%; sales 47.941 / 47.061 - 1 = 1.87%
    expect(g.latest.assetGrowth).toBeCloseTo(0.042437, 5);
    expect(g.latest.gap).toBeCloseTo(0.023738, 5);
    const step = { ...g, latest: { ...g.latest, assetGrowth: 0.024, salesGrowth: 0.019, gap: 0.005 } };
    expect(growthWords(step)).toMatch(/: about in step\./);
    expect(ahead(step.latest)).toBe(false);
    const shrink = { ...g, latest: { ...g.latest, assetGrowth: -0.03, salesGrowth: 0.02, gap: -0.05 } };
    expect(growthWords(shrink)).toMatch(/^Total assets shrank 3\.0% in FY2025 to \$105 billion while sales grew 2\.0%: asset growth was 5\.0 points below sales growth, so each dollar of sales needs less capital/);
    // both shrinking: never "faster" next to "shrank"
    const both = { ...g, latest: { ...g.latest, assetGrowth: -0.03, salesGrowth: -0.1, gap: 0.07 } };
    expect(growthWords(both)).toMatch(/shrank 3\.0% .* while sales fell 10\.0%: asset growth was 7\.0 points above sales growth/);
  });

  it('only compares year-ends a fiscal year apart', () => {
    const gap = { periods: msft.periods.filter((_, i) => i !== 8), values: Object.fromEntries(Object.entries(msft.values).map(([k, v]) => [k, v.filter((_, i) => i !== 8)])) };
    // FY2025 is missing: FY2026 can't be compared with FY2024, so the newest growth isn't today's
    expect(assetGrowth(gap)).toEqual({ lastShown: '2024-06-30', missing: 'total assets for two year-ends in a row' });
  });
});
