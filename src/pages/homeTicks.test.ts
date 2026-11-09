import { describe, expect, it } from 'vitest';
import { TickMarkType } from 'lightweight-charts';
import { cardBars, cardTick, CARD_RANGES, type CardRange } from './homePage';
import type { Bar } from '../types';

// 2026-10-27 14:30 UTC = Tue 10:30 in New York (EDT).
const t = Date.UTC(2026, 9, 27, 14, 30) / 1000;
const ALL: CardRange[] = ['1m', '5m', '1D', '1M'];

describe('index card axis labels', () => {
  it('shows short times on the 1-minute and 5-minute views', () => {
    expect(cardTick(t, TickMarkType.Time, '1m')).toBe('10:30');
    expect(cardTick(t, TickMarkType.Time, '5m')).toBe('10:30');
  });
  it('shows dates on the daily view', () => expect(cardTick(Date.UTC(2026, 9, 27) / 1000, TickMarkType.DayOfMonth, '1D')).toBe('Oct 27'));
  it('shows months, and the year where one starts, on the monthly view', () => {
    expect(cardTick(Date.UTC(2026, 9, 1) / 1000, TickMarkType.Month, '1M')).toBe('Oct');
    expect(cardTick(Date.UTC(2026, 0, 1) / 1000, TickMarkType.Year, '1M')).toBe('2026');
  });
  it('keeps every label short enough for the small cards', () => {
    for (const r of ALL) for (const k of [TickMarkType.Year, TickMarkType.Month, TickMarkType.DayOfMonth, TickMarkType.Time]) expect(cardTick(t, k, r).length).toBeLessThanOrEqual(6);
  });
});

describe('index card candle sizes', () => {
  const bar = (time: number): Bar => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });
  // two New York sessions of 1-minute bars (9:30-16:00 = 390 bars each), a day apart
  const day1 = Date.UTC(2026, 9, 26, 13, 30) / 1000;
  const day2 = Date.UTC(2026, 9, 27, 13, 30) / 1000;
  const minutes = [...Array(390).keys()].flatMap((i) => [bar(day1 + i * 60), bar(day2 + i * 60)]).sort((a, b) => a.time - b.time);

  it('offers exactly 1 minute, 5 minutes, 1 day and 1 month', () => expect(Object.keys(CARD_RANGES)).toEqual(ALL));
  it('1 minute: the last two hours of the latest session', () => {
    const out = cardBars(minutes, '1m');
    expect(out).toHaveLength(120);
    expect(out[0].time).toBe(day2 + 270 * 60);
  });
  it('5 minutes: the whole latest session', () => expect(cardBars(minutes, '5m').every((b) => b.time >= day2)).toBe(true));
  it('daily and monthly: the newest candles', () => {
    const days = [...Array(300).keys()].map((i) => bar(day1 - i * 86400)).reverse();
    expect(cardBars(days, '1D')).toHaveLength(66);
    expect(cardBars(days, '1M')).toHaveLength(60);
  });
});
