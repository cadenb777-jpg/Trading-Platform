/**
 * Family D tests: volume indicators against independent numpy/pandas references (cross-checked with TA-Lib and the
 * `ta` package where their definitions match) and every TA-Lib candlestick pattern against TA-Lib 0.8.3 itself,
 * both on FIXTURE_OHLCV and on short windows where each pattern fires (d-reference.ts, generated in Python).
 */
import { describe, expect, it } from 'vitest';
import type { Bar } from '../../types';
import { INDICATORS, defaultParams, getIndicator, indicatorLabel } from '../library';
import { MARKET_PARAM } from '../session';
import type { IndicatorDef } from '../types';
import { ALL_CANDLES_DEF, CANDLE_DEFS, PATTERNS, patternId, patternValues, selectedPatterns } from './d-candles';
import { CDL_CASES, CDL_FIXTURE, SAMPLE_INDEXES, VOLUME_REF } from './d-reference';
import { CDL, runCdl } from './d-talibCandles';
import { VOLUME_DEFS } from './d-volume';
import { FIXTURE as FIXTURE_OHLCV } from './c-fixture';
import { VOLUME_PATTERNS, VOLUME_PATTERNS_GUIDES } from './volumePatterns';

const bars = FIXTURE_OHLCV;
const toBars = (c: { o: number[]; h: number[]; l: number[]; c: number[] }): Bar[] =>
  c.o.map((o, i) => ({ time: 1700000000 + i * 86400, open: o, high: c.h[i], low: c.l[i], close: c.c[i], volume: 1000 }));

describe('fixture', () => {
  it('matches the shared generator (mulberry32 seed 42)', () => {
    expect(bars).toHaveLength(300);
    expect(bars[0]).toEqual({ time: 1700000000, open: 100, high: 100.8545, low: 99.1475, close: 100.4044, volume: 1169734.0414 });
    expect(bars[1].open).toBe(bars[0].close);
  });
});

/** Inputs the Python references were computed with, where they differ from the defaults. */
const REF_PARAMS: Record<string, Record<string, number>> = { avwap: { date: 0, barsBack: 50 } };

describe('volume indicators match the Python references', () => {
  for (const def of VOLUME_DEFS) {
    it(def.id, () => {
      const ref = VOLUME_REF[def.id];
      expect(ref, `reference for ${def.id}`).toBeDefined();
      const out = def.compute(bars, { ...defaultParams(def), ...REF_PARAMS[def.id] });
      for (const [key, expected] of Object.entries(ref)) {
        const got = SAMPLE_INDEXES.map((i) => out[key][i]);
        expected.forEach((e, j) => {
          const g = got[j];
          if (Number.isNaN(e)) expect(g, `${def.id}.${key}[${SAMPLE_INDEXES[j]}]`).toBeNaN();
          else expect(Math.abs(g - e), `${def.id}.${key}[${SAMPLE_INDEXES[j]}] ${g} vs ${e}`).toBeLessThanOrEqual(1e-7 * Math.max(1, Math.abs(e)));
        });
      }
    });
  }

  it('anchored VWAP from a date starts on that day', () => {
    const def = VOLUME_DEFS.find((d) => d.id === 'avwap')!;
    const d = new Date(bars[100].time * 1000);
    const date = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    const out = def.compute(bars, { ...defaultParams(def), date }).vwap;
    expect(out[99]).toBeNaN();
    expect(out[100]).toBeCloseTo((bars[100].high + bars[100].low + bars[100].close) / 3, 10);
  });

  it('anchored VWAP defaults to the start of the last bar’s year (fixed as new bars arrive)', () => {
    const def = VOLUME_DEFS.find((d) => d.id === 'avwap')!;
    const out = def.compute(bars, defaultParams(def)).vwap;
    const first = bars.findIndex((b) => new Date(b.time * 1000).getUTCFullYear() === 2024);
    expect(out[first - 1]).toBeNaN();
    expect(out[first]).toBeCloseTo((bars[first].high + bars[first].low + bars[first].close) / 3, 10);
    expect(def.compute(bars.slice(0, -10), defaultParams(def)).vwap).toEqual(out.slice(0, -10));
  });
});

/** Hourly stock bars 04:00-19:00 New York time (extended hours) on 1-5 Nov 2024; DST ends on 3 Nov. */
function extendedHoursBars(): Bar[] {
  const out: Bar[] = [];
  for (const day of [1, 4, 5]) {
    const offset = day >= 3 ? 5 : 4; // hours behind UTC: EDT (-4) before 3 Nov, EST (-5) after
    for (let hour = 4; hour <= 19; hour++) {
      const time = Date.UTC(2024, 10, day, hour + offset) / 1000;
      const price = 100 + day + hour / 10;
      out.push({ time, open: price, high: price + 1, low: price - 1, close: price + 0.5, volume: 1000 + hour });
    }
  }
  return out;
}

