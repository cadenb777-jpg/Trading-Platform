import { describe, expect, it } from 'vitest';
import { crosshairLabel } from './axis';
import { DAILY_LEVELS, INTRADAY_LEVELS, boundaries, chooseLevel, gridLabel, priceTickSpan, yearRow } from './grid';
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
  it('relative volume lines days up by New York clock time', () => {
    // earlier days trade 10 per hour from 09:30; today 20 per hour for its first 3 bars
    const times = hourly(['2025-11-06', '2025-11-07', '2025-11-10']);
    const bars = times.slice(0, 17).map((t, i) => bar(t, 100, 101, 99, i >= 14 ? 20 : 10));
    expect(daySummary(bars, '1h', 'America/New_York')!.relVolume).toBeCloseTo(2);
  });

  it('relative volume compares the same clock time even when an earlier day started earlier (pre-market)', () => {
    // yesterday has a 08:30 pre-market bar of 50; up to 10:30 New York it traded 50 + 10 + 10
    const pre = utc('2025-11-07T13:30:00');
    const yesterday = [pre, ...hourly(['2025-11-07'])].map((t) => bar(t, 100, 101, 99, t === pre ? 50 : 10));
    const today = hourly(['2025-11-10']).slice(0, 2).map((t) => bar(t, 100, 101, 99, 35)); // 09:30 and 10:30
    expect(daySummary([...yesterday, ...today], '1h', 'America/New_York')!.relVolume).toBeCloseTo(70 / 70);
  });

  it('VWAP is anchored at the 09:30 open, the pre-market VWAP is apart, and none above 1-hour bars', () => {
    const pre = bar(utc('2025-11-10T13:00:00'), 50, 50, 50, 100); // 08:00 New York
    const regular = [bar(utc('2025-11-10T14:30:00'), 100, 100, 100, 10), bar(utc('2025-11-10T15:30:00'), 110, 110, 110, 30)];
    const s = daySummary([pre, ...regular], '1h', 'America/New_York')!;
    expect(s.vwap).toBeCloseTo(107.5);
    expect(s.preVwap).toBeCloseTo(50);
    expect(daySummary([pre, ...regular], '4h', 'America/New_York')!.vwap).toBeNull();
    expect(daySummary([bar(utc('2025-11-10T05:00:00'), 50)], '1D')!.vwap).toBeNull();
  });

  it('session clock for stocks, none for crypto', () => {
    expect(sessionClock(utc('2026-11-05T19:35:00'), 'schwab')).toBe('Closes in 1h 25m'); // 14:35 New York
    expect(sessionClock(utc('2026-11-05T13:00:00'), 'schwab')).toBe('Opens in 1h 30m');
    expect(sessionClock(utc('2026-11-07T15:00:00'), 'schwab')).toBe('Closed'); // Saturday
    expect(sessionClock(utc('2026-11-05T19:35:00'), 'coinbase')).toBeNull();
  });

  it('NYSE holidays and 13:00 early closes', () => {
    expect(sessionClock(utc('2026-11-26T16:00:00'), 'schwab')).toBe('Market closed (holiday)'); // Thanksgiving
    expect(sessionClock(utc('2026-11-27T17:15:00'), 'schwab')).toBe('Closes 1:00 PM in 45m'); // 12:15 New York
    expect(sessionClock(utc('2026-11-27T18:30:00'), 'schwab')).toBe('Closed'); // 13:30
    expect(sessionClock(utc('2027-03-26T15:00:00'), 'schwab')).toBe('Market closed (holiday)'); // Good Friday
  });
});

describe('crosshair label', () => {
  it('carries the full date, trader style', () => {
    expect(crosshairLabel(utc('2025-11-10T05:00:00'), { daily: true })).toBe('Mon 10 Nov 2025');
    expect(crosshairLabel(utc('2026-11-05T19:35:00'), { daily: false, timeZone: 'America/New_York' })).toBe('Thu 05 Nov 2:35 PM');
  });
});

