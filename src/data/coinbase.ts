/**
 * Coinbase Exchange public market data: free, real-time, no account needed.
 * REST docs: https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
 * WebSocket docs: https://docs.cdp.coinbase.com/exchange/docs/websocket-channels
 */
import { TIMEFRAME_SECONDS, type Bar, type Timeframe } from '../types';
import { fetchJson, reconnectingSocket, type DataProvider } from './provider';

const REST = 'https://api.exchange.coinbase.com';
const WS = 'wss://ws-feed.exchange.coinbase.com';
/** Coinbase returns at most 300 candles per request; we fetch a few pages for more history. */
const PAGE = 300;
const PAGES = 3;

/** Coinbase candle format: [time, low, high, open, close, volume], newest first. */
type Candle = [number, number, number, number, number, number];

export const coinbase: DataProvider = {
  id: 'coinbase',
  name: 'Crypto (Coinbase)',
  description: 'Free real-time crypto prices. No account needed.',
  defaultSymbol: 'BTC-USD',
  symbolPlaceholder: 'BTC-USD',

  normalizeSymbol(input) {
    const s = input.trim().toUpperCase().replace(/[/_ ]/g, '-');
    if (s.includes('-')) return s;
    for (const quote of ['USDT', 'USDC', 'USD', 'EUR', 'GBP', 'BTC']) {
      if (s.length > quote.length && s.endsWith(quote)) return `${s.slice(0, -quote.length)}-${quote}`;
    }
    return `${s}-USD`;
  },

  async loadHistory(symbol, timeframe: Timeframe, signal) {
    const granularity = TIMEFRAME_SECONDS[timeframe];
    const now = Math.floor(Date.now() / 1000);
    const pages = await Promise.all(
      Array.from({ length: PAGES }, (_, i) => {
        const end = now - i * PAGE * granularity;
        const start = end - PAGE * granularity;
        const qs = new URLSearchParams({
          granularity: String(granularity),
          start: new Date(start * 1000).toISOString(),
          end: new Date(end * 1000).toISOString(),
        });
        return fetchJson<Candle[] | { message: string }>(`${REST}/products/${encodeURIComponent(symbol)}/candles?${qs}`, { signal });
      }),
    );
    const byTime = new Map<number, Bar>();
    for (const page of pages) {
      if (!Array.isArray(page)) throw new Error(page.message || 'Unexpected response from Coinbase');
      for (const [time, low, high, open, close, volume] of page) byTime.set(time, { time, open, high, low, close, volume });
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  },

  subscribe(symbol, handlers) {
    return reconnectingSocket(
      WS,
      handlers,
      (ws) => ws.send(JSON.stringify({ type: 'subscribe', product_ids: [symbol], channels: ['matches'] })),
      (_ws, data) => {
        const msg = data as { type: string; price?: string; size?: string; time?: string; message?: string; reason?: string };
        if (msg.type === 'subscriptions') handlers.onStatus('live');
        else if (msg.type === 'error') handlers.onStatus('error', msg.reason || msg.message);
        else if ((msg.type === 'match' || msg.type === 'last_match') && msg.price && msg.time) {
          handlers.onTrade({ price: Number(msg.price), size: Number(msg.size ?? 0), time: Date.parse(msg.time) / 1000 });
        }
      },
    );
  },
};
