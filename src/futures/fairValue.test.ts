import { describe, expect, it } from 'vitest';
import { briefLine, headline, reading, rollShort, rollText, signedBp, signedPct, signedPts, signedUsd, type Carry, type CarryRow } from './fairValue';

// The hand-worked case of helper/tests/test_carry.py (S&P 500 6,000, SOFR 4.30%, yield 1.20%, 36 days).
const base: CarryRow = {
  root: 'ES', index: '$SPX', indexName: 'S&P 500', etf: 'SPY', spot: 6000, spotAt: null, mult: 50,
  contract: { code: 'ESZ26', symbol: '/ESZ26', expiry: '2026-12-18', days: 36, price: 6020 },
  next: { code: 'ESH27', symbol: '/ESH27', expiry: '2027-03-19', days: 127, price: 6075 },
  cashOpen: false, divYield: 0.012, fairValue: 6018.69863, fairPremium: 18.69863, basis: 20, mispricing: 1.30137,
  mispricingUsd: 65.0685, impliedRate: null, spreadBp: null, impliedOpen: 6001.30137, impliedOpenChange: 0.0002169,
  roll: { days: 91, fairSpread: 47.42354, spread: 55, rich: 7.57646, richUsd: 378.823, impliedRate: 0.0496 },
};
const open: CarryRow = { ...base, cashOpen: true, impliedOpen: null, impliedOpenChange: null, impliedRate: 0.045169, spreadBp: 21.69 };

describe('fair value readings', () => {
  it('formats signed figures', () => {
    expect(signedPct(0.0002169)).toBe('+0.02%');
    expect(signedPct(-0.0042)).toBe('-0.42%');
    expect(signedPct(-0.00001)).toBe('0.00%');
    expect(signedPts(1.30137)).toBe('+1.30 pts');
    expect(signedUsd(-65.4)).toBe('-$65');
    expect(signedBp(21.69)).toBe('+22 bp');
    expect(signedPct(null)).toBe('—');
  });

  it('leads with the implied open while the cash market is shut', () => {
    const t = headline(base);
    expect(t).toEqual({ label: 'Implied open', value: '+0.02%', tone: 'up', detail: '6,001.30 vs 6,000.00 close' });
    expect(reading(base)).toBe('ESZ26 at 6,020.00, less its fair premium of 18.70 points, points to the S&P 500 opening higher by 0.02%.');
  });

  it('leads with futures against fair value while it trades', () => {
    const t = headline(open);
    expect(t.label).toBe('Futures vs fair value');
    expect(t.value).toBe('+1.30 pts');
    expect(t.detail).toBe('+$65 a contract · financing +22 bp over SOFR');
    expect(reading(open)).toBe('ESZ26 trades above its fair value by 1.30 points: buyers are paying 4.52% a year to hold the index through futures.');
  });

  it('says why when figures are missing', () => {
    const r = { ...base, fairValue: null, fairPremium: null, impliedOpen: null, impliedOpenChange: null, why: 'No 12-month dividend record for SPY from Yahoo, so no fair value.' };
    expect(headline(r).value).toBe('—');
    expect(headline(r).detail).toBe(r.why);
    expect(reading(r)).toBe(r.why);
  });

  it('describes the roll', () => {
    expect(rollText(base)).toBe('ESH27: 7.58 pts dear (+$379 a contract)');
    expect(rollText({ ...base, roll: null })).toBe('—');
    expect(rollShort(base)).toBe('H27 +7.58 pts');
  });

  it('gives the brief its S&P line only while the cash market is shut', () => {
    const c = { rows: [base] } as Carry;
    expect(briefLine(c)).toEqual({ text: 'S&P 500 implied open +0.02%', tone: 'up' });
    expect(briefLine({ rows: [open] } as Carry)).toBeNull();
    expect(briefLine(null)).toBeNull();
  });
});
