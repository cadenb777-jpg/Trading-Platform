import { describe, expect, it } from 'vitest';
import type { BoxReply } from '../futures/boxRates';
import type { Carry, CarryRow } from '../futures/fairValue';
import { edgeLines } from './edge';

// The hand-worked cases of helper/tests/test_carry.py and test_boxrates.py.
const es: CarryRow = {
  root: 'ES', index: '$SPX', indexName: 'S&P 500', etf: 'SPY', spot: 6000, spotAt: null, mult: 50,
  contract: { code: 'ESZ26', symbol: '/ESZ26', expiry: '2026-12-18', days: 36, price: 6020 }, next: null,
  cashOpen: false, divYield: 0.012, fairValue: 6018.69863, fairPremium: 18.69863, basis: 20, mispricing: 1.30137,
  mispricingUsd: 65.0685, impliedRate: null, spreadBp: null, impliedOpen: 6001.30137, impliedOpenChange: 0.0002169, roll: null,
};
const carry = (rows: CarryRow[]) => ({ rows }) as Carry;
const box = {
  rows: [
    { expiration: '2026-12-18', days: 37, midRate: 0.044, lend: 0.04, bill: 0.0438, extraPer100k: 2 },
    { expiration: '2027-02-19', days: 91, midRate: 0.0437998, lend: 0.0380692, bill: 0.043, extraPer100k: 19.941 },
  ],
} as unknown as BoxReply;

describe('Edge today', () => {
  it('shows the implied open before the open and the 3-month box against the T-bill', () => {
    const lines = edgeLines(carry([es]), box);
    expect(lines.map((l) => [l.label, l.value, l.tone, l.href])).toEqual([
      ['S&P 500 set to open', '+0.02%', 'up', '#futures/fair'],
      ['Lend via S&P 500 box spreads, 3 months', '4.38%', 'up', '#futures/rates'],
    ]);
    expect(lines[0].detail).toBe('ESZ26 less its fair premium points to 6,001.30');
    expect(lines[1].detail).toBe('T-bill 4.30% · +8 bp · +$20 per $100,000 at the mid');
  });

  it('shows futures against fair value while the market is open', () => {
    const [l] = edgeLines(carry([{ ...es, cashOpen: true, impliedOpen: null, impliedOpenChange: null, spreadBp: 21.69 }]), null);
    expect([l.label, l.value, l.detail]).toEqual(['S&P 500 futures vs fair value', '+1.30 pts', '+$65 a contract · buyers pay 22 bp over SOFR']);
  });

  it('leaves out what is missing', () => {
    expect(edgeLines(null, null)).toEqual([]);
    expect(edgeLines(carry([{ ...es, impliedOpenChange: null }]), null)).toEqual([]);
  });
});
