import { describe, expect, it } from 'vitest';
import { barScale, togglePick } from './faGraph';

describe('financials graph', () => {
  it('scales to the biggest value and puts zero where losses start', () => {
    expect(barScale([{ key: 'a', label: 'A', values: [10, 30, null] }])).toEqual({ top: 30, bottom: 0, zero: 1 });
    expect(barScale([{ key: 'a', label: 'A', values: [30, -10] }])).toEqual({ top: 30, bottom: -10, zero: 0.75 });
    expect(barScale([])).toEqual({ top: 0, bottom: 0, zero: 0 });
  });
  it('toggles picks and keeps at most three', () => {
    expect(togglePick(['a', 'b'], 'a')).toEqual(['b']);
    expect(togglePick(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd']);
  });
});