describe('session calendar (New York for stocks, UTC for crypto)', () => {
  const ext = extendedHoursBars();
  const tp = (b: Bar) => (b.high + b.low + b.close) / 3;
  const sessionVwap = (from: number, to: number) => {
    let pv = 0;
    let v = 0;
    for (let i = from; i <= to; i++) {
      pv += tp(ext[i]) * ext[i].volume;
      v += ext[i].volume;
    }
    return pv / v;
  };
  // 4 Nov is EST: its 19:00 bar is 00:00 UTC on 5 Nov but still belongs to the 4 Nov session.
  const evening = 16 + 15;

  it('keeps the evening session on its own day across the DST change', () => {
    expect(new Date(ext[evening].time * 1000).getUTCDate()).toBe(5);
    for (const id of ['vwap', 'vwapperiodic']) {
      const def = getIndicator(id)!;
      const params = { ...defaultParams(def), period: 1 };
      const out = def.compute(ext, params).vwap;
      expect(out[evening], id).toBeCloseTo(sessionVwap(16, evening), 10);
      expect(out[16 + 3], id).toBeCloseTo(sessionVwap(16, 19), 10);
    }
    const dist = getIndicator('vwapdist')!.compute(ext, {}).dist;
    expect(dist[evening]).toBeCloseTo((100 * (ext[evening].close - sessionVwap(16, evening))) / sessionVwap(16, evening), 10);
  });

  it('crypto keeps UTC days', () => {
    const def = getIndicator('vwapperiodic')!;
    const out = def.compute(ext, { period: 1, [MARKET_PARAM]: 'coinbase' }).vwap;
    expect(out[evening]).toBeCloseTo(tp(ext[evening]), 10); // a new UTC day starts at that bar
  });

  it('relative volume at time of day follows New York clock time across DST', () => {
    const daily: Bar[] = [];
    for (let d = 0; d < 12; d++) {
      const date = new Date(Date.UTC(2024, 9, 28 + d));
      const offset = date.getUTCDate() >= 3 && date.getUTCMonth() === 10 ? 5 : 4;
      // 09:30 and 15:30 New York time each day: the UTC clock time of both moves an hour on 3 Nov.
      daily.push({ time: Date.UTC(2024, 9, 28 + d, 9 + offset, 30) / 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: d === 11 ? 2000 : 1000 });
      daily.push({ time: Date.UTC(2024, 9, 28 + d, 15 + offset, 30) / 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5000 });
    }
    const out = getIndicator('rvoltod')!.compute(daily, { length: 10 }).rvol;
    expect(out.slice(0, 20).every(Number.isNaN)).toBe(true);
    expect([out[20], out[21], out[22], out[23]]).toEqual([1, 1, 2, 1]);
  });
});

describe('candlestick patterns match TA-Lib', () => {
  const o = bars.map((b) => b.open);
  const h = bars.map((b) => b.high);
  const l = bars.map((b) => b.low);
  const c = bars.map((b) => b.close);

  it('covers all 61 TA-Lib patterns', () => {
    expect(Object.keys(CDL)).toHaveLength(61);
    expect(PATTERNS.map((p) => p.talib).sort()).toEqual(Object.keys(CDL).sort());
    expect(Object.keys(CDL_FIXTURE).sort()).toEqual(Object.keys(CDL).sort());
  });

  for (const info of PATTERNS) {
    it(`${info.talib} on the fixture and on its firing cases`, () => {
      const expected = new Array<number>(bars.length).fill(0);
      for (const [i, v] of CDL_FIXTURE[info.talib]) expected[i] = v;
      expect(runCdl(info.talib, o, h, l, c, info.penetration ?? 0)).toEqual(expected);
      const cases = CDL_CASES[info.talib];
      expect(cases.length, 'at least one firing case').toBeGreaterThan(0);
      for (const cs of cases) {
        const got = patternValues(info, toBars(cs));
        expect(got).toEqual(cs.out);
        expect(got.at(-1)).not.toBe(0);
      }
    });
  }

  it('each pattern indicator splits TA-Lib’s sign into its marker plots', () => {
    for (const info of PATTERNS) {
      const def = CANDLE_DEFS.find((d) => d.id === patternId(info))!;
      for (const cs of CDL_CASES[info.talib]) {
        const out = def.compute(toBars(cs), defaultParams(def));
        const combined = cs.out.map((_, i) => (out.signal?.[i] ?? 0) + (out.bull?.[i] ?? 0) + (out.bear?.[i] ?? 0));
        expect(combined).toEqual(cs.out);
        if (out.bull) expect(out.bull.every((v) => v >= 0)).toBe(true);
        if (out.bear) expect(out.bear.every((v) => v <= 0)).toBe(true);
        for (const key of Object.keys(out)) expect(def.plots.some((p) => p.key === key)).toBe(true);
      }
    }
  });

  it('the combined indicator counts the selected patterns', () => {
    const params = defaultParams(ALL_CANDLES_DEF);
    const out = ALL_CANDLES_DEF.compute(bars, params);
    const bull = new Array<number>(bars.length).fill(0);
    for (const info of selectedPatterns(params)) {
      if (info.kind === 'neutral') continue;
      const confirmedOnly = info.talib.startsWith('CDLHIKKAKE');
      patternValues(info, bars).forEach((v, i) => (bull[i] += v > 0 && (!confirmedOnly || v >= 200) ? 1 : 0));
    }
    expect(out.bull).toEqual(bull);
    expect(selectedPatterns(params).some((p) => p.group === 'indecision')).toBe(false);
    const none = ALL_CANDLES_DEF.compute(bars, { ...params, bullish: 0, bearish: 0, reversal: 0, continuation: 0 });
    expect(none.bull.every((v) => v === 0) && none.bear.every((v) => v === 0)).toBe(true);
    const everything = selectedPatterns({ reversal: 1, continuation: 1, indecision: 1, candle: 1, single: 1, common: 1 });
    expect(everything).toHaveLength(61);
  });

  it('the combined indicator marks well under 15% of bars by default', () => {
    const out = ALL_CANDLES_DEF.compute(bars, defaultParams(ALL_CANDLES_DEF));
    const marked = bars.filter((_, i) => out.bull[i] || out.bear[i] || out.neutral[i]).length;
    expect(marked / bars.length).toBeLessThan(0.1);
    expect(marked).toBeGreaterThan(0);
  });
});

