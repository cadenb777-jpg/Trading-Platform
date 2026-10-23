import { describe, expect, it } from 'vitest';
import { pct, pctU } from './charts';

describe('pct', () => {
  it('signs real moves', () => {
    expect(pct(0.0123)).toBe('+1.23%');
    expect(pct(-0.0123)).toBe('-1.23%');
  });
  it('never shows a signed zero', () => {
    expect(pct(-0.00004, 1)).toBe('0.0%');
    expect(pct(0.00004, 1)).toBe('0.0%');
    expect(pct(0, 2)).toBe('0.00%');
    expect(pctU(-0.00004, 1)).toBe('0.0%');
  });
  it('shows a dash for missing values', () => {
    expect(pct(null)).toBe('—');
    expect(pct(NaN)).toBe('—');
    expect(pct(Infinity)).toBe('—');
  });
});
