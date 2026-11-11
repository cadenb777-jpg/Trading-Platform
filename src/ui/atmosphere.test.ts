import { describe, expect, it } from 'vitest';
import styleCss from '../style.css?raw';
import { SPOTS, spotAt, wave } from './atmosphere';

describe('flowing background', () => {
  it('every shape has a theme colour and slow timings', () => {
    for (const s of SPOTS) {
      expect(styleCss, s.color).toContain(`${s.color}:`);
      expect(s.move, s.color).toBeGreaterThanOrEqual(45); // calm: nothing faster than 45 s to cross
      expect(s.pulse, s.color).toBeGreaterThanOrEqual(15);
    }
  });
  it('travels there and back smoothly', () => {
    expect(wave(0, 60)).toBeCloseTo(0);
    expect(wave(60, 60)).toBeCloseTo(1);
    expect(wave(120, 60)).toBeCloseTo(0);
    expect(wave(30, 60)).toBeCloseTo(0.5);
    const a = spotAt(SPOTS[0], 0, 1000, 800);
    const b = spotAt(SPOTS[0], SPOTS[0].move, 1000, 800);
    expect(a.x).toBeCloseTo(550);
    expect(b.x).toBeCloseTo(350);
    expect(a.alpha).toBeGreaterThanOrEqual(0.55);
  });
  it('is one canvas, not window-sized animated layers', () => {
    expect(styleCss).not.toMatch(/\.atmos i\s*\{/);
    expect(styleCss).toMatch(/\.atmos canvas \{/);
  });
});
