import { describe, expect, it } from 'vitest';
import { marginTone, marginWords, peWords, rangeWords } from './tearSheet';

describe('tear sheet words', () => {
  it('describes the 52-week position', () => {
    expect(rangeWords(150, 100, 200)).toBe('50% of the way up its 52-week range: 25.0% below the high, 50.0% above the low.');
    expect(rangeWords(199, 100, 200)).toMatch(/^At the top/);
    expect(rangeWords(101, 100, 200)).toMatch(/^At the bottom/);
    expect(rangeWords(null, 100, 200)).toBe('No 52-week range yet.');
  });
  it('explains P/E and margins in plain words', () => {
    expect(peWords(34.2)).toBe('Investors pay $34 for each $1 of the last 12 months’ profit.');
    expect(peWords(8.25)).toContain('$8.3');
    expect(peWords(-3)).toMatch(/Loss-making/);
    expect(marginWords(0.25, 'net profit')).toBe('Keeps 25¢ of every $1 of sales as net profit.');
    expect(marginWords(-0.1, 'net profit')).toBe('Loses 10¢ on every $1 of sales (net profit).');
    expect(marginTone(0.2, 0.25)).toBe('warn');
    expect(marginTone(0.3, 0.25)).toBe('up');
    expect(marginTone(-0.1, 0)).toBe('down');
    expect(marginTone(null, 0)).toBe('muted');
  });
});

describe('price periods', () => {
  it('keeps the bars inside the period and works out the change', async () => {
    const { periodSlice } = await import('./tearSheet');
    const day = 86400;
    const bars = [0, 10, 20, 30, 40].map((d, i) => ({ time: d * day, close: 100 + i * 10 }));
    expect(periodSlice(bars, 20)).toEqual({ bars: bars.slice(2), change: 140 / 120 - 1 });
    expect(periodSlice([], 30)).toEqual({ bars: [], change: null });
  });
});
