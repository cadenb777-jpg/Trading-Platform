/**
 * Building blocks for indicators. Every function returns an array the same length as its
 * input, with NaN where there isn't enough data yet ("warm-up" period).
 */

/** Runs `fn` on the part of `src` after any leading NaNs, then pads the result back to full length. */
function onValid(src: number[], fn: (values: number[]) => number[]): number[] {
  const start = src.findIndex((v) => !Number.isNaN(v));
  if (start === -1) return src.map(() => NaN);
  return [...new Array<number>(start).fill(NaN), ...fn(src.slice(start))];
}

export function sma(src: number[], length: number): number[] {
  return onValid(src, (values) => {
    const out = new Array<number>(values.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= length) sum -= values[i - length];
      if (i >= length - 1) out[i] = sum / length;
    }
    return out;
  });
}

/** Exponential moving average with a given smoothing factor, seeded with the SMA of the first `length` values. */
function smoothed(src: number[], length: number, alpha: number): number[] {
  return onValid(src, (values) => {
    const out = new Array<number>(values.length).fill(NaN);
    if (values.length < length) return out;
    let prev = values.slice(0, length).reduce((a, b) => a + b, 0) / length;
    out[length - 1] = prev;
    for (let i = length; i < values.length; i++) {
      prev = alpha * values[i] + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  });
}

export function ema(src: number[], length: number): number[] {
  return smoothed(src, length, 2 / (length + 1));
}

/** Wilder's moving average (used by RSI and ATR). */
export function rma(src: number[], length: number): number[] {
  return smoothed(src, length, 1 / length);
}

export function wma(src: number[], length: number): number[] {
  return onValid(src, (values) => {
    const out = new Array<number>(values.length).fill(NaN);
    const denom = (length * (length + 1)) / 2;
    for (let i = length - 1; i < values.length; i++) {
      let sum = 0;
      for (let j = 0; j < length; j++) sum += values[i - j] * (length - j);
      out[i] = sum / denom;
    }
    return out;
  });
}

/** Population standard deviation over a rolling window (matches TradingView's Bollinger Bands). */
export function stdev(src: number[], length: number): number[] {
  const mean = sma(src, length);
  return src.map((_, i) => {
    if (Number.isNaN(mean[i])) return NaN;
    let sq = 0;
    for (let j = i - length + 1; j <= i; j++) sq += (src[j] - mean[i]) ** 2;
    return Math.sqrt(sq / length);
  });
}

/**
 * Rolling maximum (or minimum) of the last `length` values in one pass: a queue keeps only the values that
 * can still become the extreme, so each value is added and removed once (O(n) instead of O(n x length)).
 * A NaN anywhere in the window gives NaN, like Math.max/Math.min.
 */
function rollingExtreme(src: number[], length: number, max: boolean): number[] {
  const n = src.length;
  const out = new Array<number>(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let lastNaN = -1;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (Number.isNaN(v)) lastNaN = i;
    else {
      while (tail > head && (max ? src[queue[tail - 1]] <= v : src[queue[tail - 1]] >= v)) tail--;
      queue[tail++] = i;
    }
    const first = i - length + 1;
    while (head < tail && queue[head] < first) head++;
    out[i] = first < 0 || lastNaN >= first ? NaN : src[queue[head]];
  }
  return out;
}

export function highest(src: number[], length: number): number[] {
  if (Number.isInteger(length) && length >= 1) return rollingExtreme(src, length, true);
  return src.map((_, i) => (i < length - 1 ? NaN : Math.max(...src.slice(i - length + 1, i + 1))));
}

export function lowest(src: number[], length: number): number[] {
  if (Number.isInteger(length) && length >= 1) return rollingExtreme(src, length, false);
  return src.map((_, i) => (i < length - 1 ? NaN : Math.min(...src.slice(i - length + 1, i + 1))));
}

export function rsi(src: number[], length: number): number[] {
  const change = src.map((v, i) => (i === 0 ? NaN : v - src[i - 1]));
  const gain = rma(change.map((c) => (Number.isNaN(c) ? NaN : Math.max(c, 0))), length);
  const loss = rma(change.map((c) => (Number.isNaN(c) ? NaN : Math.max(-c, 0))), length);
  return gain.map((g, i) => {
    const l = loss[i];
    if (Number.isNaN(g) || Number.isNaN(l)) return NaN;
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  });
}

export function trueRange(high: number[], low: number[], close: number[]): number[] {
  return high.map((h, i) =>
    i === 0 ? h - low[i] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1])),
  );
}
