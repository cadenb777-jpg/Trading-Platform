/**
 * Cash health (Research overview): does the business's free cash flow pay the dividend (and buybacks), and how long
 * is cash tied up between paying suppliers and being paid by customers? From the annual statements research.company
 * returns (helper 74 adds inventory and payables). Pure and tested (cashHealth.test.ts, hand-worked on Apple's and
 * Coca-Cola's 10-K figures); drawn in cashHealthView.ts.
 *
 * Dividend cover = free cash flow (operating cash flow - capital spending) / dividends paid, for the newest year and
 * summed over the last 5 years (one weak year isn't a trend). Total cover adds buybacks to the payout. The free-cash-flow
 * view of what a company can pay its owners: Damodaran, "Investment Valuation" (3rd ed.), ch. 14 (FCFE).
 *
 * Cash conversion cycle = days sales outstanding + days inventory - days payables (Richards and Laughlin 1980, "A Cash
 * Conversion Cycle Approach to Liquidity Analysis", Financial Management 9(1)): receivables / sales x 365, inventory /
 * cost of sales x 365, payables / cost of sales x 365, on year-end balances. Payables are read only from their own
 * line; a company that reports none in any year has no cycle (never guessed). Without an inventory line in any
 * year the cycle counts customer and supplier days only, and says so.
 */
import { fy, ok, pc, usd, type Statements } from './debtDilution';
import { at, div } from './quality';

// ---------- dividend cover ----------

export interface CoverYear {
  end: string;
  fcf: number;
  dividends: number;
  buybacks: number | null;
}
export interface Cover {
  end: string;
  fcf: number;
  dividends: number;
  /** fcf / dividends, newest year (negative when free cash flow was negative) */
  cover: number;
  /** the consecutive years used for the multi-year figures, oldest first (the view's table shows exactly these) */
  window: CoverYear[];
  years: number;
  from: string;
  /** sum of free cash flow / sum of dividends over the window (3+ years) */
  cover5: number | null;
  /** the same with buybacks added to the payout (every year must report buybacks, and some must be above zero) */
  totalCover5: number | null;
  /** years in the window when free cash flow didn't cover the dividend */
  shortYears: string[];
}

/** Newest year with free cash flow (capital spending reported: a missing capex line would count as zero and overstate
 * the cover) and a dividend; null for companies that pay none. */
export function dividendCover(a: Statements, span = 5): Cover | null {
  const rows: CoverYear[] = [];
  for (let i = 0; i < a.periods.length; i++) {
    const fcf = at(a, 'freeCashFlow', i);
    const d = at(a, 'dividends', i);
    if (fcf != null && d != null && d > 0 && at(a, 'capex', i) != null) rows.push({ end: a.periods[i], fcf, dividends: d, buybacks: at(a, 'buybacks', i) });
  }
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  // the window: the newest year and the years just before it, only while there is no gap of a missing year
  const idx = (end: string) => a.periods.indexOf(end);
  const win = [last];
  for (let k = rows.length - 2; k >= 0 && win.length < span; k--) {
    if (idx(rows[k].end) !== idx(win[win.length - 1].end) - 1) break;
    win.push(rows[k]);
  }
  win.reverse();
  const sum = (f: (r: CoverYear) => number) => win.reduce((s, r) => s + f(r), 0);
  const bbKnown = win.every((r) => r.buybacks != null) && win.some((r) => (r.buybacks as number) > 0);
  return {
    end: last.end,
    fcf: last.fcf,
    dividends: last.dividends,
    cover: last.fcf / last.dividends,
    window: win,
    years: win.length,
    from: win[0].end,
    cover5: win.length >= 3 ? sum((r) => r.fcf) / sum((r) => r.dividends) : null,
    totalCover5: win.length >= 3 && bbKnown ? div(sum((r) => r.fcf), sum((r) => r.dividends + (r.buybacks as number))) : null,
    shortYears: win.filter((r) => r.fcf < r.dividends).map((r) => r.end),
  };
}

const times = (x: number) => `${x.toFixed(x >= 10 ? 0 : 1)} times`;
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);

