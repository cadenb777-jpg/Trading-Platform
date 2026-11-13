/**
 * Earnings quality (Research overview): two classic checks built only from the annual statements research.company
 * already returns (SEC XBRL), so no helper change. Pure and tested (quality.test.ts, hand-worked on Apple's 10-Ks);
 * drawn in qualityView.ts.
 *
 * 1. Accruals: (net income - operating cash flow) / average total assets, the cash-flow measure of Hribar and Collins
 *    (2002, "Errors in Estimating Accruals", Journal of Accounting Research 40(1)). Sloan (1996, "Do Stock Prices
 *    Fully Reflect Information in Accruals and Cash Flows about Future Earnings?", The Accounting Review 71(3)) found
 *    that profit made of accruals rather than cash persisted less, and high-accrual firms earned lower future returns.
 * 2. Piotroski F-score: nine pass/fail checks of profitability, leverage/liquidity and efficiency (Piotroski 2000,
 *    "Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers",
 *    Journal of Accounting Research 38 supplement). Definitions follow the paper: ROA and CFO over beginning-of-year
 *    assets, leverage = long-term debt / average assets, turnover = sales / beginning assets. One stand-in: the paper's
 *    "issued no common equity" is checked as "the diluted share count didn't rise" (the filings' share issuance isn't
 *    in the statements we read), and is labelled that way.
 *
 * Both are readings, not trading signals: neither has been tested on the owner's universe with the platform's
 * random-entry and Holm checks.
 */
import { fy, looksLikeSplit, ok, pc, type Statements } from './debtDilution';

/** One statement figure (finite), or null; shared with health.ts. */
export const at = (a: Statements, key: string, i: number): number | null => {
  const v = a.values[key]?.[i];
  return i >= 0 && ok(v) ? v : null;
};
export const div = (x: number | null, y: number | null): number | null => (x != null && y != null && y !== 0 ? x / y : null);
const avg = (x: number | null, y: number | null): number | null => (x != null && y != null ? (x + y) / 2 : null);

// ---------- accruals ----------

export interface AccrualYear {
  end: string;
  /** (net income - operating cash flow) / average total assets */
  accruals: number;
}
export interface Accruals {
  latest: AccrualYear;
  history: AccrualYear[];
  /** share of the company's own years with accruals at or below the latest (0-100); null with fewer than 5 years */
  percentile: number | null;
}

export function accruals(a: Statements): Accruals | null {
  const history: AccrualYear[] = [];
  for (let i = 1; i < a.periods.length; i++) {
    const ni = at(a, 'netIncome', i);
    const cfo = at(a, 'operatingCashFlow', i);
    const r = div(ni != null && cfo != null ? ni - cfo : null, avg(at(a, 'totalAssets', i), at(a, 'totalAssets', i - 1)));
    if (r != null) history.push({ end: a.periods[i], accruals: r });
  }
  if (!history.length) return null;
  const latest = history[history.length - 1];
  const percentile = history.length >= 5 ? (100 * history.filter((h) => h.accruals <= latest.accruals).length) / history.length : null;
  return { latest, history, percentile };
}


export function accrualWords(x: Accruals): string {
  const v = x.latest.accruals;
  const year = fy(x.latest.end);
  let t: string;
  if (Math.abs(v) < 0.005) t = `In ${year} profit and the cash the business brought in were about the same (accruals ${pc(v, 1, true)} of assets).`;
  else if (v < 0) t = `In ${year} the business brought in more cash than its reported profit (accruals ${pc(v, 1, true)} of assets): profit backed by cash.`;
  else t = `In ${year} reported profit was more than the cash the business brought in (accruals ${pc(v, 1, true)} of assets): part of the profit is accounting entries not yet turned into cash.`;
  if (x.percentile != null) {
    // judged against the other years' values, so ties and long histories read right
    const n = x.history.length;
    const first = fy(x.history[0].end);
    const others = x.history.slice(0, -1).map((h) => h.accruals);
    const hi = Math.max(...others);
    const lo = Math.min(...others);
    if (v > hi) t += ` That is the highest in its ${n} years since ${first}; Sloan (1996) found high-accrual profits last less.`;
    else if (v === hi) t += ` Level with its highest in ${n} years since ${first}; Sloan (1996) found high-accrual profits last less.`;
    else if (v < lo) t += ` That is the lowest in its ${n} years since ${first}.`;
    else if (v === lo) t += ` Level with its lowest in ${n} years since ${first}.`;
    else t += ` Inside its own range over ${n} years since ${first}.`;
  }
  return t;
}

// ---------- Piotroski F-score ----------

export type CheckKey = 'roa' | 'cfo' | 'droa' | 'accrual' | 'dlever' | 'dliquid' | 'shares' | 'dmargin' | 'dturn';
export interface Check {
  key: CheckKey;
  label: string;
  /** null = not enough data to judge (never counted as a pass or a fail) */
  pass: boolean | null;
  now: number | null;
  before: number | null;
  /** how to show now/before: a ratio as %, a plain ratio, or a share count */
  unit: '%' | 'x' | 'shares';
}
export interface FScore {
  end: string;
  previousEnd: string;
  checks: Check[];
  score: number;
  /** checks that had the data */
  checked: number;
}

