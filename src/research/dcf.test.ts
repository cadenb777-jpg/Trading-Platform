import { describe, expect, it } from 'vitest';
import { dcf, impliedGrowth, sensitivity, wacc } from './dcf';

const base = { baseFcf: 100, growth: 0.1, terminalGrowth: 0.03, discountRate: 0.09, netDebt: 200, shares: 10 };

describe('dcf', () => {
  it('projects ten years and discounts them', () => {
    const r = dcf(base);
    expect(r.years).toHaveLength(10);
    expect(r.years[0].fcf).toBeCloseTo(110);
    expect(r.years[0].pv).toBeCloseTo(110 / 1.09 ** 0.5); // mid-year convention
    expect(r.years[9].growth).toBeCloseTo(0.03);
    const fcf10 = r.years[9].fcf;
    expect(r.terminalValue).toBeCloseTo((fcf10 * 1.03) / 0.06);
    expect(r.perShare).toBeCloseTo((r.pvCashFlows + r.terminalValue / 1.09 ** 9.5 - 200) / 10);
    expect(r.terminalShare).toBeCloseTo(r.pvTerminal / r.enterpriseValue);
  });

  it('end-of-year convention when asked', () => {
    const r = dcf({ ...base, midYear: false });
    expect(r.years[0].pv).toBeCloseTo(110 / 1.09);
    expect(r.pvTerminal).toBeCloseTo(r.terminalValue / 1.09 ** 10);
    // mid-year is worth exactly (1 + r)^0.5 more: every cash flow arrives half a year sooner
    expect(dcf(base).enterpriseValue / r.enterpriseValue).toBeCloseTo(1.09 ** 0.5, 9);
  });

  it('flat cash flow with no growth equals a perpetuity', () => {
    const r = dcf({ ...base, growth: 0, terminalGrowth: 0, discountRate: 0.1, netDebt: 0, shares: 1, midYear: false });
    expect(r.enterpriseValue).toBeCloseTo(1000, 6);
    // the same perpetuity paid through the year: 100 / 0.1 x 1.1^0.5 = 1048.81
    expect(dcf({ ...base, growth: 0, terminalGrowth: 0, discountRate: 0.1, netDebt: 0, shares: 1 }).enterpriseValue).toBeCloseTo(1048.8088, 3);
  });

  it('is NaN when growth is at or above the discount rate', () => {
    expect(dcf({ ...base, terminalGrowth: 0.09 }).perShare).toBeNaN();
  });

  it('sensitivity grid and implied growth agree with dcf', () => {
    const grid = sensitivity(base, [0.08, 0.09], [0.02, 0.03]);
    expect(grid[1][1]).toBeCloseTo(dcf(base).perShare);
    const price = dcf(base).perShare;
    expect(impliedGrowth(base, price)).toBeCloseTo(0.1, 5);
  });
});

describe('wacc', () => {
  it('blends equity and after-tax debt', () => {
    const w = wacc({ riskFree: 0.04, beta: 1.2, equityPremium: 0.05, costOfDebt: 0.05, taxRate: 0.2, marketCap: 800, debt: 200 });
    expect(w.costOfEquity).toBeCloseTo(0.1);
    expect(w.afterTaxDebt).toBeCloseTo(0.04);
    expect(w.wacc).toBeCloseTo(0.8 * 0.1 + 0.2 * 0.04);
  });
});
