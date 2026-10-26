/** The Account page's maths: the owner's own portfolios combined into one list (same symbol merged across accounts). */
import { isCashOrAlt, isMine, type AssetClass, type Holding, type HoldingKind, type Portfolio } from './types';

/** One account's share of a combined holding. */
export interface AccountPart {
  account: string;
  shares: number;
  /** Dollar amount (cash, alternatives, dollars-mode holdings). */
  amount: number;
  cost: number | null;
}

export interface CombinedHolding {
  symbol: string;
  name: string;
  kind: HoldingKind;
  assetClass: AssetClass;
  /** Shares across accounts (securities in shares mode). */
  shares: number;
  /** Dollars across accounts (cash, alternatives and dollars-mode holdings). */
  amount: number;
  /** Total cost basis, or null when no account gave one. */
  cost: number | null;
  parts: AccountPart[];
}

/** The owner's portfolios that hold real amounts (percent-only portfolios have no money in them). */
export const myPortfolios = <T extends Portfolio>(all: T[]): T[] => all.filter((p) => isMine(p) && (p.mode ?? 'weight') !== 'weight');

const keyOf = (x: Holding) => (x.kind === 'cash' ? 'CASH' : x.symbol.trim().toUpperCase());

/** Merges the holdings of several portfolios: the same symbol (and all cash) becomes one row, keeping each account's part. */
export function combineHoldings(portfolios: Portfolio[]): CombinedHolding[] {
  const out = new Map<string, CombinedHolding>();
  for (const p of portfolios) {
    const mode = p.mode ?? 'weight';
    if (mode === 'weight') continue;
    for (const x of p.holdings) {
      const key = keyOf(x);
      if (!key) continue;
      const byShares = mode === 'shares' && !isCashOrAlt(x);
      const shares = byShares ? Math.max(0, x.shares ?? 0) : 0;
      const amount = byShares ? 0 : Math.max(0, x.amount ?? 0);
      if (!shares && !amount) continue;
      const cost = x.cost != null && Number.isFinite(x.cost) ? x.cost : null;
      const row =
        out.get(key) ??
        out
          .set(key, { symbol: key, name: x.kind === 'cash' ? 'Cash / money market' : (x.name ?? ''), kind: x.kind ?? 'security', assetClass: x.assetClass, shares: 0, amount: 0, cost: null, parts: [] })
          .get(key)!;
      row.shares += shares;
      row.amount += amount;
      if (cost != null) row.cost = (row.cost ?? 0) + cost;
      if (!row.name && x.name) row.name = x.name;
      const part = row.parts.find((a) => a.account === p.name);
      if (part) {
        part.shares += shares;
        part.amount += amount;
        if (cost != null) part.cost = (part.cost ?? 0) + cost;
      } else row.parts.push({ account: p.name, shares, amount, cost });
    }
  }
  return [...out.values()];
}

/** What the helper's dividends.portfolio request needs: share holdings only (cash and dollar amounts have no shares). */
export const dividendPayload = (rows: CombinedHolding[]) =>
  rows.filter((r) => r.kind === 'security' && r.shares > 0).map((r) => ({ symbol: r.symbol, shares: r.shares, costBasis: r.cost ?? undefined }));

/** Market value of a combined holding (null when its shares have no price yet). */
export function combinedValue(r: CombinedHolding, price: number | null | undefined): number | null {
  if (!r.shares) return r.amount;
  return price != null ? r.shares * price + r.amount : null;
}

/** Today's dollar change from a fractional change (0.01 = +1%) on the current value. */
export const todayChange = (value: number | null, change: number | null | undefined) => (value != null && change != null && change > -1 ? value - value / (1 + change) : null);

/** Value per group (e.g. asset class), largest first, with each group's share of the total. */
export function allocation<T>(rows: T[], group: (r: T) => string, value: (r: T) => number | null): { label: string; value: number; weight: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const v = value(r);
    if (v != null && v > 0) sums.set(group(r), (sums.get(group(r)) ?? 0) + v);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()].map(([label, v]) => ({ label, value: v, weight: total ? v / total : 0 })).sort((a, b) => b.value - a.value);
}

/** The switcher's "All accounts (combined)" choice. */
export const ALL_ACCOUNTS = 'all';

/**
 * The accounts a view covers: every account for "all" (or a choice that no longer exists, e.g. a removed portfolio),
 * otherwise only the chosen one. `choice` comes back cleaned, ready to remember.
 */
export function pickAccounts<T extends { id: string }>(mine: T[], choice: string | null | undefined): { choice: string; chosen: T[] } {
  const one = choice && choice !== ALL_ACCOUNTS ? mine.find((p) => p.id === choice) : undefined;
  return one ? { choice: one.id, chosen: [one] } : { choice: ALL_ACCOUNTS, chosen: mine };
}

/** How many tickers the helper's news request reads (MAX_TICKER_FEEDS in schwab_helper.py). */
export const NEWS_TICKERS = 12;

/**
 * The tickers to fetch "My holdings" news for: listed securities across the owner's own portfolios (combined), the
 * biggest positions first (by cost, then shares) so the helper's 12-ticker limit keeps the ones that matter most.
 */
export function holdingNewsSymbols(portfolios: Portfolio[], max = NEWS_TICKERS): string[] {
  return combineHoldings(myPortfolios(portfolios))
    .filter((r) => r.kind === 'security' && /^[A-Z][A-Z.]{0,5}$/.test(r.symbol))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.shares - a.shares || a.symbol.localeCompare(b.symbol))
    .slice(0, max)
    .map((r) => r.symbol);
}
