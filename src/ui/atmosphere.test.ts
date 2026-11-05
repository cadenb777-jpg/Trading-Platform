import { describe, expect, it } from 'vitest';
import styleCss from '../style.css?raw';
import { SPOTS } from './atmosphere';

describe('flowing background', () => {
  it('every shape has a colour, a path and slow timings', () => {
    for (const cls of SPOTS) {
      const rule = styleCss.match(new RegExp(`\\.atmos \\.${cls} \\{([^}]*)\\}`))?.[1] ?? '';
      expect(rule, cls).toMatch(/--spot-/);
      const move = Number(rule.match(/--move: (\d+)s/)?.[1]);
      const pulse = Number(rule.match(/--pulse: (\d+)s/)?.[1]);
      expect(move, cls).toBeGreaterThanOrEqual(45); // calm: nothing faster than 45 s to cross
      expect(pulse, cls).toBeGreaterThanOrEqual(15);
    }
  });
  it('stands still for reduced motion', () => {
    expect(styleCss).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.atmos i \{ animation-play-state: paused; \}/);
  });
});
