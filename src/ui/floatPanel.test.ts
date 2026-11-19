import { describe, expect, it } from 'vitest';
import { clampRect, snapRect } from './floatPanel';

describe('floating panels', () => {
  it('snaps to a half or the whole screen at the edges', () => {
    expect(snapRect(5, 400, 1400, 900)).toEqual({ x: 8, y: 8, w: 688, h: 884 });
    expect(snapRect(1398, 400, 1400, 900)!.x).toBe(704);
    expect(snapRect(700, 3, 1400, 900)).toEqual({ x: 8, y: 8, w: 1384, h: 884 });
    expect(snapRect(700, 400, 1400, 900)).toBeNull();
  });
  it('keeps a window on screen and at a usable size', () => {
    expect(clampRect({ x: -50, y: 2000, w: 100, h: 50 }, 1400, 900)).toEqual({ x: 8, y: 860, w: 280, h: 160 });
    expect(clampRect({ x: 100, y: 100, w: 5000, h: 5000 }, 1400, 900)).toEqual({ x: 100, y: 100, w: 1384, h: 884 });
  });
});
