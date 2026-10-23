/**
 * Bond maths for the bond calculator, CUSIP lookup and ladder builder. Prices are per 100 of face value,
 * yields and coupons are fractions (0.05 = 5%). Time to maturity is in years and may be fractional: the next
 * coupon is assumed to fall a whole number of coupon periods before maturity (the usual street convention).
 */

export interface BondInputs {
  /** Annual coupon rate, e.g. 0.05 */
  coupon: number;
  /** Years to maturity, e.g. 9.5 */
  years: number;
  /** Coupons per year: 1, 2 (most US bonds), 4 or 12. 0 = zero-coupon. */
  frequency: number;
}

export interface BondAnalytics {
  cleanPrice: number;
  dirtyPrice: number;
  accrued: number;
  yieldToMaturity: number;
  currentYield: number | null;
  macaulayDuration: number;
  modifiedDuration: number;
  convexity: number;
  /** Price change per 100 face for a 0.01% (1 basis point) move in yield. */
  dv01: number;
}

/** Cash flows as (time in years, amount per 100 face). */
function cashFlows({ coupon, years, frequency }: BondInputs): { years: number; cf: number }[] {
  if (years <= 0) return [];
  if (!frequency || coupon === 0) return [{ years, cf: 100 }];
  const flows: { years: number; cf: number }[] = [];
  for (let t = years * frequency; t > 1e-9; t -= 1) flows.unshift({ years: t / frequency, cf: (coupon * 100) / frequency });
  flows[flows.length - 1].cf += 100;
  return flows;
}

/** Compounding periods per year for discounting (zero-coupon yields are quoted semi-annually, like Treasury STRIPS). */
const compounding = (b: BondInputs) => b.frequency || 2;

/** Accrued interest per 100 face: the part of the current coupon already earned by the holder. */
export function accruedInterest(b: BondInputs): number {
  if (!b.frequency || b.coupon === 0) return 0;
  const n = b.years * b.frequency;
  const toNext = n - Math.ceil(n - 1e-9) + 1; // periods until the next coupon, in (0, 1]
  return ((b.coupon * 100) / b.frequency) * (1 - toNext);
}

function dirtyFromYield(b: BondInputs, y: number): number {
  const f = compounding(b);
  return cashFlows(b).reduce((sum, { years, cf }) => sum + cf / (1 + y / f) ** (years * f), 0);
}

export function priceFromYield(b: BondInputs, y: number): number {
  return dirtyFromYield(b, y) - accruedInterest(b);
}

/** Yield to maturity for a clean price (solved by bisection; works for any price that makes sense). */
export function yieldFromPrice(b: BondInputs, cleanPrice: number): number {
  const target = cleanPrice + accruedInterest(b);
  let lo = -0.99;
  let hi = 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (dirtyFromYield(b, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function analyze(b: BondInputs, y: number): BondAnalytics {
  const f = compounding(b);
  const r = 1 + y / f;
  let dirty = 0;
  let weighted = 0;
  let convex = 0;
  for (const { years, cf } of cashFlows(b)) {
    const p = years * f;
    const pv = cf / r ** p;
    dirty += pv;
    weighted += p * pv;
    convex += p * (p + 1) * pv;
  }
  const accrued = accruedInterest(b);
  const clean = dirty - accrued;
  const macaulay = dirty ? weighted / dirty / f : 0;
  const modified = macaulay / r;
  return {
    cleanPrice: clean,
    dirtyPrice: dirty,
    accrued,
    yieldToMaturity: y,
    currentYield: b.coupon && clean > 0 ? (b.coupon * 100) / clean : null,
    macaulayDuration: macaulay,
    modifiedDuration: modified,
    convexity: dirty ? convex / (dirty * r * r * f * f) : 0,
    dv01: modified * dirty * 0.0001,
  };
}

/** Estimated % price change for a change in yield (e.g. +0.01 = rates up 1%), using duration and convexity. */
export function priceChangeEstimate(a: Pick<BondAnalytics, 'modifiedDuration' | 'convexity'>, dy: number): number {
  return -a.modifiedDuration * dy + 0.5 * a.convexity * dy * dy;
}

/** The taxable yield that would match a tax-free (municipal) yield after tax. */
export function taxEquivalentYield(taxFreeYield: number, federalRate: number, stateRate = 0): number {
  const keep = 1 - federalRate - stateRate * (1 - federalRate);
  return keep > 0 ? taxFreeYield / keep : NaN;
}

/** Years from today until a YYYY-MM-DD date. */
export function yearsUntil(date: string, today = new Date()): number {
  const end = new Date(`${date}T00:00:00Z`).getTime();
  return (end - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / (365.25 * 86400000);
}

/** Interpolates a yield for any maturity from curve points (years → yield), flat beyond the ends. */
export function interpolateCurve(points: { years: number; yield: number }[], years: number): number | null {
  const pts = [...points].filter((p) => Number.isFinite(p.yield)).sort((a, b) => a.years - b.years);
  if (!pts.length) return null;
  if (years <= pts[0].years) return pts[0].yield;
  for (let i = 1; i < pts.length; i++) {
    if (years <= pts[i].years) {
      const a = pts[i - 1];
      const b = pts[i];
      return a.yield + ((b.yield - a.yield) * (years - a.years)) / (b.years - a.years);
    }
  }
  return pts[pts.length - 1].yield;
}

/** Curve labels like "3M", "2Y" in years. */
export function labelYears(label: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([MY])$/i.exec(label.trim());
  if (!m) return null;
  return m[2].toUpperCase() === 'M' ? +m[1] / 12 : +m[1];
}

export interface LadderRung {
  year: number;
  amount: number;
  yield: number;
  income: number;
}

/** Splits money evenly into bonds maturing each year, priced off the Treasury curve. */
export function buildLadder(total: number, firstYear: number, lastYear: number, curve: { years: number; yield: number }[]): LadderRung[] {
  const years: number[] = [];
  for (let y = Math.max(1, firstYear); y <= lastYear; y++) years.push(y);
  if (!years.length) return [];
  const each = total / years.length;
  return years.map((year) => {
    const y = interpolateCurve(curve, year) ?? 0;
    return { year, amount: each, yield: y, income: each * y };
  });
}
