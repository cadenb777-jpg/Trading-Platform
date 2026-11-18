import { describe, expect, it } from 'vitest';
import { arcPath, flowWidth, gaugeAngle, heatShare, mixSegments, petalPoints, polar, trackPos } from './viz';

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
