import { describe, expect, it } from 'vitest';
import type { Bar } from '../../types';
import { alignExternal } from '../external';
import { getIndicator } from '../library';
import { INDICATOR_PRESETS, presetDefs } from '../presets';
import { THIRTEEN_F_DELAY_DAYS, barForDay, insiderSeries, proGo, sentimentPoints, vixFix, williamsPatterns } from './smartMoney';

const DAY = 86400;
const T0 = Date.UTC(2024, 0, 1) / 1000;
/** Daily bars from [open, high, low, close] tuples, one day apart from 2024-01-01. */
const bars = (rows: [number, number, number, number][]): Bar[] => rows.map(([open, high, low, close], i) => ({ time: T0 + i * DAY, open, high, low, close, volume: 1000 }));
const fired = (values: number[]) => values.flatMap((v, i) => (v ? [i] : []));

describe('Williams Pro Go', () => {
  it('averages open − previous close (public) and close − open (pros)', () => {
    const b = bars([
      [10, 11, 9, 10],
      [11, 12, 10, 12], // public +1, pros +1
      [11, 13, 10, 13], // public −1, pros +2
      [14, 15, 12, 12], // public +1, pros −2
    ]);
    const r = proGo(b, 2);
    expect(r.public.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(r.public[2]).toBeCloseTo(0);
    expect(r.public[3]).toBeCloseTo(0);
    expect(r.pros[1]).toBeCloseTo(0.5);
    expect(r.pros[2]).toBeCloseTo(1.5);
    expect(r.pros[3]).toBeCloseTo(0);
    expect(r.diff[2]).toBeCloseTo(1.5);
  });
});

describe('Williams VIX Fix', () => {
  it('is the low’s drop below the highest close, in %', () => {
    const b = bars([
      [100, 101, 99, 100],
      [100, 101, 98, 100],
      [100, 100, 90, 95],
    ]);
    const r = vixFix(b, 3, 2, 2, 2, 0.85);
    expect(r.wvf[1]).toBeNaN(); // warm-up: needs 3 closes
    expect(r.wvf[2]).toBeCloseTo(10); // (100 − 90) / 100
  });

  it('signals once at the start of a spike', () => {
    // A calm market wobbling ±1, then a crash: the spike fires on the crash bar and not again while it lasts.
    const calm: [number, number, number, number][] = Array.from({ length: 60 }, (_, i) => (i % 2 ? [100, 101, 99, 100] : [100, 101.5, 98.5, 100]));
    const crash: [number, number, number, number][] = [[100, 100, 80, 82], [82, 84, 78, 80], [80, 85, 79, 84]];
    const r = vixFix(bars([...calm, ...crash]), 22, 20, 2, 50, 0.85);
    expect(r.signal[60]).toBe(1);
    expect(r.signal[61] + r.signal[62]).toBe(0);
    expect(r.wvf[61]).toBeGreaterThan(r.upper[61]);
  });
});

describe('Williams patterns', () => {
  it('naked Smash Day buy: close below the prior low, entry when the next bar takes out its high', () => {
    const p = williamsPatterns(bars([[10, 11, 9, 10], [9.5, 9.8, 8, 8.5], [8.6, 10, 8.4, 9.8]]));
    expect(fired(p.smashBuy)).toEqual([2]);
    expect(fired(p.smashSell)).toEqual([]);
    // No break of the smash bar's high: no entry.
    expect(fired(williamsPatterns(bars([[10, 11, 9, 10], [9.5, 9.8, 8, 8.5], [8.6, 9.7, 8.4, 9.5]])).smashBuy)).toEqual([]);
  });

  it('naked Smash Day sell mirrors the buy', () => {
    const p = williamsPatterns(bars([[10, 11, 9, 10], [10.5, 12.5, 10.2, 12], [11.9, 12, 10, 10.1]]));
    expect(fired(p.smashSell)).toEqual([2]);
  });

  it('hidden Smash Day buy: up close, below the open, in the bottom 25% of the range', () => {
    // Bar 1: close 10.2 > prior 10, below the open 11, at (10.2 − 10) / 2 = 10% of the range.
    const p = williamsPatterns(bars([[10, 10.5, 9.5, 10], [11, 12, 10, 10.2], [10.3, 12.5, 10.1, 12.2]]));
    expect(fired(p.hiddenBuy)).toEqual([2]);
    // Close in the middle of the range: not hidden.
    expect(fired(williamsPatterns(bars([[10, 10.5, 9.5, 10], [11.5, 12, 10, 11], [11, 12.5, 10.8, 12.2]])).hiddenBuy)).toEqual([]);
  });

  it('hidden Smash Day sell: down close above the open in the top 25%', () => {
    const p = williamsPatterns(bars([[10, 10.5, 9.5, 10], [9, 10, 8, 9.8], [9.7, 9.9, 7.5, 7.8]]));
    expect(fired(p.hiddenSell)).toEqual([2]);
  });

  it('Oops! buy needs a gap below the prior low that trades back to it', () => {
    expect(fired(williamsPatterns(bars([[10, 11, 9, 10], [8.5, 9.2, 8.2, 9.1]])).oopsBuy)).toEqual([1]);
    expect(fired(williamsPatterns(bars([[10, 11, 9, 10], [8.5, 8.9, 8.2, 8.7]])).oopsBuy)).toEqual([]); // never got back
    expect(fired(williamsPatterns(bars([[10, 11, 9, 10], [9.5, 9.9, 8.2, 9.1]])).oopsBuy)).toEqual([]); // no gap
    expect(fired(williamsPatterns(bars([[10, 11, 9, 10], [11.5, 11.8, 10.9, 11]])).oopsSell)).toEqual([1]);
  });

  it('outside day with a close below the prior low, marked on the next (entry) bar', () => {
    expect(fired(williamsPatterns(bars([[10, 11, 9, 10], [10.5, 11.5, 8.5, 8.8], [8.9, 9.5, 8.6, 9.2]])).outsideBuy)).toEqual([2]);
    expect(fired(williamsPatterns(bars([[10, 11, 9, 10], [10.5, 11.5, 8.5, 8.8]])).outsideBuy)).toEqual([]); // no entry bar yet
    expect(fired(williamsPatterns(bars([[10, 11, 9, 10], [10.5, 11.5, 8.5, 9.5], [9.5, 10, 9, 9.8]])).outsideBuy)).toEqual([]); // closed inside
  });

  it('never looks ahead: a bar’s markers don’t change when later bars arrive', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let c = 100;
    const rows: [number, number, number, number][] = Array.from({ length: 300 }, () => {
      const o = c * (1 + (rnd() - 0.5) * 0.03);
      c = o * (1 + (rnd() - 0.5) * 0.04);
      return [o, Math.max(o, c) * (1 + rnd() * 0.01), Math.min(o, c) * (1 - rnd() * 0.01), c];
    });
    const full = williamsPatterns(bars(rows));
    const part = williamsPatterns(bars(rows.slice(0, 200)));
    for (const k of Object.keys(full) as (keyof typeof full)[]) expect(full[k].slice(0, 200)).toEqual(part[k]);
    expect(Object.values(full).some((v) => v.some(Boolean))).toBe(true);
  });
});

