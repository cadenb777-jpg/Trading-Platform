/**
 * Taxes and operating leverage (Research overview, helper 84): the tax a company actually pays in cash against the
 * rate its income statement shows, and how hard operating profit swings when sales move. From the annual statements
 * research.company returns (helper 84 adds income taxes paid). Pure and tested (taxLeverage.test.ts, hand-worked on
 * Microsoft's, Apple's, Coca-Cola's and Amazon's 10-K figures); drawn in taxLeverageView.ts.
 *
 * Cash tax rate = income taxes paid (the 10-K's supplemental cash-flow line) / pre-tax income. The long-run rate sums
 * both over up to 5 consecutive years (Dyreng, Hanlon and Maydew, "Long-Run Corporate Tax Avoidance", The Accounting
 * Review 83, 2008): one year's payments can include settlements of earlier years, so the long run is the steadier read.
 * Book rate = income tax expense / pre-tax income over the same years. A cash rate below the book rate means tax charged
 * in the accounts but not yet paid (deferred) or released from reserves; above it, tax paid on earlier years' profits.
 *
 * Operating leverage = the slope of log operating income on log sales over up to 10 consecutive years with an operating
 * profit (Mandelker and Rhee, "The Impact of the Degrees of Operating and Financial Leverage on Systematic Risk of Common
 * Stock", Journal of Financial and Quantitative Analysis 19, 1984, estimate it this way and find it raises beta). A slope
 * of 1.5 means a 1% change in sales has come with about a 1.5% change in operating profit. Year by year: % change in
 * operating income / % change in sales, only when sales moved at least 2% (smaller moves blow the ratio up).
 */
import { fy, pc, usd, type Statements } from './debtDilution';
import { at } from './quality';
import { slopeOf } from '../indicators/catalog/c-math';
import { lastRun, newestYear } from './years';

/** The newest year lacks a line the reading needs: which one, and when it was last worked out. */
export type Stale = { lastShown: string; missing: string };

export const FEDERAL_RATE = 0.21;
/** Cash and book rates within this of each other read as about the same. */
export const SAME = 0.02;

// ---------- cash tax rate ----------

export interface TaxYear {
  end: string;
  paid: number;
  expense: number | null;
  pretax: number;
}
export interface CashTax {
  latest: TaxYear;
  /** paid / pre-tax, newest year (null without a pre-tax profit) */
  cashRate: number | null;
  /** expense / pre-tax, newest year */
  bookRate: number | null;
  /** consecutive years used for the long-run rates, oldest first */
  window: TaxYear[];
  /** sum paid / sum pre-tax over the window (3+ years; losses may cancel at most half the profitable years) */
  longCash: number | null;
  /** sum expense / sum pre-tax over the window (every year with an expense line) */
  longBook: number | null;
}

export function cashTax(a: Statements, span = 5): CashTax | Stale | null {
  const n = newestYear(a);
  const rows: TaxYear[] = [];
  for (let i = 0; i <= n; i++) {
    const paid = at(a, 'taxesPaid', i);
    const pretax = at(a, 'pretaxIncome', i);
    if (paid != null && pretax != null) rows.push({ end: a.periods[i], paid, expense: at(a, 'incomeTax', i), pretax });
  }
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  if (a.periods.indexOf(latest.end) < n) return { lastShown: latest.end, missing: at(a, 'taxesPaid', n) == null ? 'income taxes paid' : 'pre-tax profit' };
  const win = lastRun(a, rows, span);
  const sum = (f: (r: TaxYear) => number) => win.reduce((s, r) => s + f(r), 0);
  const pretax = sum((r) => r.pretax);
  const profits = sum((r) => Math.max(0, r.pretax));
  // a long-run rate needs real profit: losses that cancel more than half the profitable years make it meaningless
  const enough = win.length >= 3 && pretax > 0 && pretax >= profits / 2;
  return {
    latest,
    cashRate: latest.pretax > 0 && latest.paid >= 0 ? latest.paid / latest.pretax : null,
    bookRate: latest.pretax > 0 && latest.expense != null ? latest.expense / latest.pretax : null,
    window: win,
    longCash: enough ? sum((r) => r.paid) / pretax : null,
    longBook: enough && win.every((r) => r.expense != null) ? sum((r) => r.expense as number) / pretax : null,
  };
}

