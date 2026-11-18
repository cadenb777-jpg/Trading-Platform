import { describe, expect, it } from 'vitest';
import { ratingMonths, ratingWords, surpriseWords, type Surprise, type Trend } from './analysts';

const t = (period: string, sb: number, b: number, hd: number, s: number, ss: number): Trend => ({ period, strongBuy: sb, buy: b, hold: hd, sell: s, strongSell: ss, total: sb + b + hd + s + ss, consensus: 'Buy' });

describe('analyst ratings', () => {
  it('orders months oldest first and folds strong ratings in', () => {
    const m = ratingMonths([t('2026-11-01', 10, 20, 8, 1, 1), t('2026-08-01', 5, 15, 15, 3, 2)]);
    expect(m.map((x) => x.period)).toEqual(['2026-08-01', '2026-11-01']);
    expect(m[1]).toEqual({ period: '2026-11-01', buy: 0.75, hold: 0.2, sell: 0.05, total: 40 });
  });
  it('says which way analysts moved', () => {
    expect(ratingWords([t('2026-11-01', 10, 20, 8, 1, 1), t('2026-08-01', 5, 15, 15, 3, 2)])).toBe(
      '75% of 40 analysts say buy, 20% hold, 5% sell. More positive than 2 months ago (buy share up 25 points).',
    );
    expect(ratingWords([t('2026-11-01', 0, 10, 10, 0, 0)])).toBe('50% of 20 analysts say buy, 50% hold, 0% sell.');
    expect(ratingWords([])).toBe('');
  });
});

describe('earnings surprises', () => {
  const q = (period: string, actual: number, estimate: number | null): Surprise => ({ period, actual, estimate, surprise: estimate == null ? null : actual - estimate, surprisePct: estimate ? (actual - estimate) / Math.abs(estimate) : null });
  it('counts beats and misses, newest first', () => {
    expect(surpriseWords([q('2026-09-30', 1.1, 1.0), q('2026-06-30', 0.9, 1.0), q('2026-03-31', 1.2, 1.0)])).toBe(
      'Beat the estimate in 2 of the last 3 quarters, missed 1 (average surprise +6.7%). Latest quarter beat.',
    );
    expect(surpriseWords([q('2026-09-30', 1, null)])).toBe('');
  });
});
