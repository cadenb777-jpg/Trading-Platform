/**
 * Client review maths (Clients page): risk against the client's risk tolerance, allocation drift against the target
 * model, and the income the account is expected to pay. Pure and tested (review.test.ts).
 *
 * Risk tolerance uses five levels with a range of yearly volatility each, the way risk-score tools (Nitrogen's Risk
 * Number, Morningstar's Portfolio Risk Score) map a questionnaire to a band. The bands are guides, not rules.
 */

export interface RiskLevel {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  /** Yearly volatility range (fractions: 0.06 = 6%). */
  min: number;
  max: number | null;
}

export const RISK_LEVELS: RiskLevel[] = [
  { level: 1, label: 'Conservative', min: 0, max: 0.06 },
  { level: 2, label: 'Moderately conservative', min: 0.06, max: 0.09 },
  { level: 3, label: 'Moderate', min: 0.09, max: 0.13 },
  { level: 4, label: 'Moderately aggressive', min: 0.13, max: 0.17 },
  { level: 5, label: 'Aggressive', min: 0.17, max: null },
];

/** The tolerance a client's objective suggests when none was set (Capital preservation -> 1 ... Aggressive growth -> 5). */
export function defaultTolerance(objective: string | undefined): RiskLevel['level'] {
  const map: Record<string, RiskLevel['level']> = { 'Capital preservation': 1, Income: 2, Balanced: 3, Growth: 4, 'Aggressive growth': 5 };
  return (objective && map[objective]) || 3;
}

export const riskLevel = (level: number | undefined) => RISK_LEVELS.find((r) => r.level === level) ?? RISK_LEVELS[2];

export interface RiskFit {
  status: 'within' | 'above' | 'below';
  band: RiskLevel;
  /** The level the volatility itself falls in. */
  actual: RiskLevel;
  text: string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function riskFit(volatility: number, level: number | undefined): RiskFit {
  const band = riskLevel(level);
  const actual = RISK_LEVELS.find((r) => volatility >= r.min && (r.max == null || volatility < r.max)) ?? RISK_LEVELS[4];
  const range = band.max == null ? `${pct(band.min)} or more` : `${pct(band.min)}-${pct(band.max)}`;
  if (volatility >= (band.max ?? Infinity))
    return { status: 'above', band, actual, text: `Swings of ${pct(volatility)} a year are more than a ${band.label.toLowerCase()} client's ${range}: the portfolio reads ${actual.label.toLowerCase()}. Consider de-risking or updating the tolerance on record.` };
  if (volatility < band.min)
    return { status: 'below', band, actual, text: `Swings of ${pct(volatility)} a year are below the ${range} band for ${band.label.toLowerCase()}: the client is taking less risk than agreed (fine if intended).` };
  return { status: 'within', band, actual, text: `Swings of ${pct(volatility)} a year sit inside the ${range} band for ${band.label.toLowerCase()}.` };
}

export interface DriftRow {
  label: string;
  /** Shares of the account (0-1). */
  current: number;
  target: number;
  /** current - target, in fractions (0.05 = 5 percentage points). */
  drift: number;
  status: 'ok' | 'over' | 'under';
  /** Dollars to buy (+) or sell (-) to get back to the target, when the account value is known. */
  trade: number | null;
}

/** Drift by group (asset class) against target weights; outside ±band counts as over/under. Largest drift first. */
export function allocationDrift(current: { label: string; value: number }[], target: { label: string; weight: number }[], band = 0.05): { rows: DriftRow[]; total: number; maxDrift: number; outside: number } {
  const total = current.reduce((s, c) => s + Math.max(0, c.value), 0);
  const tSum = target.reduce((s, t) => s + Math.max(0, t.weight), 0) || 1;
  const labels = [...new Set([...current.map((c) => c.label), ...target.map((t) => t.label)])];
  const rows = labels.map((label): DriftRow => {
    const value = current.filter((c) => c.label === label).reduce((s, c) => s + Math.max(0, c.value), 0);
    const cur = total ? value / total : 0;
    const tgt = target.filter((t) => t.label === label).reduce((s, t) => s + Math.max(0, t.weight), 0) / tSum;
    const drift = cur - tgt;
    return { label, current: cur, target: tgt, drift, status: drift > band + 1e-9 ? 'over' : drift < -band - 1e-9 ? 'under' : 'ok', trade: total ? Math.round(-drift * total) : null };
  });
  rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift) || a.label.localeCompare(b.label));
  return { rows, total, maxDrift: rows.length ? Math.abs(rows[0].drift) : 0, outside: rows.filter((r) => r.status !== 'ok').length };
}

export interface IncomeRow {
  symbol: string;
  value: number;
  /** Yearly yield as a fraction, or null when unknown. */
  yld: number | null;
}

/** Estimated income over the next 12 months from current yields: total, monthly average, yield and the biggest payers. */
export function incomeEstimate(rows: IncomeRow[], top = 3) {
  const paying = rows.filter((r) => r.yld != null && r.yld > 0 && r.value > 0).map((r) => ({ ...r, income: r.value * (r.yld as number) }));
  const annual = paying.reduce((s, r) => s + r.income, 0);
  const value = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  return {
    annual,
    monthly: annual / 12,
    yield: value ? annual / value : null,
    top: paying.sort((a, b) => b.income - a.income).slice(0, top),
    unknown: rows.filter((r) => r.yld == null && r.value > 0).map((r) => r.symbol),
  };
}

/** Since the start date: the yearly (annualised) and cumulative returns, the years covered and what the initial
 * investment grew to at that cumulative return (the review and the PDF use the same figures). */
export function sinceStart(a: { start: string; end: string; stats: { totalReturn: number }; trailing: { inception: { portfolio: number | null } } } | null | undefined, initial: number | null | undefined) {
  if (!a) return null;
  const years = (Date.parse(`${a.end}T00:00:00Z`) - Date.parse(`${a.start}T00:00:00Z`)) / (365.25 * 86400000);
  const cumulative = Number.isFinite(a.stats.totalReturn) ? a.stats.totalReturn : null;
  return {
    perYear: a.trailing.inception.portfolio,
    cumulative,
    years: Number.isFinite(years) && years > 0 ? years : null,
    endValue: initial && initial > 0 && cumulative != null ? initial * (1 + cumulative) : null,
  };
}
