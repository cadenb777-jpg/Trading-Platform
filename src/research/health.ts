/**
 * Financial health scores (Research → Earnings quality), from the annual statements research.company returns
 * (helper 71 adds receivables, ppe, retainedEarnings and profile.sic). Pure and tested (health.test.ts, hand-worked on
 * Apple's FY2026 10-K); drawn in qualityView.ts.
 *
 * Beneish M-score: Beneish (1999), "The Detection of Earnings Manipulation", Financial Analysts Journal 55(5), the
 * 8-variable probit (table 3). Above -1.78 = looks like the manipulators in his sample (the cut-off he gives for a
 * 20:1 cost of missing one vs flagging an innocent firm). Depreciation is the filing's depreciation and amortization
 * line (D&A), the usual free-data stand-in for depreciation alone. All 8 ratios are needed; a missing one means no
 * score (never a guessed 1.0).
 *
 * Altman Z-score: Altman (1968), "Financial Ratios, Discriminant Analysis and the Prediction of Corporate Bankruptcy",
 * Journal of Finance 23(4), for manufacturers (SEC industry codes 2000-3999): Z = 1.2 X1 + 1.4 X2 + 3.3 X3 + 0.6 X4 +
 * 1.0 X5 with X4 = market value of equity / total liabilities; zones < 1.81 distress, > 2.99 safe. Everyone else gets
 * Altman's Z'' for non-manufacturers (Altman 1983, "Corporate Financial Distress"; restated in Altman 2000): Z'' =
 * 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4 with X4 = book equity / total liabilities, zones < 1.1 / > 2.6. Banks and
 * insurers (SEC codes 6000-6999) aren't scored: the model wasn't built for them.
 *
 * Both are readings, not signals: they haven't been tested on the owner's stocks.
 */
import { fy, ok, type Statements } from './debtDilution';
import { at, div } from './quality';

/** −2.52 with a real minus sign (also used by qualityView) */
export const signed = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

/** Newest year index with the given lines, or -1. */
function newest(a: Statements, keys: string[], needPrev: boolean): number {
  for (let t = a.periods.length - 1; t >= (needPrev ? 1 : 0); t--) {
    if (keys.every((k) => at(a, k, t) != null && (!needPrev || at(a, k, t - 1) != null))) return t;
  }
  return -1;
}

// ---------- Beneish M-score ----------

export type BeneishKey = 'DSRI' | 'GMI' | 'AQI' | 'SGI' | 'DEPI' | 'SGAI' | 'LVGI' | 'TATA';
export const BENEISH: { key: BeneishKey; weight: number; label: string; why: string }[] = [
  { key: 'DSRI', weight: 0.92, label: 'Days’ sales in receivables', why: 'money owed by customers grew faster than sales' },
  { key: 'GMI', weight: 0.528, label: 'Gross margin index', why: 'gross margin got worse' },
  { key: 'AQI', weight: 0.404, label: 'Asset quality index', why: 'more assets that aren’t cash, stock or equipment (costs held on the balance sheet)' },
  { key: 'SGI', weight: 0.892, label: 'Sales growth index', why: 'fast sales growth (pressure to keep it up)' },
  { key: 'DEPI', weight: 0.115, label: 'Depreciation index', why: 'equipment written off more slowly' },
  { key: 'SGAI', weight: -0.172, label: 'Overheads index', why: '' },
  { key: 'LVGI', weight: -0.327, label: 'Leverage index', why: '' },
  { key: 'TATA', weight: 4.679, label: 'Total accruals to assets', why: 'profit well above the cash it brought in' },
];
export const BENEISH_CONSTANT = -4.84;
export const BENEISH_CUTOFF = -1.78;
const NEEDED = ['revenue', 'grossProfit', 'receivables', 'currentAssets', 'ppe', 'totalAssets', 'dna', 'sga', 'currentLiabilities', 'longTermDebt', 'netIncome', 'operatingCashFlow'];

export interface Beneish {
  end: string;
  previousEnd: string;
  ratios: Record<BeneishKey, number>;
  m: number;
  flagged: boolean;
  /** the two positive-weight ratios that pushed M up the most (weight x (ratio - its neutral value)), for the sentence.
   * SGAI and LVGI have negative weights, so they only raise M by falling; Beneish reads neither as a sign of
   * manipulation, so they are never named as a reason. */
  drivers: BeneishKey[];
}
export interface BeneishMissing {
  /** statement lines the filings don't give for two years in a row (keys of the statements) */
  missing: string[];
  /** every line is there but a ratio divides by zero in every year pair */
  undefinedRatio?: string;
}