export function coverWords(c: Cover): string {
  const year = fy(c.end);
  let t = c.fcf <= 0
    ? `In ${year} free cash flow was ${c.fcf < 0 ? 'negative' : 'zero'} (${usd(c.fcf)}): none of the dividend (${usd(c.dividends)}) came from it, so it was paid from cash on hand or borrowing.`
    : c.cover >= 1
      ? `In ${year} free cash flow (${usd(c.fcf)}) covered the dividend (${usd(c.dividends)}) ${times(c.cover)}.`
      : `In ${year} free cash flow (${usd(c.fcf)}) paid only ${pc(c.cover, 0)} of the dividend (${usd(c.dividends)}): the rest came from cash on hand or borrowing.`;
  if (c.cover5 != null) {
    const span = `Over ${c.years} years (${fy(c.from)}–${year})`;
    const short = c.shortYears.map(fy);
    t += c.cover5 <= 0
      ? ` ${span} free cash flow added up to less than nothing, so none of the dividends came from it.`
      : ` ${span} it covered it ${times(c.cover5)}${short.length ? `, falling short in ${list(short)}.` : ', every year.'}`;
  }
  if (c.totalCover5 != null) {
    t += c.totalCover5 >= 1
      ? ` With buybacks added, ${times(c.totalCover5)} over those years.`
      : c.totalCover5 <= 0
        ? ' With buybacks added, all of the payout came from elsewhere over those years.'
        : ` With buybacks added the company paid out more than its free cash flow over those years (${pc(c.totalCover5, 0)} covered).`;
  }
  return t;
}

/** Plain-words grade for the cover: under 1 = not covered, 1-1.5 = thin, above = covered. Uses the 5-year figure
 * when there is one (one weak year isn't a trend). */
export function coverWord(c: Cover): 'covered' | 'thin' | 'not covered' {
  const x = c.cover5 ?? c.cover;
  return x < 1 ? 'not covered' : x < 1.5 ? 'thin' : 'covered';
}

// ---------- cash conversion cycle ----------

export interface CycleYear {
  end: string;
  dso: number;
  dio: number;
  dpo: number;
  ccc: number;
}
export interface Cycle {
  history: CycleYear[];
  latest: CycleYear;
  previous: CycleYear | null;
  /** the filings have no inventory line in any year: the cycle counts customer and supplier days only (said so) */
  noInventory: boolean;
}
export type CycleMissing = { missing: 'payables' | 'sales' };

export function cashCycle(a: Statements): Cycle | CycleMissing | null {
  const hasAny = (k: string) => (a.values[k] ?? []).some(ok);
  if (!hasAny('payables')) return { missing: 'payables' };
  if (!hasAny('revenue') || !hasAny('costOfRevenue')) return { missing: 'sales' };
  const noInventory = !hasAny('inventory');
  const history: CycleYear[] = [];
  for (let i = 0; i < a.periods.length; i++) {
    const sales = at(a, 'revenue', i);
    const cost = at(a, 'costOfRevenue', i);
    const rec = at(a, 'receivables', i);
    const inv = noInventory ? 0 : at(a, 'inventory', i);
    const pay = at(a, 'payables', i);
    const dso = div(rec, sales);
    const dio = div(inv, cost);
    const dpo = div(pay, cost);
    if (dso == null || dio == null || dpo == null || (sales as number) <= 0 || (cost as number) <= 0) continue;
    const y = { end: a.periods[i], dso: dso * 365, dio: dio * 365, dpo: dpo * 365, ccc: (dso + dio - dpo) * 365 };
    history.push(y);
  }
  if (!history.length) return null;
  const latest = history[history.length - 1];
  const prevIdx = a.periods.indexOf(latest.end) - 1;
  const previous = history.find((y) => y.end === a.periods[prevIdx]) ?? null;
  return { history, latest, previous, noInventory };
}

const days = (x: number) => `${Math.round(Math.abs(x))} day${Math.round(Math.abs(x)) === 1 ? '' : 's'}`;

export function cycleWords(c: Cycle): string {
  const y = c.latest;
  const parts = `customers pay in about ${days(y.dso)}${c.noInventory ? '' : `, stock sits ${days(y.dio)}`} and it pays suppliers in ${days(y.dpo)}`;
  let t = y.ccc < 0
    ? `In ${fy(y.end)} ${parts}, so it is paid ${days(y.ccc)} before it pays: suppliers fund its working capital.`
    : `In ${fy(y.end)} ${parts}, so cash is tied up for ${days(y.ccc)} between paying suppliers and being paid.`;
  if (c.previous) {
    const d = y.ccc - c.previous.ccc;
    if (Math.abs(d) >= 1) t += ` That is ${days(d)} ${d > 0 ? 'longer' : 'shorter'} than in ${fy(c.previous.end)}${d > 0 ? ' (more cash tied up)' : ''}.`;
    else t += ` About the same as in ${fy(c.previous.end)}.`;
  }
  if (c.noInventory) t += ' The filings have no inventory line, so this counts only customer and supplier days (a company that does hold stock would be tied up for longer).';
  return t;
}
