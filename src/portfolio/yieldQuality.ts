/**
 * "Is the yield sustainable?" for high-yield holdings (option-income ETFs, closed-end funds, BDCs, REITs): compares
 * the distribution yield with the total return actually earned. When the total return is lower, the difference
 * ("erosion") is payout that came out of the price, i.e. the owner's own money handed back. Prices only: the real
 * return-of-capital split comes from the fund's 19(a) notices / 1099-DIV box 3, so it is shown only when entered.
 * Pure, tested in yieldQuality.test.ts.
 */

/** Distribution yields above this get the check (and a flag in the holdings table). */
export const HIGH_YIELD = 0.06;

export interface ReturnFigures {
  tr1y?: number | null;
  price1y?: number | null;
  tr3y?: number | null;
  price3y?: number | null;
  tr5y?: number | null;
  price5y?: number | null;
  /** Since the first close fetched (a fund's inception when younger than the 6 years read); yearly when sinceYears >= 1. */
  trSince?: number | null;
  priceSince?: number | null;
  sinceStart?: string | null;
  sinceYears?: number | null;
}

export interface Period {
  label: string;
  /** Yearly rates (or the plain change for a period under a year: `yearly` false). */
  total: number;
  price: number;
  yearly: boolean;
}

/** The periods with both figures, longest last: 1y, 3y, 5y, and since inception when it adds a different span. */
export function periods(r: ReturnFigures): Period[] {
  const out: Period[] = [];
  for (const y of [1, 3, 5] as const) {
    const t = r[`tr${y}y`];
    const p = r[`price${y}y`];
    if (t != null && p != null && Number.isFinite(t) && Number.isFinite(p)) out.push({ label: `${y} yr`, total: t, price: p, yearly: true });
  }
  const years = r.sinceYears ?? 0;
  // since inception only when it isn't (about) one of the periods already shown and no 5-year figure exists
  if (r.trSince != null && r.priceSince != null && r.tr5y == null && years > 0 && ![1, 3].some((y) => Math.abs(years - y) < 0.1 && out.some((p) => p.label === `${y} yr`))) {
    out.push({ label: `Since ${r.sinceStart ?? 'start'}${years < 1 ? ` (${Math.round(years * 12)} mo)` : ''}`, total: r.trSince, price: r.priceSince, yearly: years >= 1 });
  }
  return out;
}

export interface YieldCheck {
  distYield: number;
  /** The longest yearly period used for the read (null when there is none yet). */
  period: Period | null;
  /** Distribution yield − total return, when the total return is lower (yearly points of payout from the price). */
  erosion: number | null;
  /** erosion ÷ distribution yield: the share of the payout that was the owner's own money (may exceed 1). */
  share: number | null;
  /** Plain-language read. */
  read: string;
  tone: 'ok' | 'warn' | 'bad' | '';
}

/** Erosion = distribution yield − total return when the total return is below the yield (else 0). */
export function erosionOf(distYield: number, total: number): number {
  return Math.max(0, distYield - total);
}

const pctText = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const abs = (v: number) => pctText(Math.abs(v), Math.abs(v) < 0.1 ? 1 : 0);

/** "about two-thirds" for 0.64. */
export function shareWords(share: number): string {
  if (share >= 1.05) return 'all of the payout, and more,';
  if (share >= 0.92) return 'almost all of the payout';
  const words: [number, string][] = [[0.75, 'about three-quarters'], [2 / 3, 'about two-thirds'], [0.5, 'about half'], [1 / 3, 'about a third'], [0.25, 'about a quarter'], [0.1, 'a small part']];
  let best = words[0];
  for (const w of words) if (Math.abs(w[0] - share) < Math.abs(best[0] - share)) best = w;
  return share < 0.07 ? 'very little' : `${best[1]} of the payout`;
}

/** The check for one holding; null when its yield is unknown or below HIGH_YIELD (unless `always`). */
export function yieldCheck(distYield: number | null | undefined, r: ReturnFigures, always = false): YieldCheck | null {
  if (distYield == null || !Number.isFinite(distYield) || distYield <= 0) return null;
  if (!always && distYield < HIGH_YIELD) return null;
  const yearly = periods(r).filter((p) => p.yearly);
  const period = yearly.length ? yearly[yearly.length - 1] : null;
  if (!period) return { distYield, period: null, erosion: null, share: null, read: `Pays about ${abs(distYield)} a year, but there isn't a year of price history yet to see whether the price holds up.`, tone: '' };
  const erosion = erosionOf(distYield, period.total);
  const share = erosion / distYield;
  const over = period.label === '1 yr' ? 'over the last year' : `over ${period.label.startsWith('Since') ? 'its history' : `the last ${period.label.replace(' yr', ' years')}`}`;
  const priceText = period.price < 0 ? `the price fell ${abs(period.price)}/yr` : `the price rose ${abs(period.price)}/yr`;
  let read: string;
  let tone: YieldCheck['tone'];
  if (erosion <= 0.005) {
    read = `Paid about ${abs(distYield)}/yr and ${priceText} ${over}: the payout was covered by what it earned (total return ${pct(period.total)}/yr).`;
    tone = 'ok';
  } else {
    read = `Paid about ${abs(distYield)}/yr but ${priceText} ${over} (total return ${pct(period.total)}/yr): ${shareWords(share)} came back out of your own money.`;
    tone = share >= 0.5 ? 'bad' : 'warn';
  }
  return { distYield, period, erosion, share, read, tone };
}

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${abs(v)}`;

/** The return-of-capital line: only what the owner entered (never estimated from prices). */
export function rocText(rocPct: number | null | undefined, year?: string | null): string | null {
  if (rocPct == null || !Number.isFinite(rocPct)) return null;
  const share = Math.max(0, Math.min(1, rocPct));
  return `${pctText(share)} of the payouts${year ? ` in ${year}` : ''} were return of capital (you entered this): not taxed when paid, it lowers your cost basis.`;
}

/** An EDGAR full-text search for the fund's Section 19(a) notices (where the fund states its estimated ROC). */
export const notice19aLink = (symbol: string) => `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(`"19(a)" "${symbol}"`)}`;
