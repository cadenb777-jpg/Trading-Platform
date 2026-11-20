import { describe, expect, it } from 'vitest';
import { steadyTone } from './steadyTone';

describe('steady live colours', () => {
  it('leaves near-unchanged prices uncoloured', () => {
    expect(steadyTone(0)).toBe('');
    expect(steadyTone(0.004)).toBe('');
    expect(steadyTone(-0.009)).toBe('');
    expect(steadyTone(null)).toBe('');
  });
  it('colours clear moves', () => {
    expect(steadyTone(0.25)).toBe('up');
    expect(steadyTone(-0.25)).toBe('down');
  });
  it('does not flip on tiny wiggles around the edge', () => {
    // a price hovering just under the band keeps the colour it had
    expect(steadyTone(0.007, 'up')).toBe('up');
    expect(steadyTone(-0.007, 'down')).toBe('down');
    // and a tick back toward zero from up does not turn it red
    expect(steadyTone(-0.006, 'up')).toBe('up');
    expect(steadyTone(-0.011, 'up')).toBe('down');
    // a sequence of wiggles around zero: no flips once flat
    let t: '' | 'up' | 'down' = '';
    const seen = new Set<string>();
    for (const p of [0.002, -0.003, 0.004, -0.001, 0.003]) seen.add((t = steadyTone(p, t)));
    expect([...seen]).toEqual(['']);
  });
});
