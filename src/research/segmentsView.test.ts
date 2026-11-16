import { describe, expect, it } from 'vitest';
import { coverageNote, segmentRows, segmentWords, share, type SegmentSection } from './segmentsView';

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


describe('segment flower words', () => {
  it('names the biggest part, the fastest grower and any shrinking part', () => {
    const item = (name: string, value: number, share: number, growth: number | null) => ({ member: name, name, value, prior: null, share, growth, operatingIncome: null, margin: null });
    const s = { axis: 'x', heading: 'By product', sum: 100, total: 100, complete: true, coverage: 1, items: [item('Phones', 50, 0.5, 0.02), item('Services', 30, 0.3, 0.13), item('Tablets', 20, 0.2, -0.05)] };
    expect(segmentWords(s)).toBe('Biggest: Phones, 50% of sales. Fastest growing: Services +13%; shrinking: Tablets −5%.');
    expect(segmentWords({ ...s, items: [item('Only', 10, 1, null)] })).toBe('Biggest: Only, 100% of sales.');
  });
});
