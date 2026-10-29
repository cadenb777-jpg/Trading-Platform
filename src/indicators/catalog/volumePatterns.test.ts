/**
 * Family D tests: volume indicators against independent numpy/pandas references (cross-checked with TA-Lib and the
 * `ta` package where their definitions match) and every TA-Lib candlestick pattern against TA-Lib 0.8.3 itself,
 * both on FIXTURE_OHLCV and on short windows where each pattern fires (d-reference.ts, generated in Python).
 */
import { describe, expect, it } from 'vitest';
import type { Bar } from '../../types';
import { INDICATORS, defaultParams } from '../library';
import type { IndicatorDef } from '../types';
import { ALL_CANDLES_DEF, CANDLE_DEFS, PATTERNS, patternId, patternValues, selectedPatterns } from './d-candles';
import { CDL_CASES, CDL_FIXTURE, SAMPLE_INDEXES, VOLUME_REF } from './d-reference';
import { CDL, runCdl } from './d-talibCandles';
import { VOLUME_DEFS } from './d-volume';
import { FIXTURE_OHLCV } from './fixture-ohlcv';
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

describe('volume indicators match the Python references', () => {
  for (const def of VOLUME_DEFS) {
    it(def.id, () => {
      const ref = VOLUME_REF[def.id];
      expect(ref, `reference for ${def.id}`).toBeDefined();
      const out = def.compute(bars, defaultParams(def));
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
      patternValues(info, bars).forEach((v, i) => (bull[i] += v > 0 ? 1 : 0));
    }
    expect(out.bull).toEqual(bull);
    expect(selectedPatterns(params).some((p) => p.group === 'indecision')).toBe(false);
    const none = ALL_CANDLES_DEF.compute(bars, { ...params, bullish: 0, bearish: 0, reversal: 0, continuation: 0 });
    expect(none.bull.every((v) => v === 0) && none.bear.every((v) => v === 0)).toBe(true);
    const everything = selectedPatterns({ reversal: 1, continuation: 1, indecision: 1, candle: 1, single: 1 });
    expect(everything).toHaveLength(61);
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
