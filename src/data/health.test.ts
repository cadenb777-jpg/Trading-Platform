import { beforeEach, describe, expect, it } from 'vitest';
import { feedOf, fetchedAt, health, isStale, markFetched, recordError, recordOk, resetHealth } from './health';

describe('data health', () => {
  beforeEach(resetHealth);

  it('maps request types to feeds', () => {
    expect(feedOf('invest.board')).toBe('quotes');
    expect(feedOf('history')).toBe('quotes');
    expect(feedOf('webull.snapshot')).toBe('webull');
    expect(feedOf('flow.cot_for_symbol')).toBe('cftc');
    expect(feedOf('macro.series')).toBe('fred');
    expect(feedOf('bonds.market')).toBe('fred');
    expect(feedOf('alts.fund')).toBe('sec');
    expect(feedOf('research.company')).toBe('sec');
    expect(feedOf('store.list')).toBeNull();
    expect(feedOf('ai.chat')).toBeNull();
  });

  it('is stale after twice the refresh interval, never for on-request feeds', () => {
    expect(isStale(0, 30_000, 60_000)).toBe(false);
    expect(isStale(0, 30_000, 60_001)).toBe(true);
    expect(isStale(0, 0, 1e12)).toBe(false);
    expect(isStale(null, 30_000, 1e12)).toBe(false);
  });

  it('tracks each feed: idle, ok, stale, error, recovered', () => {
    expect(health('quotes', 1000)).toBe('idle');
    markFetched('invest.board', 1000);
    expect(fetchedAt('invest.board')).toBe(1000);
    expect(health('quotes', 2000)).toBe('ok');
    expect(health('quotes', 1000 + 61_000)).toBe('stale');
    recordError('quotes', 'Schwab login expired', 3000);
    expect(health('quotes', 3500)).toBe('error');
    recordOk('quotes', 4000);
    expect(health('quotes', 4500)).toBe('ok');
    expect(health('alpaca', 1e12)).toBe('idle');
  });
});
