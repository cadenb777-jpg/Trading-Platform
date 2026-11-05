import { afterEach, describe, expect, it, vi } from 'vitest';
import { positionWords, cleanPoints, createIntent, createSeriesCache, lowHigh, range52, rangeChange, rangeForColumn, rangeStart, rebase, sliceRange, stepRange, type Point } from './miniMath';

const DAY = 86400;
const END = Date.UTC(2026, 10, 4) / 1000; // 4 Nov 2026
/** One point a day for `days` days ending at END, value = 100 + index. */
const daily = (days: number): Point[] => Array.from({ length: days }, (_, i) => [END - (days - 1 - i) * DAY, 100 + i]);

describe('range maths', () => {
  it('starts each range where the board columns do', () => {
    expect(rangeStart('1M', END)).toBe(END - 30 * DAY);
    expect(rangeStart('3M', END)).toBe(END - 91 * DAY);
    expect(rangeStart('1Y', END)).toBe(END - 365 * DAY);
    expect(rangeStart('YTD', END)).toBe(Date.UTC(2026, 0, 1) / 1000 - 1);
    expect(rangeStart('5Y', END)).toBe(END - 1826 * DAY);
  });

  it('slices from the last point at or before the start (the base of the change)', () => {
    const pts = daily(400);
    const { points, partial } = sliceRange(pts, '1M');
    expect(partial).toBe(false);
    expect(points[0][0]).toBe(END - 30 * DAY);
    expect(points.length).toBe(31);
    expect(rangeChange(points)).toBeCloseTo(499 / 469 - 1, 10);
  });

  it('uses the newest point before the start when the start falls on a gap (weekend)', () => {
    const pts: Point[] = [[END - 40 * DAY, 50], [END - 33 * DAY, 80], [END - 20 * DAY, 90], [END, 100]];
    const { points } = sliceRange(pts, '1M');
    expect(points[0]).toEqual([END - 33 * DAY, 80]);
    expect(rangeChange(points)).toBeCloseTo(0.25, 10);
  });

  it('marks a range longer than the history as partial', () => {
    const { points, partial } = sliceRange(daily(100), '1Y');
    expect(partial).toBe(true);
    expect(points.length).toBe(100);
    expect(sliceRange([], '1M')).toEqual({ points: [], partial: true });
  });

  it('a 5-year history that starts a few days after the cut-off still counts as 5 years', () => {
    const pts: Point[] = [[END - 1825 * DAY, 50], [END, 100]];
    expect(sliceRange(pts, '5Y').partial).toBe(false);
    expect(sliceRange([[END - 1800 * DAY, 50], [END, 100]], '5Y').partial).toBe(true);
  });

  it('YTD starts at the last close of the year before', () => {
    const pts: Point[] = [[Date.UTC(2025, 11, 30) / 1000, 80], [Date.UTC(2025, 11, 31) / 1000, 90], [Date.UTC(2026, 0, 2) / 1000, 95], [END, 99]];
    const { points } = sliceRange(pts, 'YTD');
    expect(points[0][1]).toBe(90);
    expect(rangeChange(points)).toBeCloseTo(0.1, 10);
  });

  it('change is a fraction for prices and percentage points for yields; null when it cannot be known', () => {
    expect(rangeChange([[0, 4.1], [1, 4.35]], 'level')).toBeCloseTo(0.25, 10);
    expect(rangeChange([[0, 50], [1, 75]])).toBeCloseTo(0.5, 10);
    expect(rangeChange([[0, 50]])).toBeNull();
    expect(rangeChange([[0, 0], [1, 5]])).toBeNull();
    expect(rangeChange([[0, NaN], [1, 5]])).toBeNull();
  });

  it('52-week range covers only the last 365 days and places the last value', () => {
    const pts: Point[] = [[END - 400 * DAY, 10], [END - 300 * DAY, 40], [END - 100 * DAY, 20], [END, 30]];
    expect(range52(pts)).toEqual({ low: 20, high: 40, last: 30, position: 0.5 });
    expect(range52([])).toBeNull();
    expect(lowHigh([[0, 5], [1, 5]])).toEqual({ low: 5, high: 5, last: 5, position: null });
  });

  it('drops non-finite points and sorts by time', () => {
    expect(cleanPoints([[3, 1], [1, NaN], [2, 4], [NaN, 3]])).toEqual([[2, 4], [3, 1]]);
  });

  it('rebases to % change from the first point (or points for levels)', () => {
    expect(rebase([[0, 50], [1, 55], [2, 45]])).toEqual([[0, 0], [1, 10.000000000000009], [2, -10.000000000000009]].map(([t, v]) => [t, expect.closeTo(v, 9)]));
    expect(rebase([[0, 4], [1, 4.5]], 'level')).toEqual([[0, 0], [1, 0.5]]);
    expect(rebase([[0, 0], [1, 1]])).toEqual([]);
  });

  it('picks the range from the sorted column and steps through ranges', () => {
    expect(rangeForColumn('1 month')).toBe('1M');
    expect(rangeForColumn('YTD')).toBe('YTD');
    expect(rangeForColumn('1 year')).toBe('1Y');
    expect(rangeForColumn('1Y total')).toBe('1Y');
    expect(rangeForColumn('Price')).toBe('3M');
    expect(rangeForColumn(undefined)).toBe('3M');
    expect(stepRange('1M', -1)).toBe('1M');
    expect(stepRange('1M', 1)).toBe('3M');
    expect(stepRange('5Y', 1)).toBe('5Y');
  });
});

