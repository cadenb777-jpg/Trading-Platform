/** Live last-price quotes for the watchlist and the home page index cards. */
import { coinbaseQuotes } from './coinbase';
import type { ProviderId } from './provider';
import { marketStatus } from '../ui/marketClock';
import type { Bar } from '../types';
import { helper, schwab } from './schwab';

export interface Quote {
  symbol: string;
  last: number | null;
  /** Previous close for stocks, price 24 hours ago for crypto. */
  prevClose: number | null;
  /** True when the change shown is the latest session's move (the market is closed and the quote said "unchanged"). */
  lastSession?: boolean;
}

/** A symbol together with the market it trades on. */
export interface MarketRef {
  provider: ProviderId;
  symbol: string;
}

export const refKey = (ref: MarketRef) => `${ref.provider}:${ref.symbol}`;

export function quoteChange(q: Quote | undefined): { change: number; percent: number } | null {
  if (!q || q.last == null || !q.prevClose) return null;
  const change = q.last - q.prevClose;
  return { change, percent: (change / q.prevClose) * 100 };
}

/** Calls `onQuote` with the latest price whenever it changes. Returns a function that stops it. */
export function subscribeQuote(ref: MarketRef, onQuote: (q: Quote) => void): () => void {
  if (ref.provider === 'coinbase') return coinbaseQuotes.listen(ref.symbol, onQuote);
  let latest: Quote | undefined;
  const deliver = (q: Quote) => {
    latest = q;
    onQuote(withSessionChange(q, () => latest && onQuote(withSessionChange(latest, null))));
  };
  return helper.listen(ref.symbol, { onQuote: deliver });
}

// ----- Latest session's change between sessions -----
// Outside regular hours Schwab often reports "unchanged" (it moves the previous close up to the latest close, and
// older helpers send the stream's close, which does the same after 4 PM). Like Google Finance, show the latest
// session's move instead: measured from the close of the trading day before it, taken from the daily bars.

const DAILY_MAX_AGE = 30 * 60 * 1000;
const dailyCache = new Map<string, { bars: Bar[]; at: number; loading?: Promise<void> }>();

function loadDaily(symbol: string, then: () => void) {
  const entry = dailyCache.get(symbol) ?? { bars: [], at: 0 };
  dailyCache.set(symbol, entry);
  entry.loading ??= schwab
    .loadHistory(symbol, '1D', new AbortController().signal)
    .then((bars) => {
      entry.bars = bars;
      entry.at = Date.now();
    })
    .catch(() => {
      entry.at = Date.now() - DAILY_MAX_AGE + 60 * 1000; // try again in a minute
    })
    .finally(() => (entry.loading = undefined));
  entry.loading.then(then);
}

/** The previous session's close for a zero-change quote, from daily bars (null when it doesn't apply). */
export function sessionPrevClose(q: Quote, daily: Bar[]): number | null {
  if (q.last == null || daily.length < 2) return null;
  const zero = !q.prevClose || Math.abs(q.last - q.prevClose) <= q.last * 1e-6;
  if (!zero) return null;
  const lastBar = daily[daily.length - 1];
  // If the newest daily bar already closed at the current price, it is the latest session: compare with the day before.
  const prev = Math.abs(lastBar.close - q.last) <= q.last * 1e-4 ? daily[daily.length - 2].close : lastBar.close;
  // Sanity check: anything beyond 50% in a session means the bars don't match the quote.
  if (!prev || Math.abs(prev - q.last) <= q.last * 1e-6 || Math.abs(prev / q.last - 1) > 0.5) return null;
  return prev;
}

function withSessionChange(q: Quote, reload: (() => void) | null): Quote {
  if (q.last == null || (q.prevClose && Math.abs(q.last - q.prevClose) > q.last * 1e-6)) return q;
  if (marketStatus(new Date()).phase === 'open') return q;
  const cached = dailyCache.get(q.symbol);
  if (reload && (!cached || Date.now() - cached.at > DAILY_MAX_AGE)) loadDaily(q.symbol, reload);
  const prev = cached ? sessionPrevClose(q, cached.bars) : null;
  return prev ? { ...q, prevClose: prev, lastSession: true } : q;
}

const CRYPTO_BASES = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'LTC', 'DOT', 'SHIB', 'BCH', 'UNI', 'XLM', 'ATOM', 'PEPE', 'SUI']);

/** Works out which market a typed symbol belongs to: "BTC" or "ETH-USD" is crypto, "AAPL" is a stock. */
export function guessMarket(input: string): MarketRef | null {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  if (s.includes('-') || s.includes('/') || CRYPTO_BASES.has(s)) {
    const symbol = s.replace('/', '-');
    return { provider: 'coinbase', symbol: symbol.includes('-') ? symbol : `${symbol}-USD` };
  }
  return { provider: 'schwab', symbol: s };
}
