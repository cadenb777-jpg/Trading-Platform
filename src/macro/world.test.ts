import { describe, expect, it } from 'vitest';
import { changeText, fmtPeriod, fmtWorld, groupByRegion, pickCountries, sparkPath } from './world';

const rows = [
  { code: 'JPN', name: 'Japan', region: 'Asia-Pacific' },
  { code: 'USA', name: 'United States', region: 'Americas' },
  { code: 'DEU', name: 'Germany', region: 'Europe' },
  { code: 'CAN', name: 'Canada', region: 'Americas' },
  { code: 'ZAF', name: 'South Africa', region: 'Africa' },
];

describe('groupByRegion', () => {
  it('groups in WEI order (Americas, Europe, Asia-Pacific) and keeps row order inside a region', () => {
    const g = groupByRegion(rows);
    expect(g.map((x) => x.region)).toEqual(['Americas', 'Europe', 'Asia-Pacific', 'Africa']);
    expect(g[0].rows.map((r) => r.code)).toEqual(['USA', 'CAN']);
  });
  it('shows only the picked countries and drops empty regions', () => {
    const g = groupByRegion(rows, ['DEU', 'CAN']);
    expect(g.map((x) => [x.region, x.rows.map((r) => r.code)])).toEqual([['Americas', ['CAN']], ['Europe', ['DEU']]]);
  });
  it('treats an empty pick as everything', () => {
    expect(groupByRegion(rows, []).flatMap((g) => g.rows).length).toBe(5);
  });
});

describe('pickCountries', () => {
  it('keeps saved known codes, or falls back to all', () => {
    expect(pickCountries(['USA', 'XXX'], ['USA', 'DEU'])).toEqual(['USA']);
    expect(pickCountries(['XXX'], ['USA', 'DEU'])).toEqual(['USA', 'DEU']);
    expect(pickCountries(null, ['USA'])).toEqual(['USA']);
  });
});

describe('formatting', () => {
  it('formats each unit', () => {
    expect(fmtWorld(2.84, '%')).toBe('2.8%');
    expect(fmtWorld(-0.1, '%')).toBe('−0.1%');
    expect(fmtWorld(121.6, '% GDP')).toBe('122%');
    expect(fmtWorld(100.31, '')).toBe('100.3');
    expect(fmtWorld(1.0832, '')).toBe('1.0832');
    expect(fmtWorld(-0.25, 'pts')).toBe('−0.25 pts');
    expect(fmtWorld(150, 'K')).toBe('150K');
    expect(fmtWorld(-12, 'K')).toBe('−12K');
    expect(fmtWorld(38.12, '$T')).toBe('$38.12T');
    expect(fmtWorld(null, '%')).toBe('—');
  });
  it('periods', () => {
    expect(fmtPeriod('2025')).toBe('2025');
    expect(fmtPeriod('2026-09-01')).toBe('Sep 2026');
    expect(fmtPeriod('2026-04-01', true)).toBe('2026 Q2');
    expect(fmtPeriod('2026-11-03')).toBe('Nov 3, 2026');
  });
  it('changes', () => {
    expect(changeText(3.1, 2.9, '%')).toBe('+0.20 pts');
    expect(changeText(100, 150, 'K')).toBe('−50K');
    expect(changeText(1.1, 1.0, '')).toBe('+10.0%');
    expect(changeText(1, null, '%')).toBeNull();
    expect(changeText(2, 2, '%')).toBe('unchanged');
  });
});

describe('sparkPath', () => {
  it('scales into the box, highest value at the top', () => {
    const d = sparkPath([1, 3, 2], 10, 10);
    expect(d).toBe('M2.0 8.0 L5.0 2.0 L8.0 5.0');
  });
  it('needs two points; a flat line sits at the bottom', () => {
    expect(sparkPath([1])).toBe('');
    expect(sparkPath([2, 2], 10, 10)).toBe('M2.0 8.0 L8.0 8.0');
  });
});
