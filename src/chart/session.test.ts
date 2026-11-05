import { describe, expect, it } from 'vitest';
import { cleanBars } from '../types';
import { isRegularHours, sessionGuides } from './session';

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

describe('sessionGuides', () => {
  // 30-minute bars from 08:00 to 19:30 New York (EDT, UTC-4) on the given dates; open = time-of-day marker.
  const day = (date: string, from = '12:00', to = '23:30') => {
    const out: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
    for (let s = t(`${date}T${from}:00Z`); s <= t(`${date}T${to}:00Z`); s += 1800) {
      const label = Number(date.slice(8, 10)) * 100 + new Date(s * 1000).getUTCHours();
      out.push({ time: s, open: label, high: label + 1, low: label - 1, close: label + 0.5, volume: 1 });
    }
    return out;
  };
  const guides = (bars: ReturnType<typeof day>) => sessionGuides((i) => bars[i], bars.length);
  // Tue 20 Oct 2026 .. Fri 23 Oct; regular hours 13:30-20:00 UTC: first regular bar 13:30 (open label d*100+13),
  // last regular bar 19:30 (close label d*100+19.5).

  it('during the session: today open and yesterday close', () => {
    const bars = [...day('2026-10-21'), ...day('2026-10-22', '12:00', '15:00')];
    expect(guides(bars)).toEqual({ todayOpen: 2213, prevClose: 2119.5 });
  });

  it('pre-market: no open yet, prev close = the last regular close', () => {
    const bars = [...day('2026-10-21'), ...day('2026-10-22', '12:00', '13:00')];
    expect(guides(bars)).toEqual({ todayOpen: null, prevClose: 2119.5 });
  });

  it('Saturday (bars end with Friday after-hours): Friday open, Thursday close', () => {
    const bars = [...day('2026-10-22'), ...day('2026-10-23')];
    expect(guides(bars)).toEqual({ todayOpen: 2313, prevClose: 2219.5 });
  });

  it('after a holiday-like gap: pre-market shows the last session before the gap', () => {
    const bars = [...day('2026-10-20'), ...day('2026-10-22', '12:00', '13:00')]; // the 21st missing
    expect(guides(bars)).toEqual({ todayOpen: null, prevClose: 2019.5 });
  });

  it('empty', () => {
    expect(guides([])).toEqual({ todayOpen: null, prevClose: null });
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
