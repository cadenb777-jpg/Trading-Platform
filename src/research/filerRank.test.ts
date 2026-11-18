import { describe, expect, it } from 'vitest';
import { METRICS, placeWords, standsOut, summaryWords, type FilerRank, type Ranked } from './filerRank';

// Coca-Cola FY2025 as engine/filerrank.py ranked it on the SEC frames of 2026-11-18 (assets >= $100 million)
const r = (value: number, percentile: number, n: number): Ranked => ({ value, percentile, n, p25: 0, median: 0, p75: 0 });
const ko: FilerRank = {
  year: 2025,
  company: { end: '2025-12-31', accn: '0001628280-26-010047', assets: 104_816e6, small: false },
  metrics: {
    grossProfitability: r(0.281865, 54.7, 1474),
    operatingMargin: r(0.287061, 90.8, 2540),
    returnOnAssets: r(0.127646, 91.4, 3861),
    salesGrowth: r(0.018699, 34.1, 3030),
    assetGrowth: r(0.042437, 46.9, 4055),
    accruals: r(0.055501, 91.3, 3768),
    inventoryVsSales: r(-0.082785, 31.3, 1610),
  },
  minAssets: 100e6,
};

describe('Among US companies', () => {
  it('places in plain words', () => {
    expect(placeWords(ko.metrics.operatingMargin!)).toBe('higher than 90% of 2,540');
    expect(placeWords(ko.metrics.salesGrowth!)).toBe('lower than 65% of 3,030');
    expect(placeWords(ko.metrics.grossProfitability!)).toBe('about the middle of 1,474');
    // never "higher than 100%"
    expect(placeWords(r(1, 100, 10))).toBe('higher than 99% of 10');
    expect(placeWords(r(1, 0, 10))).toBe('lower than 99% of 10');
  });

  it('formats every reading', () => {
    const f = Object.fromEntries(METRICS.map((m) => [m.key, m.format(ko.metrics[m.key]!.value)]));
    expect(f).toEqual({ grossProfitability: '$0.28', operatingMargin: '28.7%', returnOnAssets: '12.8%', salesGrowth: '+1.9%', assetGrowth: '+4.2%', accruals: '+5.6%', inventoryVsSales: '−8.3 pts' });
  });

  it('names the top and bottom tenths', () => {
    expect(summaryWords(ko)).toBe('It sits in the top tenth of US companies for operating margin, return on assets and accruals.');
    expect(standsOut(ko.metrics.accruals!)).toBe(true);
    const low = { ...ko, metrics: { ...ko.metrics, salesGrowth: r(-0.2, 4, 3021) } };
    expect(summaryWords(low)).toBe('It sits in the top tenth of US companies for operating margin, return on assets and accruals, and in the bottom tenth for sales growth.');
    const plain = { ...ko, metrics: { assetGrowth: r(0.04, 46.9, 4055), accruals: null } };
    expect(summaryWords(plain)).toBe('Its one reading is not in the top or bottom tenth of US companies.');
    expect(summaryWords({ ...ko, metrics: { assetGrowth: r(0.04, 46.9, 4055), salesGrowth: r(0.02, 34.2, 3021) } })).toBe('None of its 2 readings is in the top or bottom tenth of US companies.');
    expect(summaryWords({ ...ko, metrics: {} })).toMatch(/^None of these readings could be worked out/);
  });
});
