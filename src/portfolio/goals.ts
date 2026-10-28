/** The optimiser's goals: names, one-line plain explanations, glossary terms, and the text the page builds from results. */
import type { GoalKey, GoalResult, Optimisation, WalkForwardRow } from './types';

export interface GoalInfo {
  key: GoalKey;
  name: string;
  /** One plain sentence: what the goal does. */
  line: string;
  /** Glossary term for the "i" tip. */
  term: string;
  /** Which extra setting the goal needs next to the dropdown. */
  needs?: 'targetVol' | 'volCap' | 'benchmark';
}

// Sources are in the helper (helper/engine/quant.py, GOALS): Michaud 1998 + Black & Litterman 1992; Maillard, Roncalli
// & Teiletche 2010; Markowitz 1952; Choueifaty & Coignard 2008; López de Prado 2016; Rockafellar & Uryasev 2000; Roll 1992.
export const GOALS: GoalInfo[] = [
  { key: 'risk_parity', name: 'Even risk', line: 'Each holding adds the same amount of risk. Uses no return forecasts, so it tends to hold up.', term: 'optRiskParity' },
  { key: 'growth', name: 'Best return for the risk', line: 'Aims for the most return per unit of risk, with cautious return estimates averaged over 200 reshuffled histories.', term: 'optGrowth' },
  { key: 'min_var', name: 'Lowest volatility', line: 'The mix that swung the least. Ignores returns, so it can lean hard on the calmest holdings.', term: 'optMinVar' },
  { key: 'max_div', name: 'Most diversified', line: 'Gets the most out of holdings not moving together: the biggest gap between their own swings and the mix’s.', term: 'optMaxDiv' },
  { key: 'hrp', name: 'Hierarchical risk parity', line: 'Groups holdings that move alike, then splits the money between groups by risk. Copes well with short history.', term: 'optHrp' },
  { key: 'min_cvar', name: 'Smallest bad months', line: 'Makes the average of the worst 5% of past months as mild as possible.', term: 'optCvar' },
  { key: 'target_vol', name: 'Target volatility', line: 'The highest expected return that swings about as much as you choose.', term: 'optTargetVol', needs: 'targetVol' },
  { key: 'income', name: 'Income', line: 'The highest dividend yield that stays under the volatility limit you set.', term: 'optIncome', needs: 'volCap' },
  { key: 'track', name: 'Stay close to a benchmark', line: 'Stays near a benchmark you pick, straying only as far as your tracking-error budget allows.', term: 'optTracking', needs: 'benchmark' },
];

export const DEFAULT_GOAL: GoalKey = 'risk_parity';

/** Max per holding by default: 2 / holdings, kept between 25% and 50% (same rule as the helper's default_max_weight). */
export function defaultMaxWeight(n: number): number {
  return Math.min(Math.max(2 / Math.max(n, 1), 0.25), 0.5);
}

export function goalInfo(key: string): GoalInfo | undefined {
  return GOALS.find((g) => g.key === key);
}

/** A walk-forward row's name: the current mix, equal weight, or a goal. */
export function rowName(key: WalkForwardRow['key'] | string): string {
  if (key === 'current') return 'Your current mix';
  if (key === 'equal') return 'Equal weight';
  return goalInfo(key)?.name ?? key;
}

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

/** "8.0%" for a fraction, "—" when missing. */
export function pctOrDash(v: number | null | undefined, d = 1): string {
  return v == null || !Number.isFinite(v) ? '—' : pct(v, d);
}

/** The owner's views (rows of symbol, expected return in %, confidence 0-1) as the helper wants them; incomplete rows are skipped. */
export function cleanViews(rows: { symbol: string; ret: string; confidence: number }[]): { symbol: string; return: number; confidence: number }[] {
  return rows
    .map((r) => ({ symbol: r.symbol.trim().toUpperCase(), return: parseFloat(r.ret) / 100, confidence: Math.min(0.99, Math.max(0.01, r.confidence)) }))
    .filter((v) => v.symbol && Number.isFinite(v.return));
}

/** Holm-adjusted random-walk p at or below this: the goal's edge needed the real order of events. */
export const TIMING_LEVEL = 0.1;

export interface CompareRow {
  key: GoalKey;
  row: WalkForwardRow;
  /** Holm-adjusted random-walk p (null when no shuffles were needed: no edge over the current mix). */
  p: number | null;
  beatCurrent: boolean;
  /** Later goals with the same weights, merged into this row. */
  twins: GoalKey[];
  /** Sharpe minus Even risk's, with its standard error (null for Even risk itself). */
  vs: { diff: number; se: number } | null;
}

