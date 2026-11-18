import { describe, expect, it } from 'vitest';
import { EXCHANGES, groupAverages, leaders, localTime, sessionState } from './monitor';

const ny = EXCHANGES.find((x) => x.city === 'New York')!;
const tokyo = EXCHANGES.find((x) => x.city === 'Tokyo')!;

describe('world market clocks', () => {
  it('reads local time in a time zone', () => {
    // Wed 18 Nov 2026 15:00 UTC = 10:00 in New York (EST), 00:00 Thursday in Tokyo
    const t = new Date(Date.UTC(2026, 10, 18, 15, 0));
    expect(localTime(t, 'America/New_York')).toEqual({ day: 3, minutes: 600, text: '10:00' });
    expect(localTime(t, 'Asia/Tokyo').day).toBe(4);
  });
  it('knows open, closed, lunch and weekends', () => {
    expect(sessionState(ny, new Date(Date.UTC(2026, 10, 18, 15, 0)))).toEqual({ state: 'open', time: '10:00', note: 'Closes in 6h 0m' });
    expect(sessionState(ny, new Date(Date.UTC(2026, 10, 18, 14, 0))).note).toBe('Opens in 30m');
    expect(sessionState(ny, new Date(Date.UTC(2026, 10, 18, 22, 0))).state).toBe('closed');
    expect(sessionState(ny, new Date(Date.UTC(2026, 10, 21, 15, 0))).note).toBe('Weekend');
    // 12:00 in Tokyo (03:00 UTC) on a Wednesday: lunch
    expect(sessionState(tokyo, new Date(Date.UTC(2026, 10, 18, 3, 0))).state).toBe('lunch');
  });
});

describe('monitor helpers', () => {
  it('averages each group over the members that have a price', () => {
    const ch: Record<string, number | null> = { A: 0.02, B: 0, C: null, D: -0.01 };
    expect(groupAverages({ g1: ['A', 'B', 'C'], g2: ['D'], g3: ['C'] }, (s) => ch[s])).toEqual([
      { group: 'g1', avg: 0.01, priced: 2, count: 3 },
      { group: 'g2', avg: -0.01, priced: 1, count: 1 },
      { group: 'g3', avg: null, priced: 0, count: 1 },
    ]);
  });
  it('picks leaders and laggards, only real gains and losses', () => {
    const rows = [{ s: 'a', change: 0.03 }, { s: 'b', change: -0.02 }, { s: 'c', change: 0.01 }, { s: 'd', change: null }, { s: 'e', change: -0.05 }];
    const l = leaders(rows, 2);
    expect(l.up.map((r) => r.s)).toEqual(['a', 'c']);
    expect(l.down.map((r) => r.s)).toEqual(['e', 'b']);
    expect(leaders([{ change: 0.01 }], 2).down).toEqual([]);
  });
});
