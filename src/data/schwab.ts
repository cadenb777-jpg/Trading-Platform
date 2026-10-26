/**
 * Live, all-exchange US stock data and market news from the helper program running on this
 * computer (see helper/README.md). The browser never sees the Schwab keys; it only talks to
 * the helper over ws://127.0.0.1:8765.
 */
import { cleanBars, regroupBars, type Bar, type Timeframe } from '../types';
import type { ConnectionStatus, DataProvider, Trade } from './provider';
import { feedOf, markFetched, recordError, recordOk } from './health';
import type { Quote } from './quotes';

const HELPER_URL = 'ws://127.0.0.1:8765';
const CONNECT_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 30000;

/** The newest helper version. Must match HELPER_VERSION in helper/schwab_helper.py. */
export const LATEST_HELPER_VERSION = 32;
/** Charts, quotes, news and the calendar work with any helper from this version on. */
const CORE_HELPER_VERSION = 2;
/** The analysis engine (Flow, Research, Macro, Portfolios, Clients, AI) needs at least this version. */
const ENGINE_HELPER_VERSION = 6;
const CORE_REQUESTS = new Set(['history', 'news', 'calendar', 'summary', 'update']);
/** Installing an update downloads the new version and its Python parts, which can take a few minutes. */
const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;
/** The Investments page (markets, bonds, private funds) needs at least this version. */
const INVEST_HELPER_VERSION = 8;
const INVEST_REQUEST = /^(invest|bonds|alts)\./;
/** The market scanner and the AI page summaries need at least this version. */
const SCANNER_HELPER_VERSION = 10;
const NEW_INSIGHTS = new Set(['scanner', 'market', 'macro', 'bonds', 'board', 'fund', 'backtest']);
/** The Futures market page (board, term structure, positioning) needs at least this version. */
const FUTURES_MARKET_HELPER_VERSION = 31;

export const HELPER_OUTDATED =
  'Your Schwab helper is an old copy. Download the project ZIP from GitHub again, replace your helper folder, and restart the helper.';
export const HELPER_UPDATE_FOR_FEATURE =
  'This feature needs the updated Schwab helper. Download the project ZIP from GitHub again, replace your helper folder, and restart the helper.';

export const HELPER_NOT_RUNNING =
  'The helper isn\'t running on this computer. Start it (double-click start-windows.bat or start-mac.command), then click Try again.';

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

/** With Alpaca keys saved, the helper fills intraday history older than Schwab keeps, so these charts reach ~3 years. */
const ALPACA_HISTORY_PLAN: Partial<Record<Timeframe, { resolution: string; days: number }>> = {
  '30m': { resolution: '30m', days: 365 * 3 },
  '1h': { resolution: '30m', days: 365 * 3 },
  '2h': { resolution: '30m', days: 365 * 3 },
  '3h': { resolution: '30m', days: 365 * 3 },
  '4h': { resolution: '30m', days: 365 * 3 },
};
let alpacaSet = false;
let alpacaAsked = false;

/** Whether Alpaca keys are saved (null until the helper has been asked). */
export const alpacaKeysSaved = (): boolean | null => (alpacaAsked ? alpacaSet : null);

/** Settings calls this when it learns whether Alpaca keys are saved. */
export function setAlpacaConnected(value: boolean) {
  alpacaSet = value;
  alpacaAsked = true;
}

/** Asks the helper once (in the background) whether Alpaca keys are saved; charts use the longer plan after that. */
function checkAlpaca() {
  if (alpacaAsked) return;
  alpacaAsked = true;
  engineRequest<{ alpacaSet?: boolean }>('settings.get', {}, 10000)
    .then((s) => (alpacaSet = !!s.alpacaSet))
    .catch(() => (alpacaAsked = false));
}

export interface HelperListener {
  onTrade?(trade: Trade): void;
  onQuote?(quote: Quote): void;
  onStatus?(status: ConnectionStatus, message?: string): void;
}

