/**
 * A fixed OHLCV fixture for the catalog's reference tests: 300 daily bars from a seeded generator (Park-Miller
 * LCG, seed 12345), prices rounded to cents so other tools (TA-Lib, pandas) can reproduce them exactly.
 * Bars open at 09:30 New York (14:30 UTC) starting Tuesday 2 January 2024, one per calendar day.
 */
import type { Bar } from '../../types';

function generate(count: number): Bar[] {
  let seed = 12345;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const round = (v: number) => Math.round(v * 100) / 100;
  const bars: Bar[] = [];
  let close = 100;
  for (let i = 0; i < count; i++) {
    const open = round(close + (rand() - 0.5) * 2);
    close = round(Math.max(1, open + (rand() - 0.48) * 4));
    const high = round(Math.max(open, close) + rand() * 1.5);
    const low = round(Math.min(open, close) - rand() * 1.5);
    const volume = Math.round(1000 + rand() * 9000);
    bars.push({ time: 1704205800 + i * 86400, open, high, low, close, volume });
  }
  return bars;
}

export const FIXTURE: Bar[] = generate(300);
