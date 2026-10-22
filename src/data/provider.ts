import type { Bar, Timeframe } from '../types';

export type ProviderId = 'coinbase' | 'schwab' | 'alpaca' | 'demo';

export type ConnectionStatus = 'connecting' | 'live' | 'error' | 'closed';

export interface Trade {
  price: number;
  size: number;
  /** UTC unix seconds */
  time: number;
}

export interface LiveHandlers {
  onTrade(trade: Trade): void;
  onStatus(status: ConnectionStatus, message?: string): void;
}

/** A source of market data. Each provider loads past bars and streams live trades. */
export interface DataProvider {
  id: ProviderId;
  name: string;
  /** Short description shown in the market picker. */
  description: string;
  defaultSymbol: string;
  symbolPlaceholder: string;
  /** Converts what the user typed into the provider's symbol format, e.g. "btc" -> "BTC-USD". */
  normalizeSymbol(input: string): string;
  loadHistory(symbol: string, timeframe: Timeframe, signal: AbortSignal): Promise<Bar[]>;
  /** Starts streaming live trades. `lastPrice` is the latest loaded close. Returns a function that stops the stream. */
  subscribe(symbol: string, handlers: LiveHandlers, lastPrice: number): () => void;
}

/**
 * Keeps a WebSocket connected, reconnecting with growing delays if it drops.
 * `onOpen` should send any subscribe/auth messages.
 */
export function reconnectingSocket(
  url: string,
  handlers: LiveHandlers,
  onOpen: (ws: WebSocket) => void,
  onMessage: (ws: WebSocket, data: unknown) => void,
): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    handlers.onStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      onOpen(ws!);
    };
    ws.onmessage = (event) => {
      try {
        onMessage(ws!, JSON.parse(event.data as string));
      } catch (err) {
        console.warn('Bad message from data feed', err);
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      const delay = Math.min(30000, 1000 * 2 ** attempt++);
      handlers.onStatus('error', `Disconnected, retrying in ${Math.round(delay / 1000)}s`);
      timer = setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
    handlers.onStatus('closed');
  };
}

/** Wraps fetch with friendlier errors for the most common failure modes. */
export async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error('Could not reach the data service. Check your internet connection, or the service may block requests from browsers.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Data service returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return res.json() as Promise<T>;
}
