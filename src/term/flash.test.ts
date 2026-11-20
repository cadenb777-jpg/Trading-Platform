import { describe, expect, it } from 'vitest';
import { FLASH, newFlashState, shouldFlash } from './flash';

describe('calm flashes', () => {
  it('flashes a real change once, in its direction', () => {
    const s = newFlashState();
    const cell = {};
    expect(shouldFlash(s, cell, 10, 11, 0)).toBe('up');
    expect(shouldFlash(s, {}, 10, 9, 0)).toBe('down');
  });
  it('never flashes the first value, an unchanged one or a tiny move', () => {
    const s = newFlashState();
    expect(shouldFlash(s, {}, null, 11, 0)).toBeNull();
    expect(shouldFlash(s, {}, 11, 11, 0)).toBeNull();
    expect(shouldFlash(s, {}, 100, 100.01, 0, 0.0002)).toBeNull();
    expect(shouldFlash(s, {}, 100, 100.05, 0, 0.0002)).toBe('up');
  });
  it('lets one cell flash at most every five seconds', () => {
    const s = newFlashState();
    const cell = {};
    expect(shouldFlash(s, cell, 1, 2, 0)).toBe('up');
    expect(shouldFlash(s, cell, 2, 3, 500)).toBeNull();
    expect(shouldFlash(s, cell, 3, 4, FLASH.cellGapMs + 1)).toBe('up');
  });
  it('caps the whole screen at four flashes a second', () => {
    const s = newFlashState();
    const fired = Array.from({ length: 30 }, (_, i) => shouldFlash(s, {}, 1, 2, i * 10)).filter(Boolean).length;
    expect(fired).toBe(FLASH.perSecond);
    expect(shouldFlash(s, {}, 1, 2, 1500)).toBe('up'); // a second later there is room again
  });
});
