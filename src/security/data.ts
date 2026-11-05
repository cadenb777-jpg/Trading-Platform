/**
 * What the security view loads, once per symbol (kept 5 minutes, so Back/Forward is instant). Only requests the helper
 * already has: invest.board, research.company, history (daily bars), dividends.history, news, flow.options,
 * research.insider_history, prospect.holders_by_symbol, scanner.results and the saved portfolios. A failure is never
 * kept, so the next look asks again.
 */
import { getProvider } from '../data';
import { engineRequest, loadNews, type NewsItem } from '../data/schwab';
import { listDocs } from '../data/store';
import type { BoardRow } from '../invest/shared';
import type { CompanyData } from '../pages/researchPage';
import type { Setup } from '../home/setupsPanel';
import type { Portfolio } from '../portfolio/types';
import type { Bar } from '../types';

export type { CompanyData, BoardRow, NewsItem, Setup };

export interface OptionsReply {
  symbol: string;
  spot: number;
  expiration: string;
  expirations: string[];
  summary: {
    callVolume: number;
    putVolume: number;
    putCallVolume: number | null;
    callOi: number;
    putOi: number;
    putCallOi: number | null;
    maxPain: number | null;
    atmIv: number | null;
    netGex: number;
    expectedMove?: { strike: number; amount: number; percent: number | null } | null;
  };
  byExpiration?: { expiration: string; dte: number; callVolume: number; putVolume: number; putCallVolume: number | null; putCallOi: number | null; maxPain: number | null; atmIv: number | null; expectedMove: { amount: number; percent: number | null } | null }[];
  strikes: { strike: number; callVolume: number; putVolume: number; callOi: number; putOi: number }[];
  unusual: { type: 'call' | 'put'; expiration: string; dte: number; strike: number; last: number; volume: number; oi: number; iv: number | null; ratio: number | null; premium: number; side: string }[];
}

export interface InsiderReply {
  company: string;
  since: string;
  filings: number;
  trades: { date: string; filed: string; code: 'P' | 'S'; insider: string; title: string; shares: number; price: number | null; value: number | null }[];
  months: { month: string; buy: number; sell: number; net: number }[];
}

export interface HoldersReply {
  cusip: string;
  note: string;
  quarters: { period: string; holders: number; shares: number; value: number; new?: number; added?: number; reduced?: number; soldOut?: number }[];
}

export interface ScanReply {
  updated?: number;
  loading?: boolean;
  horizons?: Partial<Record<string, { setups: Setup[] }>>;
  horizonInfo?: Record<string, { label: string }>;
}

export interface DividendHistory {
  closes: [string, number][];
  dividends: [string, number][];
}

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = load();
  const entry = { at: Date.now(), value };
  cache.set(key, entry);
  value.catch(() => cache.get(key) === entry && cache.delete(key));
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}

/** Forgets everything for a symbol (the Refresh button). */
export function forget(symbol: string) {
  for (const k of [...cache.keys()]) if (k.endsWith(`:${symbol}`)) cache.delete(k);
}

const bare = (s: string) => s.replace(/^\$/, '');

export const loadBoard = (s: string) =>
  once(`board:${s}`, () => engineRequest<{ rows: BoardRow[]; asOf?: number }>('invest.board', { symbols: [s] }, 30_000).then((r) => ({ row: r.rows[0] ?? null, asOf: r.asOf ?? Date.now() / 1000 })));
export const loadCompany = (s: string) => once(`company:${s}`, () => engineRequest<CompanyData>('research.company', { symbol: bare(s) }, 90_000));
/** About 5 years of daily bars (Schwab). */
export const loadDaily = (s: string) => once(`daily:${s}`, () => getProvider('schwab').loadHistory(s, '1D', new AbortController().signal) as Promise<Bar[]>);
export const loadDividends = (s: string) => once(`dvd:${s}`, () => engineRequest<DividendHistory & { symbol: string }>('dividends.history', { symbol: bare(s) }, 60_000));
export const loadNewsFor = (s: string) => once(`news:${s}`, () => loadNews([bare(s)]).then((r) => ({ ...r, at: Date.now() / 1000 })));
export const loadOptions = (s: string) => once(`omon:${s}`, () => engineRequest<OptionsReply>('flow.options', { symbol: bare(s) }, 45_000));
export const loadInsiders = (s: string) => once(`ins:${s}`, () => engineRequest<InsiderReply>('research.insider_history', { symbol: bare(s), years: 2 }, 180_000));
export const loadHolders = (s: string) => once(`hds:${s}`, () => engineRequest<HoldersReply>('prospect.holders_by_symbol', { symbol: bare(s) }, 60_000));
export const loadScan = () => once('scan:all', () => engineRequest<ScanReply>('scanner.results', {}, 30_000));
export const loadPortfolios = () => once('pf:all', () => listDocs<Portfolio>('portfolios'));
