/** Plain-language lines for the optimiser's short-history features: stand-in history, left-out holdings, advice. */
import type { Optimisation } from './types';

/** "Apr 2025" from an ISO date. */
export function monthYear(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Years between two ISO dates, to one decimal. */
export function yearsBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / (365.25 * 864e4)) / 10;
}

export function standInLine(s: NonNullable<Optimisation['standIns']>[number], label = s.symbol): string {
  return `Before ${monthYear(s.realStart)}, ${label}’s history is estimated from ${s.standIn} (correlation ${s.correlation.toFixed(2)}).`;
}

export function leftOutLine(s: NonNullable<Optimisation['leftOut']>[number], label = s.symbol): string {
  return `${label} only has prices since ${monthYear(s.realStart)} and no long-running fund moves closely enough with it, so it is left out of the test below.`;
}

/**
 * What to do when history is short. `tested` = 'none' (no walk-forward at all) or 'short' (the low-confidence
 * 1-year test). Methods that need little data hold up best with short histories (DeMiguel, Garlappi & Uppal 2009).
 */
export function shortHistoryAdvice(years: number, tested: 'none' | 'short'): string {
  const lead =
    tested === 'none'
      ? `Your holdings share only about ${years.toFixed(1)} years of price history, too little to test any method on data it hadn’t seen (that needs 2.5 years), so there is no proof these weights would do better.`
      : `This is a short test (about ${years.toFixed(1)} years of history): low confidence.`;
  return `${lead} With little data, simple goals are the most reliable: Even risk (uses only how much each holding swings), Hierarchical risk parity or Lowest volatility (or plain equal weight). Best return for the risk leans on past returns, which short histories can’t pin down. Check the weight ranges: wide bars mean the data can’t settle that weight. Treat the suggestion as a starting point.`;
}
