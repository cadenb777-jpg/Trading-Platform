/**
 * Live, all-exchange US stock data and market news from the helper program running on this
 * computer (see helper/README.md). The browser never sees the Schwab keys; it only talks to
 * the helper over ws://127.0.0.1:8765.
 */
import { regroupBars, type Bar, type Timeframe } from '../types';
import type { ConnectionStatus, DataProvider, Trade } from './provider';
import type { Quote } from './quotes';

const HELPER_URL = 'ws://127.0.0.1:8765';
const CONNECT_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 30000;

/** The helper version this site needs. Must match HELPER_VERSION in helper/schwab_helper.py. */
const REQUIRED_HELPER_VERSION = 3;

export const HELPER_OUTDATED =
  'Your Schwab helper is an old copy. Download the project ZIP from GitHub again, replace your helper folder, and restart the helper.';

export const HELPER_NOT_RUNNING =
  'The Schwab helper isn\'t running on this computer. Start it (double-click start-windows.bat or start-mac.command), then click Try again.';

export type NewsSection = 'economy' | 'markets' | 'companies' | 'crypto';
export type Impact = 'high' | 'medium' | 'low';

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  /** UTC unix seconds, 0 if unknown */
  published: number;
  summary: string;
  section: NewsSection;
  /** Market-moving topics found in the story, e.g. "Fed", "Earnings". */
  tags: string[];
  /** Other outlets running the same story. */
  alsoReportedBy: string[];
  /** How likely the story is to move the market (higher = more important). */
  score: number;
  impact: Impact;
}

export interface CalendarEvent {
  title: string;
  /** Currency code, e.g. USD */
  country: string;
  /** UTC unix seconds */
  time: number;
  impact: Impact | 'holiday';
  forecast: string;
  previous: string;
  actual: string;
}

/** Which Schwab bar size to request for each timeframe, and how many days back. */
const HISTORY_PLAN: Record<Timeframe, { resolution: string; days: number } | null> = {
  // Schwab has no second-level history: these charts build from live trades.
  '5s': null,
  '10s': null,
  '15s': null,
  '30s': null,
  '1m': { resolution: '1m', days: 5 },
  '2m': { resolution: '1m', days: 10 },
  '3m': { resolution: '1m', days: 15 },
  '5m': { resolution: '5m', days: 20 },
  '10m': { resolution: '10m', days: 40 },
  '15m': { resolution: '15m', days: 60 },
  '30m': { resolution: '30m', days: 120 },
  '45m': { resolution: '15m', days: 180 },
  '1h': { resolution: '30m', days: 180 },
  '2h': { resolution: '30m', days: 270 },
  '3h': { resolution: '30m', days: 270 },
  '4h': { resolution: '30m', days: 270 },
  '1D': { resolution: '1D', days: 365 * 5 },
  '1W': { resolution: '1W', days: 365 * 15 },
  '1M': { resolution: '1D', days: 365 * 20 },
};

export interface HelperListener {
  onTrade?(trade: Trade): void;
  onQuote?(quote: Quote): void;
  onStatus?(status: ConnectionStatus, message?: string): void;
}

type HelperMessage =
  | { type: 'status'; status: ConnectionStatus; message: string; version?: number }
  | { type: 'history'; id: number; bars: Bar[] }
  | { type: 'news'; id: number; items: NewsItem[]; failed: string[] }
  | { type: 'calendar'; id: number; events: CalendarEvent[]; failed: string[] }
  | { type: 'error'; id: number | null; message: string }
  | { type: 'trade'; symbol: string; price: number; size: number; time: number }
  | { type: 'quote'; symbol: string; last: number | null; prevClose: number | null };

