/**
 * Formatting for the cross-check confidence meter (helper engine/crosscheck.py scores; this only displays them).
 * Pure functions so they can be tested without a browser.
 */

export type CheckField = 'last' | 'prevClose' | 'nav' | 'divYield' | 'expenseRatio';
export type CheckTone = 'ok' | 'amber' | 'red';

export interface SourceReading {
  source: string;
  name: string;
  kind: string;
  value: number | null;
  asOf: number | null;
  url: string | null;
  note?: string;
  error?: string;
  /** The definition: 'forward' / 'trailing' (yields), 'net' / 'gross' (expense ratios), 'Class I' (NAVs). */
  basis?: string | null;
  basisLabel?: string | null;
  /** False when its definition differs from the main one (listed, not compared). */
  compared?: boolean;
  reliability?: number;
  freshness?: number;
  weight?: number;
  agrees?: boolean;
}

export interface CrossCheck {
  field: CheckField;
  label: string;
  unit: 'usd' | 'pct';
  symbol: string | null;
  cik: number | null;
  tolerance: number;
  best: number | null;
  /** The source whose value is the best estimate (the most trusted one that agrees). */
  bestSource: string | null;
  basis: string | null;
  basisLabel: string | null;
  score: number;
  level: 'High' | 'Medium' | 'Low' | 'None';
  tone: CheckTone;
  status: 'none' | 'single' | 'agree' | 'differ' | 'conflict';
  message: string;
  agreeing: number;
  spread: number | null;
  sources: SourceReading[];
  rubric: string[];
  checkedAt: number;
}

/** 0.653 -> 65 (whole percent, 0-100; never rounds a sub-1% score up to look like evidence). */
export function meterPercent(score: number | null | undefined): number {
  if (score == null || !Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.floor(score * 100 + 1e-9)));
}

/** "65% confident". */
export const meterText = (score: number | null | undefined) => `${meterPercent(score)}% confident`;

/** High (80%+), Medium (55%+), Low, or None when no source had a value. Same thresholds as the helper. */
export function confidenceLabel(score: number | null | undefined, hasValue = true): 'High' | 'Medium' | 'Low' | 'None' {
  if (!hasValue) return 'None';
  const p = meterPercent(score);
  return p >= 80 ? 'High' : p >= 55 ? 'Medium' : 'Low';
}

/** Plain-words heading for the status. */
export function statusWords(status: CrossCheck['status']): string {
  return { none: 'No source had it', single: 'Only one source', agree: 'Sources agree', differ: 'One or more sources differ', conflict: 'Sources disagree' }[status] ?? '';
}

/** A value in its unit: dollars ($230.12; small NAVs keep 4 decimals) or a percentage from a fraction (0.0045 -> 0.45%). */
export function formatCheckValue(value: number | null | undefined, unit: 'usd' | 'pct'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (unit === 'pct') return `${(value * 100).toFixed(Math.abs(value) < 0.001 ? 3 : 2)}%`;
  const abs = Math.abs(value);
  const digits = abs >= 1 ? 2 : 4;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** How old a reading is, in words: "just now", "5 min ago", "3 h ago", "2 days ago", "on 2026-09-30", "time not given". */
export function ageText(asOf: number | null | undefined, nowMs = Date.now()): string {
  if (asOf == null || !Number.isFinite(asOf)) return 'time not given';
  const s = Math.max(0, nowMs / 1000 - asOf);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  if (s < 14 * 86400) return `${Math.round(s / 86400)} days ago`;
  return `on ${new Date(asOf * 1000).toISOString().slice(0, 10)}`;
}

/** The chip's text: "Sources" before a check, "Sources · 65%" after, "Sources · none" when nothing was found. */
export function chipText(check: Pick<CrossCheck, 'score' | 'best'> | null): string {
  if (!check) return 'Sources';
  return check.best == null ? 'Sources · none' : `Sources · ${meterPercent(check.score)}%`;
}

/** The rubric as one tooltip string (shown on hover over the meter). */
export function rubricTitle(rubric: string[] | undefined): string {
  return ['How the confidence is scored:', ...(rubric ?? []).map((r) => `• ${r}`)].join('\n');
}