export function taxWords(t: CashTax): string {
  const y = t.latest;
  const year = fy(y.end);
  let s =
    y.paid < 0
      ? `In ${year} the company received a net income tax refund of ${usd(-y.paid)} in cash (refunds were bigger than payments).`
      : t.cashRate != null
      ? `In ${year} the company paid ${usd(y.paid)} of income tax in cash: ${pc(t.cashRate, 1)} of its pre-tax profit${t.bookRate != null ? `, against ${pc(t.bookRate, 1)} charged in its income statement` : ''}.`
      : `In ${year} the company paid ${usd(y.paid)} of income tax in cash with no pre-tax profit (${usd(y.pretax)}), so no rate can be worked out for the year.`;
  if (t.longCash != null && t.longCash < 0) {
    s += ` Over ${t.window.length} years (${fy(t.window[0].end)}–${year}) refunds were bigger than payments.`;
  } else if (t.longCash != null) {
    const span = `Over ${t.window.length} years (${fy(t.window[0].end)}–${year})`;
    s += ` ${span} it paid ${pc(t.longCash, 1)} in cash`;
    if (t.longBook != null) {
      const gap = t.longCash - t.longBook;
      s +=
        Math.abs(gap) < SAME
          ? ` and charged ${pc(t.longBook, 1)}: about the same.`
          : gap < 0
            ? ` but charged ${pc(t.longBook, 1)}: part of the tax in its accounts hasn’t been paid yet (deferred to later years) or was released from reserves.`
            : ` but charged ${pc(t.longBook, 1)}: it paid more than its accounts charged, for example tax on earlier years’ profits.`;
    } else s += '.';
    s += ` The federal rate is ${pc(FEDERAL_RATE, 0)}; state and foreign taxes and credits move a company’s rate either way.`;
  }
  return s;
}

// ---------- operating leverage ----------

export interface LeverageYear {
  end: string;
  opGrowth: number;
  salesGrowth: number;
  /** opGrowth / salesGrowth, null when sales moved less than 2% */
  dol: number | null;
}
export interface Leverage {
  /** slope of ln(operating income) on ln(sales), up to 10 consecutive years with an operating profit (5+ needed) */
  slope: number | null;
  years: number;
  from: string;
  to: string;
  /** yearly readings, oldest first (at most 5) */
  history: LeverageYear[];
}

export const MIN_MOVE = 0.02;

export function operatingLeverage(a: Statements, span = 10): Leverage | Stale | null {
  const n = newestYear(a);
  const pts: { end: string; i: number; oi: number; sales: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const oi = at(a, 'operatingIncome', i);
    const sales = at(a, 'revenue', i);
    if (oi != null && oi > 0 && sales != null && sales > 0) pts.push({ end: a.periods[i], i, oi, sales });
  }
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  if (last.i < n) return { lastShown: last.end, missing: 'an operating profit' };
  const run = lastRun(a, pts, span);
  const history: LeverageYear[] = [];
  for (let k = 1; k < run.length; k++) {
    const p = run[k - 1];
    const c = run[k];
    const opGrowth = c.oi / p.oi - 1;
    const salesGrowth = c.sales / p.sales - 1;
    history.push({ end: c.end, opGrowth, salesGrowth, dol: Math.abs(salesGrowth) >= MIN_MOVE ? opGrowth / salesGrowth : null });
  }
  const s = run.length >= 5 ? slopeOf(run.map((r) => Math.log(r.sales)), run.map((r) => Math.log(r.oi))) : null;
  return { slope: s != null && Number.isFinite(s) ? s : null, years: run.length, from: run[0].end, to: last.end, history: history.slice(-5) };
}

export function leverageWords(l: Leverage): string {
  let s = '';
  if (l.slope != null) {
    s = `Over ${l.years} years (${fy(l.from)}–${fy(l.to)}) each 1% change in sales came with about a ${l.slope.toFixed(1)}% change in operating profit.`;
    const shown = Number(l.slope.toFixed(1)); // the words follow the multiple the page shows
    s +=
      shown < 0
        ? ' Below zero means profit has moved the opposite way to sales: it fell as sales grew, or rose as they fell.'
        : shown > 1.1
          ? ' Above 1 means fixed costs magnify the swings: profit rises faster than sales in good years and falls faster in bad ones.'
          : shown < 0.9
            ? ' Below 1 means profit has moved less than sales (costs rising with growth, or margins being squeezed).'
            : ' About 1 means profit has moved roughly in line with sales.';
    s += ' Mandelker and Rhee (1984) found that higher operating leverage goes with higher market risk.';
  } else s = 'Five years in a row with an operating profit are needed to measure how profit moves with sales.';
  const y = l.history[l.history.length - 1];
  if (y && y.end === l.to) {
    s += ` In ${fy(y.end)} operating profit ${y.opGrowth >= 0 ? 'grew' : 'fell'} ${pc(Math.abs(y.opGrowth), 1)} while sales ${y.salesGrowth >= 0 ? 'grew' : 'fell'} ${pc(Math.abs(y.salesGrowth), 1)}`;
    s += y.dol != null ? ` (${y.dol.toFixed(2)}×).` : ' (sales barely moved, so no ratio).';
  }
  return s;
}
