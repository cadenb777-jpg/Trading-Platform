/** Simulated prices so the app works offline and without any accounts. Not real market data. */
import { TIMEFRAME_SECONDS, type Bar } from '../types';
import type { DataProvider } from './provider';

/** Small deterministic random number generator so each symbol always gets the same history. */
function seededRandom(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export const demo: DataProvider = {
  id: 'demo',
  name: 'Demo (simulated)',
  description: 'Made-up prices for trying things out. Works offline.',
  defaultSymbol: 'DEMO',
  symbolPlaceholder: 'Any name',

  normalizeSymbol: (input) => input.trim().toUpperCase() || 'DEMO',

  async loadHistory(symbol, timeframe) {
    const tf = TIMEFRAME_SECONDS[timeframe];
    const rand = seededRandom(symbol + timeframe);
    const count = 800;
    const end = Math.floor(Date.now() / 1000 / tf) * tf;
    let price = 50 + rand() * 450;
    const bars: Bar[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const open = price;
      const drift = (rand() - 0.49) * 0.02 * Math.sqrt(tf / 60);
      const close = Math.max(0.01, open * (1 + drift));
      const high = Math.max(open, close) * (1 + rand() * 0.006);
      const low = Math.min(open, close) * (1 - rand() * 0.006);
      bars.push({ time: end - i * tf, open, high, low, close, volume: Math.round(1000 + rand() * 50000) });
      price = close;
    }
    return bars;
  },

  subscribe(symbol, handlers, lastPrice) {
    const rand = seededRandom(symbol + Date.now());
    let price = lastPrice;
    handlers.onStatus('live');
    const timer = setInterval(() => {
      price = Math.max(0.01, price * (1 + (rand() - 0.5) * 0.002));
      handlers.onTrade({ price, size: Math.round(rand() * 500), time: Date.now() / 1000 });
    }, 500);
    return () => {
      clearInterval(timer);
      handlers.onStatus('closed');
    };
  },
};
