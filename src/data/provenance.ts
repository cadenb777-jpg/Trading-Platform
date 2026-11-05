/**
 * Provenance from the helper's data hub (helper/engine/datahub.py), shown the same way everywhere.
 *
 * - An envelope is one figure with where it came from: {value, source, sourceName, asOf, fetchedAt, stale}.
 * - Every engine reply (v44+) may carry `provenance`: {fetchedAt, stale, sources}, built from the cached values the
 *   reply used. `stale` means an older saved copy was shown while the helper fetches a new one.
 * - data.health lists every source's state for the Data window's Sources table.
 */

export interface Envelope<T = unknown> {
  value: T;
  source: string;
  sourceName: string;
  /** the time the figure describes: unix seconds or a 'YYYY-MM-DD' date (a close, a filing) */
  asOf: number | string | null;
  /** when the helper fetched it (unix seconds) */
  fetchedAt: number;
  stale: boolean;
}

export interface ReplyProvenance {
  fetchedAt: number;
  stale: boolean;
  sources: Record<string, { fetchedAt: number; stale: boolean; name: string }>;
}

export interface SourceHealth {
  source: string;
  label: string;
  about: string;
  state: 'ok' | 'failing' | 'rate-limited' | 'idle';
  calls: number;
  ok: number;
  failed: number;
  retried: number;
  coalesced: number;
  lastOk: number | null;
  ageSeconds: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  lastStatus: number | null;
  avgMs: number | null;
  rateLimited: number;
  rateLimitedFor: number;
  usedLastMinute: number;
  perMinute: number | null;
  cacheHits: number;
  cacheMisses: number;
  staleServed: number;
  cacheHitRate: number | null;
  notes: { at: number; text: string }[];
}

export interface DataHealth {
  at: number;
  sources: SourceHealth[];
}

/** The reply's provenance (v44+ helpers), or null. */
export function replyProvenance(data: unknown): ReplyProvenance | null {
  const p = data && typeof data === 'object' ? (data as { provenance?: unknown }).provenance : null;
  if (!p || typeof p !== 'object') return null;
  const r = p as ReplyProvenance;
  return typeof r.fetchedAt === 'number' && typeof r.stale === 'boolean' ? r : null;
}

/** "42 s", "5 min", "3 h", "2 days". */
export function ageText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 2 * 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

/** One figure's label: "FRED · as of 2026-10-01" (plus " · saved copy" when stale). */
export function envelopeLabel(env: Pick<Envelope, 'sourceName' | 'asOf' | 'stale'>, nowMs = Date.now()): string {
  let when = '';
  if (typeof env.asOf === 'string' && env.asOf) when = ` · as of ${env.asOf}`;
  else if (typeof env.asOf === 'number') when = ` · ${ageText(nowMs / 1000 - env.asOf)} old`;
  return `${env.sourceName}${when}${env.stale ? ' · saved copy' : ''}`;
}

/** Plain words for a source's state in the Sources table. */
export const SOURCE_STATE_TEXT: Record<SourceHealth['state'], string> = {
  ok: 'Working',
  failing: 'Failing',
  'rate-limited': 'Paused (rate limit)',
  idle: 'Not used yet',
};

/** One row of the Sources table as text cells (pure, tested). */
export function sourceCells(s: SourceHealth): { name: string; state: string; last: string; errors: string; limit: string; cache: string } {
  const last = s.ageSeconds == null ? '—' : `${ageText(s.ageSeconds)} ago`;
  const errors = s.failed ? `${s.failed}${s.lastError ? ` · ${s.lastError}` : ''}` : '0';
  let limit = s.perMinute ? `${s.usedLastMinute}/${s.perMinute} a min` : `${s.calls} calls`;
  if (s.rateLimitedFor > 0) limit += ` · paused ${s.rateLimitedFor} s`;
  else if (s.rateLimited) limit += ` · ${s.rateLimited}× limited`;
  const cache = s.cacheHitRate == null ? '—' : `${Math.round(s.cacheHitRate * 100)}%${s.staleServed ? ` (${s.staleServed} saved ${s.staleServed === 1 ? 'copy' : 'copies'})` : ''}`;
  return { name: s.label, state: SOURCE_STATE_TEXT[s.state] ?? s.state, last, errors, limit, cache };
}
