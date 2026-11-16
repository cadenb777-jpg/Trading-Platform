/**
 * Building and stock pay (Research overview, helper 81): is the company spending on property and equipment faster than
 * it wears out, and what is free cash flow once the cost of paying staff in stock is counted? From the annual
 * statements research.company returns. Pure and tested (buildPay.test.ts, hand-worked on Microsoft's, Apple's,
 * Amazon's and Coca-Cola's 10-K figures); drawn in buildPayView.ts.
 *
 * Spending vs depreciation = capital spending (cash paid for property and equipment) / depreciation of property and
 * equipment, by year. Above 1 the asset base grows; about 1 the company replaces what wears out; below 1 it shrinks
 * (or the business needs few new assets). Depreciation alone is used, not depreciation and amortization: amortization
 * of bought intangibles has nothing to do with what capital spending buys. Only when a company tags no depreciation
 * line does the D&A line stand in, and the panel says so. Spending well ahead of depreciation raises depreciation (a
 * cost in profit) for years after, as the new assets are written off: Damodaran, "Investment Valuation" (3rd ed.),
 * ch. 10 (net capital expenditure = capex - depreciation, the reinvestment that drives growth).
 *
 * Free cash flow after stock pay = (operating cash flow - capital spending) - stock-based compensation. Operating
 * cash flow adds stock pay back as a non-cash cost, yet it is pay that dilutes owners (or buybacks spend cash to undo
 * it): Mauboussin and Callahan, "Stock-Based Compensation: Unearned Riches" (Morgan Stanley Counterpoint Global, 2022)
 * treat it as an operating cost. Yields are against today's market value (price x shares).
 */
import { fy, pc, usd, type Statements } from './debtDilution';
import { at, div } from './quality';

/** Newest year with operating cash flow (the newest cash-flow statement), or -1. */
function newestCashFlow(a: Statements): number {
  let i = a.periods.length - 1;
  while (i >= 0 && at(a, 'operatingCashFlow', i) == null) i--;
  return i;
}

/** The newest run of consecutive years (at most `span`), oldest first. */
function window<T extends { end: string }>(a: Statements, rows: T[], span: number): T[] {
  const idx = (end: string) => a.periods.indexOf(end);
  const win = [rows[rows.length - 1]];
  for (let k = rows.length - 2; k >= 0 && win.length < span; k--) {
    if (idx(rows[k].end) !== idx(win[win.length - 1].end) - 1) break;
    win.push(rows[k]);
  }
  return win.reverse();
}

export type Stale = { lastShown: string };
const times = (x: number) => `${x.toFixed(1)}×`;

// ---------- spending vs depreciation ----------

export type Basis = 'depreciation' | 'dna';
export interface BuildYear {
  end: string;
  capex: number;
  dep: number;
  /** capex / dep */
  ratio: number;
}
export interface Build {
  /** consecutive years, oldest first (the view's bars show exactly these) */
  history: BuildYear[];
  latest: BuildYear;
  /** depreciation alone, or the D&A line standing in when the filings have no depreciation line */
  basis: Basis;
  /** capex / sales, newest year */
  ofSales: number | null;
  /** capex - depreciation, newest year (net reinvestment) */
  net: number;
}

/** Bands for the words and the bars' colour: in step = within 10% of depreciation. */
export const REPLACING = 0.1;
export type Pace = 'ahead' | 'growing' | 'replacing' | 'shrinking';
export function pace(ratio: number): Pace {
  return ratio >= 1.5 ? 'ahead' : ratio > 1 + REPLACING ? 'growing' : ratio >= 1 - REPLACING ? 'replacing' : 'shrinking';
}

export function buildRate(a: Statements, span = 5): Build | Stale | null {
  const n = newestCashFlow(a);
  if (n < 0) return null;
  const has = (k: string, i: number) => {
    const v = at(a, k, i);
    return v != null && v > 0;
  };
  // the basis the newest year has; depreciation alone whenever the filings carry it
  const basis: Basis | null = has('depreciation', n) ? 'depreciation' : has('dna', n) ? 'dna' : (a.values.depreciation ?? []).some((v) => v != null && v > 0) ? 'depreciation' : (a.values.dna ?? []).some((v) => v != null && v > 0) ? 'dna' : null;
  if (!basis) return null;
  const rows: BuildYear[] = [];
  for (let i = 0; i <= n; i++) {
    const capex = at(a, 'capex', i);
    const dep = at(a, basis, i);
    if (capex != null && capex >= 0 && dep != null && dep > 0) rows.push({ end: a.periods[i], capex, dep, ratio: capex / dep });
  }
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  // never an old year as today's: the newest cash-flow statement doesn't show both lines
  if (a.periods.indexOf(latest.end) < n) return { lastShown: latest.end };
  const i = a.periods.indexOf(latest.end);
  return { history: window(a, rows, span), latest, basis, ofSales: div(latest.capex, at(a, 'revenue', i)), net: latest.capex - latest.dep };
}

