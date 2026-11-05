/**
 * Pure pieces behind the Investments page's mini charts (src/invest/rowInteract.ts): range maths, the hover intent
 * timer and the per-series cache. No DOM here, so all of it is tested in miniMath.test.ts.
 */

/** [unix seconds, value] */
export type Point = [number, number];
export type Range = '1M' | '3M' | 'YTD' | '1Y' | '5Y';
export const RANGES: Range[] = ['1M', '3M', 'YTD', '1Y', '5Y'];
/** 'price': change in % (prices, NAVs). 'level': change in percentage points (yields, spreads). */
export type ChangeMode = 'price' | 'level';

const DAY = 86400;

/**
 * Where a range starts, counted back from the newest point. The same cut-offs as the helper's board columns
 * (invest.py `performance`): 30, 91 and 365 days, and the year's first day for YTD.
 */
export function rangeStart(range: Range, end: number): number {
  if (range === '1M') return end - 30 * DAY;
  if (range === '3M') return end - 91 * DAY;
  if (range === '1Y') return end - 365 * DAY;
  if (range === '5Y') return end - Math.round(5 * 365.25) * DAY;
  return Date.UTC(new Date(end * 1000).getUTCFullYear(), 0, 1) / 1000 - 1;
}

/** Points sorted by time with non-finite values dropped (so nothing downstream can print NaN). */
export function cleanPoints(points: readonly Point[]): Point[] {
  return points.filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
}

/**
 * The points of one range: the last point at or before the range's start (the base the change is measured from,
 * like the board columns) and everything after it. `partial` is true when the history starts after the range does.
 */
export function sliceRange(points: readonly Point[], range: Range): { points: Point[]; partial: boolean } {
  if (!points.length) return { points: [], partial: true };
  const start = rangeStart(range, points[points.length - 1][0]);
  let i = points.length - 1;
  while (i > 0 && points[i][0] > start) i--;
  // A week's slack: a 5-year request starts a day or two after the 5Y cut-off, and holidays leave gaps.
  return { points: points.slice(i), partial: points[i][0] > start + 7 * DAY };
}

/** Change from the first to the last point: a fraction for prices, percentage points for levels; null when unknown. */
export function rangeChange(points: readonly Point[], mode: ChangeMode = 'price'): number | null {
  if (points.length < 2) return null;
  const first = points[0][1];
  const last = points[points.length - 1][1];
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  if (mode === 'level') return last - first;
  return first > 0 ? last / first - 1 : null;
}

/** Low, high and where the last value sits between them (0..1), over the 52 weeks before the newest point. */
export function range52(points: readonly Point[]): { low: number; high: number; last: number; position: number | null } | null {
  if (!points.length) return null;
  const end = points[points.length - 1][0];
  const year = points.filter(([t]) => t >= end - 365 * DAY);
  return lowHigh(year);
}

/** Low, high and the last value's position for any run of points. */
export function lowHigh(points: readonly Point[]): { low: number; high: number; last: number; position: number | null } | null {
  if (!points.length) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const [, v] of points) {
    if (v < low) low = v;
    if (v > high) high = v;
  }
  const last = points[points.length - 1][1];
  return { low, high, last, position: high > low ? (last - low) / (high - low) : null };
}

/** Where a value sits in its range, in words (never a bare "100%"). `span`: "52-week", "1-year". */
export function positionWords(position: number, span: string): string {
  if (!Number.isFinite(position)) return '';
  const p = Math.min(1, Math.max(0, position));
  if (p >= 0.98) return `at the top of its ${span} range`;
  if (p <= 0.02) return `at the bottom of its ${span} range`;
  return `${Math.round(p * 100)}% up its ${span} range`;
}

/** Each point as the % change from the first one (for the compare chart). */
export function rebase(points: readonly Point[], mode: ChangeMode = 'price'): Point[] {
  if (!points.length) return [];
  const base = points[0][1];
  if (mode === 'level') return points.map(([t, v]) => [t, v - base]);
  return base > 0 ? points.map(([t, v]) => [t, (v / base - 1) * 100]) : [];
}

/** The range a board's mini charts open on: the period column it's sorted by, else 3 months (its line column). */
export function rangeForColumn(column: string | undefined): Range {
  const c = (column ?? '').toLowerCase();
  if (c.startsWith('1 month')) return '1M';
  if (c.startsWith('ytd')) return 'YTD';
  if (c.startsWith('1 year') || c.startsWith('1y total')) return '1Y';
  return '3M';
}

/** The next or previous range (← / → on a row), staying at the ends. */
export function stepRange(range: Range, by: 1 | -1): Range {
  const i = RANGES.indexOf(range) + by;
  return RANGES[Math.max(0, Math.min(RANGES.length - 1, i))];
}

/** Which data a range needs: about 13 months of daily closes covers up to 1 year; 5 years needs the long series. */
export const needsLong = (range: Range) => range === '5Y';

// ---------- Hover intent ----------

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * Hover intent: `enter(key, fn)` runs fn once the pointer (or focus) has rested on `key` for `delay` ms; moving to
 * another key or `leave()` before then cancels it, so sweeping across rows starts nothing.
 */
export function createIntent(delay: number, timers: Timers = realTimers) {
  let handle: unknown = null;
  let pending: string | null = null;
  const cancel = () => {
    if (handle != null) timers.clear(handle);
    handle = null;
    pending = null;
  };
  return {
    enter(key: string, fn: () => void, ms = delay) {
      if (pending === key) return;
      cancel();
      pending = key;
      handle = timers.set(() => {
        handle = null;
        pending = null;
        fn();
      }, ms);
    },
    leave: cancel,
    get pending() {
      return pending;
    },
  };
}

// ---------- Series cache ----------

/**
 * One fetch per key: a finished value is kept (the oldest dropped past `max`), a fetch on its way is shared by
 * everyone asking, a failure is not kept, and `cancel(key)` aborts a fetch nobody needs any more.
 */
export function createSeriesCache<T>(fetcher: (key: string, signal: AbortSignal) => Promise<T>, max = 80) {
  const done = new Map<string, T>();
  const flying = new Map<string, { promise: Promise<T>; ctrl: AbortController }>();
  return {
    get(key: string): Promise<T> {
      if (done.has(key)) {
        const v = done.get(key)!;
        done.delete(key); // most recently used goes to the back
        done.set(key, v);
        return Promise.resolve(v);
      }
      const f = flying.get(key);
      if (f) return f.promise;
      const ctrl = new AbortController();
      const promise = fetcher(key, ctrl.signal).then(
        (v) => {
          if (flying.get(key)?.ctrl === ctrl) flying.delete(key);
          if (ctrl.signal.aborted) throw abortError();
          done.set(key, v);
          while (done.size > max) done.delete(done.keys().next().value!);
          return v;
        },
        (err) => {
          if (flying.get(key)?.ctrl === ctrl) flying.delete(key);
          throw err;
        },
      );
      flying.set(key, { promise, ctrl });
      return promise;
    },
    peek: (key: string): T | undefined => done.get(key),
    has: (key: string) => done.has(key),
    inFlight: (key: string) => flying.has(key),
    cancel(key: string) {
      const f = flying.get(key);
      if (!f) return;
      flying.delete(key);
      f.ctrl.abort();
    },
    clear() {
      done.clear();
      for (const f of flying.values()) f.ctrl.abort();
      flying.clear();
    },
    get size() {
      return done.size;
    },
  };
}

function abortError() {
  const e = new Error('Cancelled');
  e.name = 'AbortError';
  return e;
}
