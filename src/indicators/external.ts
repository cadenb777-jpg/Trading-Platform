/** Data from outside the chart for indicators like COT positioning (loaded once per symbol, then reused). */
import { engineRequest } from '../data/schwab';
import type { Bar } from '../types';
import type { ExternalPoint, IndicatorDef } from './types';

const cache = new Map<string, { data?: ExternalPoint[]; error?: string; loading?: Promise<void>; waiters: Set<() => void> }>();
const LIFETIME_MS = 30 * 60 * 1000;
const loadedAt = new Map<string, number>();

/**
 * Returns the data if it's ready; otherwise starts loading it (once) and calls every `onReady`
 * passed in the meantime when it arrives, so each chart showing the indicator redraws.
 */
export function externalData(def: IndicatorDef, symbol: string, onReady: () => void): ExternalPoint[] | undefined {
  if (!def.external || !symbol) return undefined;
  const key = `${def.id}:${symbol}`;
  let entry = cache.get(key);
  const fresh = (loadedAt.get(key) ?? 0) > Date.now() - LIFETIME_MS;
  if (entry?.data && fresh) return entry.data;
  if (!entry) {
    entry = { waiters: new Set() };
    cache.set(key, entry);
  }
  entry.waiters.add(onReady);
  if (!entry.loading) {
    const e = entry;
    e.loading = def.external
      .load(symbol)
      .then((data) => {
        e.data = data;
        e.error = undefined;
        loadedAt.set(key, Date.now());
      })
      .catch((err: Error) => {
        e.error = err.message;
        loadedAt.set(key, Date.now() - LIFETIME_MS + 60000); // retry in a minute
      })
      .finally(() => {
        e.loading = undefined;
        const waiters = [...e.waiters];
        e.waiters.clear();
        for (const fn of waiters) fn();
      });
  }
  return entry.data;
}

export function externalError(def: IndicatorDef, symbol: string): string | undefined {
  return cache.get(`${def.id}:${symbol}`)?.error;
}

/** Each bar gets the latest value known at that bar's time (values carry forward until the next one). */
export function alignExternal(bars: Bar[], points: ExternalPoint[] | undefined, field: string): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (!points?.length) return out;
  let j = -1;
  for (let i = 0; i < bars.length; i++) {
    while (j + 1 < points.length && points[j + 1].time <= bars[i].time) j++;
    if (j >= 0) out[i] = points[j].values[field] ?? NaN;
  }
  return out;
}

const DAY = 86400;
const toTime = (date: string, delayDays = 0) => Date.parse(`${date}T00:00:00Z`) / 1000 + delayDays * DAY;

interface CotRow {
  date: string;
  specIndex: number | null;
  commIndex: number | null;
  specNet: number;
  commNet: number;
  smallNet: number;
}

/** COT for the futures market related to `symbol`. Reports are as of Tuesday and published Friday, so values count from then. */
export async function loadCot(symbol: string): Promise<ExternalPoint[]> {
  const d = await engineRequest<{ rows: CotRow[]; market: string }>('flow.cot_for_symbol', { symbol: symbol.replace(/^\$/, '') }, 60000);
  return d.rows.map((r) => ({ time: toTime(r.date, 3), values: { spec: r.specIndex ?? NaN, comm: r.commIndex ?? NaN, specNet: r.specNet, commNet: r.commNet, smallNet: r.smallNet } }));
}

/** FINRA daily short-sale volume ratio (published after the close, so it applies from the next day). */
export async function loadShortVolume(symbol: string): Promise<ExternalPoint[]> {
  const d = await engineRequest<{ rows: { date: string; ratio: number }[] }>('flow.short_volume', { symbol, days: 60 }, 90000);
  return d.rows.map((r) => ({ time: toTime(r.date, 1), values: { ratio: r.ratio * 100 } }));
}