describe('range position in words', () => {
  it('says top and bottom instead of 100% and 0%', () => {
    expect(positionWords(1, '1-year')).toBe('at the top of its 1-year range');
    expect(positionWords(0.99, '52-week')).toBe('at the top of its 52-week range');
    expect(positionWords(0, '52-week')).toBe('at the bottom of its 52-week range');
    expect(positionWords(0.4, '52-week')).toBe('40% up its 52-week range');
    expect(positionWords(NaN, '52-week')).toBe('');
  });
});

describe('hover intent', () => {
  afterEach(() => vi.useRealTimers());

  it('fires only after resting on one row for the delay', () => {
    vi.useFakeTimers();
    const intent = createIntent(150);
    const fired: string[] = [];
    // sweep across 10 rows, 30 ms each: nothing fires
    for (let i = 0; i < 10; i++) {
      intent.enter(`r${i}`, () => fired.push(`r${i}`));
      vi.advanceTimersByTime(30);
    }
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(fired).toEqual(['r9']);
  });

  it('re-entering the same row does not restart the timer; leave cancels', () => {
    vi.useFakeTimers();
    const intent = createIntent(150);
    const fired: string[] = [];
    intent.enter('a', () => fired.push('a'));
    vi.advanceTimersByTime(100);
    intent.enter('a', () => fired.push('a2'));
    vi.advanceTimersByTime(60);
    expect(fired).toEqual(['a']);
    intent.enter('b', () => fired.push('b'));
    intent.leave();
    vi.advanceTimersByTime(500);
    expect(fired).toEqual(['a']);
    expect(intent.pending).toBeNull();
  });
});

describe('series cache', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
    return { promise, resolve, reject };
  };

  it('shares one fetch between callers and keeps the value', async () => {
    const calls: string[] = [];
    const cache = createSeriesCache(async (key) => (calls.push(key), [key]));
    const [a, b] = await Promise.all([cache.get('AAPL'), cache.get('AAPL')]);
    expect(a).toBe(b);
    await cache.get('AAPL');
    expect(calls).toEqual(['AAPL']);
    expect(cache.peek('AAPL')).toEqual(['AAPL']);
  });

  it('does not keep failures', async () => {
    let n = 0;
    const cache = createSeriesCache(async () => {
      if (n++ === 0) throw new Error('down');
      return 'ok';
    });
    await expect(cache.get('X')).rejects.toThrow('down');
    await expect(cache.get('X')).resolves.toBe('ok');
    expect(n).toBe(2);
  });

  it('cancel aborts the fetch, rejects its waiters and keeps nothing', async () => {
    const d = deferred<string>();
    let signal: AbortSignal | undefined;
    const cache = createSeriesCache((_k, s) => ((signal = s), d.promise));
    const p = cache.get('X');
    expect(cache.inFlight('X')).toBe(true);
    cache.cancel('X');
    expect(signal?.aborted).toBe(true);
    d.resolve('late');
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(cache.has('X')).toBe(false);
    expect(cache.inFlight('X')).toBe(false);
  });

  it('evicts the least recently used past max', async () => {
    const cache = createSeriesCache(async (k) => k, 2);
    await cache.get('a');
    await cache.get('b');
    await cache.get('a'); // a is now newest
    await cache.get('c');
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.size).toBe(2);
  });
});