function ratiosFor(a: Statements, t: number): Record<BeneishKey, number | null> {
  const p = t - 1;
  const v = (k: string, i: number) => at(a, k, i) as number;
  const gm = (i: number) => div(v('grossProfit', i), v('revenue', i));
  const soft = (i: number) => div(v('totalAssets', i) - v('currentAssets', i) - v('ppe', i), v('totalAssets', i));
  const dep = (i: number) => div(v('dna', i), v('dna', i) + v('ppe', i));
  const sga = (i: number) => div(v('sga', i), v('revenue', i));
  const lev = (i: number) => div(v('currentLiabilities', i) + v('longTermDebt', i), v('totalAssets', i));
  return {
    DSRI: div(div(v('receivables', t), v('revenue', t)), div(v('receivables', p), v('revenue', p))),
    GMI: div(gm(p), gm(t)),
    AQI: div(soft(t), soft(p)),
    SGI: div(v('revenue', t), v('revenue', p)),
    DEPI: div(dep(p), dep(t)),
    SGAI: div(sga(t), sga(p)),
    LVGI: div(lev(t), lev(p)),
    TATA: div(v('netIncome', t) - v('operatingCashFlow', t), v('totalAssets', t)),
  };
}

const has = (a: Statements, t: number) => NEEDED.every((k) => at(a, k, t) != null && at(a, k, t - 1) != null);
const finite = (r: Record<BeneishKey, number | null>) => BENEISH.every((b) => r[b.key] != null && Number.isFinite(r[b.key] as number));

/** M-score for the newest year pair that has every line and gives eight finite ratios. */
export function beneish(a: Statements): Beneish | BeneishMissing {
  let firstBad: string | null = null;
  for (let t = a.periods.length - 1; t >= 1; t--) {
    if (!has(a, t)) continue;
    const raw = ratiosFor(a, t);
    if (!finite(raw)) {
      firstBad ??= BENEISH.find((b) => raw[b.key] == null || !Number.isFinite(raw[b.key] as number))!.label;
      continue;
    }
    const ratios = raw as Record<BeneishKey, number>;
    const m = BENEISH_CONSTANT + BENEISH.reduce((s, b) => s + b.weight * ratios[b.key], 0);
    // neutral = 1 for the indexes (no change), 0 for accruals
    const push = BENEISH.filter((b) => b.weight > 0).map((b) => ({ key: b.key, up: b.weight * (ratios[b.key] - (b.key === 'TATA' ? 0 : 1)) })).filter((x) => x.up > 0);
    push.sort((x, y) => y.up - x.up);
    return { end: a.periods[t], previousEnd: a.periods[t - 1], ratios, m, flagged: m > BENEISH_CUTOFF, drivers: push.slice(0, 2).map((x) => x.key) };
  }
  const last = a.periods.length - 1;
  const missing = NEEDED.filter((k) => at(a, k, last) == null || at(a, k, last - 1) == null);
  return firstBad && !missing.length ? { missing: [], undefinedRatio: firstBad } : { missing };
}

export function beneishWords(b: Beneish): string {
  const year = `${fy(b.end)} vs ${fy(b.previousEnd)}`;
  if (b.flagged) {
    const why = b.drivers.map((k) => BENEISH.find((x) => x.key === k)!.why);
    return `M-score ${signed(b.m)} (${year}) is above Beneish’s ${signed(BENEISH_CUTOFF)} line: the figures look like those of companies later found to have inflated profits${why.length ? `, mainly because ${why.join(' and ')}` : ''}. A flag to read the filing closely, not proof of anything.`;
  }
  return `M-score ${signed(b.m)} (${year}) is below Beneish’s ${signed(BENEISH_CUTOFF)} line: nothing in these eight ratios looks like the companies later found to have inflated profits.`;
}

// ---------- Altman Z-score ----------

export type AltmanModel = 'Z' | "Z'" | "Z''";
/** why the original Z wasn't used for a manufacturer */
export type BookReason = 'no-price' | 'old-year';
export interface Altman {
  end: string;
  model: AltmanModel;
  x: { workingCapital: number; retained: number; ebit: number; equity: number; sales: number | null };
  z: number;
  zone: 'distress' | 'grey' | 'safe';
  /** total liabilities came from total assets minus shareholders' equity (the filing has no total liabilities line) */
  liabilitiesDerived: boolean;
  bookReason: BookReason | null;
}

