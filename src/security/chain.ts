/**
 * The option chain the professional way (Bloomberg OMON, owner's spec 7.8): calls on the left, the strike in the
 * middle, puts on the right, in-the-money sides shaded and the underlying's price marked between the strikes it sits
 * between. Pure parts, tested in chain.test.ts.
 */
import type { ChainStrike } from './data';

/** The n strikes nearest the price (sorted low to high) and where the price sits among them (index of the first strike above it). */
export function chainWindow(strikes: ChainStrike[], spot: number, n = 16): { rows: ChainStrike[]; spotAt: number } {
  const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
  if (!sorted.length) return { rows: [], spotAt: 0 };
  const above = sorted.findIndex((s) => s.strike > spot);
  const pivot = above < 0 ? sorted.length : above;
  let from = Math.max(0, pivot - Math.floor(n / 2));
  const to = Math.min(sorted.length, from + n);
  from = Math.max(0, to - n);
  const rows = sorted.slice(from, to);
  return { rows, spotAt: Math.min(rows.length, Math.max(0, pivot - from)) };
}

/** A call is in the money below the price, a put above it. */
export const inTheMoney = (side: 'call' | 'put', strike: number, spot: number) => (side === 'call' ? strike < spot : strike > spot);

/** Whether this helper sent quotes (helper 87 on): any bid, ask or last on either side. */
export const hasQuotes = (rows: ChainStrike[]) => rows.some((r) => r.callBid != null || r.callAsk != null || r.putBid != null || r.putAsk != null);
