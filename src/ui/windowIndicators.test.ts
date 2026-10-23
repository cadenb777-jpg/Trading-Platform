import { describe, expect, it } from 'vitest';
import { barsFromLine, computeOnLine, lineIndicators } from './windowIndicators';
import { getIndicator, defaultParams } from '../indicators/library';

const data = Array.from({ length: 60 }, (_, i) => ({ time: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, value: 4 + Math.sin(i / 5) * 0.3 }));

describe('indicators on a line', () => {
  it('turns a line into flat bars', () => {
    expect(barsFromLine([{ time: '2026-01-02', value: 4.1 }])[0]).toEqual({ time: Date.parse('2026-01-02T00:00:00Z') / 1000, open: 4.1, high: 4.1, low: 4.1, close: 4.1, volume: 0 });
  });

  it('computes a moving average in the line\'s own time format, skipping the warm-up', () => {
    const sma = getIndicator('sma')!;
    const out = computeOnLine(sma, { ...defaultParams(sma), length: 10 }, data);
    const key = sma.plots[0].key;
    expect(out[key]).toHaveLength(51);
    expect(out[key][0].time).toBe(data[9].time);
    const mean = data.slice(0, 10).reduce((s, p) => s + p.value, 0) / 10;
    expect(out[key][0].value).toBeCloseTo(mean, 10);
  });

  it('offers only studies that work without highs, lows or volume', () => {
    const ids = lineIndicators().map((d) => d.id);
    expect(ids).toContain('rsi');
    expect(ids).toContain('zscore');
    expect(ids).not.toContain('atr');
    expect(ids).not.toContain('obv');
    for (const d of lineIndicators()) for (const v of Object.values(computeOnLine(d, defaultParams(d), data))) for (const p of v) expect(Number.isFinite(p.value)).toBe(true);
  });
});
