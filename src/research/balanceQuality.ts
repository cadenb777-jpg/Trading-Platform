/**
 * Balance-sheet quality (Research overview, helper 75): money billed in advance against sales, and goodwill with its
 * write-downs. From the annual statements research.company returns. Pure and tested (balanceQuality.test.ts,
 * hand-worked on Microsoft's FY2026 and Coca-Cola's FY2025 10-K figures); drawn in balanceQualityView.ts.
 *
 * Billed in advance = current contract liabilities (deferred revenue; ASC 606-10-45-2, disclosed under 606-10-50-8):
 * cash or bills already sent for work not yet delivered. When it grows slower than sales, less future revenue is
 * already booked than before; faster = more. Months billed = deferred revenue / (sales / 12).
 *
 * Goodwill = what acquisitions cost above the fair value of what was bought (ASC 350). Shown against shareholders'
 * equity and total assets, with the write-downs (goodwill and other intangibles) the filings report year by year.
 * A year without a write-down line is "none reported", never zero. Large goodwill has preceded write-downs when
 * returns fall (Li, Shroff, Venkataraman and Zhang 2011, Review of Accounting Studies 16).
 */
import { fy, pc, usd, type Statements } from './debtDilution';
import { at, div } from './quality';

// ---------- billed in advance ----------

export interface DeferredYear {
  end: string;
  deferred: number;
  revenue: number;
  /** year-on-year growth (null for the first year or a missing year before) */
  deferredGrowth: number | null;
  revenueGrowth: number | null;
}
export type DeferredStale = { lastShown: string };
export interface Deferred {
  history: DeferredYear[];
  latest: DeferredYear;
  /** deferredGrowth - revenueGrowth, newest year */
  gap: number | null;
  /** deferred / (revenue / 12) */
  months: number;
}

/** Newest balance-sheet year (total assets reported), or -1. */
function newestBalance(a: Statements): number {
  let i = a.periods.length - 1;
  while (i >= 0 && at(a, 'totalAssets', i) == null) i--;
  return i;
}

/** In step = growth within this of sales growth (the words and the table's red use the same line). */
export const IN_STEP = 0.01;
export const slower = (y: DeferredYear) => y.deferredGrowth != null && y.revenueGrowth != null && y.deferredGrowth < y.revenueGrowth - IN_STEP;

export function deferredRevenue(a: Statements): Deferred | DeferredStale | null {
  const history: DeferredYear[] = [];
  for (let i = 0; i < a.periods.length; i++) {
    const d = at(a, 'deferredRevenue', i);
    const r = at(a, 'revenue', i);
    if (d == null || r == null || r <= 0) continue;
    const dp = at(a, 'deferredRevenue', i - 1);
    const rp = at(a, 'revenue', i - 1);
    history.push({
      end: a.periods[i],
      deferred: d,
      revenue: r,
      deferredGrowth: dp != null && dp > 0 ? d / dp - 1 : null,
      revenueGrowth: rp != null && rp > 0 ? r / rp - 1 : null,
    });
  }
  if (!history.length) return null;
  const latest = history[history.length - 1];
  // never an old year as today's: the newest balance sheet doesn't show it any more
  if (a.periods.indexOf(latest.end) < newestBalance(a)) return { lastShown: latest.end };
  return {
    history,
    latest,
    gap: latest.deferredGrowth != null && latest.revenueGrowth != null ? latest.deferredGrowth - latest.revenueGrowth : null,
    months: latest.deferred / (latest.revenue / 12),
  };
}

export function deferredWords(d: Deferred): string {
  const y = d.latest;
  let t = `At the end of ${fy(y.end)} customers had already been billed ${usd(y.deferred)} for work not yet delivered: ${d.months.toFixed(1)} months of sales.`;
  if (d.gap != null && y.deferredGrowth != null && y.revenueGrowth != null) {
    const pts = Math.abs(d.gap * 100).toFixed(1);
    t += ` It grew ${pc(y.deferredGrowth, 1, true)} while sales grew ${pc(y.revenueGrowth, 1, true)}`;
    t += Math.abs(d.gap) <= IN_STEP
      ? ', about in step.'
      : d.gap < 0
        ? `: ${pts} points slower, so less of next year’s sales is already booked than a year ago.`
        : `: ${pts} points faster, so more of next year’s sales is already booked than a year ago.`;
  }
  return t;
}

// ---------- goodwill and write-downs ----------

