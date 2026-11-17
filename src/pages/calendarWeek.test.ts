import { describe, expect, it } from 'vitest';
import { surprise, weekDays } from './calendarPage';

const ev = (actual: string, forecast: string, impact: 'high' | 'medium' | 'low' = 'high', time = 0) => ({ title: 'x', country: 'USD', time, impact, forecast, previous: '', actual });

describe('calendar visuals', () => {
  it('measures actual against forecast for the little bar', () => {
    expect(surprise(ev('0.3%', '0.3%'))).toBe(0);
    expect(surprise(ev('0.4%', '0.3%'))).toBeCloseTo(0.5);
    expect(surprise(ev('300K', '200K'))).toBe(1);
    expect(surprise(ev('', '0.3%'))).toBeNull();
  });
  it('counts each day’s big events in order', () => {
    const list = [ev('', '', 'high', 1), ev('', '', 'medium', 2), ev('', '', 'high', 100), ev('', '', 'low', 101)];
    expect(weekDays(list, (t) => (t < 50 ? 'Mon' : 'Tue'))).toEqual([
      { day: 'Mon', high: 1, medium: 1, total: 2 },
      { day: 'Tue', high: 1, medium: 0, total: 2 },
    ]);
  });
});
