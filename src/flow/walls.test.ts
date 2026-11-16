import { describe, expect, it } from 'vitest';
import { optionWalls, wallWords } from './walls';

describe('options walls', () => {
  const rows = [
    { strike: 90, callOi: 100, putOi: 5000 },
    { strike: 95, callOi: 300, putOi: 8000 },
    { strike: 100, callOi: 2000, putOi: 2000 },
    { strike: 105, callOi: 9000, putOi: 400 },
    { strike: 110, callOi: 6000, putOi: 100 },
  ];
  it('finds the biggest call strike above and put strike below the price', () => {
    const w = optionWalls(rows, 101);
    expect(w.call).toEqual({ strike: 105, oi: 9000, distance: 105 / 101 - 1 });
    expect(w.put?.strike).toBe(95);
    expect(optionWalls(rows, 0)).toEqual({ call: null, put: null });
    expect(optionWalls([], 100)).toEqual({ call: null, put: null });
  });
  it('explains them', () => {
    const text = wallWords(optionWalls(rows, 101), (v) => `$${v}`);
    expect(text).toContain('Call wall $105 (4.0% above)');
    expect(text).toContain('Put wall $95 (5.9% below)');
    expect(text).toContain('A tendency, not a rule');
    expect(wallWords({ call: null, put: null }, String)).toMatch(/^No clear walls/);
  });
});