/** The helper's self-update (helper/updater.py): the newest version on GitHub and what an update is doing. */
export interface HelperUpdate {
  latest: number | null;
  state: 'idle' | 'updating' | 'restarting' | 'failed';
  message: string;
}

type HelperMessage =
  | { type: 'status'; status: ConnectionStatus; message: string; version?: number; problems?: string[]; log?: string; update?: HelperUpdate }
  | { type: 'update'; id: number; version: number }
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
  private readonly updateListeners = new Set<() => void>();
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
  /** Self-update state; null for helpers too old to update themselves (they need one manual download). */
  update: HelperUpdate | null = null;
  /** Finishes connecting once the helper's first status message (with its version) arrives. */
  private onReady: (() => void) | null = null;

  /** The helper's latest status (connecting / live / error) and message. */
  get status() {
    return this.helperStatus;
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Calls `fn` when the newest version or an update's progress changes. */
  onUpdateChange(fn: () => void): () => void {
    this.updateListeners.add(fn);
    return () => this.updateListeners.delete(fn);
  }

  /** Asks the helper to download and install the newest version; it restarts by itself and the page reconnects. */
  async installUpdate(): Promise<void> {
    await this.request({ type: 'update' }, undefined, UPDATE_TIMEOUT_MS);
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
    if ((type.startsWith('futures.') || (type === 'ai.insight' && msg.topic === 'futures')) && (this.version ?? 0) < FUTURES_MARKET_HELPER_VERSION) throw new Error(HELPER_UPDATE_FOR_FEATURE);
    if ((type.startsWith('scanner.') || (type === 'ai.insight' && NEW_INSIGHTS.has(String(msg.topic)))) && (this.version ?? 0) < SCANNER_HELPER_VERSION) throw new Error(HELPER_UPDATE_FOR_FEATURE);
    const id = this.nextId++;
    return new Promise<HelperMessage>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error('The helper took too long to answer. Try again.')), timeoutMs);
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
        const update = msg.update ?? null;
        const updateChanged = JSON.stringify(update) !== JSON.stringify(this.update);
        this.update = update;
        // Self-updating helpers know the newest version on GitHub; older ones are compared with this site's number.
        this.outdated = update ? (update.latest ?? 0) > version : version < LATEST_HELPER_VERSION;
        this.tooOld = version < CORE_HELPER_VERSION;
        if (changed && !this.onReady) this.notify(true);
        this.onReady?.();
        this.helperStatus = { status: msg.status, message: msg.message };
        for (const l of this.allListeners()) l.onStatus?.(msg.status, msg.message);
        if (updateChanged) for (const fn of this.updateListeners) fn();
        break;
      }
      case 'update':
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
        recordOk('stream');
        for (const l of this.listeners.get(msg.symbol) ?? []) l.onTrade?.(msg);
        break;
      case 'quote':
        recordOk('quotes');
        for (const l of this.listeners.get(msg.symbol) ?? []) l.onQuote?.(msg);
        break;
    }
  }

  private onClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null;
    for (const p of this.pending.values()) p.reject(new Error('Lost connection to the helper.'));
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
/**
 * How long (ms) a read-only reply can be reused, so clicking back to a page or tab shows its data instantly.
 * Live prices are kept briefly; slow-moving data (macro, bonds, filings) longer. Anything that saves, asks the AI
 * or scans is never cached.
 */