describe('square grid', () => {
  it('price steps match the chart library’s label steps', () => {
    expect(priceTickSpan(238.5, 229.5, 470, 22, 100)).toBe(0.5);
    expect(priceTickSpan(238.5, 229.5, 470, 36, 100)).toBe(1);
    expect(priceTickSpan(68000, 66000, 400, 36, 100)).toBe(200);
  });

  const days = (from: string, n: number) => {
    const out: number[] = [];
    for (let t = utc(`${from}T05:00:00`); out.length < n; t += 86400) {
      const wd = new Date(t * 1000).getUTCDay();
      if (wd !== 0 && wd !== 6) out.push(t);
    }
    return out;
  };

  it('picks the calendar level whose spacing is closest to the price-line spacing (square cells)', () => {
    const times = days('2024-01-02', 500);
    expect(chooseLevel(times, 0, 499, 4, 70, DAILY_LEVELS, 'utc')!.level).toBe('month'); // ~84 px apart
    expect(chooseLevel(times, 0, 499, 4, 230, DAILY_LEVELS, 'utc')!.level).toBe('quarter');
    expect(chooseLevel(times, 0, 499, 20, 90, DAILY_LEVELS, 'utc')!.level).toBe('week'); // 5 bars x 20 px
    const fiveMin = Array.from({ length: 78 * 3 }, (_, i) => utc('2025-11-05T14:30:00') + Math.floor(i / 78) * 86400 + (i % 78) * 300);
    expect(chooseLevel(fiveMin, 0, fiveMin.length - 1, 6, 70, INTRADAY_LEVELS, 'utc')!.level).toBe('h1'); // 12 bars x 6 px
  });

  it('vertical lines sit on the first bar of each period', () => {
    const times = days('2024-12-27', 7); // Fri 27, Mon 30, Tue 31, Wed 1 Jan, Thu 2, Fri 3, Mon 6
    expect(boundaries(times, 0, 6, 'year', 'utc')).toEqual([3]);
    expect(boundaries(times, 0, 6, 'week', 'utc')).toEqual([1, 6]);
  });

  it('labels: years, months, dates and clock times', () => {
    expect(gridLabel(utc('2025-01-02T05:00:00'), 'year', 'utc')).toBe('2025');
    expect(gridLabel(utc('2025-02-03T05:00:00'), 'month', 'utc')).toBe('Feb');
    expect(gridLabel(utc('2025-11-10T05:00:00'), 'week', 'utc')).toBe('Nov 10');
    expect(gridLabel(utc('2025-11-10T14:00:00'), 'h1', 'utc')).toBe('2:00 PM');
  });

  it('year row: under the first label, then under the first label of each new year (rollover)', () => {
    const labels = ['2024-12-02', '2025-01-02', '2025-02-03', '2026-01-02'].map((d) => utc(`${d}T05:00:00`));
    expect(yearRow(labels, 'utc')).toEqual([
      { at: 0, year: 2024 },
      { at: 1, year: 2025 },
      { at: 3, year: 2026 },
    ]);
  });
});

import { chooseStep, stepCandidates } from './grid';
import { timeframeFor } from './range';
describe('uniform grid columns', () => {
  it('natural bar counts per timeframe', () => {
    expect(stepCandidates(300)).toContain(6); // 30 minutes of 5m bars
    expect(stepCandidates(300)).toContain(12); // an hour
    expect(stepCandidates(86400)).toEqual(expect.arrayContaining([5, 21, 63, 252]));
    expect(stepCandidates(7 * 86400)).toContain(52);
  });
  it('picks the count that makes square cells', () => {
    expect(chooseStep(86400, 4, 80)).toBe(21); // 4 px a day, 80 px rows -> a month (84 px)
    expect(chooseStep(300, 10, 60)).toBe(6); // 10 px per 5m bar, 60 px rows -> 30 minutes
  });
  it('ranges read on their natural timeframe', () => {
    expect(timeframeFor('1Y')).toBe('1D');
    expect(timeframeFor('1D')).toBe('5m');
  });
});
