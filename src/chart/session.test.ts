import { describe, expect, it } from 'vitest';
import { cleanBars } from '../types';
import { isRegularHours } from './session';

const t = (iso: string) => Date.parse(iso) / 1000;

describe('isRegularHours', () => {
  it('knows the regular session in New York time (summer and winter)', () => {
    expect(isRegularHours(t('2026-10-22T13:30:00Z'))).toBe(true); // 9:30 EDT
    expect(isRegularHours(t('2026-10-22T13:25:00Z'))).toBe(false); // 9:25 pre-market
    expect(isRegularHours(t('2026-10-22T19:55:00Z'))).toBe(true); // 15:55
    expect(isRegularHours(t('2026-10-22T20:00:00Z'))).toBe(false); // 16:00 after-hours
    expect(isRegularHours(t('2026-12-15T14:30:00Z'))).toBe(true); // 9:30 EST
    expect(isRegularHours(t('2026-12-15T14:00:00Z'))).toBe(false); // 9:00 EST
    expect(isRegularHours(t('2026-10-24T15:00:00Z'))).toBe(false); // Saturday
  });
});

describe('cleanBars', () => {
  it('sorts, merges duplicate times and drops bars with missing prices', () => {
    const bar = (time: number, close: number) => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 10 });
    const bad = { time: 400, open: NaN, high: 1, low: 1, close: 1, volume: 1 };
    const out = cleanBars([bar(300, 3), bar(100, 1), bar(200, 2), bar(200, 2.5), bad as never]);
    expect(out.map((b) => b.time)).toEqual([100, 200, 300]);
    expect(out[1]).toMatchObject({ close: 2.5, high: 3.5, low: 1, volume: 20 });
  });
});
