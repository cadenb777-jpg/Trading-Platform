import { describe, expect, it } from 'vitest';
import type { MarketRef } from '../data/quotes';
import { changeText, pulseList, PULSE_CORE } from './railPulse';

describe('market pulse', () => {
  it('shows the day change with a sign and tone', () => {
    expect(changeText(101, 100)).toEqual({ text: '+1.00%', tone: 'up' });
    expect(changeText(99.6, 100)).toEqual({ text: '−0.40%', tone: 'down' });
    expect(changeText(null, 100)).toEqual({ text: '—', tone: '' });
  });
  it('adds watchlist names not already in the core list, at most six', () => {
    const watch: MarketRef[] = [{ provider: 'schwab', symbol: 'SPY' }, ...'ABCDEFGH'.split('').map((s): MarketRef => ({ provider: 'schwab', symbol: s }))];
    const l = pulseList(watch);
    expect(l.core).toBe(PULSE_CORE);
    expect(l.watch.map((w) => w.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});
