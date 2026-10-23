/**
 * Live, all-exchange US stock data and market news from the helper program running on this
 * computer (see helper/README.md). The browser never sees the Schwab keys; it only talks to
 * the helper over ws://127.0.0.1:8765.
 */
import { cleanBars, regroupBars, type Bar, type Timeframe } from '../types';
import type { ConnectionStatus, DataProvider, Trade } from './provider';
import type { Quote } from './quotes';

const HELPER_URL = 'ws://127.0.0.1:8765';
const CONNECT_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 30000;

/** The newest helper version. Must match HELPER_VERSION in helper/schwab_helper.py. */
export const LATEST_HELPER_VERSION = 15;
/** Charts, quotes, news and the calendar work with any helper from this version on. */
const CORE_HELPER_VERSION = 2;
/** The analysis engine (Flow, Research, Macro, Portfolios, Clients, AI) needs at least this version. */
const ENGINE_HELPER_VERSION = 6;
const CORE_REQUESTS = new Set(['history', 'news', 'calendar', 'summary']);
/** The Investments page (markets, bonds, private funds) needs at least this version. */
const INVEST_HELPER_VERSION = 8;
const INVEST_REQUEST = /^(invest|bonds|alts)\./;
/** The market scanner and the AI page summaries need at least this version. */
const SCANNER_HELPER_VERSION = 10;
const NEW_INSIGHTS = new Set(['scanner', 'market', 'macro', 'bonds', 'board', 'fund', 'backtest']);

export const HELPER_OUTDATED =
  'Your Schwab helper is an old copy. Download the project ZIP from GitHub again, replace your helper folder, and restart the helper.';
export const HELPER_UPDATE_FOR_FEATURE =
  'This feature needs the updated Schwab helper. Download the project ZIP from GitHub again, replace your helper folder, and restart the helper.';

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
  /** Other outlets running the same story, and links to their versions. */
  alsoReportedBy: string[];
  otherLinks: string[];
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
  /** Where the actual came from when the feed lacked it (e.g. 'FRED') */
  actualSource?: string;
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
  | { type: 'status'; status: ConnectionStatus; message: string; version?: number; problems?: string[]; log?: string }
  | { type: 'history'; id: number; bars: Bar[] }
  | { type: 'news'; id: number; items: NewsItem[]; failed: string[] }
  | { type: 'calendar'; id: number; events: CalendarEvent[]; failed: string[] }
  | { type: 'summary'; id: number; points: string[]; description: string; url: string; words: number }
  | { type: 'engine'; id: number; data: unknown }
  | { type: 'engine_event'; id: number; event: EngineEvent }
  | { type: 'error'; id: number | null; message: string }
  | { type: 'trade'; symbol: string; price: number; size: number; time: number }
  | { type: 'quote'; symbol: string; last: number | null; prevClose: number | null };

/** Progress sent by a long-running engine request before its final reply (e.g. AI text as it is written). */
export type EngineEvent = { type: 'text'; text: string } | { type: 'status'; text: string };

