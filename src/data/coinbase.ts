/**
 * Coinbase Exchange public market data: free, real-time, no account needed.
 * REST docs: https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
 * WebSocket docs: https://docs.cdp.coinbase.com/exchange/docs/websocket-channels
 */
import { TIMEFRAME_SECONDS, applyTrade, cleanBars, regroupBars, type Bar, type Timeframe } from '../types';
import { fetchJson, reconnectingSocket, type DataProvider } from './provider';
import type { Quote } from './quotes';

const REST = 'https://api.exchange.coinbase.com';
const WS = 'wss://ws-feed.exchange.coinbase.com';
/** Coinbase returns at most 300 candles per request; we fetch several pages for more history. */
const PAGE = 300;
/** Candle sizes Coinbase provides directly, in seconds. Other timeframes are built from these. */
const NATIVE = [86400, 21600, 3600, 900, 300, 60];
const TARGET_BARS = 600;
const MAX_PAGES = 10;
const TRADE_PAGES = 3;

/** Coinbase candle format: [time, low, high, open, close, volume], newest first. */
type Candle = [number, number, number, number, number, number];

async function inBatches<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  return out;
}

async function loadCandles(symbol: string, timeframe: Timeframe, signal: AbortSignal): Promise<Bar[]> {
  const target = TIMEFRAME_SECONDS[timeframe];
  const granularity = NATIVE.find((g) => target % g === 0 && g <= target) ?? 60;
  const pages = Math.min(MAX_PAGES, Math.max(3, Math.ceil((TARGET_BARS * (target / granularity)) / PAGE)));
  const now = Math.floor(Date.now() / 1000);
  const results = await inBatches(
    Array.from({ length: pages }, (_, i) => () => {
      const end = now - i * PAGE * granularity;
      const qs = new URLSearchParams({
        granularity: String(granularity),
        start: new Date((end - PAGE * granularity) * 1000).toISOString(),
        end: new Date(end * 1000).toISOString(),
      });
      return fetchJson<Candle[] | { message: string }>(`${REST}/products/${encodeURIComponent(symbol)}/candles?${qs}`, { signal });
    }),
    5,
  );
  const byTime = new Map<number, Bar>();
  for (const page of results) {
    if (!Array.isArray(page)) throw new Error(page.message || 'Unexpected response from Coinbase');
    for (const [time, low, high, open, close, volume] of page) byTime.set(time, { time, open, high, low, close, volume });
  }
  const bars = cleanBars([...byTime.values()]);
  return granularity === target ? bars : regroupBars(bars, timeframe);
}

/** Second-based charts have no candle history, so build them from Coinbase's most recent trades. */
async function loadFromTrades(symbol: string, timeframe: Timeframe, signal: AbortSignal): Promise<Bar[]> {
  type Trade = { trade_id: number; price: string; size: string; time: string };
  const trades: Trade[] = [];
  let after: number | undefined;
  for (let i = 0; i < TRADE_PAGES; i++) {
    const qs = new URLSearchParams({ limit: '1000', ...(after ? { after: String(after) } : {}) });
    const page = await fetchJson<Trade[]>(`${REST}/products/${encodeURIComponent(symbol)}/trades?${qs}`, { signal });
    if (!page.length) break;
    trades.push(...page);
    after = Math.min(...page.map((t) => t.trade_id));
  }
  const bars: Bar[] = [];
  for (const t of trades.sort((a, b) => a.trade_id - b.trade_id)) {
    applyTrade(bars, timeframe, Number(t.price), Number(t.size), Date.parse(t.time) / 1000);
  }
  return bars;
}

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

  loadHistory(symbol, timeframe, signal) {
    return TIMEFRAME_SECONDS[timeframe] < 60 ? loadFromTrades(symbol, timeframe, signal) : loadCandles(symbol, timeframe, signal);
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

/** Live prices for many crypto symbols at once (watchlist), over one shared connection. */
class CoinbaseQuotes {
  private readonly listeners = new Map<string, Set<(q: Quote) => void>>();
  private readonly latest = new Map<string, Quote>();
  private ws: WebSocket | null = null;
  private stop: (() => void) | null = null;

  listen(symbol: string, onQuote: (q: Quote) => void): () => void {
    let set = this.listeners.get(symbol);
    if (!set) {
      set = new Set();
      this.listeners.set(symbol, set);
      this.send({ type: 'subscribe', product_ids: [symbol], channels: ['ticker'] });
      this.loadInitial(symbol);
    }
    set.add(onQuote);
    const latest = this.latest.get(symbol);
    if (latest) onQuote(latest);
    this.ensureConnected();
    return () => {
      set.delete(onQuote);
      if (set.size) return;
      this.listeners.delete(symbol);
      this.latest.delete(symbol);
      this.send({ type: 'unsubscribe', product_ids: [symbol], channels: ['ticker'] });
      if (!this.listeners.size) {
        this.stop?.();
        this.stop = null;
        this.ws = null;
      }
    };
  }

  private emit(quote: Quote) {
    this.latest.set(quote.symbol, quote);
    for (const fn of this.listeners.get(quote.symbol) ?? []) fn(quote);
  }

  private async loadInitial(symbol: string) {
    try {
      const stats = await fetchJson<{ open: string; last: string }>(`${REST}/products/${encodeURIComponent(symbol)}/stats`, {});
      if (this.listeners.has(symbol) && !this.latest.has(symbol)) {
        this.emit({ symbol, last: Number(stats.last), prevClose: Number(stats.open) });
      }
    } catch {
      // The live ticker will fill it in.
    }
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private ensureConnected() {
    if (this.stop) return;
    this.stop = reconnectingSocket(
      WS,
      { onTrade: () => {}, onStatus: () => {} },
      (ws) => {
        this.ws = ws;
        ws.send(JSON.stringify({ type: 'subscribe', product_ids: [...this.listeners.keys()], channels: ['ticker'] }));
      },
      (_ws, data) => {
        const msg = data as { type: string; product_id?: string; price?: string; open_24h?: string };
        if (msg.type === 'ticker' && msg.product_id && msg.price) {
          this.emit({ symbol: msg.product_id, last: Number(msg.price), prevClose: msg.open_24h ? Number(msg.open_24h) : null });
        }
      },
    );
  }
}

export const coinbaseQuotes = new CoinbaseQuotes();
