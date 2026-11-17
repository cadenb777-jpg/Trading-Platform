/**
 * Profitability and asset growth (Research overview): two classic readings from the annual statements research.company
 * already returns, so no helper change. Pure and tested (assetQuality.test.ts, hand-worked on Microsoft's, NVIDIA's and
 * Coca-Cola's 10-K figures); drawn in assetQualityView.ts.
 *
 * Gross profitability = gross profit / total assets (Novy-Marx, "The Other Side of Value: The Gross Profitability
 * Premium", Journal of Financial Economics 108, 2013): in US stocks 1963-2010, companies earning more gross profit per
 * dollar of assets went on to earn higher returns than those earning less. Shown against the company's own range.
 *
 * Asset growth = this year-end's total assets / last year-end's - 1, against sales growth (Cooper, Gulen and Schill,
 * "Asset Growth and the Cross-Section of Stock Returns", Journal of Finance 63, 2008): companies whose assets grew
 * fastest went on to earn lower returns than the slowest growers. Assets growing faster than sales = more capital for
 * each dollar of sales.
 *
 * Both are readings: neither has been tested on the owner's universe with the platform's statistics.
 */
import { fy, pc, usd, type Statements } from './debtDilution';
import { at } from './quality';
import { lastRun, newestYear, yearsBefore } from './years';

/** The newest year lacks a line the reading needs: which one, and when it was last worked out. */
export type Stale = { lastShown: string; missing: string };

/** Dollars per dollar of assets, a loss with a real minus sign: $0.30, −$0.05. */
export const dollars = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

// ---------- gross profitability ----------

export interface GpYear {
  end: string;
  /** column index in the statements */
  i: number;
  gp: number;
  assets: number;
  /** gross profit / total assets */
  ratio: number;
}
export interface GrossProfitability {
  history: GpYear[];
  latest: GpYear;
  low: number;
  high: number;
  /** where the latest sits in the company's own range: lower, middle or upper third (null with fewer than 5 years) */
  place: 'lower' | 'middle' | 'upper' | null;
}

export function grossProfitability(a: Statements): GrossProfitability | Stale | null {
  const n = newestYear(a);
  const history: GpYear[] = [];
  for (let i = 0; i <= n; i++) {
    const gp = at(a, 'grossProfit', i);
    const assets = at(a, 'totalAssets', i);
    if (gp != null && assets != null && assets > 0) history.push({ end: a.periods[i], i, gp, assets, ratio: gp / assets });
  }
  if (!history.length) return null;
  const latest = history[history.length - 1];
  if (latest.i < n) return { lastShown: latest.end, missing: at(a, 'grossProfit', n) == null ? 'gross profit' : 'total assets' };
  const rs = history.map((y) => y.ratio);
  const low = Math.min(...rs);
  const high = Math.max(...rs);
  const at01 = high > low ? (latest.ratio - low) / (high - low) : 0.5;
  return { history, latest, low, high, place: history.length < 5 ? null : at01 < 1 / 3 ? 'lower' : at01 > 2 / 3 ? 'upper' : 'middle' };
}

export function gpWords(g: GrossProfitability): string {
  const y = g.latest;
  let t =
    y.ratio > 0
      ? `In ${fy(y.end)} the company made ${dollars(y.ratio)} of gross profit for every dollar of assets (${usd(y.gp)} ÷ ${usd(y.assets)}).`
      : `In ${fy(y.end)} the company sold its goods for less than they cost to make: a gross loss of ${dollars(-y.ratio)} for every dollar of assets (${usd(y.gp)} on ${usd(y.assets)}).`;
  if (g.place) {
    t += ` Since ${fy(g.history[0].end)} it has ranged from ${dollars(g.low)} to ${dollars(g.high)}; this year sits in the ${g.place} third of that range.`;
  }
  t += ' Novy-Marx (2013) found that US companies earning more gross profit per dollar of assets went on to earn higher returns than those earning less (1963–2010).';
  return t;
}

// ---------- asset growth ----------

export interface GrowthYear {
  end: string;
  /** column index in the statements */
  i: number;
  assets: number;
  assetGrowth: number;
  salesGrowth: number | null;
  /** asset growth - sales growth (null without sales) */
  gap: number | null;
}
export interface AssetGrowth {
  /** consecutive fiscal years, oldest first (at most 5) */
  history: GrowthYear[];
  latest: GrowthYear;
}

/** In step = growth within this of sales growth (words and table use the same line). */
export const IN_STEP = 0.01;

export function assetGrowth(a: Statements, span = 5): AssetGrowth | Stale | null {
  const n = newestYear(a);
  const rows: GrowthYear[] = [];
  for (let i = 1; i <= n; i++) {
    const now = at(a, 'totalAssets', i);
    const before = at(a, 'totalAssets', i - 1);
    if (now == null || before == null || before <= 0 || !yearsBefore(a, i, i - 1, 1)) continue;
    const s = at(a, 'revenue', i);
    const s0 = at(a, 'revenue', i - 1);
    const assetGrowth = now / before - 1;
    const salesGrowth = s != null && s0 != null && s0 > 0 ? s / s0 - 1 : null;
    rows.push({ end: a.periods[i], i, assets: now, assetGrowth, salesGrowth, gap: salesGrowth == null ? null : assetGrowth - salesGrowth });
  }
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  if (latest.i < n) return { lastShown: latest.end, missing: 'total assets for two year-ends in a row' };
  return { history: lastRun(a, rows, span), latest };
}

/** Asset growth more than a point above sales growth that year (the table's amber and the words use this one test). */
export const ahead = (y: GrowthYear) => y.gap != null && y.gap > IN_STEP;
const behind = (y: GrowthYear) => y.gap != null && y.gap < -IN_STEP;

export function growthWords(g: AssetGrowth): string {
  const y = g.latest;
  let t = `Total assets ${y.assetGrowth >= 0 ? 'grew' : 'shrank'} ${pc(Math.abs(y.assetGrowth), 1)} in ${fy(y.end)} to ${usd(y.assets)}`;
  if (y.gap != null && y.salesGrowth != null) {
    t += ` while sales ${y.salesGrowth >= 0 ? 'grew' : 'fell'} ${pc(Math.abs(y.salesGrowth), 1)}`;
    const pts = Math.abs(y.gap * 100).toFixed(1);
    // above/below sales growth, never "faster" next to "shrank"
    t += ahead(y)
      ? `: asset growth was ${pts} points above sales growth, so each dollar of sales needs more capital than a year before.`
      : behind(y)
        ? `: asset growth was ${pts} points below sales growth, so each dollar of sales needs less capital than a year before.`
        : ': about in step.';
  } else t += '.';
  t += ' Cooper, Gulen and Schill (2008) found that US companies whose assets grew fastest went on to earn lower returns than the slowest growers.';
  return t;
}

export const staleWords = (s: Stale) => `The newest filings don’t show ${s.missing}; it was last worked out for ${fy(s.lastShown)}.`;
