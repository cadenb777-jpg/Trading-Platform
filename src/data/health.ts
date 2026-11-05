/**
 * Data health: when each feed last answered (in this browser session), so panels can say "as of 10:42 · Schwab"
 * and the Data button can list every feed. Pure bookkeeping; schwab.ts records successes and failures.
 */

import { replyProvenance } from './provenance';

export type FeedId = 'quotes' | 'stream' | 'alpaca' | 'sec' | 'fred' | 'cftc' | 'webull';

/** Each feed, its stamp label and how often it is normally refreshed (stale after twice that). 0 = on request only. */
export const FEEDS: Record<FeedId, { label: string; source: string; refreshMs: number; about: string }> = {
  quotes: { label: 'Schwab quotes', source: 'Schwab', refreshMs: 30_000, about: 'Prices and daily history; the helper refreshes quotes every 30 s.' },
  stream: { label: 'Schwab stream', source: 'Schwab live', refreshMs: 60_000, about: 'Live trades for open charts (quiet outside market hours).' },
  alpaca: { label: 'Alpaca', source: 'Alpaca', refreshMs: 0, about: 'Older intraday history, only when keys are saved in Settings.' },
  sec: { label: 'SEC EDGAR', source: 'SEC', refreshMs: 15 * 60_000, about: 'Company filings, fund NAVs and sectors.' },
  fred: { label: 'FRED', source: 'FRED', refreshMs: 10 * 60_000, about: 'Economic series and Treasury yields (daily or slower).' },
  cftc: { label: 'CFTC', source: 'CFTC', refreshMs: 30 * 60_000, about: 'Commitments of Traders, published weekly (Friday).' },
  webull: { label: 'Webull', source: 'Webull', refreshMs: 30_000, about: 'Your Webull balances, positions and orders.' },
};

/** Which feed an engine request type reads (null for requests that aren't a market data feed). */
export function feedOf(type: string): FeedId | null {
  if (/^webull\./.test(type)) return 'webull';
  if (/^alpaca\./.test(type)) return 'alpaca';
  if (/^flow\.cot/.test(type)) return 'cftc';
  if (/^(macro\.|bonds\.market)/.test(type)) return 'fred';
  if (/^(research\.company|alts\.|sec\.)/.test(type)) return 'sec';
  if (/^(history|invest\.(board|history|movers|search)|futures\.board|bonds\.cusip|risk\.account)$/.test(type)) return 'quotes';
  return null;
}

/** An error about one request's own input (an unknown or invalid symbol, no data for it), not the feed itself. */
export const requestProblem = (message: string) =>
  /\b(invalid|unknown|no such|not found|no usable|no (price )?data|no symbols?|no quote|delisted)\b|symbol/i.test(message ?? '');

export interface FeedState {
  lastOk: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

const states = new Map<FeedId, FeedState>();
/** When each reply object arrived; a cached reply is the same object, so it keeps its own fetch time. */
let replies = new WeakMap<object, number>();
const listeners = new Set<() => void>();

const blank = (): FeedState => ({ lastOk: null, lastError: null, lastErrorAt: null });

export function feedState(id: FeedId): FeedState {
  return states.get(id) ?? blank();
}

/** Calls `fn` when a feed changes between working / failing (not on every quote). Returns an unsubscribe. */
export function onHealthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recordOk(id: FeedId, at = Date.now()) {
  const s = states.get(id) ?? blank();
  const changed = s.lastOk == null || s.lastError != null;
  s.lastOk = at;
  s.lastError = null;
  states.set(id, s);
  if (changed) for (const fn of listeners) fn();
}

export function recordError(id: FeedId, message: string, at = Date.now()) {
  const s = states.get(id) ?? blank();
  s.lastError = message;
  s.lastErrorAt = at;
  states.set(id, s);
  for (const fn of listeners) fn();
}

/** A successful network reply (a cache hit doesn't count): marks its feed working and remembers the reply's time. */
export function markFetched(type: string, data?: unknown, at = Date.now()) {
  if (data && typeof data === 'object') replies.set(data, at);
  const feed = feedOf(type);
  if (feed) recordOk(feed, at);
}

/** The helper's data-hub source name for each feed (reply provenance is keyed by these). */
const FEED_SOURCE: Partial<Record<FeedId, string>> = { quotes: 'schwab', alpaca: 'alpaca', sec: 'sec', fred: 'fred', cftc: 'cftc', webull: 'webull' };

/**
 * When this reply's data was fetched (ms), or null. With reply provenance (v44) it is the helper's own fetch time of
 * the cached inputs (the feed's source when given and present, else the oldest input), so a saved copy is stamped
 * with its real age; older helpers: the time the reply arrived.
 */
export const replyTime = (data: unknown, feed?: FeedId | null): number | null => {
  if (!data || typeof data !== 'object') return null;
  const prov = replyProvenance(data);
  if (prov) {
    const own = feed ? prov.sources?.[FEED_SOURCE[feed] ?? ''] : undefined;
    return (own?.fetchedAt ?? prov.fetchedAt) * 1000;
  }
  return replies.get(data) ?? null;
};

/** Stale = older than twice the feed's refresh interval (feeds refreshed only on request never go stale). */
export function isStale(at: number | null, refreshMs: number, now = Date.now()): boolean {
  return at != null && refreshMs > 0 && now - at > 2 * refreshMs;
}

export type Health = 'ok' | 'stale' | 'error' | 'idle';

export function health(id: FeedId, now = Date.now()): Health {
  const s = feedState(id);
  if (s.lastError && (s.lastOk == null || (s.lastErrorAt ?? 0) > s.lastOk)) return 'error';
  if (s.lastOk == null) return 'idle';
  return isStale(s.lastOk, FEEDS[id].refreshMs, now) ? 'stale' : 'ok';
}

/** "10:42" today, "Oct 24 10:42" on another day. */
export function stampTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

/** Test hook. */
export function resetHealth() {
  states.clear();
  replies = new WeakMap();
}
