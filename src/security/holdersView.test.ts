import { describe, expect, it } from 'vitest';
import { holderWords } from './holdersView';

const row = (share: number, status: 'new' | 'added' | 'reduced' | 'same' | null) => ({ cik: 1, name: 'x', shares: 1, share, change: 0, status });

describe('holders', () => {
  it('sums the top ten and counts what they did', () => {
    expect(holderWords([row(0.2, 'added'), row(0.1, 'reduced'), row(0.05, 'new'), row(0.04, null)])).toBe(
      'The 4 biggest holders own 39% of the shares reported on 13F; last quarter 1 added, 1 cut, 1 new.',
    );
    expect(holderWords([])).toBe('');
  });
});