describe('outside data alignment', () => {
  const daily = Array.from({ length: 400 }, (_, i) => ({ time: T0 + i * DAY + 14.5 * 3600, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  const dayIndex = (date: string) => daily.findIndex((b) => new Date(b.time * 1000).toISOString().startsWith(date));

  it('monthly sentiment steps onto daily bars from the month after the survey month', () => {
    const pts = sentimentPoints([{ time: '2023-12-01', value: 70 }, { time: '2024-01-01', value: 80 }, { time: '2024-02-01', value: 90 }]);
    expect(pts.map((p) => p.values.avg)).toEqual([70, 75, 80]);
    const v = alignExternal(daily, pts, 'value');
    expect(v[dayIndex('2024-01-01')]).toBe(70); // December's survey is known by January
    expect(v[dayIndex('2024-01-31')]).toBe(70);
    expect(v[dayIndex('2024-02-01')]).toBe(80);
    expect(v[dayIndex('2024-03-15')]).toBe(90);
  });

  it('a 13F quarter counts only from its filing deadline', () => {
    const time = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000 + THIRTEEN_F_DELAY_DAYS * DAY;
    const pts = [{ time: time('2023-12-31'), values: { holders: 100 } }, { time: time('2024-03-31'), values: { holders: 120 } }];
    const v = alignExternal(daily, pts, 'holders');
    expect(v[dayIndex('2024-01-10')]).toBeNaN();
    expect(v[dayIndex('2024-02-14')]).toBe(100); // Dec 31 + 45 days
    expect(v[dayIndex('2024-05-14')]).toBe(100);
    expect(v[dayIndex('2024-05-15')]).toBe(120);
  });

  it('insider trades mark their own day and add up month to date', () => {
    const t = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
    expect(barForDay(daily, t('2024-01-05'))).toBe(dayIndex('2024-01-05'));
    expect(barForDay(daily, t('2023-06-01'))).toBe(-1);
    const r = insiderSeries(daily, [
      { time: t('2024-01-05'), values: { buy: 1, sell: 0, value: 1000 } },
      { time: t('2024-01-20'), values: { buy: 0, sell: 1, value: 300 } },
      { time: t('2024-02-02'), values: { buy: 1, sell: 0, value: 50 } },
    ]);
    expect(fired(r.buy)).toEqual([dayIndex('2024-01-05'), dayIndex('2024-02-02')]);
    expect(fired(r.sell)).toEqual([dayIndex('2024-01-20')]);
    expect(r.net[dayIndex('2024-01-04')]).toBe(0);
    expect(r.net[dayIndex('2024-01-10')]).toBe(1000);
    expect(r.net[dayIndex('2024-01-31')]).toBe(700);
    expect(r.net[dayIndex('2024-02-01')]).toBe(0);
    expect(r.net[dayIndex('2024-02-03')]).toBe(50);
  });
});

describe('registry', () => {
  it('registers the smart money indicators and the Larry Williams preset', () => {
    for (const id of ['progo', 'vixfix', 'williamspatterns', 'insiders', 'inst13f', 'inst13fshares', 'putcall', 'umcsent']) expect(getIndicator(id), id).toBeTruthy();
    const set = INDICATOR_PRESETS.find((p) => p.name === 'Larry Williams set')!;
    expect(presetDefs(set).map((d) => d.id)).toEqual(['williamscot', 'progo', 'willr', 'wad', 'uo']);
  });
});
