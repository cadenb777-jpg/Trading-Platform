import { describe, expect, it } from 'vitest';
import { sourceTitle } from './quotes';

describe('price source', () => {
  it('names the source and the age of the trade', () => {
    expect(sourceTitle({ symbol: 'X', last: 1, prevClose: 1, src: 'Schwab live', at: 1000 }, 1_003_000)).toBe('Price from Schwab live · last trade 3 s ago');
    expect(sourceTitle({ symbol: 'X', last: 1, prevClose: 1, src: 'Alpaca', at: 1000 }, 1_000_000 + 300_000)).toBe('Price from Alpaca · last trade 5 min ago');
    expect(sourceTitle({ symbol: 'X', last: 1, prevClose: 1 })).toBe('');
  });
});
