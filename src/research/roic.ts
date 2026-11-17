/**
 * Return on capital (Research overview, helper 83): what the business earns, after tax, on the money tied up in its
 * operations, against what a medium-grade company pays to borrow; and the same with research spending counted as the
 * investment it is. From the annual statements research.company returns plus Moody's Baa yield (research.corpyields,
 * FRED BAA). Pure and tested (roic.test.ts, hand-worked on Microsoft's, Apple's and Coca-Cola's 10-K figures); drawn in
 * roicView.ts.
 *
 * ROIC = operating income x (1 - tax rate) / average invested capital (Koller, Goedhart and Wessels, "Valuation",
 * McKinsey, 7th ed., ch. 11). Invested capital is measured on the operating side: total assets less cash, short-term
 * investments and long-term marketable securities, less the current liabilities that aren't debt. Equity plus debt
 * would make Apple's buybacks (which shrink equity) look like better returns. Tax rate = the year's income tax / pre-tax
 * income, held to 0-50%; with no pre-tax profit the 21% federal rate stands in, and the words say so.
 *
 * Moody's Baa yield is what medium-grade companies pay to borrow. Shareholders expect more than lenders, so earning
 * above it is a floor test, not the full cost of capital (no equity premium is guessed).
 *
 * R&D as an investment: R&D is expensed, so research-heavy companies look more profitable on less capital than they
 * use. Capitalised over RD_LIFE years straight-line (Lev and Sougiannis 1996, Journal of Accounting and Economics 21;
 * Damodaran, "Research and Development Expenses: Implications for Profitability Measurement and Valuation", 1999):
 * research asset = sum of the last 5 years' R&D, each with its unwritten-off share; operating income adds back the
 * year's R&D and takes off that year's write-off of the 5 years before.
 */
import { fy, ok, pc, usd, type Statements } from './debtDilution';
import { at } from './quality';
import { newestYear, yearsBefore, type Stale } from './years';

export { yearsBefore, type Stale };
import { median } from '../indicators/catalog/c-math';
import { monthYear } from '../portfolio/optimiserText';

export const STATUTORY_TAX = 0.21;
export const RD_LIFE = 5;

/** Cash-like lines left out of invested capital; one never tagged in any year counts as zero. */
const CASH_LIKE = ['cash', 'shortInvestments', 'longInvestments'] as const;
const LABELS: Record<string, string> = { cash: 'cash', shortInvestments: 'short-term investments', longInvestments: 'long-term securities' };

const everTagged = (a: Statements, k: string) => (a.values[k] ?? []).some(ok);

export interface Capital {
  value: number;
  /** lines the company tagged in other years but not this one, counted as zero (the return may read low or high) */
  missing: string[];
}

/** Invested capital at year-end i: total assets - cash-like lines - (current liabilities - current debt). */
export function investedCapital(a: Statements, i: number): Capital | null {
  const ta = at(a, 'totalAssets', i);
  const cl = at(a, 'currentLiabilities', i);
  if (ta == null || cl == null) return null;
  const missing: string[] = [];
  const part = (k: string) => {
    const v = at(a, k, i);
    if (v == null && everTagged(a, k)) missing.push(LABELS[k]);
    return v ?? 0;
  };
  const cashLike = CASH_LIKE.reduce((s, k) => s + part(k), 0);
  // untagged current debt usually means none that year (a repaid line is dropped), so no warning
  const debt = at(a, 'currentDebt', i) ?? 0;
  return { value: ta - cashLike - (cl - debt), missing };
}

export interface Tax {
  rate: number;
  statutory: boolean;
}
export function taxRate(a: Statements, i: number): Tax {
  const t = at(a, 'incomeTax', i);
  const p = at(a, 'pretaxIncome', i);
  if (t == null || p == null || p <= 0) return { rate: STATUTORY_TAX, statutory: true };
  return { rate: Math.min(0.5, Math.max(0, t / p)), statutory: false };
}

