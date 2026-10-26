import { describe, expect, it } from 'vitest';
import { frontMonth, futuresBasis, notional, onTick, positionPnl, riskToStop, tickDollars, ticksBetween, type FuturesContract } from './futuresMath';

const c = (symbol: string, cutoff: string, tradable = true): FuturesContract => ({
  symbol, root: 'ES', name: symbol, multiplier: 50, tick: 0.25, tickValue: 12.5, lastTrade: cutoff, cutoff, daysLeft: 30, month: '202612', status: 'OC', tradable,
});

describe('futures maths', () => {
  it('notional is price x multiplier x contracts', () => {
    expect(notional(5000.25, 5, 1)).toBe(25001.25); // 1 MES
    expect(notional(5000, 50, 2)).toBe(500000); // 2 ES
    expect(notional(null, 50, 1)).toBeNull();
    expect(notional(5000, 50, 0)).toBeNull();
  });

  it('one tick in dollars', () => {
    expect(tickDollars(0.25, 50)).toBe(12.5); // ES
    expect(tickDollars(0.25, 2, 3)).toBe(1.5); // 3 MNQ
    expect(tickDollars(0.01, 1000)).toBe(10); // CL
  });

  it('risk to the protective stop, only on the right side', () => {
    expect(riskToStop('BUY', 5000, 4990, 5, 1)).toBe(50);
    expect(riskToStop('SELL', 5000, 5012.5, 50, 2)).toBe(1250);
    expect(riskToStop('BUY', 5000, 5010, 5, 1)).toBeNull();
    expect(riskToStop('SELL', 5000, 4990, 5, 1)).toBeNull();
    expect(riskToStop('BUY', 5000, null, 5, 1)).toBeNull();
    expect(ticksBetween(5000, 4990, 0.25)).toBe(40);
  });

  it('prices on the tick', () => {
    expect(onTick(5000.25, 0.25)).toBe(true);
    expect(onTick(5000.1, 0.25)).toBe(false);
    expect(onTick(61.37, 0.01)).toBe(true);
  });

  it('open P/L is multiplier aware, shorts negative quantity', () => {
    expect(positionPnl(2, 4990, 5000, 5)).toBe(100);
    expect(positionPnl(-1, 4990, 5000, 50)).toBe(-500);
    expect(positionPnl(1, 4990, 5000, null)).toBeNull();
  });

  it('basis and front month', () => {
    expect(futuresBasis('LIMIT', 5000, 4999, null)).toBe(4999);
    expect(futuresBasis('STOP', 5000, null, 5010)).toBe(5010);
    expect(futuresBasis('MARKET', 5000, 4999, null)).toBe(5000);
    expect(frontMonth([c('ESH7', '2027-03-19'), c('ESZ6', '2026-12-18', false), c('ESM7', '2027-06-18')])?.symbol).toBe('ESH7');
    expect(frontMonth([c('ESZ6', '2026-12-18', false)])).toBeNull();
  });
});
