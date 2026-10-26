import { describe, expect, it } from 'vitest';
import { HIGH_YIELD, notice19aLink, periods, rocText, shareWords, splitPeriod, yieldCheck } from './yieldQuality';

describe('splitPeriod', () => {
  it('payouts made = total − price return; the price fall paid for part of them', () => {
    const s = splitPeriod({ total: 0.05, price: -0.09 });
    expect(s.paid).toBeCloseTo(0.14);
    expect(s.fromPrice).toBeCloseTo(0.09);
    expect(s.share).toBeCloseTo(0.643, 3);
  });

  it('never blames your money when the price rose or held', () => {
    expect(splitPeriod({ total: 0.2, price: 0.08 })).toMatchObject({ fromPrice: 0, share: 0 });
    expect(splitPeriod({ total: 0.1, price: 0 })).toMatchObject({ fromPrice: 0, share: 0 });
  });

  it('a fall bigger than the payouts: all of them, never more', () => {
    const s = splitPeriod({ total: -0.05, price: -0.2 });
    expect(s.paid).toBeCloseTo(0.15);
    expect(s.fromPrice).toBeCloseTo(0.15);
    expect(s.share).toBeCloseTo(1);
  });

  it('nothing paid: no share', () => {
    expect(splitPeriod({ total: -0.1, price: -0.1 }).share).toBeNull();
  });
});

describe('yieldCheck', () => {
  it('reads the owner example: 14% paid, price −9%/yr', () => {
    const c = yieldCheck(0.13, { tr1y: 0.05, price1y: -0.09 })!;
    expect(c.paid).toBeCloseTo(0.14);
    expect(c.erosion).toBeCloseTo(0.09);
    expect(c.read).toBe("Paid about 14%/yr but the price fell 9.0%/yr over the last year (total return +5.0%/yr): about two-thirds of the payout came from the fund's own price falling, i.e. your own money coming back.");
    expect(c.tone).toBe('bad');
  });

  it('price rose: erosion 0 even when the total return is below today’s yield', () => {
    const c = yieldCheck(0.15, { tr1y: 0.09, price1y: 0.02 })!;
    expect(c.erosion).toBe(0);
    expect(c.tone).toBe('ok');
    expect(c.read).toContain('none of the payout came from');
    expect(c.read).toContain('Paid about 7.0%/yr');
  });

  it('uses the longest yearly period', () => {
    const c = yieldCheck(0.1, { tr1y: 0.12, price1y: 0.02, tr3y: 0.04, price3y: -0.06, tr5y: null })!;
    expect(c.period?.label).toBe('3 yr');
    expect(c.erosion).toBeCloseTo(0.06);
    expect(c.read).toContain('over the last 3 years');
  });

  it('only for high yields unless asked; no history = no verdict', () => {
    expect(yieldCheck(HIGH_YIELD - 0.01, { tr1y: 0, price1y: 0 })).toBeNull();
    expect(yieldCheck(0.03, { tr1y: 0, price1y: -0.03 }, true)?.erosion).toBeCloseTo(0.03);
    expect(yieldCheck(null, {})).toBeNull();
    const young = yieldCheck(0.3, { trSince: 0.02, priceSince: -0.1, sinceYears: 0.5, sinceStart: '2026-04-01' })!;
    expect(young.period).toBeNull();
    expect(young.erosion).toBeNull();
  });
});

describe('periods', () => {
  it('adds since-inception for young funds, with a human date', () => {
    const r = { tr1y: 0.05, price1y: -0.08, trSince: 0.03, priceSince: -0.1, sinceYears: 2.2, sinceStart: '2024-08-01' };
    expect(periods(r).map((x) => x.label)).toEqual(['1 yr', 'Since Aug 2024']);
    const c = yieldCheck(0.15, r)!;
    expect(c.period?.label).toBe('Since Aug 2024');
    expect(c.read).toContain('since Aug 2024');
  });

  it('skips since-inception when 5 years exist or it repeats a period', () => {
    expect(periods({ tr5y: 0.05, price5y: 0, trSince: 0.05, priceSince: 0, sinceYears: 6 }).map((x) => x.label)).toEqual(['5 yr']);
    expect(periods({ tr1y: 0.05, price1y: 0, trSince: 0.05, priceSince: 0, sinceYears: 1.02 }).map((x) => x.label)).toEqual(['1 yr']);
    expect(periods({ trSince: 0.05, priceSince: 0, sinceYears: 0.5, sinceStart: '2026-04-20' })[0]).toMatchObject({ yearly: false, label: 'Since Apr 2026 (6 mo)' });
  });
});

describe('words and return of capital', () => {
  it('rounds shares to plain words', () => {
    expect(shareWords(0.5)).toBe('about half of the payout');
    expect(shareWords(0.3)).toBe('about a third of the payout');
    expect(shareWords(0.97)).toBe('almost all of the payout');
    expect(shareWords(0.03)).toBe('very little of the payout');
  });

  it('shows ROC only when entered, never invented', () => {
    expect(rocText(null)).toBeNull();
    expect(rocText(undefined)).toBeNull();
    expect(rocText(0.42, '2025')).toBe('42% of the payouts in 2025 were return of capital (you entered this): not taxed when paid, it lowers your cost basis.');
    expect(notice19aLink('QYLD')).toBe('https://www.sec.gov/edgar/search/#/q=%2219(a)%22%20%22QYLD%22');
  });
});