/** One shared connection to the helper, reused by charts, the watchlist and the home page. */
class HelperConnection {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (msg: HelperMessage) => void; reject: (err: Error) => void }>();
  private readonly listeners = new Map<string, Set<HelperListener>>();
  private readonly availability = new Set<(up: boolean) => void>();
  private helperStatus: { status: ConnectionStatus; message: string } = { status: 'connecting', message: 'Connecting' };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** True when the running helper is older than this site needs. */
  outdated = false;
  /** Finishes connecting once the helper's first status message (with its version) arrives. */
  private onReady: (() => void) | null = null;

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Calls `fn(true)` when the helper connects and `fn(false)` when it can't be reached. */
  onAvailability(fn: (up: boolean) => void): () => void {
    this.availability.add(fn);
    return () => this.availability.delete(fn);
  }

  connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(HELPER_URL);
      const fail = () => {
        clearTimeout(timer);
        this.notify(false);
        reject(new Error(HELPER_NOT_RUNNING));
      };
      const timer = setTimeout(() => {
        ws.close();
        fail();
      }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        // Re-subscribe anything that was streaming before a reconnect.
        for (const symbol of this.listeners.keys()) this.send({ type: 'subscribe', symbol });
        const ready = () => {
          clearTimeout(readyTimer);
          this.onReady = null;
          this.notify(true);
          resolve(ws);
        };
        const readyTimer = setTimeout(ready, 2000);
        this.onReady = ready;
      };
      ws.onerror = fail;
      ws.onmessage = (event) => this.onMessage(JSON.parse(event.data as string) as HelperMessage);
      ws.onclose = () => this.onClose(ws);
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  /** Sends a request and waits for the helper's reply with the same id. */
  async request(msg: Record<string, unknown>, signal?: AbortSignal): Promise<HelperMessage> {
    await this.connect();
    if (this.outdated) throw new Error(HELPER_OUTDATED);
    const id = this.nextId++;
    return new Promise<HelperMessage>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('The Schwab helper took too long to answer. Try again.')), REQUEST_TIMEOUT_MS);
      const finish = (err: Error | null, reply?: HelperMessage) => {
        clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(reply!);
      };
      const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', onAbort);
      this.pending.set(id, { resolve: (reply) => finish(null, reply), reject: (err) => finish(err) });
      this.send({ ...msg, id });
    });
  }

  /** Streams trades and quotes for a symbol. Returns a function that stops listening. */
  listen(symbol: string, listener: HelperListener): () => void {
    let set = this.listeners.get(symbol);
    if (!set) {
      set = new Set();
      this.listeners.set(symbol, set);
      this.send({ type: 'subscribe', symbol });
    }
    set.add(listener);
    listener.onStatus?.(this.isConnected ? this.helperStatus.status : 'connecting', this.helperStatus.message);
    this.connect().catch(() => this.scheduleRetry());
    return () => {
      set.delete(listener);
      if (!set.size) {
        this.listeners.delete(symbol);
        this.send({ type: 'unsubscribe', symbol });
      }
    };
  }

  private notify(up: boolean) {
    for (const fn of this.availability) fn(up);
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private allListeners(): HelperListener[] {
    return [...this.listeners.values()].flatMap((s) => [...s]);
  }

  private onMessage(msg: HelperMessage) {
    switch (msg.type) {
      case 'status': {
        const outdated = (msg.version ?? 1) < REQUIRED_HELPER_VERSION;
        if (outdated !== this.outdated) {
          this.outdated = outdated;
          if (!this.onReady) this.notify(true);
        }
        this.onReady?.();
        this.helperStatus = { status: msg.status, message: msg.message };
        for (const l of this.allListeners()) l.onStatus?.(msg.status, msg.message);
        break;
      }
      case 'history':
      case 'news':
      case 'calendar':
        this.pending.get(msg.id)?.resolve(msg);
        break;
      case 'error':
        if (msg.id !== null) this.pending.get(msg.id)?.reject(new Error(msg.message));
        break;
      case 'trade':
        for (const l of this.listeners.get(msg.symbol) ?? []) l.onTrade?.(msg);
        break;
      case 'quote':
        for (const l of this.listeners.get(msg.symbol) ?? []) l.onQuote?.(msg);
        break;
    }
  }

  private onClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null;
    for (const p of this.pending.values()) p.reject(new Error('Lost connection to the Schwab helper.'));
    this.pending.clear();
    for (const l of this.allListeners()) l.onStatus?.('error', 'Schwab helper stopped. Reconnecting…');
    this.notify(false);
    this.scheduleRetry();
  }

  /** Keeps trying to reconnect while anything is listening, so it recovers when the helper starts. */
  private scheduleRetry() {
    if (!this.listeners.size || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect().catch(() => this.scheduleRetry());
    }, 3000);
  }
}

export const helper = new HelperConnection();

export async function loadNews(symbols: string[] = []): Promise<{ items: NewsItem[]; failed: string[] }> {
  const reply = await helper.request({ type: 'news', symbols });
  if (reply.type !== 'news') throw new Error('Unexpected reply from the helper');
  return { items: reply.items, failed: reply.failed };
}

export async function loadCalendar(): Promise<{ events: CalendarEvent[]; failed: string[] }> {
  const reply = await helper.request({ type: 'calendar' });
  if (reply.type !== 'calendar') throw new Error('Unexpected reply from the helper');
  return { events: reply.events, failed: reply.failed };
}

export const schwab: DataProvider = {
  id: 'schwab',
  name: 'Stocks (Schwab)',
  description: 'Live US stock prices from every exchange. Needs the Schwab helper running on this computer.',
  defaultSymbol: 'AAPL',
  symbolPlaceholder: 'AAPL',

  normalizeSymbol: (input) => input.trim().toUpperCase(),

  async loadHistory(symbol, timeframe, signal) {
    const plan = HISTORY_PLAN[timeframe];
    if (!plan) {
      await helper.connect();
      return [];
    }
    const reply = await helper.request({ type: 'history', symbol, resolution: plan.resolution, days: plan.days }, signal);
    if (reply.type !== 'history') throw new Error('Unexpected reply from the helper');
    return plan.resolution === timeframe ? reply.bars : regroupBars(reply.bars, timeframe);
  },

  subscribe(symbol, handlers) {
    const stop = helper.listen(symbol, { onTrade: handlers.onTrade, onStatus: handlers.onStatus });
    return () => {
      stop();
      handlers.onStatus('closed');
    };
  },
};
