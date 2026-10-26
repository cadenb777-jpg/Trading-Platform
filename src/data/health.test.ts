import { beforeEach, describe, expect, it } from 'vitest';
import { feedOf, health, requestProblem, replyTime, isStale, markFetched, recordError, recordOk, resetHealth } from './health';

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
    const reply = { rows: [] };
    markFetched('invest.board', reply, 1000);
    expect(replyTime(reply)).toBe(1000);
    expect(replyTime({ rows: [] })).toBeNull(); // another request's reply has its own time
    expect(health('quotes', 2000)).toBe('ok');
    expect(health('quotes', 1000 + 61_000)).toBe('stale');
    recordError('quotes', 'Schwab login expired', 3000);
    expect(health('quotes', 3500)).toBe('error');
    recordOk('quotes', 4000);
    expect(health('quotes', 4500)).toBe('ok');
    expect(health('alpaca', 1e12)).toBe('idle');
  });

  it('an unknown symbol is a problem with the request, not the feed', () => {
    expect(requestProblem('Invalid symbol "ZZZZ"')).toBe(true);
    expect(requestProblem('Schwab sent no usable price data for XYZ.')).toBe(true);
    expect(requestProblem('Schwab login expired: run the helper again to log in.')).toBe(false);
    expect(requestProblem('The helper took too long to answer. Try again.')).toBe(false);
  });
});
