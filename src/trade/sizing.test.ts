import { describe, expect, it } from 'vitest';
import { accountReady, basisPrice, estimate, maxBuyShares, riskShares, sellFraction, sharesForDollars } from './sizing';

describe('order ticket sizing', () => {
  it('turns dollars into whole shares and shows the rounding', () => {
    expect(sharesForDollars(1000, 230.4)).toEqual({ shares: 4, cost: 921.6, left: 78.4 });
    expect(sharesForDollars(100, 230)).toEqual({ shares: 0, cost: 0, left: 100 });
    expect(sharesForDollars(690, 230).shares).toBe(3); // exact multiple is not lost to floating point
    expect(sharesForDollars(500, 0).shares).toBe(0);
  });

  it('sizes by risk like the trade guide', () => {
    // $12,000 x 0.5% = $60 risk; $230 entry, $222 stop = $8 a share -> 7 shares
    expect(riskShares(12000, 0.5, 230, 222)).toEqual({ shares: 7, riskDollars: 60, perShare: 8 });
    expect(riskShares(12000, 0.5, 230, 230).shares).toBe(0);
    expect(riskShares(0, 0.5, 230, 222).shares).toBe(0);
  });

  it('caps the max buy by the order limit and the buying power', () => {
    expect(maxBuyShares(100, 1000, 5000)).toBe(10);
    expect(maxBuyShares(100, 1000, 450)).toBe(4);
    expect(maxBuyShares(100, 1000, null)).toBe(10);
    expect(maxBuyShares(0, 1000, 450)).toBe(0);
  });

  it('sells fractions of a position in whole shares', () => {
    expect(sellFraction(10, 0.25)).toBe(2);
    expect(sellFraction(10, 1)).toBe(10);
    expect(sellFraction(1, 0.25)).toBe(1);
    expect(sellFraction(0, 0.5)).toBe(0);
  });

  it('values the order at its limit, stop or last price', () => {
    expect(basisPrice('MARKET', 100, 90, 80)).toBe(100);
    expect(basisPrice('LIMIT', 100, 90, null)).toBe(90);
    expect(basisPrice('STOP', 100, null, 80)).toBe(80);
    expect(basisPrice('STOP_LIMIT', 100, 81, 80)).toBe(81);
    expect(estimate('BUY', 3, 100, 1000)).toEqual({ value: 300, after: 700 });
    expect(estimate('SELL', 3, 100, 1000)).toEqual({ value: 300, after: 1300 });
    expect(estimate('BUY', 0, 100, 1000)).toEqual({ value: null, after: null });
  });
});

describe('the ticket account', () => {
  it('previews only once the chosen account has loaded', () => {
    expect(accountReady('ROTH', 'ROTH')).toBe(true);
    expect(accountReady('TRAD', 'ROTH')).toBe(false); // just switched: the old snapshot is still shown
    expect(accountReady(undefined, 'ROTH')).toBe(false);
    expect(accountReady('ROTH', '')).toBe(false);
  });
});
