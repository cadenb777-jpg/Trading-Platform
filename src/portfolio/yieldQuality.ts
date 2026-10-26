/**
 * "Is the yield sustainable?" for high-yield holdings (option-income ETFs, closed-end funds, BDCs, REITs). Over a
 * period, the payouts actually made (realised distribution yield ≈ total return − price return) are compared with the
 * price change: when the price fell, that fall paid for part of the payout ("erosion": the owner's own money coming
 * back). When the price held or rose, nothing came from the owner's money. Same idea as payoutSplit.ts, per year.
 * Prices only (market price, not NAV); the real return-of-capital split comes from the fund's 19(a) notices /
 * 1099-DIV box 3, so it is shown only when entered. Pure, tested in yieldQuality.test.ts.
 */

/** Today's distribution yields above this get the check (and a flag in the holdings table). */
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

const monthYear = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'start';
};

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
    out.push({ label: `Since ${monthYear(r.sinceStart)}${years < 1 ? ` (${Math.round(years * 12)} mo)` : ''}`, total: r.trSince, price: r.priceSince, yearly: years >= 1 });
  }
  return out;
}

export interface PeriodSplit {
  /** Payouts made, as a yield: total return − price return (never below 0). */
  paid: number;
  /** The part of `paid` the price fall paid for: min(paid, −price return); 0 when the price held or rose. */
  fromPrice: number;
  /** fromPrice ÷ paid (0..1); null when nothing was paid. */
  share: number | null;
}

/** One period's payouts split by its price change (the yearly version of payoutSplit.splitPayout). */
export function splitPeriod(p: Pick<Period, 'total' | 'price'>): PeriodSplit {
  const paid = Math.max(0, p.total - p.price);
  const fromPrice = p.price < 0 ? Math.min(paid, -p.price) : 0;
  return { paid, fromPrice, share: paid > 0 ? fromPrice / paid : null };
}

export interface YieldCheck {
  /** Today's forward distribution yield (latest payment × payments a year ÷ price). */
  distYield: number;
  /** The longest yearly period used for the read (null when there is none yet). */
  period: Period | null;
  /** Yearly payouts made over that period (realised distribution yield). */
  paid: number | null;
  /** Yearly points of payout that came from the price falling (0 when the price held or rose). */
  erosion: number | null;
  /** erosion ÷ paid (0..1). */
  share: number | null;
  /** Plain-language read. */
  read: string;
  tone: 'ok' | 'warn' | 'bad' | '';
}

const pctText = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const abs = (v: number) => pctText(Math.abs(v), Math.abs(v) < 0.1 ? 1 : 0);
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${abs(v)}`;

/** "about two-thirds" for 0.64. */
export function shareWords(share: number): string {
  if (share >= 0.92) return 'almost all of the payout';
  const words: [number, string][] = [[0.75, 'about three-quarters'], [2 / 3, 'about two-thirds'], [0.5, 'about half'], [1 / 3, 'about a third'], [0.25, 'about a quarter'], [0.1, 'a small part']];
  let best = words[0];
  for (const w of words) if (Math.abs(w[0] - share) < Math.abs(best[0] - share)) best = w;
  return share < 0.07 ? 'very little of the payout' : `${best[1]} of the payout`;
}

/** The check for one holding; null when today's yield is unknown or below HIGH_YIELD (unless `always`). */
export function yieldCheck(distYield: number | null | undefined, r: ReturnFigures, always = false): YieldCheck | null {
  if (distYield == null || !Number.isFinite(distYield) || distYield <= 0) return null;
  if (!always && distYield < HIGH_YIELD) return null;
  const yearly = periods(r).filter((p) => p.yearly);
  const period = yearly.length ? yearly[yearly.length - 1] : null;
  const none = (read: string): YieldCheck => ({ distYield, period, paid: null, erosion: null, share: null, read, tone: '' });
  if (!period) return none(`Pays about ${abs(distYield)} a year at today's rate, but there isn't a year of price history yet to see whether the price holds up.`);
  const { paid, fromPrice, share } = splitPeriod(period);
  if (share == null) return none(`No payouts showed up in the price history ${overText(period)}, so there is nothing to split yet.`);
  const priceText = period.price < 0 ? `the price fell ${abs(period.price)}/yr` : `the price ${period.price > 0.005 ? `rose ${abs(period.price)}/yr` : 'held steady'}`;
  if (fromPrice <= 0.005 * paid || fromPrice < 0.001) {
    return { distYield, period, paid, erosion: 0, share: 0, read: `Paid about ${abs(paid)}/yr and ${priceText} ${overText(period)}: none of the payout came from the fund's own price falling (total return ${pct(period.total)}/yr).`, tone: 'ok' };
  }
  return {
    distYield,
    period,
    paid,
    erosion: fromPrice,
    share,
    read: `Paid about ${abs(paid)}/yr but ${priceText} ${overText(period)} (total return ${pct(period.total)}/yr): ${shareWords(share)} came from the fund's own price falling, i.e. your own money coming back.`,
    tone: share >= 0.5 ? 'bad' : 'warn',
  };
}

function overText(p: Period) {
  if (p.label === '1 yr') return 'over the last year';
  if (p.label.startsWith('Since ')) return `since ${p.label.slice(6)}`;
  return `over the last ${p.label.replace(' yr', ' years')}`;
}

/** The return-of-capital line: only what the owner entered (never estimated from prices). */
export function rocText(rocPct: number | null | undefined, year?: string | null): string | null {
  if (rocPct == null || !Number.isFinite(rocPct)) return null;
  const share = Math.max(0, Math.min(1, rocPct));
  return `${pctText(share)} of the payouts${year ? ` in ${year}` : ''} were return of capital (you entered this): not taxed when paid, it lowers your cost basis.`;
}

/** An EDGAR full-text search for the fund's Section 19(a) notices (where the fund states its estimated ROC). */
export const notice19aLink = (symbol: string) => `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(`"19(a)" "${symbol}"`)}`;
