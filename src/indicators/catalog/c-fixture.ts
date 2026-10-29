/**
 * The trend/volatility/statistics family's reference fixture: 300 daily bars from mulberry32 (seed 42).
 * Per bar four consecutive draws r1..r4: open = previous close (first open 100), close = open*(1+(r1-0.5)*0.04),
 * high = max(open, close)*(1+r2*0.01), low = min(open, close)*(1-r3*0.01), volume = 1e6*(0.5+r4),
 * time = 1700000000 + i*86400; every value is rounded to 4 decimals (the rounded close is the next open).
 */
import type { Bar } from '../../types';

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export function fixtureBars(count = 300, seed = 42): Bar[] {
  const rand = mulberry32(seed);
  const bars: Bar[] = [];
  let prev = 100;
  for (let i = 0; i < count; i++) {
    const r1 = rand();
    const r2 = rand();
    const r3 = rand();
    const r4 = rand();
    const open = prev;
    const close = round4(open * (1 + (r1 - 0.5) * 0.04));
    const high = round4(Math.max(open, close) * (1 + r2 * 0.01));
    const low = round4(Math.min(open, close) * (1 - r3 * 0.01));
    const volume = round4(1e6 * (0.5 + r4));
    bars.push({ time: 1700000000 + i * 86400, open, high, low, close, volume });
    prev = close;
  }
  return bars;
}

export const FIXTURE: Bar[] = fixtureBars();
