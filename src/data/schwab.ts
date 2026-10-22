/**
 * Live, all-exchange US stock data from Schwab, via the helper program running on this
 * computer (see helper/README.md). The browser never sees the Schwab keys; it only talks
 * to the helper over ws://127.0.0.1:8765.
 */
import type { Bar } from '../types';
import type { ConnectionStatus, DataProvider, LiveHandlers } from './provider';

const HELPER_URL = 'ws://127.0.0.1:8765';
const CONNECT_TIMEOUT_MS = 10000;
const HISTORY_TIMEOUT_MS = 30000;

export const HELPER_NOT_RUNNING =
  'The Schwab helper isn\'t running on this computer. Start it (double-click start-windows.bat or start-mac.command), then click Try again.';

type HelperMessage =
  | { type: 'status'; status: ConnectionStatus; message: string }
  | { type: 'history'; id: number; bars: Bar[] }
  | { type: 'error'; id: number | null; message: string }
  | { type: 'trade'; symbol: string; price: number; size: number; time: number };

/** One shared connection to the helper, reused by every chart request. */
class HelperConnection {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (bars: Bar[]) => void; reject: (err: Error) => void }>();
  private readonly subscribers = new Map<string, Set<LiveHandlers>>();
  private helperStatus: { status: ConnectionStatus; message: string } = { status: 'connecting', message: 'Connecting' };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(HELPER_URL);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(HELPER_NOT_RUNNING));
      }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        // Re-subscribe anything that was streaming before a reconnect.
        for (const symbol of this.subscribers.keys()) this.send({ type: 'subscribe', symbol });
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(HELPER_NOT_RUNNING));
      };
      ws.onmessage = (event) => this.onMessage(JSON.parse(event.data as string) as HelperMessage);
      ws.onclose = () => this.onClose(ws);
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  async history(symbol: string, timeframe: string, signal: AbortSignal): Promise<Bar[]> {
    await this.connect();
    const id = this.nextId++;
    return new Promise<Bar[]>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Schwab took too long to send price history. Try again.')), HISTORY_TIMEOUT_MS);
      const finish = (err: Error | null, bars?: Bar[]) => {
        clearTimeout(timer);
        this.pending.delete(id);
        signal.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(bars!);
      };
      const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort);
      this.pending.set(id, { resolve: (bars) => finish(null, bars), reject: (err) => finish(err) });
      this.send({ type: 'history', id, symbol, timeframe });
    });
  }

  subscribe(symbol: string, handlers: LiveHandlers): () => void {
    let set = this.subscribers.get(symbol);
    if (!set) {
      set = new Set();
      this.subscribers.set(symbol, set);
      this.send({ type: 'subscribe', symbol });
    }
    set.add(handlers);
    handlers.onStatus(this.ws ? this.helperStatus.status : 'connecting', this.helperStatus.message);
    this.connect().catch(() => this.scheduleRetry());
    return () => {
      set.delete(handlers);
      if (!set.size) {
        this.subscribers.delete(symbol);
        this.send({ type: 'unsubscribe', symbol });
      }
      handlers.onStatus('closed');
    };
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private allHandlers(): LiveHandlers[] {
    return [...this.subscribers.values()].flatMap((s) => [...s]);
  }

  private onMessage(msg: HelperMessage) {
    switch (msg.type) {
      case 'status':
        this.helperStatus = { status: msg.status, message: msg.message };
        for (const h of this.allHandlers()) h.onStatus(msg.status, msg.message);
        break;
      case 'history':
        this.pending.get(msg.id)?.resolve(msg.bars);
        break;
      case 'error':
        if (msg.id !== null) this.pending.get(msg.id)?.reject(new Error(msg.message));
        break;
      case 'trade':
        for (const h of this.subscribers.get(msg.symbol) ?? []) h.onTrade(msg);
        break;
    }
  }

  private onClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null;
    for (const p of this.pending.values()) p.reject(new Error('Lost connection to the Schwab helper.'));
    this.pending.clear();
    for (const h of this.allHandlers()) h.onStatus('error', 'Schwab helper stopped. Reconnecting…');
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (!this.subscribers.size || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect().catch(() => this.scheduleRetry());
    }, 3000);
  }
}

const helper = new HelperConnection();

export const schwab: DataProvider = {
  id: 'schwab',
  name: 'Stocks (Schwab)',
  description: 'Live US stock prices from every exchange. Needs the Schwab helper running on this computer.',
  defaultSymbol: 'AAPL',
  symbolPlaceholder: 'AAPL',

  normalizeSymbol: (input) => input.trim().toUpperCase(),

  loadHistory: (symbol, timeframe, signal) => helper.history(symbol, timeframe, signal),

  subscribe: (symbol, handlers) => helper.subscribe(symbol, handlers),
};