export interface RoicYear {
  end: string;
  /** operating income after tax */
  nopat: number;
  /** average of this year-end's and last year-end's invested capital */
  capital: number;
  roic: number;
  tax: Tax;
  missing: string[];
}

function roicAt(a: Statements, i: number): RoicYear | null {
  const oi = at(a, 'operatingIncome', i);
  if (!yearsBefore(a, i, i - 1, 1)) return null;
  const now = investedCapital(a, i);
  const before = investedCapital(a, i - 1);
  if (oi == null || !now || !before) return null;
  const capital = (now.value + before.value) / 2;
  if (!(capital > 0)) return null;
  const tax = taxRate(a, i);
  const nopat = oi * (1 - tax.rate);
  return { end: a.periods[i], nopat, capital, roic: nopat / capital, tax, missing: [...new Set([...now.missing, ...before.missing])] };
}

export interface Baa {
  value: number;
  date: string;
  series: string;
}
export interface Roic {
  /** every year that could be worked out, oldest first (the bars show these) */
  history: RoicYear[];
  latest: RoicYear;
  /** median of the history, 5+ years */
  median: number | null;
}

export function returnOnCapital(a: Statements): Roic | Stale | null {
  const n = newestYear(a);
  if (n < 1) return null;
  const history: RoicYear[] = [];
  for (let i = 1; i <= n; i++) {
    const y = roicAt(a, i);
    if (y) history.push(y);
  }
  if (!history.length) return null;
  const latest = history[history.length - 1];
  if (a.periods.indexOf(latest.end) < n) return { lastShown: latest.end };
  return { history, latest, median: history.length >= 5 ? median(history.map((y) => y.roic)) : null };
}

/** Latest ROIC minus the Baa yield (fractions). */
export const overBaa = (r: Roic, baa: Baa) => r.latest.roic - baa.value / 100;


export function roicWords(r: Roic, baa?: Baa | null): string {
  const y = r.latest;
  let t = `In ${fy(y.end)} the business earned ${pc(y.roic, 1)} after tax on the ${usd(y.capital)} tied up in its operations (operating profit after tax ${usd(y.nopat)}).`;
  if (y.roic >= 1) t += ' Above 100% means the business runs on very little capital of its own: customers and suppliers fund much of it.';
  if (y.tax.statutory) t += ' With no pre-tax profit to read a tax rate from, the 21% federal rate stands in.';
  if (r.median != null) {
    const first = fy(r.history[0].end);
    const d = y.roic - r.median;
    t += Math.abs(d) < 0.02 ? ` About its median since ${first} (${pc(r.median, 1)}).` : ` ${d > 0 ? 'Above' : 'Below'} its median since ${first} (${pc(r.median, 1)}).`;
  }
  if (baa) {
    const spread = overBaa(r, baa);
    const b = `Medium-grade companies pay ${baa.value.toFixed(2)}% to borrow (Moody’s Baa, ${monthYear(baa.date)})`;
    t +=
      spread > 0
        ? ` ${b}: it earns ${(spread * 100).toFixed(1)} points more. Shareholders expect more than lenders, so this is a floor, not the full cost of capital.`
        : ` ${b}: it earns ${(-spread * 100).toFixed(1)} points less, so it isn’t covering even what borrowing would cost.`;
  }
  if (y.missing.length) t += ` The filings don’t tag ${list(y.missing)} for every year used, so ${y.missing.length > 1 ? 'they count' : 'it counts'} as zero and the figure may be off.`;
  return t;
}

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs[0]);

export const roicStaleWords = (s: Stale) => `The newest filings don’t show everything return on capital needs; it was last worked out for ${fy(s.lastShown)}.`;

// ---------- R&D as an investment ----------

export interface Research {
  end: string;
  rd: number;
  ofSales: number | null;
  /** compound yearly growth of R&D over the last 5 years */
  growth5: number | null;
  /** capitalised: the research asset (unwritten-off R&D of the last RD_LIFE years) and this year's write-off */
  asset: number | null;
  amortization: number | null;
  /** ROIC with R&D capitalised; null with the reason in `missing` */
  adjusted: number | null;
  reported: number | null;
  /** why `adjusted` couldn't be worked out: too few whole years of R&D, or no return on capital for the year */
  missing: 'history' | 'capital' | null;
}

