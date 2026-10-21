/**
 * Alpaca stock market data. A free Alpaca account (paper trading is fine) gives real-time
 * prices from the IEX exchange. Keys are entered in the app's settings and stay in this browser.
 * REST docs: https://docs.alpaca.markets/reference/stockbarsingle-1
 * WebSocket docs: https://docs.alpaca.markets/docs/real-time-stock-pricing-data
 */
import type { Timeframe } from '../types';
import { loadAlpacaKeys } from '../storage';
import { fetchJson, reconnectingSocket, type DataProvider } from './provider';

const REST = 'https://data.alpaca.markets/v2';
const WS = 'wss://stream.data.alpaca.markets/v2/iex';

const TIMEFRAME: Record<Timeframe, { alpaca: string; lookbackDays: number }> = {
  '1m': { alpaca: '1Min', lookbackDays: 5 },
  '5m': { alpaca: '5Min', lookbackDays: 20 },
  '15m': { alpaca: '15Min', lookbackDays: 45 },
  '1h': { alpaca: '1Hour', lookbackDays: 180 },
  '1D': { alpaca: '1Day', lookbackDays: 365 * 4 },
};

function requireKeys() {
  const keys = loadAlpacaKeys();
  if (!keys) throw new Error('Add your free Alpaca API keys in Settings (⚙) to load stock data.');
  return keys;
}

export const alpaca: DataProvider = {
  id: 'alpaca',
  name: 'Stocks (Alpaca)',
  description: 'Free real-time US stock prices (IEX). Needs a free Alpaca account.',
  defaultSymbol: 'AAPL',
  symbolPlaceholder: 'AAPL',

  normalizeSymbol: (input) => input.trim().toUpperCase(),

  async loadHistory(symbol, timeframe, signal) {
    const keys = requireKeys();
    const tf = TIMEFRAME[timeframe];
    const qs = new URLSearchParams({
      timeframe: tf.alpaca,
      start: new Date(Date.now() - tf.lookbackDays * 86400_000).toISOString(),
      limit: '1000',
      sort: 'desc',
      feed: 'iex',
      adjustment: 'split',
    });
    const data = await fetchJson<{ bars: { t: string; o: number; h: number; l: number; c: number; v: number }[] | null }>(
      `${REST}/stocks/${encodeURIComponent(symbol)}/bars?${qs}`,
      { signal, headers: { 'APCA-API-KEY-ID': keys.key, 'APCA-API-SECRET-KEY': keys.secret } },
    );
    if (!data.bars?.length) throw new Error(`No data found for "${symbol}". Check the ticker symbol.`);
    return data.bars
      .map((b) => ({ time: Date.parse(b.t) / 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
      .reverse();
  },

  subscribe(symbol, handlers) {
    const keys = loadAlpacaKeys();
    if (!keys) {
      handlers.onStatus('error', 'Alpaca keys missing');
      return () => {};
    }
    return reconnectingSocket(
      WS,
      handlers,
      () => {},
      (ws, data) => {
        for (const msg of data as { T: string; msg?: string; code?: number; p?: number; s?: number; t?: string }[]) {
          if (msg.T === 'success' && msg.msg === 'connected') {
            ws.send(JSON.stringify({ action: 'auth', key: keys.key, secret: keys.secret }));
          } else if (msg.T === 'success' && msg.msg === 'authenticated') {
            ws.send(JSON.stringify({ action: 'subscribe', trades: [symbol] }));
          } else if (msg.T === 'subscription') {
            handlers.onStatus('live');
          } else if (msg.T === 'error') {
            handlers.onStatus('error', `Alpaca: ${msg.msg} (${msg.code})`);
          } else if (msg.T === 't' && msg.p && msg.t) {
            handlers.onTrade({ price: msg.p, size: msg.s ?? 0, time: Date.parse(msg.t) / 1000 });
          }
        }
      },
    );
  },
};
