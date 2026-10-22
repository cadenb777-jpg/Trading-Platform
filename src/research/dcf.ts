/** Discounted cash flow valuation: what a company is worth today from its future free cash flow. */

export interface DcfInputs {
  /** Free cash flow over the last year ($). */
  baseFcf: number;
  /** Yearly growth for the first five years (0.08 = 8%). */
  growth: number;
  /** Long-run growth after year ten, forever (usually 2–3%). */
  terminalGrowth: number;
  /** The yearly return investors require (WACC). */
  discountRate: number;
  /** Debt minus cash ($). */
  netDebt: number;
  shares: number;
}

export interface DcfResult {
  years: { year: number; growth: number; fcf: number; pv: number }[];
  pvCashFlows: number;
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  perShare: number;
}

/** Ten-year model: `growth` for years 1–5, then fading in a straight line to `terminalGrowth` by year 10. */
export function dcf(i: DcfInputs): DcfResult {
  const years: DcfResult['years'] = [];
  let fcf = i.baseFcf;
  let pvCashFlows = 0;
  for (let year = 1; year <= 10; year++) {
    const growth = year <= 5 ? i.growth : i.growth + ((i.terminalGrowth - i.growth) * (year - 5)) / 5;
    fcf *= 1 + growth;
    const pv = fcf / (1 + i.discountRate) ** year;
    pvCashFlows += pv;
    years.push({ year, growth, fcf, pv });
  }
  const terminalValue = i.discountRate > i.terminalGrowth ? (fcf * (1 + i.terminalGrowth)) / (i.discountRate - i.terminalGrowth) : NaN;
  const pvTerminal = terminalValue / (1 + i.discountRate) ** 10;
  const enterpriseValue = pvCashFlows + pvTerminal;
  const equityValue = enterpriseValue - i.netDebt;
  return { years, pvCashFlows, terminalValue, pvTerminal, enterpriseValue, equityValue, perShare: i.shares > 0 ? equityValue / i.shares : NaN };
}

export interface WaccInputs {
  riskFree: number;
  beta: number;
  equityPremium: number;
  costOfDebt: number;
  taxRate: number;
  marketCap: number;
  debt: number;
}

/** Weighted average cost of capital: the blended return owed to shareholders (CAPM) and lenders (after tax). */
export function wacc(i: WaccInputs) {
  const costOfEquity = i.riskFree + i.beta * i.equityPremium;
  const afterTaxDebt = i.costOfDebt * (1 - i.taxRate);
  const total = i.marketCap + i.debt;
  const equityWeight = total > 0 ? i.marketCap / total : 1;
  return { costOfEquity, afterTaxDebt, equityWeight, wacc: equityWeight * costOfEquity + (1 - equityWeight) * afterTaxDebt };
}

/** Value per share for a grid of discount rates (rows) and terminal growth rates (columns). */
export function sensitivity(i: DcfInputs, rates: number[], growths: number[]) {
  return rates.map((r) => growths.map((g) => dcf({ ...i, discountRate: r, terminalGrowth: g }).perShare));
}

/** The growth rate (years 1–5) the current price implies, found by bisection. */
export function impliedGrowth(i: DcfInputs, price: number): number | null {
  let lo = -0.5;
  let hi = 1;
  const at = (g: number) => dcf({ ...i, growth: g }).perShare - price;
  if (!Number.isFinite(at(lo)) || at(lo) > 0 || at(hi) < 0) return null;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
