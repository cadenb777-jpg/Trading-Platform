/**
 * Futures ticket maths, kept pure so it can be tested. The helper works out the same figures again at preview
 * (helper/engine/webull.py futures_risk); these only drive the live estimate on the ticket.
 */
import type { OrderKind } from './sizing';

/** One listed contract (webull.futures_contracts). */
export interface FuturesContract {
  symbol: string;
  root: string;
  name: string;
  multiplier: number;
  tick: number;
  tickValue: number;
  lastTrade: string;
  /** The earliest of last trading day, first notice day and settlement day. */
  cutoff: string;
  daysLeft: number;
  month: string;
  status: string;
  /** New positions may be opened (tradable status, more than 2 trading days left). */
  tradable: boolean;
  /** A closing order may still be sent (tradable or liquidate-only, up to the last trading day). */
  closable?: boolean;
  price?: number | null;
}

/** Dollars per one-point move of one contract times contracts: price x multiplier x qty. */
export function notional(price: number | null, multiplier: number, qty: number): number | null {
  return price != null && price > 0 && multiplier > 0 && qty > 0 ? round2(price * multiplier * qty) : null;
}

/** Dollar value of one tick for the whole order (tick size x multiplier x contracts). */
export function tickDollars(tick: number, multiplier: number, qty = 1): number | null {
  return tick > 0 && multiplier > 0 && qty > 0 ? round2(tick * multiplier * qty) : null;
}

/** Dollar loss if the protective stop is hit, or null when the stop is missing or on the wrong side. */
export function riskToStop(side: 'BUY' | 'SELL', entry: number | null, stop: number | null, multiplier: number, qty: number): number | null {
  if (entry == null || stop == null || !(entry > 0) || !(stop > 0) || !(qty > 0)) return null;
  if (side === 'BUY' ? stop >= entry : stop <= entry) return null;
  return round2(Math.abs(entry - stop) * multiplier * qty);
}

/** Ticks between entry and stop (how many ticks of room). */
export function ticksBetween(entry: number, stop: number, tick: number): number {
  return tick > 0 ? Math.round(Math.abs(entry - stop) / tick) : 0;
}

/** True when a price sits on the contract's tick (e.g. ES moves in 0.25). */
export function onTick(price: number, tick: number): boolean {
  if (!(tick > 0)) return false;
  const steps = price / tick;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** Open P/L in dollars for a position: (last - average) x qty x multiplier (qty negative for a short). */
export function positionPnl(qty: number, avg: number | null, last: number | null, multiplier: number | null): number | null {
  return avg == null || last == null || multiplier == null ? null : round2((last - avg) * qty * multiplier);
}

/** The price an order is valued at: its limit, else its stop, else the last price (as the helper does). */
export function futuresBasis(kind: OrderKind, last: number | null, limit: number | null, stop: number | null): number | null {
  if ((kind === 'LIMIT' || kind === 'STOP_LIMIT') && limit && limit > 0) return limit;
  if (kind === 'STOP' && stop && stop > 0) return stop;
  return last && last > 0 ? last : null;
}

/** The contract the picker starts on: the nearest one that can still be traded here. */
export function frontMonth(contracts: FuturesContract[]): FuturesContract | null {
  return [...contracts].sort((a, b) => a.cutoff.localeCompare(b.cutoff)).find((c) => c.tradable) ?? null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
