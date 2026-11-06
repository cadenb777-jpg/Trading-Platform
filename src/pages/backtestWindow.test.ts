import { describe, expect, it } from 'vitest';
import { onlyFrom, testWindow, warmupDays } from './backtestPage';

describe('backtest date window', () => {
  it('reads the date boxes', () => {
    expect(testWindow('', '')).toEqual({ from: undefined, to: undefined });
    const w = testWindow('2020-01-01', '2021-12-31');
    expect(w.from).toBe(Date.UTC(2020, 0, 1) / 1000);
    expect(w.to).toBe(Date.UTC(2021, 11, 31, 23, 59, 59) / 1000);
    expect(testWindow('2021-01-01', '2020-01-01').error).toMatch(/before/);
    expect(testWindow('2999-01-01', '').error).toMatch(/future/);
  });
  it('opens no trades before the start, keeps exits', () => {
    const s = onlyFrom({ enterLong: [true, true, true], exitLong: [true, false, true] }, 2);
    expect(s.enterLong).toEqual([false, false, true]);
    expect(s.exitLong).toEqual([true, false, true]);
  });
  it('warms indicators up', () => {
    expect(warmupDays('1D')).toBeGreaterThan(250);
  });
});