/** Zones per model: Altman (1968) for Z, Altman (1983) for Z' and Z''. */
export const ZONES: Record<AltmanModel, [number, number]> = { Z: [1.81, 2.99], "Z'": [1.23, 2.9], "Z''": [1.1, 2.6] };

export const isManufacturer = (sic: string | number | null | undefined) => {
  const n = Number(sic);
  return sic !== '' && sic != null && Number.isFinite(n) && n >= 2000 && n <= 3999;
};
export const isFinancial = (sic: string | number | null | undefined) => {
  const n = Number(sic);
  return sic !== '' && sic != null && Number.isFinite(n) && n >= 6000 && n <= 6999;
};

/**
 * Z (1968): manufacturers, market value, only when the year scored is the newest one (today's market value
 * against an older balance sheet would mix dates). Z' (1983): manufacturers otherwise, book equity, with sales.
 * Z'' (1983): everyone else, or a manufacturer whose sales line is missing.
 */
export function altman(a: Statements, sic: string | number | null | undefined, marketCap: number | null): Altman | null {
  if (isFinancial(sic)) return null;
  const t = newest(a, ['currentAssets', 'currentLiabilities', 'retainedEarnings', 'operatingIncome', 'totalAssets'], false);
  if (t < 0) return null;
  const ta = at(a, 'totalAssets', t) as number;
  const equity = at(a, 'equity', t);
  const reported = at(a, 'totalLiabilities', t);
  const liabilitiesDerived = reported == null && equity != null;
  const tl = liabilitiesDerived ? ta - (equity as number) : reported;
  if (tl == null || tl <= 0) return null;
  const x1 = ((at(a, 'currentAssets', t) as number) - (at(a, 'currentLiabilities', t) as number)) / ta;
  const x2 = (at(a, 'retainedEarnings', t) as number) / ta;
  const x3 = (at(a, 'operatingIncome', t) as number) / ta;
  const sales = at(a, 'revenue', t);
  const x5 = sales != null ? sales / ta : null;
  const out = (model: AltmanModel, x4: number, z: number, bookReason: BookReason | null): Altman => {
    const [lo, hi] = ZONES[model];
    return { end: a.periods[t], model, x: { workingCapital: x1, retained: x2, ebit: x3, equity: x4, sales: model === "Z''" ? null : x5 }, z, zone: z < lo ? 'distress' : z > hi ? 'safe' : 'grey', liabilitiesDerived, bookReason };
  };
  const newestYear = t === a.periods.length - 1;
  if (isManufacturer(sic) && x5 != null) {
    if (ok(marketCap) && marketCap > 0 && newestYear) {
      const x4 = marketCap / tl;
      return out('Z', x4, 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5, null);
    }
    if (equity == null) return null;
    const x4 = equity / tl;
    return out("Z'", x4, 0.717 * x1 + 0.847 * x2 + 3.107 * x3 + 0.42 * x4 + 0.998 * x5, newestYear ? 'no-price' : 'old-year');
  }
  if (equity == null) return null;
  const x4 = equity / tl;
  return out("Z''", x4, 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4, null);
}

export function altmanWords(z: Altman): string {
  const [lo, hi] = ZONES[z.model];
  const zone = z.zone === 'safe' ? 'the safe zone' : z.zone === 'distress' ? 'the distress zone, where companies in Altman’s study often failed within two years' : 'the grey zone in between';
  const name = z.model === 'Z' ? 'Z-score' : z.model === "Z'" ? 'Z′-score' : 'Z′′-score';
  let t = `${name} ${signed(z.z)} for ${fy(z.end)} is in ${zone} (below ${lo} = distress, above ${hi} = safe).`;
  if (z.model === "Z'")
    t += z.bookReason === 'old-year'
      ? ' The newest filing lacks a line it needs, so it scores an older year on book equity (Altman’s manufacturer version for book values) rather than mix today’s market value with old accounts.'
      : ' Without a live price this uses book equity (Altman’s manufacturer version for book values).';
  if (z.model === "Z''") t += ' Altman’s version for companies that aren’t manufacturers (no sales term, book equity).';
  if (z.liabilitiesDerived) t += ' The filing has no total liabilities line, so it is total assets minus shareholders’ equity (any minority interests count as equity).';
  return t;
}
