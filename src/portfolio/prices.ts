/** Live prices and dividend yields for valuing portfolios (from the helper's Schwab quotes). */
import { engineRequest } from '../data/schwab';

export interface PriceInfo {
  price: number | null;
  /** Dividend yield as a fraction (0.015 = 1.5%). */
  yield: number | null;
  name: string;
}

const cache = new Map<string, { at: number; info: PriceInfo }>();
const FRESH_MS = 60000;

export async function fetchPrices(symbols: string[]): Promise<Record<string, PriceInfo>> {
  const now = Date.now();
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const missing = wanted.filter((s) => (cache.get(s)?.at ?? 0) < now - FRESH_MS);
  if (missing.length) {
    const { rows } = await engineRequest<{ rows: { symbol: string; price: number | null; divYield?: number | null; name?: string }[] }>('invest.board', { symbols: missing }, 60000);
    for (const r of rows) cache.set(r.symbol, { at: now, info: { price: r.price, yield: r.divYield != null ? r.divYield / 100 : null, name: r.name ?? '' } });
  }
  return Object.fromEntries(wanted.map((s) => [s, cache.get(s)?.info ?? { price: null, yield: null, name: '' }]));
}

export const priceMap = (info: Record<string, PriceInfo>) => Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v.price]));