describe('legend labels', () => {
  const label = (id: string, params: Record<string, number> = {}) => {
    const def = getIndicator(id)!;
    return indicatorLabel(def, { params: { ...defaultParams(def), ...params }, timeframe: null });
  };
  it('hides toggles and formats dates, bar counts and periods', () => {
    expect(label('cdl_all')).toBe('Candles');
    expect(label('avwap')).toBe('AVWAP');
    expect(label('avwap', { date: 20240115 })).toBe('AVWAP 2024-01-15');
    expect(label('avwap', { barsBack: 50 })).toBe('AVWAP 50 bars');
    expect(label('vwapperiodic')).toBe('pVWAP Week');
    expect(label('vwapperiodic', { period: 1 })).toBe('pVWAP Day');
    expect(label('pvo')).toBe('PVO 12 26 9');
  });
});

describe('family D definitions', () => {
  const ids = VOLUME_PATTERNS.map((d) => d.id);

  it('has unique ids that do not clash with the rest of the library', () => {
    expect(new Set(ids).size).toBe(ids.length);
    const others = INDICATORS.filter((d) => !VOLUME_PATTERNS.includes(d)).map((d) => d.id);
    expect(ids.filter((id) => others.includes(id))).toEqual([]);
    expect(VOLUME_DEFS.length).toBeGreaterThanOrEqual(40);
    expect(CANDLE_DEFS).toHaveLength(61);
  });

  for (const def of VOLUME_PATTERNS) {
    it(`${def.id}: description, guide, inputs and robustness`, () => {
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.category).toBe(def.id.startsWith('cdl_') ? 'Candlestick Patterns' : 'Volume');
      const guide = VOLUME_PATTERNS_GUIDES[def.id];
      expect(guide?.what.length).toBeGreaterThan(10);
      expect(guide.use.length).toBeGreaterThan(0);
      expect(guide.signals.length).toBeGreaterThan(0);
      for (const input of def.inputs) {
        if (input.type !== 'number') continue;
        expect(input.default).toBeGreaterThanOrEqual(input.min ?? -Infinity);
        expect(input.default).toBeLessThanOrEqual(input.max ?? Infinity);
      }
      expect(def.plots.length).toBeGreaterThan(0);
      for (const p of def.plots) if (p.type === 'marker') expect(p.marker).toBeDefined();
      if (def.category === 'Volume') expect(def.plots.some((p) => p.type === 'marker'), 'volume signals stay in their own pane').toBe(false);
      for (const input of def.inputs) if (input.type === 'number' && input.toggle) expect([input.min, input.max, input.legend]).toEqual([0, 1, 'hide']);
      checkSurvives(def, bars.slice(0, 5));
      checkSurvives(def, bars.map((b) => ({ ...b, open: 50, high: 50, low: 50, close: 50 })));
      checkSurvives(def, []);
    });
  }
});

function checkSurvives(def: IndicatorDef, input: Bar[]) {
  const out = def.compute(input, defaultParams(def));
  for (const p of def.plots) {
    expect(out[p.key], `${def.id}.${p.key}`).toHaveLength(input.length);
    for (const v of out[p.key]) expect(Number.isNaN(v) || Number.isFinite(v), `${def.id}.${p.key} finite`).toBe(true);
  }
}
