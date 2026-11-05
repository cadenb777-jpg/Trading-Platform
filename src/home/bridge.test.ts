import { describe, expect, it } from 'vitest';
import { archY, bridgeMarkup, hangerXs } from './bridge';

describe('Home hero bridge', () => {
  it('is symmetric around the centre', () => {
    const xs = hangerXs();
    expect(xs).toContain(600);
    expect(xs.length).toBeGreaterThan(10);
    for (const x of xs) expect(xs).toContain(1200 - x);
    const sky = { half: 540, apex: 40 };
    expect(archY(sky, 600)).toBeCloseTo(40, 5);
    expect(archY(sky, 300)).toBeCloseTo(archY(sky, 900), 5);
  });

  it('hangs every hanger from the arch to the baseline and uses no hard-coded colours', () => {
    const svg = bridgeMarkup();
    expect(svg.match(/<line x1="(\d+)" y1="([\d.]+)" x2="\1" y2="160"/g)?.length).toBe(hangerXs().length);
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(svg).toContain('aria-hidden="true"');
  });
});
