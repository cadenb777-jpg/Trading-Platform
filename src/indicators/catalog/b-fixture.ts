/**
 * The momentum family's copy of the shared catalog fixture (the same bars as catalog/fixture-ohlcv.ts on the
 * feat/ind-d branch; once both are merged this file can simply re-export that one).
 *
 * mulberry32 seed 42, 300 daily bars, starting price 100. Per bar four draws r1..r4 in order:
 *   open = previous close, close = open x (1 + (r1 - 0.5) x 0.04), high = max(open, close) x (1 + r2 x 0.01),
 *   low = min(open, close) x (1 - r3 x 0.01), volume = 1e6 x (0.5 + r4), time = 1700000000 + i x 86400;
 * every value rounded to 4 decimals as soon as it is made.
 */
import type { Bar } from '../../types';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

function generate(count: number): Bar[] {
  const rand = mulberry32(42);
  const bars: Bar[] = [];
  let prevClose = 100;
  for (let i = 0; i < count; i++) {
    const r1 = rand();
    const r2 = rand();
    const r3 = rand();
    const r4 = rand();
    const open = prevClose;
    const close = round4(open * (1 + (r1 - 0.5) * 0.04));
    const high = round4(Math.max(open, close) * (1 + r2 * 0.01));
    const low = round4(Math.min(open, close) * (1 - r3 * 0.01));
    const volume = round4(1e6 * (0.5 + r4));
    bars.push({ time: 1700000000 + i * 86400, open, high, low, close, volume });
    prevClose = close;
  }
  return bars;
}

export const FIXTURE: Bar[] = generate(300);