export function buildWords(b: Build): string {
  const y = b.latest;
  const what = b.basis === 'depreciation' ? 'depreciation' : 'depreciation and amortization';
  let t = `In ${fy(y.end)} the company spent ${usd(y.capex)} on property and equipment, ${times(y.ratio)} its ${what} (${usd(y.dep)})`;
  const p = pace(y.ratio);
  t +=
    p === 'ahead'
      ? ': it is building well ahead of what wears out. The new assets are written off over the coming years, so depreciation, a cost in profit, tends to keep rising after spending like this.'
      : p === 'growing'
        ? ': it is growing its asset base, a little ahead of what wears out.'
        : p === 'replacing'
          ? ': about what wears out each year, so it is replacing rather than growing its assets.'
          : ': less than what wears out, so its asset base is shrinking (or the business needs few new assets).';
  if (b.ofSales != null) t += ` Spending was ${pc(b.ofSales, 1)} of sales.`;
  const first = b.history[0];
  if (b.history.length >= 3) {
    const change = y.ratio / first.ratio - 1;
    t += Math.abs(change) < REPLACING ? ` About the same pace as in ${fy(first.end)} (${times(first.ratio)}).` : ` ${change > 0 ? 'Up' : 'Down'} from ${times(first.ratio)} in ${fy(first.end)}.`;
  }
  return t;
}

export const buildStaleWords = (s: Stale) => `The newest cash-flow statement doesn’t show both capital spending and depreciation; they were last shown together for ${fy(s.lastShown)}, so today’s pace can’t be read from the filings.`;

// ---------- free cash flow after stock pay ----------

export interface PayYear {
  end: string;
  fcf: number;
  sbc: number;
}
export interface StockPay {
  latest: PayYear;
  /** fcf - sbc, newest year */
  after: number;
  /** sbc / fcf, newest year; null when free cash flow wasn't above zero */
  share: number | null;
  /** consecutive years used for the multi-year figure, oldest first */
  window: PayYear[];
  /** sum of stock pay / sum of free cash flow over the window (3+ years, the sum above zero) */
  share5: number | null;
  /** newest year's free cash flow over today's market value, before and after stock pay */
  fcfYield: number | null;
  afterYield: number | null;
}

/** Newest year with free cash flow (capital spending reported: a missing capex line would count as zero) and stock
 * pay; null for companies that report none. */
export function stockPay(a: Statements, marketCap: number | null, span = 5): StockPay | Stale | null {
  const n = newestCashFlow(a);
  const rows: PayYear[] = [];
  for (let i = 0; i <= n; i++) {
    const fcf = at(a, 'freeCashFlow', i);
    const sbc = at(a, 'stockComp', i);
    if (fcf != null && sbc != null && sbc >= 0 && at(a, 'capex', i) != null) rows.push({ end: a.periods[i], fcf, sbc });
  }
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  if (a.periods.indexOf(latest.end) < n) return { lastShown: latest.end };
  const win = window(a, rows, span);
  const sumF = win.reduce((s, r) => s + r.fcf, 0);
  const sumS = win.reduce((s, r) => s + r.sbc, 0);
  const after = latest.fcf - latest.sbc;
  const mc = marketCap != null && marketCap > 0 ? marketCap : null;
  return {
    latest,
    after,
    share: latest.fcf > 0 ? latest.sbc / latest.fcf : null,
    window: win,
    share5: win.length >= 3 && sumF > 0 ? sumS / sumF : null,
    fcfYield: div(latest.fcf, mc),
    afterYield: div(after, mc),
  };
}

export function payWords(s: StockPay): string {
  const y = s.latest;
  const year = fy(y.end);
  let t =
    y.fcf > 0
      ? `In ${year} free cash flow was ${usd(y.fcf)}. Paying staff in stock cost another ${usd(y.sbc)}, ${pc(s.share, 0)} of it, which free cash flow doesn’t count because no cash left the company. After stock pay: ${usd(s.after)}.`
      : `In ${year} free cash flow was ${y.fcf < 0 ? 'negative' : 'zero'} (${usd(y.fcf)}), and paying staff in stock cost another ${usd(y.sbc)}: ${usd(s.after)} after stock pay.`;
  const w = s.window;
  if (s.share5 != null) t += ` Over ${w.length} years (${fy(w[0].end)}–${year}) stock pay came to ${pc(s.share5, 0)} of free cash flow.`;
  else if (w.length >= 3) t += ` Over ${w.length} years (${fy(w[0].end)}–${year}) free cash flow added up to nothing or less.`;
  if (s.fcfYield != null && s.afterYield != null) t += ` At today’s market value that is a free-cash-flow yield of ${pc(s.fcfYield, 1)}, or ${pc(s.afterYield, 1)} after stock pay.`;
  return t;
}

export const payStaleWords = (s: Stale) => `The newest cash-flow statement doesn’t show free cash flow and stock pay together; they were last shown for ${fy(s.lastShown)}.`;
