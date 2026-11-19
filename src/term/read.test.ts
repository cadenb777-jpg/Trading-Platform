import { describe, expect, it } from 'vitest';
import { alignedReturns, corrMatrix, pearson } from './corr';
import { marketRead, spread } from './read';

const f = (root: string, change: number, extra: Record<string, unknown> = {}) => ({ root, name: root, sector: '', change, ...extra });

describe('market read', () => {
  it('reads the regime from stocks, volatility and bonds together', () => {
    const lines = marketRead({ futures: [f('ES', 0.006), f('VX', -0.04), f('ZN', -0.003)] });
    expect(lines[0].label).toBe('Regime');
    expect(lines[0].text).toMatch(/^Risk-on: stocks and yields both up/);
  });
  it('says nothing it has no numbers for', () => {
    expect(marketRead({})).toEqual([]);
    expect(marketRead({ futures: [f('ES', 0.01)] })).toEqual([]);
  });
  it('flags unusual moves and crowded positioning moving the wrong way', () => {
    const lines = marketRead({ futures: [f('CL', -0.03, { name: 'Crude', sigma: -2.4, positioning: { specIndex: 91 } }), f('MCL', -0.03, { sigma: -2.4 })] });
    expect(lines.find((l) => l.label === 'Unusual')!.text).toContain('Crude -2.4σ');
    expect(lines.find((l) => l.label === 'Unusual')!.text).not.toContain('MCL'); // micro contracts repeat the big one
    expect(lines.find((l) => l.label === 'Positioning')!.text).toContain('crowded long unwinding');
  });
  it('measures the curve and the Fed in plain terms', () => {
    const curve = [{ label: '2Y', now: 3.46, monthAgo: 3.55 }, { label: '10Y', now: 4.12, monthAgo: 4.08 }];
    expect(spread(curve, '2Y', '10Y')).toBe(66);
    const lines = marketRead({ curve, fed: { change: -0.37, by: 'Mar 18' } });
    expect(lines.find((l) => l.label === 'Curve')!.text).toBe('2s10s +66 bp, steepening 13 bp over the month.');
    expect(lines.find((l) => l.label === 'Fed')!.text).toBe('Futures price 1.5 cuts of 25 bp by Mar 18.');
  });
  it('names leaders, laggards and splits', () => {
    const lines = marketRead({ sectorsVsSpx: [{ name: 'Energy', rel: -0.015 }, { name: 'Technology', rel: 0.006 }], markets: { SPY: 0.003, IWM: -0.004, EWJ: 0.008, FXI: -0.013 } });
    const t = lines.find((l) => l.label === 'Leadership')!.text;
    expect(t).toContain('Technology leads');
    expect(t).toContain('Energy lags');
    expect(t).toContain('small caps trail large by 0.7 pts');
    expect(t).toContain('Asia split');
  });
});

describe('correlations', () => {
  it('aligns series on shared days and measures them', () => {
    const day = 86400;
    const a: [number, number][] = Array.from({ length: 30 }, (_, i) => [i * day, 100 + i + (i % 3)]);
    const b: [number, number][] = a.map(([t, c]) => [t, c * 2]);
    const c: [number, number][] = a.filter((_, i) => i !== 5).map(([t, v]) => [t + 3600, 300 - v]);
    const { names, rows } = alignedReturns({ a, b, c });
    expect(names).toEqual(['a', 'b', 'c']);
    const m = corrMatrix(names, rows, 20);
    expect(m[0][1]).toBeCloseTo(1, 6);
    expect(m[0][2]!).toBeLessThan(-0.9);
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });
});
