/**
 * SPX box-spread rates (helper rates.box): types and the plain-language reading for the Futures page's
 * "What money costs" panel. Pure and tested in boxRates.test.ts; the maths is in helper/engine/boxrates.py.
 */
import type { Envelope } from './fairValue';

export interface BoxRow {
  expiration: string;
  days: number;
  k1: number;
  k2: number;
  width: number;
  notional: number;
  buyPrice: number;
  midPrice: number;
  sellPrice: number;
  lend: number | null;
  midRate: number | null;
  borrow: number | null;
  bill: number | null;
  feeUsd: number;
  lendVsBillBp: number | null;
  midVsBillBp: number | null;
  extraPer100k: number | null;
}

export interface BoxReply {
  rows: BoxRow[];
  spot: number | null;
  chainAt: number;
  asOf: number;
  curve: { days: number; rate: number }[];
  curveDate: string | null;
  sofr: Envelope | null;
  feePerContract: number;
  note: string | null;
}

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
export const rate = (v: number | null | undefined) => (ok(v) ? `${(v * 100).toFixed(2)}%` : '—');
export const bp = (v: number | null | undefined) => (ok(v) ? `${v > 0 ? '+' : ''}${Math.round(v)} bp` : '—');
export const months = (days: number) => (days < 45 ? `${Math.round(days / 7)} weeks` : days < 600 ? `${Math.round(days / 30.4)} months` : `${(days / 365).toFixed(1)} years`);
const dollars = (v: number) => '$' + Math.abs(Math.round(v)).toLocaleString('en-US');

/** The row nearest 3 months (the length most people compare with a T-bill). */
export function benchmarkRow<T extends { days: number }>(rows: T[]): T | null {
  return rows.length ? rows.reduce((a, b) => (Math.abs(b.days - 91) < Math.abs(a.days - 91) ? b : a)) : null;
}

/** One sentence a beginner can act on: what lending through boxes pays against a T-bill, at the mid and when paying
 * every ask. */
export function reading(r: Pick<BoxRow, 'days' | 'midRate' | 'lend' | 'bill' | 'extraPer100k'>): string {
  if (!ok(r.midRate) || !ok(r.bill)) return 'Not enough quotes for a reading yet.';
  const diff = (r.midRate - r.bill) * 10000;
  const side = Math.abs(diff) < 1 ? 'the same as' : diff > 0 ? 'more than' : 'less than';
  const money = ok(r.extraPer100k) && Math.abs(diff) >= 1 ? ` (about ${dollars(r.extraPer100k)} ${diff > 0 ? 'more' : 'less'} per $100,000)` : '';
  const asks = ok(r.lend) ? ` Paying every ask instead: ${rate(r.lend)}${r.lend < r.bill ? ', below the T-bill, so only a patient limit order near the mid captures the gap' : ''}.` : '';
  return `Lending through S&P 500 box spreads for ${months(r.days)} pays ${rate(r.midRate)} at the mid, ${side} a Treasury bill of the same length (${rate(r.bill)})${money}.${asks}`;
}
