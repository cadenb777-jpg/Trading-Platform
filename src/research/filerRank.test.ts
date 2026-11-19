import { describe, expect, it } from 'vitest';
import { METRICS, placeWords, standsOut, summaryWords, type FilerRank, type Ranked } from './filerRank';

// Coca-Cola FY2025 as engine/filerrank.py ranked it on the SEC frames of 2026-11-18 (assets >= $100 million)
const r = (value: number, percentile: number, n: number): Ranked => ({ value, percentile, n, p25: 0, median: 0, p75: 0 });
const ko: FilerRank = {
  year: 2025,
  company: { end: '2025-12-31', accn: '0001628280-26-010047', assets: 104_816e6, small: false },
  metrics: {
    grossProfitability: r(0.281865, 54.7, 1474),
    operatingMargin: r(0.287061, 90.6, 2539),
    returnOnAssets: r(0.127646, 91.4, 3861),
    salesGrowth: r(0.018699, 34.2, 3028),
    assetGrowth: r(0.042437, 46.9, 4055),
    accruals: r(0.055501, 91.3, 3768),
    inventoryVsSales: r(-0.082785, 31.4, 1610),
    // helper 91 (frames of 2026-11-19): ln(4,313 / 4,320) diluted shares; Coca-Cola tags no R&D line
    shareIssuance: r(-0.0016217, 35.3, 3619),
    rdIntensity: null,
  },
  minAssets: 100e6,
};

describe('Among US companies', () => {
  it('places in plain words', () => {
    expect(placeWords(ko.metrics.operatingMargin!)).toBe('higher than 90% of 2,539');
    expect(placeWords(ko.metrics.salesGrowth!)).toBe('lower than 65% of 3,028');
    expect(placeWords(ko.metrics.grossProfitability!)).toBe('about the middle of 1,474');
    // never "higher than 100%"
    expect(placeWords(r(1, 100, 10))).toBe('higher than 99% of 10');
    expect(placeWords(r(1, 0, 10))).toBe('lower than 99% of 10');
  });

  it('formats every reading', () => {
    const f = Object.fromEntries(METRICS.filter((m) => ko.metrics[m.key]).map((m) => [m.key, m.format(ko.metrics[m.key]!.value)]));
    // share count change: the log change shown as the % change it equals, e^-0.0016217 - 1 = -0.16%
    expect(f).toEqual({ grossProfitability: '$0.28', operatingMargin: '28.7%', returnOnAssets: '12.8%', salesGrowth: '+1.9%', assetGrowth: '+4.2%', accruals: '+5.6%', inventoryVsSales: '−8.3 pts', shareIssuance: '−0.2%' });
    // Apple FY2025: R&D 34,550 / sales 416,161; ln(15,004.697 / 15,408.095) = 2.6% fewer shares
    const rd = METRICS.find((m) => m.key === 'rdIntensity')!;
    const sh = METRICS.find((m) => m.key === 'shareIssuance')!;
    expect([rd.format(0.083021), sh.format(-0.02653)]).toEqual(['8.3%', '−2.6%']);
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
