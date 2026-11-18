import { describe, expect, it } from 'vitest';
import { bpChange } from './yieldCurve';

describe('curve table', () => {
  it('turns yield differences into basis points', () => {
    expect(bpChange(4.21, 4.05)).toBe(16);
    expect(bpChange(3.9, 4.25)).toBe(-35);
    expect(bpChange(4, null)).toBeNull();
  });
});