/** One shared connection to the helper, reused by charts, the watchlist and the home page. */
class HelperConnection {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (msg: HelperMessage) => void; reject: (err: Error) => void; event?: (e: EngineEvent) => void }>();
  private readonly listeners = new Map<string, Set<HelperListener>>();
  private readonly availability = new Set<(up: boolean) => void>();
  private helperStatus: { status: ConnectionStatus; message: string } = { status: 'connecting', message: 'Connecting' };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** The running helper's version (null until it says hello). */
  version: number | null = null;
  /** True when the helper is older than the newest version (a newer copy is available). */
  outdated = false;
  /** True when even charts and quotes can't work with this helper. */
  tooOld = false;
  /** Helper features that couldn't start, and where the helper's log file is. */
  problems: string[] = [];
  logPath = '';
  /** Finishes connecting once the helper's first status message (with its version) arrives. */
  private onReady: (() => void) | null = null;

  /** The helper's latest status (connecting / live / error) and message. */
  get status() {
    return this.helperStatus;
  }

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

  /**
   * Sends a request and waits for the helper's reply with the same id. `onEvent` receives progress
   * messages; each one restarts the timeout, so long answers that keep streaming never time out.
   */
  async request(msg: Record<string, unknown>, signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS, onEvent?: (e: EngineEvent) => void): Promise<HelperMessage> {
    await this.connect();
    const type = String(msg.type);
    if (this.tooOld) throw new Error(HELPER_OUTDATED);
    // Older helpers simply ignore requests they don't know, so stop here with a clear message instead of waiting.
    if (!CORE_REQUESTS.has(type) && (this.version ?? 0) < ENGINE_HELPER_VERSION) throw new Error(HELPER_UPDATE_FOR_FEATURE);
    if ((INVEST_REQUEST.test(type) || msg.collection === 'alt_holdings') && (this.version ?? 0) < INVEST_HELPER_VERSION) throw new Error(HELPER_UPDATE_FOR_FEATURE);
    if ((type.startsWith('scanner.') || (type === 'ai.insight' && NEW_INSIGHTS.has(String(msg.topic)))) && (this.version ?? 0) < SCANNER_HELPER_VERSION) throw new Error(HELPER_UPDATE_FOR_FEATURE);
    const id = this.nextId++;
    return new Promise<HelperMessage>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error('The Schwab helper took too long to answer. Try again.')), timeoutMs);
      };
      const finish = (err: Error | null, reply?: HelperMessage) => {
        clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(reply!);
      };
      const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', onAbort);
      arm();
      this.pending.set(id, {
        resolve: (reply) => finish(null, reply),
        reject: (err) => finish(err),
        event: (e) => {
          arm();
          onEvent?.(e);
        },
      });
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
        const version = msg.version ?? 1;
        const changed = version !== this.version;
        this.version = version;
        this.problems = msg.problems ?? [];
        this.logPath = msg.log ?? '';
        this.outdated = version < LATEST_HELPER_VERSION;
        this.tooOld = version < CORE_HELPER_VERSION;
        if (changed && !this.onReady) this.notify(true);
        this.onReady?.();
        this.helperStatus = { status: msg.status, message: msg.message };
        for (const l of this.allListeners()) l.onStatus?.(msg.status, msg.message);
        break;
      }
      case 'history':
      case 'news':
      case 'calendar':
      case 'summary':
      case 'engine':
        this.pending.get(msg.id)?.resolve(msg);
        break;
      case 'engine_event':
        this.pending.get(msg.id)?.event?.(msg.event);
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

export interface ArticleSummary {
  /** The article's most important sentences, in order. */
  points: string[];
  /** The publisher's own one-line description. */
  description: string;
  url: string;
  words: number;
}

/** Asks the helper to open an article and pull out its key points. */
export async function loadSummary(item: Pick<NewsItem, 'link' | 'otherLinks' | 'title'>): Promise<ArticleSummary> {
  const reply = await helper.request({ type: 'summary', title: item.title, links: [item.link, ...(item.otherLinks ?? [])] });
  if (reply.type !== 'summary') throw new Error('Unexpected reply from the helper');
  return reply;
}

/** Headlines: the general market feeds, headlines for some tickers, or a search. */
export async function loadNews(symbols: string[] = [], query = ''): Promise<{ items: NewsItem[]; failed: string[] }> {
  const reply = await helper.request({ type: 'news', symbols, query });
  if (reply.type !== 'news') throw new Error('Unexpected reply from the helper');
  return { items: reply.items, failed: reply.failed };
}

/**
 * Asks the helper's analysis engine for something (fundamentals, options flow, portfolio maths...).
 * `type` is the engine handler name, e.g. 'sec.financials'.
 */
export async function engineRequest<T>(type: string, params: Record<string, unknown> = {}, timeoutMs = 60000, onEvent?: (e: EngineEvent) => void, signal?: AbortSignal): Promise<T> {
  // Every message carries its request number as `id`, so parameters must use other names.
  if ('id' in params || 'type' in params) throw new Error(`engineRequest("${type}"): "id" and "type" are reserved parameter names`);
  const reply = await helper.request({ ...params, type }, signal, timeoutMs, onEvent);
  if (reply.type !== 'engine') throw new Error('Unexpected reply from the helper');
  return reply.data as T;
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
    const bars = cleanBars(reply.bars);
    if (!bars.length) throw new Error(`Schwab sent no usable price data for ${symbol}.`);
    return plan.resolution === timeframe ? bars : regroupBars(bars, timeframe);
  },

  subscribe(symbol, handlers) {
    const stop = helper.listen(symbol, { onTrade: handlers.onTrade, onStatus: handlers.onStatus });
    return () => {
      stop();
      handlers.onStatus('closed');
    };
  },
};
