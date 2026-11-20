import { describe, expect, it } from 'vitest';
import { ESSENTIALS } from './essentials';
import { allIndicators } from './library';

describe('essential indicators', () => {
  it('lists real indicators, once each, and keeps the list short', () => {
    const ids = new Set(allIndicators().map((d) => d.id));
    for (const id of ESSENTIALS) expect(ids.has(id), id).toBe(true);
    expect(new Set(ESSENTIALS).size).toBe(ESSENTIALS.length);
    expect(ESSENTIALS.length).toBeLessThanOrEqual(60);
  });
  it('includes the ones asked for by name (Money Flow Index, COT)', () => {
    for (const id of ['mfi', 'cot', 'williamscot', 'rsi', 'macd', 'vwap']) expect(ESSENTIALS).toContain(id);
  });
});
