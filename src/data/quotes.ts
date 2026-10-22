/** Live last-price quotes for the watchlist and the home page index cards. */
import { coinbaseQuotes } from './coinbase';
import type { ProviderId } from './provider';
import { helper } from './schwab';

export interface Quote {
  symbol: string;
  last: number | null;
  /** Previous close for stocks, price 24 hours ago for crypto. */
  prevClose: number | null;
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
  return helper.listen(ref.symbol, { onQuote });
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
