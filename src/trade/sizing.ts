/**
 * Order-ticket maths, kept pure so it can be tested: dollars -> whole shares, risk-based size (the same sum as the
 * Setups trade guide: account x risk% / risk per share, rounded down), quick buttons and the cost estimate.
 */

/** Whole shares a dollar amount buys at a price (rounded down), with what's left over. */
export function sharesForDollars(dollars: number, price: number): { shares: number; cost: number; left: number } {
  if (!(dollars > 0) || !(price > 0)) return { shares: 0, cost: 0, left: Math.max(dollars || 0, 0) };
  const shares = Math.floor(dollars / price + 1e-9);
  const cost = round2(shares * price);
  return { shares, cost, left: round2(dollars - cost) };
}

/** Shares sized so that hitting the stop loses about `riskPct`% of the account (trade guide maths). */
export function riskShares(account: number, riskPct: number, entry: number, stop: number): { shares: number; riskDollars: number; perShare: number } {
  const perShare = Math.abs(entry - stop);
  const riskDollars = account > 0 && riskPct > 0 ? (account * riskPct) / 100 : 0;
  const shares = perShare > 0 && riskDollars > 0 ? Math.floor(riskDollars / perShare + 1e-9) : 0;
  return { shares, riskDollars: round2(riskDollars), perShare: round2(perShare) };
}

/** The most whole shares a buy can be: under both the max order value (Settings) and the buying power. */
export function maxBuyShares(price: number, maxOrder: number, buyingPower: number | null | undefined): number {
  if (!(price > 0)) return 0;
  const cap = Math.min(maxOrder > 0 ? maxOrder : Infinity, buyingPower != null && buyingPower >= 0 ? buyingPower : Infinity);
  return Number.isFinite(cap) ? Math.floor(cap / price + 1e-9) : 0;
}

/** A fraction of what can be sold, in whole shares (at least 1 when anything is held). */
export function sellFraction(available: number, fraction: number): number {
  if (!(available > 0)) return 0;
  return Math.min(Math.floor(available), Math.max(1, Math.floor(available * fraction + 1e-9)));
}

export type OrderKind = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';

/** The price an order is valued at: its limit, else its stop, else the last price (as the helper does). */
export function basisPrice(kind: OrderKind, last: number | null, limit: number | null, stop: number | null): number | null {
  if ((kind === 'LIMIT' || kind === 'STOP_LIMIT') && limit && limit > 0) return limit;
  if (kind === 'STOP' && stop && stop > 0) return stop;
  return last && last > 0 ? last : null;
}

/** Estimated cost (buy) or proceeds (sell) and buying power after the order. */
export function estimate(side: 'BUY' | 'SELL', qty: number, basis: number | null, buyingPower: number | null | undefined) {
  const value = basis != null && qty > 0 ? round2(qty * basis) : null;
  const after = value == null || buyingPower == null ? null : round2(side === 'BUY' ? buyingPower - value : buyingPower + value);
  return { value, after };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ----- Account size and risk % (shared with the Setups trade guide; saved per browser) -----

const SIZE_KEY = 'tp-guide-size';

export function readSize(): { account: number; risk: number } {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) || '');
    if (v && v.account > 0 && v.risk > 0) return v;
  } catch {
    /* private window or nothing saved yet */
  }
  return { account: 10000, risk: 0.5 };
}

export function saveSize(v: { account: number; risk: number }) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(v));
  } catch {
    /* not essential */
  }
}
