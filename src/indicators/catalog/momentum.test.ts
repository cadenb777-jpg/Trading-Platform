import { describe, expect, it } from 'vitest';
import type { Bar } from '../../types';
import { getIndicator } from '../library';
import type { IndicatorDef, IndicatorParams } from '../types';
import { REFS } from './b-refs';
import { FIXTURE } from './b-fixture';
import { MOMENTUM, MOMENTUM_GUIDES } from './momentum';

/**
 * Reference values come from b-refs.ts (TA-Lib 0.8.3 where it has the indicator, otherwise an independent Python
 * implementation of the published formula), checked to 1e-6 relative, plus the first bar with a value.
 */
const defaults = (def: IndicatorDef): IndicatorParams => Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));

describe('momentum family reference values', () => {
  for (const def of MOMENTUM) {
    it(`${def.id} matches its reference`, () => {
      const ref = REFS[def.id];
      expect(ref, `no reference for ${def.id}`).toBeDefined();
      const out = def.compute(FIXTURE, defaults(def));
      for (const [key, plot] of Object.entries(ref.plots)) {
        const series = out[key];
        expect(series, `${def.id}.${key}`).toBeDefined();
        if (plot.firstValid !== null) {
          expect(series.slice(0, plot.firstValid).every(Number.isNaN), `${def.id}.${key} warm-up`).toBe(true);
          expect(Number.isNaN(series[plot.firstValid]), `${def.id}.${key} first value`).toBe(false);
        }
        for (const [i, want] of Object.entries(plot.values)) {
          const got = series[Number(i)];
          expect(Math.abs(got - want), `${def.id}.${key}[${i}] = ${got}, want ${want}`).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(want)));
        }
      }
    });
  }
});

describe('momentum family definitions', () => {
  const flat: Bar[] = Array.from({ length: 120 }, (_, i) => ({ time: 1700000000 + i * 86400, open: 50, high: 50, low: 50, close: 50, volume: 1000 }));
  const short = FIXTURE.slice(0, 5);

  it('has unique ids that the library serves (no clash with older indicators)', () => {
    const ids = MOMENTUM.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of MOMENTUM) expect(getIndicator(def.id), def.id).toBe(def);
    expect(MOMENTUM.length).toBeGreaterThanOrEqual(80);
  });

  it('adaptive lines (DyMI, ACP cycle) have no gaps once they start', () => {
    for (const [id, key] of [['dymi', 'dymi'], ['acp', 'cycle']]) {
      const def = MOMENTUM.find((d) => d.id === id)!;
      const series = def.compute(FIXTURE, defaults(def))[key];
      const start = series.findIndex((x) => !Number.isNaN(x));
      expect(start, id).toBeGreaterThanOrEqual(0);
      expect(series.slice(start).every(Number.isFinite), id).toBe(true);
    }
    const acp = MOMENTUM.find((d) => d.id === 'acp')!;
    const cyc = acp.compute(FIXTURE, defaults(acp)).cycle.filter((x) => !Number.isNaN(x));
    expect(Math.min(...cyc)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...cyc)).toBeLessThanOrEqual(48);
  });

  it('REI follows DeMark’s overlap rule (a bar with no overlap 5-8 bars back counts 0)', () => {
    const rei = MOMENTUM.find((d) => d.id === 'rei')!;
    // a steady fall: every high is below the lows 5-6 bars back and below the closes 7-8 bars back, so nothing counts
    const falling: Bar[] = Array.from({ length: 30 }, (_, i) => {
      const c = 100 - 10 * i;
      return { time: i, open: c + 1, high: c + 2, low: c - 2, close: c, volume: 1 };
    });
    expect(rei.compute(falling, defaults(rei)).rei.at(-1)).toBe(0);
  });

  for (const def of MOMENTUM) {
    it(`${def.id} is complete and robust`, () => {
      expect(['Momentum', 'Oscillators', 'Cycles']).toContain(def.category);
      expect(def.description.length).toBeGreaterThan(20);
      const guide = MOMENTUM_GUIDES[def.id];
      expect(guide?.what.length).toBeGreaterThan(10);
      expect(guide.use.length).toBeGreaterThan(0);
      expect(guide.signals.length).toBeGreaterThan(0);
      expect(new Set(def.inputs.map((i) => i.key)).size).toBe(def.inputs.length);
      for (const input of def.inputs) {
        if (input.type !== 'number') continue;
        if (input.min !== undefined) expect(input.default).toBeGreaterThanOrEqual(input.min);
        if (input.max !== undefined) expect(input.default).toBeLessThanOrEqual(input.max);
      }
      expect(new Set(def.plots.map((p) => p.key)).size).toBe(def.plots.length);
      for (const bars of [short, flat, [] as Bar[]]) {
        const out = def.compute(bars, defaults(def));
        for (const plot of def.plots) {
          expect(out[plot.key], `${def.id}.${plot.key}`).toHaveLength(bars.length);
          expect(out[plot.key].every((x) => Number.isNaN(x) || Number.isFinite(x)), `${def.id}.${plot.key} finite`).toBe(true);
        }
      }
      // every plot shows something on a normal history
      const out = def.compute(FIXTURE, defaults(def));
      for (const plot of def.plots) {
        expect(out[plot.key].some((x) => !Number.isNaN(x)), `${def.id}.${plot.key} empty`).toBe(true);
      }
    });
  }
});
