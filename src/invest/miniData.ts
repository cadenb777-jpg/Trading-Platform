/**
 * Where the mini charts get their lines (all free, all already used elsewhere): Schwab daily closes through the
 * helper (invest.history ~13 months; the chart history request for 5 years), Coinbase daily candles, FRED series
 * (macro.series) and a fund's monthly NAV line from its SEC filings (alts.fund navHistory). One cache per series.
 */
import { coinbase } from '../data/coinbase';
import { engineRequest, schwab } from '../data/schwab';
import type { GoAction } from './goTo';
import { cleanPoints, createSeriesCache, needsLong, type ChangeMode, type Point, type Range } from './miniMath';

export type MiniSource =
  | { kind: 'symbol'; symbol: string }
  | { kind: 'coin'; symbol: string }
  | { kind: 'fred'; id: string }
  /** Points from somewhere else (a fund's NAV history); `id` keys the cache. */
  | { kind: 'points'; id: string; load: () => Promise<Point[]>; source: string }
  /** No history to show, and why. */
  | { kind: 'none'; reason: string };

export interface Series {
  points: Point[];
  /** "Schwab daily closes", "FRED DGS10", ... */
  source: string;
}

/** What a row or tile shows in its mini chart. */
export interface MiniItem {
  /** Unique per series (the symbol, FRED id, fund id); rows with the same key share a chart. */
  key: string;
  label: string;
  /** Shown under the label (ticker, series id). */
  sub?: string;
  source: MiniSource;
  mode: ChangeMode;
  /** Opens the full view (security view, fund detail, FRED window). */
  open: () => void;
  /** Formats one value of the line (price, yield, NAV). */
  format?: (v: number) => string;
  /** Extra facts for the expanded row (P/E, dividend yield, ...). */
  facts?: () => { label: string; value: string }[];
  /** Where it leads in the rest of the platform (goTo.ts), best first. */
  actions?: () => GoAction[];
}

const dateToUnix = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

async function fetchSeries(key: string, signal: AbortSignal): Promise<Series> {
  const [kind, length, ...rest] = key.split('|');
  const id = rest.join('|');
  if (kind === 'symbol' && length === 'short') {
    const { closes } = await engineRequest<{ closes: [number, number][] }>('invest.history', { symbol: id }, 45000, undefined, signal);
    return { points: cleanPoints(closes), source: 'Schwab daily closes' };
  }
  if (kind === 'symbol') {
    const bars = await schwab.loadHistory(id, '1D', signal);
    return { points: cleanPoints(bars.map((b) => [b.time, b.close])), source: 'Schwab daily closes' };
  }
  if (kind === 'coin') {
    const bars = await coinbase.loadHistory(id, '1D', signal);
    return { points: cleanPoints(bars.map((b) => [b.time, b.close])), source: 'Coinbase daily' };
  }
  if (kind === 'fred') {
    const d = await engineRequest<{ data: { time: string; value: number }[] }>('macro.series', { series: id, raw: true, limit: 100000 }, 45000, undefined, signal);
    return { points: cleanPoints(d.data.map((p) => [dateToUnix(p.time), p.value])), source: `FRED ${id}` };
  }
  const custom = loaders.get(id);
  if (!custom) throw new Error('No history for this one');
  return { points: cleanPoints(await custom.load()), source: custom.source };
}

const loaders = new Map<string, { load: () => Promise<Point[]>; source: string }>();
export const seriesCache = createSeriesCache(fetchSeries, 120);

/** The cache key for a source and range (symbols need a longer request for 5 years); null when there's no history. */
export function seriesKey(src: MiniSource, range: Range): string | null {
  if (src.kind === 'none') return null;
  if (src.kind === 'symbol') {
    // Once the 5-year line is here it serves every range.
    const long = `symbol|long|${src.symbol}`;
    return needsLong(range) || seriesCache.has(long) ? long : `symbol|short|${src.symbol}`;
  }
  if (src.kind === 'coin') return `coin|all|${src.symbol}`;
  if (src.kind === 'fred') return `fred|all|${src.id}`;
  loaders.set(src.id, { load: src.load, source: src.source });
  return `points|all|${src.id}`;
}
