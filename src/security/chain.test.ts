import { describe, expect, it } from 'vitest';
import { chainWindow, hasQuotes, inTheMoney } from './chain';

const k = (strike: number) => ({ strike, callVolume: 0, putVolume: 0, callOi: 0, putOi: 0 });
const strikes = [90, 95, 100, 105, 110, 115, 120].map(k);

describe('option chain', () => {
  it('keeps the strikes nearest the price and marks where it sits', () => {
    expect(chainWindow(strikes, 101, 4)).toEqual({ rows: [95, 100, 105, 110].map(k), spotAt: 2 });
    expect(chainWindow(strikes, 200, 3)).toEqual({ rows: [110, 115, 120].map(k), spotAt: 3 }); // price above every strike
    expect(chainWindow(strikes, 10, 3)).toEqual({ rows: [90, 95, 100].map(k), spotAt: 0 });
    expect(chainWindow([], 100)).toEqual({ rows: [], spotAt: 0 });
  });
  it('shades the in-the-money side', () => {
    expect(inTheMoney('call', 95, 101)).toBe(true);
    expect(inTheMoney('put', 95, 101)).toBe(false);
    expect(inTheMoney('put', 105, 101)).toBe(true);
  });
  it('knows when the helper sent quotes', () => {
    expect(hasQuotes(strikes)).toBe(false);
    expect(hasQuotes([{ ...k(100), callBid: 1 }])).toBe(true);
  });
});
