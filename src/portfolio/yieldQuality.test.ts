import { describe, expect, it } from 'vitest';
import { HIGH_YIELD, erosionOf, notice19aLink, periods, rocText, shareWords, yieldCheck } from './yieldQuality';

describe('erosion', () => {
  it('is the yield minus the total return, never negative', () => {
    expect(erosionOf(0.14, 0.05)).toBeCloseTo(0.09);
    expect(erosionOf(0.08, 0.1)).toBe(0);
    expect(erosionOf(0.1, -0.05)).toBeCloseTo(0.15);
  });

  it('reads the owner example: 14% paid, price −9%/yr', () => {
    const c = yieldCheck(0.14, { tr1y: 0.05, price1y: -0.09 })!;
    expect(c.erosion).toBeCloseTo(0.09);
    expect(c.share).toBeCloseTo(0.643, 2);
    expect(c.read).toBe('Paid about 14%/yr but the price fell 9.0%/yr over the last year (total return +5.0%/yr): about two-thirds of the payout came back out of your own money.');
    expect(c.tone).toBe('bad');
  });

  it('uses the longest yearly period', () => {
    const c = yieldCheck(0.1, { tr1y: 0.12, price1y: 0.02, tr3y: 0.04, price3y: -0.06, tr5y: null })!;
    expect(c.period?.label).toBe('3 yr');
    expect(c.erosion).toBeCloseTo(0.06);
    expect(c.read).toContain('over the last 3 years');
  });

  it('covered payouts read as fine', () => {
    const c = yieldCheck(0.07, { tr1y: 0.09, price1y: 0.02 })!;
    expect(c.erosion).toBe(0);
    expect(c.tone).toBe('ok');
    expect(c.read).toContain('covered');
  });

  it('a total loss is more than the whole payout', () => {
    expect(yieldCheck(0.2, { tr1y: -0.05, price1y: -0.25 })!.read).toContain('all of the payout, and more,');
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
  it('adds since-inception for young funds', () => {
    const p = periods({ tr1y: 0.05, price1y: -0.08, trSince: 0.03, priceSince: -0.1, sinceYears: 2.2, sinceStart: '2024-08-01' });
    expect(p.map((x) => x.label)).toEqual(['1 yr', 'Since 2024-08-01']);
    expect(yieldCheck(0.15, { tr1y: 0.05, price1y: -0.08, trSince: 0.03, priceSince: -0.1, sinceYears: 2.2, sinceStart: '2024-08-01' })!.period?.label).toBe('Since 2024-08-01');
  });

  it('skips since-inception when 5 years exist or it repeats a period', () => {
    expect(periods({ tr5y: 0.05, price5y: 0, trSince: 0.05, priceSince: 0, sinceYears: 6 }).map((x) => x.label)).toEqual(['5 yr']);
    expect(periods({ tr1y: 0.05, price1y: 0, trSince: 0.05, priceSince: 0, sinceYears: 1.02 }).map((x) => x.label)).toEqual(['1 yr']);
    expect(periods({ trSince: 0.05, priceSince: 0, sinceYears: 0.5, sinceStart: 'x' })[0]).toMatchObject({ yearly: false, label: 'Since x (6 mo)' });
  });
});

describe('words and return of capital', () => {
  it('rounds shares to plain words', () => {
    expect(shareWords(0.5)).toBe('about half of the payout');
    expect(shareWords(0.3)).toBe('about a third of the payout');
    expect(shareWords(0.97)).toBe('almost all of the payout');
    expect(shareWords(0.03)).toBe('very little');
  });

  it('shows ROC only when entered, never invented', () => {
    expect(rocText(null)).toBeNull();
    expect(rocText(undefined)).toBeNull();
    expect(rocText(0.42, '2025')).toBe('42% of the payouts in 2025 were return of capital (you entered this): not taxed when paid, it lowers your cost basis.');
    expect(notice19aLink('QYLD')).toBe('https://www.sec.gov/edgar/search/#/q=%2219(a)%22%20%22QYLD%22');
  });
});
