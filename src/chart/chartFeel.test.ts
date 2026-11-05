import { describe, expect, it } from 'vitest';
import { TICK, crosshairLabel, tickLabel, yearMarks } from './axis';
import { daysNeeded, firstIndexFrom, rangeFits, rangeStart } from './range';
import { daySummary, sessionClock, visibleStats } from './summary';
import type { Bar } from '../types';

const utc = (s: string) => Date.parse(`${s}Z`) / 1000;
const bar = (time: number, close: number, high = close + 1, low = close - 1, volume = 100): Bar => ({ time, open: close, high, low, close, volume });

/** Hourly regular-session bars (14:30-20:30 UTC = 9:30-15:30 New York in November) for the given dates. */
function hourly(dates: string[]): number[] {
  return dates.flatMap((d) => [14, 15, 16, 17, 18, 19, 20].map((h) => utc(`${d}T${String(h).padStart(2, '0')}:30:00`)));
}

describe('range bar', () => {
  it('3D on a Monday counts trading days back across the weekend (Thu, Fri, Mon)', () => {
    const times = hourly(['2025-11-05', '2025-11-06', '2025-11-07', '2025-11-10']); // Wed..Mon
    const r = rangeStart('3D', times, 'America/New_York')!;
    expect(r).toEqual({ from: utc('2025-11-06T14:30:00'), covered: true });
  });

  it('1D is the last trading day only', () => {
    const times = hourly(['2025-11-07', '2025-11-10']);
    expect(rangeStart('1D', times, 'America/New_York')!.from).toBe(utc('2025-11-10T14:30:00'));
  });

  it('3D with only two days loaded estimates on the calendar and asks for more', () => {
    const times = hourly(['2025-11-07', '2025-11-10']); // Fri, Mon
    const r = rangeStart('3D', times, 'America/New_York')!;
    expect(r.covered).toBe(false);
    expect(r.from).toBe(utc('2025-11-06T00:00:00')); // Thursday
  });

  it('YTD starts on 1 January of the last bar’s year', () => {
    const times = [utc('2024-12-30T05:00:00'), utc('2024-12-31T05:00:00'), utc('2025-01-02T05:00:00'), utc('2025-03-14T04:00:00')];
    const r = rangeStart('YTD', times)!;
    expect(r.from).toBe(utc('2025-01-01T00:00:00'));
    expect(r.covered).toBe(true);
    expect(firstIndexFrom(times, r.from)).toBe(2);
  });

  it('YTD is not covered when the history starts later in the year', () => {
    expect(rangeStart('YTD', [utc('2025-02-10T05:00:00'), utc('2025-03-14T05:00:00')])!.covered).toBe(false);
  });

  it('months count back on the calendar, clamping the day (31 Mar - 1M = 28 Feb)', () => {
    const times = [utc('2025-01-02T05:00:00'), utc('2025-03-31T04:00:00')];
    expect(rangeStart('1M', times)!.from).toBe(utc('2025-02-28T00:00:00'));
    expect(rangeStart('1Y', times)!.from).toBe(utc('2024-03-31T00:00:00'));
  });

  it('Max starts at the first bar and always asks for everything', () => {
    const times = [utc('2020-01-02T05:00:00'), utc('2025-03-14T04:00:00')];
    expect(rangeStart('MAX', times)).toEqual({ from: times[0], covered: false });
    expect(daysNeeded('MAX', times[1])).toBe(Infinity);
  });

  it('days needed covers the range plus a margin', () => {
    const now = utc('2025-11-10T15:00:00'); // Monday
    expect(daysNeeded('3D', now)).toBeGreaterThanOrEqual(4 + 1);
    expect(daysNeeded('1Y', now)).toBeGreaterThanOrEqual(365);
    expect(daysNeeded('5Y', now)).toBeGreaterThanOrEqual(1826);
  });

  it('offers only ranges that show a few bars at the timeframe', () => {
    expect(rangeFits('1D', '1D')).toBe(false);
    expect(rangeFits('3D', '1D')).toBe(true);
    expect(rangeFits('1D', '15m')).toBe(true);
    expect(rangeFits('1M', '1M')).toBe(false);
    expect(rangeFits('3D', '1W')).toBe(false);
    expect(rangeFits('MAX', '1M')).toBe(true);
  });
});

describe('legend box statistics', () => {
  const bars = [bar(100, 10, 12, 9), bar(200, 20, 25, 18), bar(300, 30, 31, 5), bar(400, 40, 41, 39), bar(500, 50, 99, 1)];

  it('high, low (with dates) and average close over the visible bars only', () => {
    const s = visibleStats(bars, 0.6, 3.4)!; // bars 1..3
    expect(s).toMatchObject({ last: 40, high: 41, highTime: 400, low: 5, lowTime: 300, average: 30, count: 3 });
  });

  it('clamps a range that runs past the data', () => {
    const s = visibleStats(bars, -10, 99)!;
    expect(s).toMatchObject({ last: 50, high: 99, highTime: 500, low: 1, lowTime: 500, average: 30, count: 5 });
  });

  it('is empty when nothing is on screen', () => {
    expect(visibleStats(bars, 5.2, 9)).toBeNull();
    expect(visibleStats([], 0, 10)).toBeNull();
  });
});