/** The compare-goals rows in goal order (Even risk first, as the baseline); goals with identical weights share one row. */
export function compareRows(r: Optimisation): CompareRow[] {
  const wf = r.walkForward;
  if (!wf) return [];
  const cur = wf.rows.find((x) => x.key === 'current');
  const byGoal = new Map((r.goals ?? []).map((g) => [g.key, g] as const));
  const rows = new Map(wf.rows.map((x) => [x.key, x] as const));
  const out: CompareRow[] = [];
  for (const info of GOALS) {
    const row = rows.get(info.key);
    if (!row) continue;
    const g = byGoal.get(info.key);
    if (g?.sameAs) continue;
    const rw = g?.randomWalk;
    out.push({
      key: info.key,
      row,
      p: rw && rw.runs ? (rw.pAdjusted ?? rw.p) : null,
      beatCurrent: (row.sharpe ?? 0) > (cur?.sharpe ?? 0),
      twins: (r.goals ?? []).filter((x) => x.sameAs === info.key).map((x) => x.key),
      vs: g?.vsEvenRisk ?? null,
    });
  }
  return out;
}

/** "Lowest volatility (same weights: Target volatility, Income)". */
export function compareName(c: Pick<CompareRow, 'key' | 'twins'>): string {
  return c.twins.length ? `${rowName(c.key)} (same weights: ${c.twins.map(rowName).join(', ')})` : rowName(c.key);
}

/** "+0.05 ± 0.04": Sharpe difference vs Even risk, ± one standard error. */
export function vsText(vs: CompareRow['vs']): string {
  if (!vs) return 'baseline';
  return `${vs.diff >= 0 ? '+' : '−'}${Math.abs(vs.diff).toFixed(2)} ± ${vs.se.toFixed(2)}`;
}

/** The headline of the comparison: does any goal beat Even risk by more than 2 standard errors? */
export function compareVerdict(r: Optimisation): string {
  const rows = compareRows(r).filter((x) => x.vs);
  if (!rows.length) return '';
  const clear = rows.filter((x) => x.vs!.se > 0 && Math.abs(x.vs!.diff) >= 2 * x.vs!.se);
  const better = clear.filter((x) => x.vs!.diff > 0);
  if (!better.length)
    return clear.length
      ? `No goal clearly beats Even risk; ${clear.map((x) => rowName(x.key)).join(', ')} did clearly worse.`
      : 'No goal clearly beats Even risk: every difference is within 2 standard errors, so it could be chance.';
  return `${better.map((x) => rowName(x.key)).join(', ')} beat Even risk by more than 2 standard errors on data ${better.length > 1 ? 'they' : 'it'} hadn’t seen. With several goals compared, one such result can still be luck.`;
}

/** The honest lines under the compare table. */
export function compareNote(r: Optimisation): string {
  const rows = compareRows(r);
  if (!rows.length) return '';
  const beat = rows.filter((x) => x.beatCurrent).length;
  const timing = rows.filter((x) => x.p != null && x.p <= TIMING_LEVEL).length;
  const short = r.walkForward?.short ? ' This test is short, so treat every difference as chance.' : '';
  return (
    `${beat} of ${rows.length} distinct goals beat your current mix on data they hadn’t seen (goals with the same weights count once). ` +
    `“Vs Even risk” is the Sharpe difference ± one standard error (paired block bootstrap); under 2 standard errors is within chance. ` +
    `“Needs real timing?” reruns the test on history shuffled in 1-month blocks: p ≤ ${TIMING_LEVEL.toFixed(2)} (Holm-adjusted across the ${rows.length} goals) means the edge over your mix needed the real order of events` +
    `${timing ? ` (${timing} here)` : ''}. A high p is not luck: risk-based goals keep their edge on shuffled data because it comes from how the holdings move together.${short}`
  );
}

/** Before/after figures as table rows: label, current, suggested, glossary term. */
export function figureRows(current: Optimisation['currentFigures'], chosen: GoalResult | undefined): { label: string; now: string; next: string; term?: string }[] {
  if (!current || !chosen) return [];
  const rows: { label: string; now: string; next: string; term?: string }[] = [
    { label: 'Expected return / yr', now: pct(current.expectedReturn), next: pct(chosen.expectedReturn), term: 'returnEstimate' },
    { label: 'Volatility / yr', now: pct(current.volatility), next: pct(chosen.volatility) },
    { label: 'Dividend yield', now: pctOrDash(current.yield, 2), next: pctOrDash(chosen.yield, 2) },
    { label: 'Worst drop', now: pct(current.maxDrawdown, 0), next: pct(chosen.maxDrawdown, 0) },
    { label: 'Bad-month loss (CVaR 95%)', now: pct(-current.cvar), next: pct(-chosen.cvar), term: 'cvarMonth' },
  ];
  if (current.trackingError != null && chosen.trackingError != null) rows.push({ label: 'Tracking error', now: pct(current.trackingError), next: pct(chosen.trackingError), term: 'trackingError' });
  return rows;
}

/** One line on the shown goal's random-walk check. */
export function randomWalkLine(rw: GoalResult['randomWalk'], name: string): string {
  if (!rw) return '';
  if (!rw.runs) return ' Not needed: there was no edge over your mix to explain.';
  const times = Math.round(rw.p * (rw.runs + 1)) - 1;
  const adj = rw.pAdjusted != null && rw.family ? ` Holm-adjusted for the ${rw.family} goals compared: p = ${rw.pAdjusted.toFixed(2)}.` : '';
  return ` In ${times} of ${rw.runs} shuffled histories ${name} beat your mix by at least as much (p = ${rw.p.toFixed(2)}).${adj}`;
}
