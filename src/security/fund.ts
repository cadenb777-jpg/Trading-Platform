/**
 * ETFs and mutual funds in the security view (owner, 2026-11-20: "if I search an ETF or mutual fund there should be
 * information that pertains to funds"). A fund gets its own Overview instead of the company panels (it has no 10-K):
 * the fund profile and costs, its objective, top holdings, asset mix and sectors, stock or bond characteristics, and
 * returns and risk against its category. Data: helper fund.profile (engine/funds.py, Yahoo Finance's fund modules);
 * the price, NAV and returns from Schwab as for any symbol.
 */
import type { BoardRow } from '../invest/shared';
import { engineRequest } from '../data/schwab';

export const FUND_HELPER_VERSION = 93;

export interface FundProfile {
  symbol: string;
  kind: 'etf' | 'mutualfund';
  name: string | null;
  family: string | null;
  category: string | null;
  legalType: string | null;
  inception: string | null;
  netAssets: number | null;
  nav: number | null;
  yield: number | null;
  expenseRatio: number | null;
  grossExpenseRatio: number | null;
  turnover: number | null;
  frontLoad: number | null;
  deferredLoad: number | null;
  twelveB1: number | null;
  minInvestment: number | null;
  morningstarRating: number | null;
  morningstarRisk: number | null;
  beta3y: number | null;
  objective: string | null;
  holdings: { symbol: string; name: string; weight: number }[];
  holdingsShare: number | null;
  mix: { label: string; weight: number }[];
  sectors: { sector: string; weight: number }[];
  equity: Record<'priceToEarnings' | 'priceToBook' | 'priceToSales' | 'priceToCashflow' | 'medianMarketCap' | 'threeYearEarningsGrowth', number | null>;
  bonds: { duration: number | null; maturity: number | null; creditQuality: number | null };
  ratings: { rating: string; weight: number }[];
  trailing: { period: string; fund: number | null; category: number | null }[];
  trailingAsOf: string | null;
  annual: { year: string; fund: number | null; category: number | null }[];
  best: { oneYear: number | null; threeYear: number | null };
  worst: { oneYear: number | null; threeYear: number | null };
  yearsUp: number | null;
  yearsDown: number | null;
  risk: { years: string; alpha: number | null; beta: number | null; rSquared: number | null; stdDev: number | null; sharpeRatio: number | null; category: Record<string, number | null> | null }[];
  source: string;
  url: string;
  fetched: string;
}

/** Schwab marks ETFs with the sub-type ETF and mutual funds with the main type MUTUAL_FUND. */
export function isFundRow(row: Pick<BoardRow, 'assetType' | 'assetSubType'> | null | undefined): boolean {
  if (!row) return false;
  const main = (row.assetType ?? '').toUpperCase();
  const sub = (row.assetSubType ?? '').toUpperCase();
  return main === 'MUTUAL_FUND' || main === 'ETF' || sub === 'ETF' || sub === 'MUTUAL_FUND';
}

const cache = new Map<string, Promise<FundProfile>>();
export function loadFund(symbol: string): Promise<FundProfile> {
  const s = symbol.replace(/^\$/, '').toUpperCase();
  if (!cache.has(s)) {
    const p = engineRequest<FundProfile>('fund.profile', { symbol: s }, 60_000);
    cache.set(s, p);
    p.catch(() => cache.delete(s));
  }
  return cache.get(s)!;
}

// ---------- words from numbers (pure, tested) ----------

/** "$3 a year on every $10,000" from an expense ratio (a fraction). */
export function costWords(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '';
  const dollars = ratio * 10_000;
  return `$${dollars < 10 ? dollars.toFixed(dollars < 1 ? 2 : 1).replace(/\.0$/, '') : Math.round(dollars).toLocaleString('en-US')} a year on every $10,000 invested`;
}

/** How cheap or dear an expense ratio is, in rough bands for index ETFs vs actively managed funds. */
export function costBand(ratio: number | null | undefined): 'very low' | 'low' | 'average' | 'high' | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio <= 0.001) return 'very low';
  if (ratio <= 0.004) return 'low';
  if (ratio <= 0.009) return 'average';
  return 'high';
}

/** Morningstar's 1-5 risk score in words. */
export const riskWords = (n: number | null | undefined) => (n == null ? null : ['', 'Low', 'Below average', 'Average', 'Above average', 'High'][Math.round(n)] ?? null);

/** ★★★★☆ for a 1-5 rating. */
export const stars = (n: number | null | undefined) => (n == null || !(n >= 1) ? null : '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)));

/** One line on how the fund did against its category over the longest period both have. */
export function versusCategory(trailing: FundProfile['trailing']): string | null {
  const both = trailing.filter((t) => t.fund != null && t.category != null);
  const t = both[both.length - 1];
  if (!t) return null;
  const gap = (t.fund! - t.category!) * 100;
  if (Math.abs(gap) < 0.05) return `Level with its category over ${t.period.replace(' (a year)', '')}.`;
  return `${gap > 0 ? 'Ahead of' : 'Behind'} its category by ${Math.abs(gap).toFixed(1)} points a year over ${t.period.replace(' (a year)', '')}.`;
}
