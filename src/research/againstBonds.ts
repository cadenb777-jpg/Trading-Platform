/**
 * Against bonds (Research overview, helper 86): what a stock earns per dollar of its price against what a 10-year
 * inflation-protected Treasury pays above inflation. Pure and tested (againstBonds.test.ts); drawn in
 * againstBondsView.ts.
 *
 * Earnings yield = 1 / P/E (the last twelve months' diluted earnings over today's price). Earnings, unlike a bond's
 * coupon, tend to grow with inflation, so the earnings yield is compared with the REAL yield (FRED DFII10), not the
 * nominal one: Asness, "Fight the Fed Model", Journal of Portfolio Management 30 (2003), shows the nominal comparison
 * mixes a real figure with a nominal one. If earnings just keep pace with inflation, the gap is roughly the extra real
 * return the stock offers for its extra risk; growth above inflation adds to it, falling earnings take from it.
 */
import { pc } from './debtDilution';
import type { CorpYields } from './obligations';

/** research.corpyields' real10 (helper 86). */
export type RealYield = NonNullable<CorpYields['real10']>;

export interface AgainstBonds {
  pe: number;
  /** 1 / P/E */
  earningsYield: number;
  /** real 10-year yield as a fraction */
  real: number;
  /** earnings yield - real yield (fractions), rounded to a tenth of a point so words, sign and headline agree */
  gap: number;
}

/** Null when there are no earnings to compare (a loss, or no P/E). */
export function againstBonds(pe: number | null | undefined, realYield: RealYield): AgainstBonds | null {
  if (pe == null || !Number.isFinite(pe) || pe <= 0) return null;
  const earningsYield = 1 / pe;
  const real = realYield.value / 100;
  return { pe, earningsYield, real, gap: Math.round((earningsYield - real) * 1000) / 1000 };
}

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const year = (iso: string) => iso.slice(0, 4);

/** Plain words for where the real yield sits in its own history. */
export function realYieldPlace(r: RealYield): string {
  if (r.percentile == null || !r.since) return '';
  const p = r.percentile;
  const since = year(r.since);
  // p = share of days below today plus half the ties: "higher than on" uses the days below, never 100%
  if (p >= 90) return `, higher than on ${Math.min(99, Math.floor(p))}% of days since ${since}`;
  if (p <= 10) return `, lower than on ${Math.min(99, Math.floor(100 - p))}% of days since ${since}`;
  return `, in the middle of its range since ${since}`;
}

export function againstWords(x: AgainstBonds, r: RealYield): string {
  let t = `At today’s price the company earns ${pc(x.earningsYield, 1)} of its price a year (P/E ${x.pe.toFixed(1)} on the last twelve months).`;
  t +=
    r.value >= 0
      ? ` A 10-year inflation-protected Treasury pays ${r.value.toFixed(2)}% a year above inflation (${day(r.date)})${realYieldPlace(r)}.`
      : ` A 10-year inflation-protected Treasury pays ${Math.abs(r.value).toFixed(2)}% a year less than inflation (${day(r.date)})${realYieldPlace(r)}: a real loss for the safe bond.`;
  const pts = Math.abs(x.gap * 100).toFixed(1);
  if (x.gap === 0) return `${t} The stock earns about the same as the safe bond, so its price relies on earnings growing faster than inflation to do better.`;
  t +=
    x.gap > 0
      ? ` The stock earns ${pts} points more. If its earnings only keep pace with inflation, that gap is roughly the extra real return it offers for its extra risk; growth above inflation adds to it.`
      : ` The stock earns ${pts} points less, so its price relies on earnings growing faster than inflation to beat the safe bond.`;
  return t;
}

export const noEarningsWords = 'The company has no earnings over the last twelve months (or no price right now), so there is no earnings yield to set against bonds.';