const rdAt = (a: Statements, i: number) => at(a, 'rnd', i);
/** R&D k whole fiscal years before period t, or null (a gap or a short transition period never stands in). */
const rdBack = (a: Statements, t: number, k: number) => (k === 0 || yearsBefore(a, t, t - k, k) ? rdAt(a, t - k) : null);
function researchAsset(a: Statements, t: number): number | null {
  let s = 0;
  for (let k = 0; k < RD_LIFE; k++) {
    const v = rdBack(a, t, k);
    if (v == null) return null;
    s += v * (1 - k / RD_LIFE);
  }
  return s;
}
function writeOff(a: Statements, t: number): number | null {
  let s = 0;
  for (let k = 1; k <= RD_LIFE; k++) {
    const v = rdBack(a, t, k);
    if (v == null) return null;
    s += v / RD_LIFE;
  }
  return s;
}

/** R&D in the newest fiscal year; a line tagged before but not now is stale; null for companies that report none. */
export function research(a: Statements): Research | Stale | null {
  const n = newestYear(a);
  if (n < 0) return null;
  const rd = rdAt(a, n);
  if (rd == null || rd <= 0) {
    let last = n - 1;
    while (last >= 0 && !((rdAt(a, last) ?? 0) > 0)) last--;
    return last >= 0 ? { lastShown: a.periods[last] } : null;
  }
  const sales = at(a, 'revenue', n);
  const before = rdBack(a, n, 5);
  const asset = researchAsset(a, n);
  const assetBefore = yearsBefore(a, n, n - 1, 1) ? researchAsset(a, n - 1) : null;
  const amort = writeOff(a, n);
  const reported = roicAt(a, n);
  let adjusted: number | null = null;
  let missing: Research['missing'] = null;
  if (asset == null || assetBefore == null || amort == null) missing = 'history';
  else if (!reported) missing = 'capital';
  else {
    const now = investedCapital(a, n)!.value + asset;
    const prev = investedCapital(a, n - 1)!.value + assetBefore;
    const oi = (at(a, 'operatingIncome', n) as number) + rd - amort;
    const cap = (now + prev) / 2;
    if (cap > 0) adjusted = (oi * (1 - reported.tax.rate)) / cap;
    else missing = 'capital';
  }
  return {
    end: a.periods[n],
    rd,
    ofSales: sales != null && sales > 0 ? rd / sales : null,
    growth5: before != null && before > 0 ? (rd / before) ** (1 / 5) - 1 : null,
    asset,
    amortization: amort,
    adjusted,
    reported: reported?.roic ?? null,
    missing,
  };
}

export function researchWords(r: Research): string {
  let t = `In ${fy(r.end)} the company spent ${usd(r.rd)} on research and development${r.ofSales != null ? `, ${pc(r.ofSales, 1)} of sales` : ''}`;
  t += r.growth5 != null ? `, up ${pc(r.growth5, 1)} a year over 5 years.` : '.';
  if (r.adjusted != null && r.reported != null) {
    t += ` Accounting counts it as a cost, but it is spent to earn for years. Counted as an investment written off over ${RD_LIFE} years (a research asset of ${usd(r.asset)}), the return on capital is ${pc(r.adjusted, 1)} instead of ${pc(r.reported, 1)}`;
    t += r.adjusted < r.reported ? ': lower, because the capital the business really uses is larger.' : ': higher, because this year’s research spending runs well ahead of the write-off of past years.';
  } else if (r.missing === 'capital') t += ' Counting it as an investment also needs the year’s return on capital, which these filings don’t allow working out.';
  else t += ` Counting it as an investment needs ${RD_LIFE + 1} years of R&D in a row, which the filings don’t show.`;
  return t;
}

export const researchStaleWords = (s: Stale) => `The filings stopped showing research and development on a line of its own after ${fy(s.lastShown)}.`;
