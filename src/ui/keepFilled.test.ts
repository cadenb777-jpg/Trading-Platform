import { describe, expect, it } from 'vitest';
import { emptyLeftFix } from './theme';

describe('charts keep their data filling the width', () => {
  it('refits small charts that show empty space before the first candle', () => {
    expect(emptyLeftFix({ from: -120, to: 389 }, 'fit')).toEqual({ fit: true });
    expect(emptyLeftFix({ from: -0.5, to: 389 }, 'fit')).toBeNull(); // the usual half-bar margin is fine
    expect(emptyLeftFix({ from: 40, to: 389 }, 'fit')).toBeNull(); // zoomed in
    expect(emptyLeftFix(null, 'fit')).toBeNull();
  });
  it('stretches the main chart from the left and keeps its right edge', () => {
    expect(emptyLeftFix({ from: -200, to: 520 }, 'left')).toEqual({ from: -0.5, to: 520 });
  });
});
