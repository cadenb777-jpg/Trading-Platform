/**
 * Interest-rate risk for a portfolio of bonds: value-weighted duration and convexity, total DV01, and key-rate
 * durations against today's Treasury curve (how much each holding loses if only one part of the curve rises).
 *
 * Key rates: the curve's yields are used as discount rates (semi-annual), plus one constant spread per bond solved
 * so the curve prices the bond at its quoted yield. Each key rate is bumped with a "tent" (full size at that key,
 * fading in a straight line to zero at the neighbouring keys), so the bumps add up to a parallel shift and the key-
 * rate durations add up to the effective duration (Ho 1992, "Key Rate Durations", Journal of Fixed Income).
 */
import { analyze, interpolateCurve, type BondInputs } from './bonds';

export interface BondPosition extends BondInputs {
  name: string;
  /** Face amount owned ($). */
  face: number;
  /** Yield to maturity (fraction). */
  yield: number;
}

export interface PortfolioBondRisk {
  marketValue: number;
  modifiedDuration: number;
  macaulayDuration: number;
  convexity: number;
  /** Dollar change for a 0.01% parallel move. */
  dv01: number;
  rows: { name: string; value: number; weight: number; modifiedDuration: number; convexity: number; dv01: number }[];
}

/** Market-value-weighted duration and convexity (dirty prices), DV01 summed in dollars. */
export function portfolioRisk(bonds: BondPosition[]): PortfolioBondRisk {
  const rows = bonds.map((b) => {
    const a = analyze(b, b.yield);
    const value = (a.dirtyPrice * b.face) / 100;
    return { name: b.name, value, a };
  });
  const total = rows.reduce((s, r) => s + r.value, 0);
  const w = (r: (typeof rows)[number]) => (total ? r.value / total : 0);
  return {
    marketValue: total,
    modifiedDuration: rows.reduce((s, r) => s + w(r) * r.a.modifiedDuration, 0),
    macaulayDuration: rows.reduce((s, r) => s + w(r) * r.a.macaulayDuration, 0),
    convexity: rows.reduce((s, r) => s + w(r) * r.a.convexity, 0),
    dv01: rows.reduce((s, r) => s + r.value * r.a.modifiedDuration * 0.0001, 0),
    rows: rows.map((r) => ({ name: r.name, value: r.value, weight: w(r), modifiedDuration: r.a.modifiedDuration, convexity: r.a.convexity, dv01: r.value * r.a.modifiedDuration * 0.0001 })),
  };
}

export const KEY_RATES = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];

/** Cash flows per 100 face (time in years), the same convention as bonds.ts. */
function flows({ coupon, years, frequency }: BondInputs): { t: number; cf: number }[] {
  if (years <= 0) return [];
  if (!frequency || coupon === 0) return [{ t: years, cf: 100 }];
  const out: { t: number; cf: number }[] = [];
  for (let k = years * frequency; k > 1e-9; k -= 1) out.unshift({ t: k / frequency, cf: (coupon * 100) / frequency });
  out[out.length - 1].cf += 100;
  return out;
}

/** The tent bump at key `k` (index into keys), evaluated at maturity t: 1 at the key, 0 at its neighbours. */
export function tent(keys: number[], k: number, t: number): number {
  const x = keys[k];
  const left = keys[k - 1];
  const right = keys[k + 1];
  if (t === x) return 1;
  if (t < x) return left == null ? 1 : t <= left ? 0 : (t - left) / (x - left);
  return right == null ? 1 : t >= right ? 0 : (right - t) / (right - x);
}

type Curve = { years: number; yield: number }[];

function curvePrice(b: BondInputs, curve: Curve, spread: number, bump: (t: number) => number = () => 0): number {
  return flows(b).reduce((s, { t, cf }) => s + cf / (1 + ((interpolateCurve(curve, t) ?? 0) + spread + bump(t)) / 2) ** (2 * t), 0);
}

/** The constant spread over the curve that gives this dirty price (bisection). */
export function solveSpread(b: BondInputs, curve: Curve, dirtyPrice: number): number {
  let lo = -0.2;
  let hi = 0.5;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (curvePrice(b, curve, mid) > dirtyPrice) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface KeyRateResult {
  keys: number[];
  durations: number[];
  effective: number;
  spread: number;
}

/** Key-rate durations of one bond (per 100 face) against a curve, with a 1 basis point bump each way. */
export function keyRateDurations(b: BondPosition, curve: Curve, keys: number[] = KEY_RATES.filter((k) => k <= Math.max(...curve.map((p) => p.years)))): KeyRateResult {
  const dirty = analyze(b, b.yield).dirtyPrice;
  const spread = solveSpread(b, curve, dirty);
  const d = 0.0001;
  const p0 = curvePrice(b, curve, spread);
  const durations = keys.map((_, k) => {
    const up = curvePrice(b, curve, spread, (t) => d * tent(keys, k, t));
    const down = curvePrice(b, curve, spread, (t) => -d * tent(keys, k, t));
    return (down - up) / (2 * p0 * d);
  });
  const effective = (curvePrice(b, curve, spread, () => -d) - curvePrice(b, curve, spread, () => d)) / (2 * p0 * d);
  return { keys, durations, effective, spread };
}

/** Portfolio key-rate durations: each bond's, weighted by market value. */
export function portfolioKeyRates(bonds: BondPosition[], curve: Curve): KeyRateResult & { perBond: KeyRateResult[] } {
  const risk = portfolioRisk(bonds);
  const perBond = bonds.map((b) => keyRateDurations(b, curve));
  const keys = perBond[0]?.keys ?? [];
  const durations = keys.map((_, k) => perBond.reduce((s, r, i) => s + risk.rows[i].weight * r.durations[k], 0));
  return { keys, durations, effective: perBond.reduce((s, r, i) => s + risk.rows[i].weight * r.effective, 0), spread: NaN, perBond };
}
