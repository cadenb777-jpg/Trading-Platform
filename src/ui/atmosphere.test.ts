import { describe, expect, it } from 'vitest';
import { nextPose } from './atmosphere';

describe('colour spots', () => {
  it('wander within reach of home, with gentle size and brightness changes', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const p = nextPose([50, 50], rand, 16);
      expect(Math.abs(p.x - 50)).toBeLessThanOrEqual(16);
      expect(Math.abs(p.y - 50)).toBeLessThanOrEqual(16);
      expect(p.scale).toBeGreaterThanOrEqual(0.85);
      expect(p.scale).toBeLessThanOrEqual(1.2);
      expect(p.opacity).toBeGreaterThanOrEqual(0.5);
      expect(p.opacity).toBeLessThanOrEqual(1);
    }
  });
});