describe('header day summary', () => {
  it('intraday: open/high/low/volume of the latest New York day, previous close from the day before', () => {
    const times = hourly(['2025-11-07', '2025-11-10']);
    const bars = times.map((t, i) => bar(t, 100 + i, 100 + i + 2, 100 + i - 2, 10));
    const s = daySummary(bars, '1h', 'America/New_York')!;
    expect(s.open).toBe(107);
    expect(s.high).toBe(115);
    expect(s.low).toBe(105);
    expect(s.prevClose).toBe(106);
    expect(s.last).toBe(113);
    expect(s.change).toBe(7);
    expect(s.volume).toBe(70);
  });

  it('daily: the newest bar against the one before', () => {
    const s = daySummary([bar(utc('2025-11-07T05:00:00'), 50), bar(utc('2025-11-10T05:00:00'), 55, 56, 49, 1000)], '1D')!;
    expect(s).toMatchObject({ open: 55, high: 56, low: 49, prevClose: 50, change: 5, volume: 1000, value: ((56 + 49 + 55) / 3) * 1000 });
    expect(s.changePct).toBeCloseTo(10);
  });
});

describe('header trader figures', () => {
  it('VWAP and relative volume at the same time of day', () => {
    const times = hourly(['2025-11-06', '2025-11-07', '2025-11-10']);
    // earlier days trade 10 per hour; today 20 per hour for the first 3 hours
    const bars = times.slice(0, 17).map((t, i) => bar(t, 100, 101, 99, i >= 14 ? 20 : 10));
    const s = daySummary(bars, '1h', 'America/New_York')!;
    expect(s.relVolume).toBeCloseTo(2);
    expect(s.vwap).toBeCloseTo(100);
  });

  it('session clock for stocks, none for crypto', () => {
    expect(sessionClock(utc('2026-11-05T19:35:00'), 'schwab')).toBe('Closes in 1h 25m'); // 14:35 New York
    expect(sessionClock(utc('2026-11-05T13:00:00'), 'schwab')).toBe('Opens in 1h 30m');
    expect(sessionClock(utc('2026-11-07T15:00:00'), 'schwab')).toBe('Closed'); // Saturday
    expect(sessionClock(utc('2026-11-05T19:35:00'), 'coinbase')).toBeNull();
  });
});

describe('time axis labels', () => {
  const daily = { daily: true };
  const intraday = { daily: false, timeZone: 'America/New_York' };

  it('daily: months as major labels, the year left for the row below', () => {
    expect(tickLabel(utc('2025-01-02T05:00:00'), TICK.Year, daily)).toBe('Jan');
    expect(tickLabel(utc('2025-02-03T05:00:00'), TICK.Month, daily)).toBe('Feb');
    expect(tickLabel(utc('2025-02-10T05:00:00'), TICK.DayOfMonth, daily)).toBe('10');
  });

  it('several years on screen: year boundaries carry the year itself', () => {
    expect(tickLabel(utc('2025-01-02T05:00:00'), TICK.Year, { daily: true, years: true })).toBe('2025');
    expect(tickLabel(utc('2025-02-03T05:00:00'), TICK.Month, { daily: true, years: true })).toBe('Feb');
  });

  it('daily bars stamped near midnight in New York read as their own UTC date', () => {
    expect(tickLabel(utc('2025-03-01T05:00:00'), TICK.Month, daily)).toBe('Mar');
  });

  it('intraday: the day as the major label, 24-hour times between, in the chosen zone', () => {
    expect(tickLabel(utc('2025-11-10T14:30:00'), TICK.DayOfMonth, intraday)).toBe('Nov 10');
    expect(tickLabel(utc('2025-11-10T15:30:00'), TICK.Time, intraday)).toBe('10:30');
    expect(tickLabel(utc('2026-01-02T14:30:00'), TICK.Year, intraday)).toBe('Jan 2');
  });

  it('crosshair label carries the full date', () => {
    expect(crosshairLabel(utc('2025-11-10T05:00:00'), daily)).toBe('Mon 10 Nov 2025');
    expect(crosshairLabel(utc('2026-11-05T19:35:00'), intraday)).toBe('Thu 05 Nov 14:35');
  });

  it('year row: the first visible bar, then the first bar of each new year (rollover)', () => {
    const times = ['2024-12-27', '2024-12-30', '2024-12-31', '2025-01-02', '2025-01-03', '2026-01-02'].map((d) => utc(`${d}T05:00:00`));
    expect(yearMarks(times, 0.4, 5, daily)).toEqual([
      { index: 1, year: 2024, edge: true },
      { index: 3, year: 2025, edge: false },
      { index: 5, year: 2026, edge: false },
    ]);
  });

  it('year row intraday: New Year is read in the axis zone, not UTC', () => {
    // 31 Dec 19:30 New York is already 1 Jan in UTC: still 2025 on a New York axis.
    const times = [utc('2025-12-31T23:30:00'), utc('2026-01-01T00:30:00'), utc('2026-01-02T14:30:00')];
    expect(yearMarks(times, 0, 2, intraday).map((m) => [m.index, m.year])).toEqual([
      [0, 2025],
      [2, 2026],
    ]);
  });
});
