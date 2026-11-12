import { describe, expect, it } from 'vitest';
import { columnLabel, figure, pickerGroups, type ArItem } from './asReportedView';

describe('as reported view', () => {
  it('labels years, quarters and balance dates', () => {
    expect(columnLabel({ start: '2024-09-29', end: '2025-09-27' })).toBe('Year to Sep 2025');
    expect(columnLabel({ start: '2025-06-29', end: '2025-09-27' })).toBe('Qtr to Sep 2025');
    expect(columnLabel({ start: null, end: '2025-09-27' })).toBe('Sep 27, 2025');
  });
  it('formats amounts, per-share figures, rates and share counts', () => {
    expect(figure(null, 'Revenues')).toBe('');
    expect(figure(7.46, 'EarningsPerShareDiluted')).toBe('7.46');
    expect(figure(0.21, 'EffectiveIncomeTaxRateContinuingOperations')).toBe('21.0%');
    expect(figure(14_948_500_000, 'WeightedAverageNumberOfDilutedSharesOutstanding')).toBe('14.95B');
  });
  it('puts the statements before the notes', () => {
    const items: ArItem[] = [
      { role: 'a', title: 'Statements Of Operations', kind: 'income', group: 'statement' },
      { role: 'b', title: 'Inventories', kind: 'details', group: 'details' },
    ];
    expect(pickerGroups(items).map((g) => [g.label, g.items.length])).toEqual([
      ['Statements', 1],
      ['Note details', 1],
    ]);
    expect(pickerGroups(items.slice(0, 1))).toHaveLength(1);
  });
});
