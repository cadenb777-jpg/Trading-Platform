/**
 * Where a fund's payout came from, per 12-month period: the part its total return covered ("earned") and the part
 * that only came back because the price fell ("paid from your money"). Plus $10,000 invested: total value with payouts
 * reinvested, the share price alone, and the payouts received. Prices only (market price, not NAV): an economic
 * reading, not the tax label (return of capital), which only the fund's 19(a) notices / 1099-DIV give.
 * Pure, tested in payoutSplit.test.ts. Data: the helper's dividends.history (daily closes + dividends).
 */

export type Close = [date: string, close: number];
export type Payment = [exDate: string, perShare: number];

export interface YearSplit {
  /** First and last day of the period (YYYY-MM-DD). */
  from: string;
  to: string;
  startPrice: number;
  endPrice: number;
  /** Payout per share in the period (ex-dates after `from`, up to `to`). */
  payout: number;
  /** Covered by the total return: payout + price change, kept between 0 and the payout. */
  earned: number;
  /** The rest of the payout: the price drop that paid for it. */
  fromPrice: number;
  /** Price fell by more than the whole payout: the extra loss per share (beyond what was paid out). */
  extraLoss: number;
  /** fromPrice ÷ payout (0 when nothing was paid). */
  fromPriceShare: number;
}

const DAY = 86400000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Splits one period's payout per share by its price change. */
export function splitPayout(payout: number, priceChange: number): Pick<YearSplit, 'earned' | 'fromPrice' | 'extraLoss' | 'fromPriceShare'> {
  const p = Math.max(0, payout);
  const earned = Math.min(p, Math.max(0, p + priceChange));
  const fromPrice = p - earned;
  return { earned, fromPrice, extraLoss: Math.max(0, -(p + priceChange)), fromPriceShare: p > 0 ? fromPrice / p : 0 };
}

/**
 * Up to `maxYears` 12-month periods ending at the last close, oldest first. Each starts at the last close on or
 * before its start date (5 days of slack, as in dividends.total_return_stats); a period without a start is skipped.
 */
export function yearlySplit(closes: Close[], divs: Payment[], maxYears = 5): YearSplit[] {
  if (closes.length < 2) return [];
  const end = ms(closes[closes.length - 1][0]);
  const at = (t: number) => {
    let found = -1;
    for (let i = 0; i < closes.length && ms(closes[i][0]) <= t + 5 * DAY; i++) found = i;
    return found;
  };
  const out: YearSplit[] = [];
  for (let k = 0; k < maxYears; k++) {
    const toT = end - Math.round(365.25 * k) * DAY;
    const fromT = end - Math.round(365.25 * (k + 1)) * DAY;
    const a = at(fromT);
    const b = at(toT);
    if (a < 0 || b <= a || ms(closes[0][0]) > fromT + 5 * DAY) break;
    const from = closes[a][0];
    const to = closes[b][0];
    const payout = divs.filter(([d]) => d > from && d <= to).reduce((s, [, x]) => s + x, 0);
    const startPrice = closes[a][1];
    const endPrice = closes[b][1];
    out.unshift({ from, to, startPrice, endPrice, payout, ...splitPayout(payout, endPrice - startPrice) });
  }
  return out;
}

/** All periods together: the share of every $1 paid that came from the price falling. */
export function overall(splits: YearSplit[]): { payout: number; fromPrice: number; share: number | null } {
  const payout = splits.reduce((s, x) => s + x.payout, 0);
  const fromPrice = splits.reduce((s, x) => s + x.fromPrice, 0);
  return { payout, fromPrice, share: payout > 0 ? fromPrice / payout : null };
}

/** "Over 3 years, about 64¢ of every $1 paid came from the fund's own price falling." */
export function splitRead(splits: YearSplit[]): string {
  const o = overall(splits);
  if (!splits.length || o.share == null) return 'Not enough history to split the payouts yet.';
  const span = splits.length === 1 ? 'Over the last year' : `Over ${splits.length} years`;
  const cents = Math.round(o.share * 100);
  if (cents <= 2) return `${span}, the payouts were covered by what the fund earned: none of them came from its price falling.`;
  if (cents >= 100) return `${span}, every $1 paid came from the fund's own price falling (and the price fell further still).`;
  return `${span}, about ${cents}¢ of every $1 paid came from the fund's own price falling.`;
}

export interface GrowthPoint {
  date: string;
  /** Payouts reinvested on their ex-date (bought at that day's close). */
  total: number;
  /** The shares first bought, at today's price (no payouts). */
  price: number;
  /** Payouts received in cash on the first shares, added up. */
  payouts: number;
}

/** $`amount` invested at the first close: total value (payouts reinvested), price alone, payouts received. */
export function growthOf(closes: Close[], divs: Payment[], amount = 10000): GrowthPoint[] {
  if (!closes.length || !(closes[0][1] > 0)) return [];
  const shares0 = amount / closes[0][1];
  const pending = divs.filter(([d]) => d > closes[0][0]).sort((a, b) => a[0].localeCompare(b[0]));
  let j = 0;
  let shares = shares0;
  let paidPerShare = 0;
  return closes.map(([date, close]) => {
    // a dividend counts on the first close on or after its ex-date (as quant.price_matrix does)
    while (j < pending.length && pending[j][0] <= date) {
      shares += (shares * pending[j][1]) / close;
      paidPerShare += pending[j][1];
      j++;
    }
    return { date, total: shares * close, price: shares0 * close, payouts: shares0 * paidPerShare };
  });
}

/** Thins a daily series to about `max` points (keeps the first and last) so the chart stays light. */
export function thin<T>(rows: T[], max = 260): T[] {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]);
}

export const shortRange = (s: YearSplit) => {
  const f = (d: string) => new Date(ms(d)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${f(s.from)} – ${f(s.to)}`;
};
