import { describe, expect, it } from 'vitest';
import { arcPath, flowWidth, gaugeAngle, heatShare, mixSegments, petalPoints, polar, ringSlice, squarify, sunburstLayout, trackPos } from './viz';

describe('viz geometry', () => {
  it('places points clockwise from the top', () => {
    const [x, y] = polar(50, 50, 10, 0);
    expect([Math.round(x), Math.round(y)]).toEqual([50, 40]);
    const [rx, ry] = polar(50, 50, 10, 90);
    expect([Math.round(rx), Math.round(ry)]).toEqual([60, 50]);
  });
  it('maps gauge values to -90..90 and clamps', () => {
    expect(gaugeAngle(0, 0, 100)).toBe(-90);
    expect(gaugeAngle(50, 0, 100)).toBe(0);
    expect(gaugeAngle(150, 0, 100)).toBe(90);
    expect(gaugeAngle(NaN, 0, 100)).toBe(-90);
  });
  it('draws arcs with the large-arc flag only past 180 degrees', () => {
    expect(arcPath(0, 0, 10, -90, 0)).toContain(' 0 0 1 ');
    expect(arcPath(0, 0, 10, 0, 270)).toContain(' 0 1 1 ');
  });
  it('places a value on a track (clamped) and spreads petals evenly', () => {
    expect(trackPos(150, 100, 200)).toBe(0.5);
    expect(trackPos(250, 100, 200)).toBe(1);
    expect(trackPos(1, 1, 1)).toBe(0.5);
    const pts = petalPoints(4, 0, 0, 10).map(([x, y]) => [Math.round(x), Math.round(y)]);
    expect(pts).toEqual([[0, -10], [10, 0], [0, 10], [-10, 0]]);
  });
  it('sizes flows and heat tiles by magnitude', () => {
    expect(flowWidth(100, 100)).toBe(10);
    expect(flowWidth(0, 100)).toBe(1.2);
    expect(flowWidth(25, 100)).toBeCloseTo(1.2 + 8.8 * 0.5);
    expect(heatShare(-2, 4)).toBe(39);
    expect(heatShare(4, 4)).toBe(70);
    expect(heatShare(1, 0)).toBe(0);
  });
});

describe('mix bar', () => {
  it('keeps the biggest parts and folds the rest into Other', () => {
    const s = mixSegments([{ label: 'a', value: 50 }, { label: 'b', value: 20 }, { label: 'c', value: 10 }, { label: 'd', value: 10 }, { label: 'e', value: 5 }, { label: 'f', value: 5 }, { label: 'z', value: 0 }]);
    expect(s.map((x) => x.label)).toEqual(['a', 'b', 'c', 'd', 'Other']);
    expect(s[4].value).toBe(10);
    expect(s.reduce((t, x) => t + x.weight, 0)).toBeCloseTo(1);
    expect(mixSegments([])).toEqual([]);
    expect(mixSegments([{ label: 'a', value: 1 }, { label: 'b', value: 1 }], 5).map((x) => x.weight)).toEqual([0.5, 0.5]);
  });
});

describe('sunburst', () => {
  it('gives every member the same angle and groups span their members', () => {
    const l = sunburstLayout([{ label: 'A', items: ['a1', 'a2', 'a3'] }, { label: 'B', items: [] }, { label: 'C', items: ['c1'] }], 0);
    expect(l.items.map((i) => [i.label, i.a0, i.a1])).toEqual([['a1', 0, 90], ['a2', 90, 180], ['a3', 180, 270], ['c1', 270, 360]]);
    expect(l.groups).toEqual([{ label: 'A', a0: 0, a1: 270 }, { label: 'C', a0: 270, a1: 360 }]);
    expect(sunburstLayout([])).toEqual({ groups: [], items: [] });
  });
  it('draws a closed ring slice', () => {
    const d = ringSlice(100, 100, 50, 90, 0, 90);
    expect(d.startsWith('M 100.00 10.00 A 90 90 0 0 1 190.00 100.00 L 150.00 100.00 A 50 50 0 0 0 100.00 50.00')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('squarified treemap', () => {
  const rect = { x: 0, y: 0, w: 600, h: 400 };
  const items = [6, 6, 4, 3, 2, 2, 1].map((weight, i) => ({ id: i, weight }));
  const out = squarify(items, rect);
  it('gives every block an area proportional to its weight and fills the rectangle', () => {
    const total = 24;
    for (const b of out) expect(b.w * b.h).toBeCloseTo((b.weight / total) * 600 * 400, 6);
    expect(out.reduce((s, b) => s + b.w * b.h, 0)).toBeCloseTo(600 * 400, 6);
  });
  it('keeps every block inside and none overlapping', () => {
    for (const b of out) {
      expect(b.x).toBeGreaterThanOrEqual(-1e-9);
      expect(b.y).toBeGreaterThanOrEqual(-1e-9);
      expect(b.x + b.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(b.y + b.h).toBeLessThanOrEqual(400 + 1e-6);
    }
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox <= 1e-6 || oy <= 1e-6).toBe(true);
      }
  });
  it('keeps blocks close to square (the reference example: worst ratio under 3)', () => {
    for (const b of out) expect(Math.max(b.w / b.h, b.h / b.w)).toBeLessThan(3);
  });
  it('leaves out zero weights and handles nothing to draw', () => {
    expect(squarify([{ weight: 0 }, { weight: 2 }], rect)).toHaveLength(1);
    expect(squarify([], rect)).toEqual([]);
  });
});
