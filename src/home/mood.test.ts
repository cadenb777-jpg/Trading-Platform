import { describe, expect, it } from 'vitest';
import { sectorWords, vixWords } from './mood';

describe('market mood words', () => {
  it('reads the VIX', () => {
    expect(vixWords(null)).toBe('Waiting for the VIX.');
    expect(vixWords(12)).toMatch(/^Very calm/);
    expect(vixWords(16)).toMatch(/^Calm/);
    expect(vixWords(22)).toMatch(/^Nervous/);
    expect(vixWords(30)).toMatch(/^Fearful/);
    expect(vixWords(45)).toMatch(/^Panic/);
    expect(vixWords(17.32)).toContain('±5.0%');
  });
  it('sums up the sectors', () => {
    expect(sectorWords([{ label: 'A', value: 1 }])).toBe('Waiting for sector prices.');
    expect(sectorWords([{ label: 'Tech', value: 1.2 }, { label: 'Energy', value: -0.8 }, { label: 'Utilities', value: 0.1 }, { label: 'Staples', value: null }])).toBe(
      '2 of 3 sectors up (a mixed tape). Leading: Tech +1.2%; lagging: Energy −0.8%.',
    );
  });
});
