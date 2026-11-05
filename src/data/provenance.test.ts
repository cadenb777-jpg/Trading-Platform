import { describe, expect, it } from 'vitest';
import { ageText, envelopeLabel, replyProvenance, sourceCells, type SourceHealth } from './provenance';
import { markFetched, replyTime, resetHealth } from './health';

const row = (over: Partial<SourceHealth> = {}): SourceHealth => ({
  source: 'sec', label: 'SEC EDGAR', about: '', state: 'ok', calls: 10, ok: 9, failed: 1, retried: 1, coalesced: 2,
  lastOk: 1_700_000_000, ageSeconds: 75, lastError: 'SEC EDGAR answered 503', lastErrorAt: 1_699_999_000, lastStatus: 200,
  avgMs: 120, rateLimited: 0, rateLimitedFor: 0, usedLastMinute: 0, perMinute: null, cacheHits: 3, cacheMisses: 1,
  staleServed: 1, cacheHitRate: 0.75, notes: [], ...over,
});

describe('provenance', () => {
  it('reads a reply provenance only when well formed', () => {
    expect(replyProvenance({ provenance: { fetchedAt: 5, stale: true, sources: {} } })?.stale).toBe(true);
    expect(replyProvenance({ provenance: { stale: true } })).toBeNull();
    expect(replyProvenance(null)).toBeNull();
  });

  it('stamps the helper fetch time whenever provenance is present, the feed source first', () => {
    resetHealth();
    const plain = { a: 1 };
    const prov = { a: 1, provenance: { fetchedAt: 1_000, stale: false, sources: { fred: { fetchedAt: 2_000, stale: false, name: 'FRED' } } } };
    markFetched('x', plain, 5_000_000);
    markFetched('x', prov, 5_000_000);
    expect(replyTime(plain)).toBe(5_000_000);
    expect(replyTime(prov)).toBe(1_000_000);
    expect(replyTime(prov, 'fred')).toBe(2_000_000);
    expect(replyTime(prov, 'sec')).toBe(1_000_000);
  });

  it('labels figures consistently', () => {
    expect(ageText(42)).toBe('42 s');
    expect(ageText(300)).toBe('5 min');
    expect(ageText(3 * 3600)).toBe('3 h');
    expect(ageText(3 * 86400)).toBe('3 days');
    expect(envelopeLabel({ sourceName: 'FRED', asOf: '2026-10-01', stale: false })).toBe('FRED · as of 2026-10-01');
    expect(envelopeLabel({ sourceName: 'Schwab', asOf: 1_000, stale: true }, 1_060_000)).toBe('Schwab · 1 min old · saved copy');
  });

  it('turns a source health row into table cells', () => {
    expect(sourceCells(row())).toEqual({
      name: 'SEC EDGAR', state: 'Working', last: '1 min ago', errors: '1 · SEC EDGAR answered 503', limit: '10 calls', cache: '75% (1 saved copy)',
    });
    const schwab = sourceCells(row({ label: 'Schwab', state: 'rate-limited', perMinute: 120, usedLastMinute: 64, rateLimitedFor: 12, failed: 0, cacheHitRate: null, ageSeconds: null }));
    expect(schwab).toMatchObject({ state: 'Paused (rate limit)', last: '—', errors: '0', limit: '64/120 a min · paused 12 s', cache: '—' });
  });
});