export const ENGINE_CACHE_MS: Record<string, number> = {
  'invest.board': 20_000,
  'invest.movers': 20_000,
  'flow.options': 20_000,
  'invest.history': 5 * 60_000,
  'portfolio.analyze': 5 * 60_000,
  'flow.positioning': 5 * 60_000,
  'invest.search': 10 * 60_000,
  'bonds.cusip': 10 * 60_000,
  'bonds.market': 10 * 60_000,
  'bonds.auctions': 10 * 60_000,
  'macro.series': 10 * 60_000,
  'macro.curve': 10 * 60_000,
  'macro.catalog': 60 * 60_000,
  'flow.cot': 30 * 60_000,
  'flow.cot_markets': 60 * 60_000,
  'flow.cot_for_symbol': 30 * 60_000,
  'flow.short_volume': 30 * 60_000,
  'research.company': 5 * 60_000,
  'alts.fund': 15 * 60_000,
  'alts.search_private': 15 * 60_000,
  'alts.latest_private': 10 * 60_000,
  'risk.account': 5 * 60_000,
  'tax.account': 60_000,
  'futures.board': 20_000,
  'futures.curve': 60_000,
  'futures.detail': 5 * 60_000,
  'webull.futures_contracts': 20_000,
};
const engineCache = new Map<string, { at: number; value: Promise<unknown> }>();

/** A reply that came back partly failed (a section in `errors`, or Research without its quote) isn't reused. */
export function complete(type: string, data: unknown): boolean {
  const d = (data ?? {}) as { errors?: Record<string, unknown>; quote?: Record<string, unknown> };
  if (d.errors && Object.keys(d.errors).length) return false;
  if (type === 'research.company' && !(d.quote && Object.keys(d.quote).length)) return false;
  return true;
}

/** JSON with object keys sorted at every level, so the same request always gives the same cache key. */
export function stableKey(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableKey((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** Forgets cached replies (all, or those whose type starts with `prefix`), e.g. after the Refresh button. */
export function clearEngineCache(prefix = '') {
  for (const key of [...engineCache.keys()]) if (key.startsWith(prefix)) engineCache.delete(key);
}

export async function engineRequest<T>(type: string, params: Record<string, unknown> = {}, timeoutMs = 60000, onEvent?: (e: EngineEvent) => void, signal?: AbortSignal): Promise<T> {
  // Every message carries its request number as `id`, so parameters must use other names.
  if ('id' in params || 'type' in params) throw new Error(`engineRequest("${type}"): "id" and "type" are reserved parameter names`);
  // A request that can be cancelled isn't shared: one caller cancelling must not cancel the reply for another.
  const ttl = onEvent || signal || params.refresh ? 0 : (ENGINE_CACHE_MS[type] ?? 0);
  const key = `${type} ${stableKey(params)}`;
  const hit = ttl ? engineCache.get(key) : undefined;
  // Reuse a recent reply, or join the same request already on its way (two panels asking for one board).
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = helper.request({ ...params, type }, signal, timeoutMs, onEvent).then(
    (reply) => {
      if (reply.type !== 'engine') throw new Error('Unexpected reply from the helper');
      markFetched(type);
      return reply.data as T;
    },
    (err: Error) => {
      noteFailure(type, err);
      throw err;
    },
  );
  if (ttl) {
    const entry = { at: Date.now(), value };
    engineCache.set(key, entry);
    const drop = () => engineCache.get(key) === entry && engineCache.delete(key);
    value.then((data) => complete(type, data) || drop(), drop); // never keep a failure or a partial reply
    if (engineCache.size > 300) engineCache.delete(engineCache.keys().next().value!);
  }
  return value;
}

/** A failed request marks its feed as failing on the Data panel (not when the helper simply isn't running). */
function noteFailure(type: string, err: Error) {
  const feed = feedOf(type);
  if (feed && err?.name !== 'AbortError' && helper.isConnected) recordError(feed, err.message);
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
    checkAlpaca();
    const plan = (alpacaSet && ALPACA_HISTORY_PLAN[timeframe]) || HISTORY_PLAN[timeframe];
    if (!plan) {
      await helper.connect();
      return [];
    }
    const reply = await helper.request({ type: 'history', symbol, resolution: plan.resolution, days: plan.days }, signal).catch((err: Error) => {
      noteFailure('history', err);
      throw err;
    });
    if (reply.type !== 'history') throw new Error('Unexpected reply from the helper');
    markFetched('history');
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