export interface WriteDown {
  end: string;
  goodwill: number | null;
  intangibles: number | null;
}
export interface Goodwill {
  end: string;
  goodwill: number;
  ofEquity: number | null;
  ofAssets: number | null;
  /** write-downs reported in the window (only years that report one above zero) */
  writeDowns: WriteDown[];
  from: string;
  /** goodwill written down in the window over the goodwill at its start (intangibles are reported apart) */
  goodwillWrittenOff: number | null;
}
export interface GoodwillStale {
  lastShown: string;
  /** write-downs reported after the line was last shown (often the reason it vanished) */
  writeDowns: WriteDown[];
}

function writeDowns(a: Statements, from: number, to: number): WriteDown[] {
  const out: WriteDown[] = [];
  for (let i = Math.max(0, from); i <= to; i++) {
    const gw = at(a, 'goodwillImpairment', i);
    const it = at(a, 'intangibleImpairment', i);
    if ((gw ?? 0) > 0 || (it ?? 0) > 0) out.push({ end: a.periods[i], goodwill: gw != null && gw > 0 ? gw : null, intangibles: it != null && it > 0 ? it : null });
  }
  return out;
}

/** Goodwill in the newest year; when the newest balance sheet doesn't show it, when it was last shown and any
 * write-downs since (never an old figure as today's). Null when no year in the filings' columns shows goodwill. */
export function goodwill(a: Statements, span = 5): Goodwill | GoodwillStale | null {
  let t = a.periods.length - 1;
  while (t >= 0 && at(a, 'goodwill', t) == null) t--;
  if (t < 0) return null;
  const nb = newestBalance(a);
  if (nb > t) return { lastShown: a.periods[t], writeDowns: writeDowns(a, t + 1, nb) };
  const g = at(a, 'goodwill', t) as number;
  const from = Math.max(0, t - span + 1);
  const wd = writeDowns(a, from, t);
  const goodwillLost = wd.reduce((sum, w) => sum + (w.goodwill ?? 0), 0);
  const start = at(a, 'goodwill', from - 1) ?? at(a, 'goodwill', from);
  return {
    end: a.periods[t],
    goodwill: g,
    ofEquity: div(g, at(a, 'equity', t)),
    ofAssets: div(g, at(a, 'totalAssets', t)),
    writeDowns: wd,
    from: a.periods[from],
    goodwillWrittenOff: start != null && start > 0 ? goodwillLost / start : null,
  };
}

const each = (ws: WriteDown[], key: 'goodwill' | 'intangibles') => ws.filter((w) => w[key] != null).map((w) => `${fy(w.end)} ${usd(w[key] as number)}`);
const listWords = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);

export function goodwillWords(g: Goodwill): string {
  let t = `Goodwill (what acquisitions cost above the value of what was bought) was ${usd(g.goodwill)} at the end of ${fy(g.end)}`;
  const parts = [g.ofEquity != null && g.ofEquity > 0 ? `${pc(g.ofEquity, 0)} of shareholders’ equity` : '', g.ofAssets != null ? `${pc(g.ofAssets, 0)} of total assets` : ''].filter(Boolean);
  t += parts.length ? `: ${parts.join(' and ')}.` : '.';
  if (g.ofEquity != null && g.ofEquity <= 0) t += ' Shareholders’ equity is below zero, so goodwill can’t be set against it.';
  const span = `${fy(g.from)}–${fy(g.end)}`;
  const gw = each(g.writeDowns, 'goodwill');
  const it = each(g.writeDowns, 'intangibles');
  if (!gw.length && !it.length) return `${t} The filings report no write-downs in ${span}.`;
  if (gw.length) t += ` Goodwill written down in ${span}: ${listWords(gw)}${g.goodwillWrittenOff != null ? ` (${pc(g.goodwillWrittenOff, 1)} of the goodwill at the start)` : ''}.`;
  else t += ` No goodwill write-downs reported in ${span}.`;
  if (it.length) t += ` Other intangibles (such as brands and trademarks) written down: ${listWords(it)}.`;
  return t;
}

export function staleWords(s: GoodwillStale): string {
  let t = `The filings haven’t shown goodwill on a line of its own since ${fy(s.lastShown)}, so today’s figure can’t be read from them.`;
  const gw = each(s.writeDowns, 'goodwill');
  if (gw.length) t += ` Goodwill written down since then: ${listWords(gw)}, which may be why the line is gone.`;
  return t;
}

export const deferredStaleWords = (s: DeferredStale) =>
  `The filings haven’t shown deferred revenue on a line of its own since ${fy(s.lastShown)}, so today’s figure can’t be read from them.`;
