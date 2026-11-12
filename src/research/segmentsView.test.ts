import { describe, expect, it } from 'vitest';
import { coverageNote, segmentRows, share, type SegmentSection } from './segmentsView';

const apple: SegmentSection = {
  axis: 'ProductOrServiceAxis', heading: 'By product or service', sum: 416161, total: 416161, complete: true, coverage: 1,
  items: [
    { member: 'i', name: 'iPhone', value: 209586, prior: 201183, share: 0.5036, growth: 0.0418, operatingIncome: null, margin: null },
    { member: 's', name: 'Services', value: 109158, prior: 96169, share: 0.2623, growth: 0.135, operatingIncome: null, margin: null },
  ],
};

describe('where the money comes from', () => {
  it('scales bars to the biggest part', () => {
    const rows = segmentRows(apple);
    expect(rows[0].bar).toBe(1);
    expect(rows[1].bar).toBeCloseTo(109158 / 209586);
  });
  it('shows a share without a plus sign', () => {
    expect(share(0.5036)).toBe('50%');
    expect(share(null)).toBe('—');
  });
  it('explains a breakdown that does not add up', () => {
    expect(coverageNote(apple)).toBe('Adds up to total sales.');
    expect(coverageNote({ ...apple, complete: false, coverage: 0.74 })).toContain('74%');
  });
});
