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

/** The compare-goals rows: each goal's walk-forward result next to the current mix, best walk-forward Sharpe first. */
export function compareRows(r: Optimisation): { key: GoalKey; row: WalkForwardRow; p: number | null; beatCurrent: boolean }[] {
  const wf = r.walkForward;
  if (!wf) return [];
  const cur = wf.rows.find((x) => x.key === 'current');
  const byGoal = new Map((r.goals ?? []).map((g) => [g.key, g] as const));
  return wf.rows
    .filter((x): x is WalkForwardRow & { key: GoalKey } => x.key !== 'current' && x.key !== 'equal')
    .map((row) => {
      const rw = byGoal.get(row.key)?.randomWalk;
      return { key: row.key, row, p: rw && rw.runs ? rw.p : null, beatCurrent: (row.sharpe ?? 0) > (cur?.sharpe ?? 0) };
    })
    .sort((a, b) => (b.row.sharpe ?? -Infinity) - (a.row.sharpe ?? -Infinity));
}

/** The honest line under the compare table. */
export function compareNote(r: Optimisation): string {
  const rows = compareRows(r);
  if (!rows.length) return '';
  const beat = rows.filter((x) => x.beatCurrent).length;
  const strong = rows.filter((x) => x.p != null && x.p <= 0.1).length;
  const short = r.walkForward?.short ? ' This test is short, so treat every difference as chance.' : '';
  return (
    `${beat} of ${rows.length} goals beat your current mix on data they hadn’t seen. ` +
    `Differences between goals are often chance: with ${rows.length} goals tested, one or two “wins” (p ≤ 0.10) are expected even when none is really better` +
    `${strong ? ` (${strong} here)` : ''}. Prefer a goal that held up and suits you over the top row.${short}`
  );
}

/** Before/after figures as table rows: label, current, suggested, glossary term. */
export function figureRows(current: Optimisation['currentFigures'], chosen: GoalResult | undefined): { label: string; now: string; next: string; term?: string }[] {
  if (!current || !chosen) return [];
  const rows: { label: string; now: string; next: string; term?: string }[] = [
    { label: 'Expected return / yr', now: pct(current.expectedReturn), next: pct(chosen.expectedReturn), term: 'returnEstimate' },
    { label: 'Volatility / yr', now: pct(current.volatility), next: pct(chosen.volatility) },
    { label: 'Dividend yield', now: pctOrDash(current.yield, 2), next: pctOrDash(chosen.yield, 2) },
    { label: 'Worst drop (history)', now: pct(current.maxDrawdown, 0), next: pct(chosen.maxDrawdown, 0) },
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
  return ` In ${times} of ${rw.runs} shuffled histories ${name} beat your mix by at least as much (p = ${rw.p.toFixed(2)}).`;
}
