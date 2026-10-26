import { describe, expect, it } from 'vitest';
import { leftOutLine, monthYear, shortHistoryAdvice, standInLine, yearsBetween } from './optimiserText';

describe('optimiser short-history text', () => {
  it('names the stand-in, its correlation and the real start month', () => {
    expect(monthYear('2025-04-07')).toBe('Apr 2025');
    expect(standInLine({ symbol: 'XYZ', standIn: 'QQQ', correlation: 0.934, beta: 1.2, realStart: '2025-04-07' })).toBe(
      'Before Apr 2025, XYZ’s history is estimated from QQQ (correlation 0.93).',
    );
    expect(leftOutLine({ symbol: 'ODD', realStart: '2025-04-07' })).toContain('left out of the test');
  });

  it('measures years and gives advice for both cases', () => {
    expect(yearsBetween('2025-04-25', '2026-10-23')).toBe(1.5);
    expect(shortHistoryAdvice(1.5, 'none')).toContain('about 1.5 years');
    expect(shortHistoryAdvice(3, 'short')).toContain('low confidence');
  });
});