/** F-score for the newest fiscal year that has net income and both prior years' total assets. */
export function fScore(a: Statements): FScore | null {
  let t = a.periods.length - 1;
  while (t >= 2 && (at(a, 'netIncome', t) == null || at(a, 'totalAssets', t - 1) == null)) t--;
  if (t < 1 || at(a, 'netIncome', t) == null || at(a, 'totalAssets', t - 1) == null) return null;
  const p = t - 1;
  const begin = (i: number) => at(a, 'totalAssets', i - 1);
  const roa = (i: number) => div(at(a, 'netIncome', i), begin(i));
  const cfo = (i: number) => div(at(a, 'operatingCashFlow', i), begin(i));
  // a company that reports no long-term debt in any year is debt-free (0), not "no data"; a single missing year stays unjudged
  const debtFree = !(a.values.longTermDebt ?? []).some(ok);
  const lever = (i: number) => div(debtFree ? 0 : at(a, 'longTermDebt', i), avg(at(a, 'totalAssets', i), at(a, 'totalAssets', i - 1)));
  const liquid = (i: number) => div(at(a, 'currentAssets', i), at(a, 'currentLiabilities', i));
  const margin = (i: number) => div(at(a, 'grossProfit', i), at(a, 'revenue', i));
  const turn = (i: number) => div(at(a, 'revenue', i), begin(i));
  const up = (n: number | null, b: number | null) => (n != null && b != null ? n > b : null);
  const down = (n: number | null, b: number | null) => (n != null && b != null ? n < b : null);
  const pos = (n: number | null) => (n != null ? n > 0 : null);
  const r = [roa(t), roa(p)];
  const c = cfo(t);
  const sh = [at(a, 'dilutedShares', t), at(a, 'dilutedShares', p)];
  const checks: Check[] = [
    { key: 'roa', label: 'Made a profit (return on assets above 0)', pass: pos(r[0]), now: r[0], before: null, unit: '%' },
    { key: 'cfo', label: 'Brought in cash from operations', pass: pos(c), now: c, before: null, unit: '%' },
    { key: 'droa', label: 'Return on assets rose', pass: up(r[0], r[1]), now: r[0], before: r[1], unit: '%' },
    { key: 'accrual', label: 'Cash from operations beat profit', pass: up(c, r[0]), now: c, before: r[0], unit: '%' },
    debtFree
      ? { key: 'dlever', label: 'No long-term debt either year', pass: lever(t) != null && lever(p) != null ? true : null, now: lever(t), before: lever(p), unit: '%' }
      : { key: 'dlever', label: 'Long-term debt fell against assets', pass: down(lever(t), lever(p)), now: lever(t), before: lever(p), unit: '%' },
    { key: 'dliquid', label: 'Current ratio rose (more short-term cover)', pass: up(liquid(t), liquid(p)), now: liquid(t), before: liquid(p), unit: 'x' },
    // stand-in for "issued no common equity": the diluted share count didn't rise
    // never across an unrestated split (a 4-for-1 split isn't 4x dilution): unjudged then
    { key: 'shares', label: 'No new shares (diluted count didn’t rise)', pass: sh[0] != null && sh[1] != null && sh[1] > 0 && !looksLikeSplit(sh[0] / sh[1]) ? sh[0] <= sh[1] : null, now: sh[0], before: sh[1], unit: 'shares' },
    { key: 'dmargin', label: 'Gross margin rose', pass: up(margin(t), margin(p)), now: margin(t), before: margin(p), unit: '%' },
    { key: 'dturn', label: 'Sales per dollar of assets rose', pass: up(turn(t), turn(p)), now: turn(t), before: turn(p), unit: 'x' },
  ];
  // lever(p) and turn/roa(p) need assets two years back; a missing input leaves that check unjudged
  return {
    end: a.periods[t],
    previousEnd: a.periods[p],
    checks,
    score: checks.filter((x) => x.pass === true).length,
    checked: checks.filter((x) => x.pass !== null).length,
  };
}

/** Piotroski's own grouping: 8-9 = high (strong), 0-1 = low (weak); the rest in between. Only with all 9 checked. */
export function fScoreWord(f: FScore): 'strong' | 'weak' | 'middle' | 'incomplete' {
  if (f.checked < 9) return 'incomplete';
  return f.score >= 8 ? 'strong' : f.score <= 1 ? 'weak' : 'middle';
}

export function fScoreWords(f: FScore): string {
  const year = `${fy(f.end)} vs ${fy(f.previousEnd)}`;
  const failed = f.checks.filter((c) => c.pass === false).map((c) => c.label.charAt(0).toLowerCase() + c.label.slice(1));
  const w = fScoreWord(f);
  let t = `Passes ${f.score} of ${f.checked === 9 ? 9 : `${f.checked} checks it has data for (of 9)`} in ${year}.`;
  if (w === 'strong') t += ' In Piotroski’s study, cheap stocks scoring 8-9 went on to beat those scoring 0-1.';
  else if (w === 'weak') t += ' Piotroski found cheap stocks scoring this low did worst.';
  if (failed.length) t += ` Missed: ${failed.join('; ')}.`;
  if (w === 'incomplete') t += ' Some figures are missing from the filings, so the score is out of fewer checks.';
  return t;
}
