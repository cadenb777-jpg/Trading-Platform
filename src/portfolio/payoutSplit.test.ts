import { describe, expect, it } from 'vitest';
import { growthOf, overall, splitPayout, splitRead, thin, yearlySplit, type Close, type Payment } from './payoutSplit';

/** Daily closes from `start` for `days` days, price = f(day index). */
function series(start: string, days: number, f: (i: number) => number): Close[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => [new Date(t0 + i * 86400000).toISOString().slice(0, 10), f(i)] as Close);
}

describe('splitPayout', () => {
  it('price fell less than the payout: the drop is the part paid from your money', () => {
    const s = splitPayout(1.4, -0.9);
    expect(s.earned).toBeCloseTo(0.5);
    expect(s.fromPrice).toBeCloseTo(0.9);
    expect(s.fromPriceShare).toBeCloseTo(0.643, 3);
    expect(s.extraLoss).toBe(0);
  });

  it('price rose: all earned', () => {
    expect(splitPayout(1, 0.3)).toEqual({ earned: 1, fromPrice: 0, extraLoss: 0, fromPriceShare: 0 });
  });

  it('price fell more than the payout: all of it from your money, plus an extra loss', () => {
    const s = splitPayout(1, -1.5);
    expect(s).toMatchObject({ earned: 0, fromPrice: 1, fromPriceShare: 1 });
    expect(s.extraLoss).toBeCloseTo(0.5);
  });

  it('no payout', () => {
    expect(splitPayout(0, -2)).toEqual({ earned: 0, fromPrice: 0, extraLoss: 2, fromPriceShare: 0 });
  });
});

describe('yearlySplit', () => {
  // a fund at $20 losing $1 a year, paying $0.15 on the 15th of each month (=$1.80 a year)
  const closes = series('2021-10-01', 5 * 366 + 30, (i) => 20 - i / 365.25);
  const divs: Payment[] = closes.filter(([d]) => d.endsWith('-15')).map(([d]) => [d, 0.15]);

  it('splits each 12-month period, oldest first, up to five', () => {
    const s = yearlySplit(closes, divs);
    expect(s).toHaveLength(5);
    expect(s[0].from < s[4].from).toBe(true);
    for (const y of s) {
      expect(y.payout).toBeCloseTo(1.8, 5);
      expect(y.endPrice - y.startPrice).toBeCloseTo(-1, 1);
      expect(y.fromPrice).toBeCloseTo(1, 1);
      expect(y.earned + y.fromPrice).toBeCloseTo(y.payout, 9);
    }
    expect(overall(s).share).toBeCloseTo(1 / 1.8, 1);
    expect(splitRead(s)).toMatch(/^Over 5 years, about 5[56]¢ of every \$1 paid came from the fund's own price falling\.$/);
  });

  it('a young fund gets as many full years as it has', () => {
    expect(yearlySplit(closes.slice(-800), divs)).toHaveLength(2);
    expect(yearlySplit(closes.slice(-200), divs)).toEqual([]);
    expect(splitRead([])).toBe('Not enough history to split the payouts yet.');
  });

  it('reads covered and fully eroded cases plainly', () => {
    const rising = series('2025-01-01', 400, (i) => 10 + i / 100);
    const paid: Payment[] = [['2025-06-01', 0.5]];
    expect(splitRead(yearlySplit(rising, paid))).toContain('covered');
    const crash = series('2025-01-01', 400, (i) => 10 - i / 50);
    expect(splitRead(yearlySplit(crash, paid))).toContain('every $1 paid came from');
  });
});

describe('growthOf', () => {
  it('reinvests payouts, keeps the price line and adds up cash payouts', () => {
    const closes: Close[] = [['2026-01-01', 10], ['2026-02-01', 10], ['2026-03-01', 8]];
    const g = growthOf(closes, [['2026-01-15', 1]], 10000);
    expect(g[0]).toEqual({ date: '2026-01-01', total: 10000, price: 10000, payouts: 0 });
    // $1 on 1,000 shares reinvested at $10 = 100 more shares
    expect(g[1].total).toBeCloseTo(11000);
    expect(g[1].payouts).toBeCloseTo(1000);
    expect(g[2]).toMatchObject({ price: 8000, payouts: 1000 });
    expect(g[2].total).toBeCloseTo(1100 * 8);
    expect(growthOf([], [])).toEqual([]);
  });

  it('thins long series, keeping both ends', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const t = thin(rows, 100);
    expect(t).toHaveLength(100);
    expect(t[0]).toBe(0);
    expect(t[99]).toBe(999);
    expect(thin([1, 2], 100)).toEqual([1, 2]);
  });
});
