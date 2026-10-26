import { describe, expect, it } from 'vitest';
import { TickMarkType } from 'lightweight-charts';
import { cardTick } from './homePage';

// 2026-10-27 14:30 UTC = Tue 10:30 in New York (EDT).
const t = Date.UTC(2026, 9, 27, 14, 30) / 1000;

describe('index card axis labels', () => {
  it('shows short times on the 1-day view', () => expect(cardTick(t, TickMarkType.Time, '1D')).toBe('10:30'));
  it('shows the weekday where a 5-day session starts', () => expect(cardTick(t, TickMarkType.DayOfMonth, '5D')).toBe('Tue 27'));
  it('shows times between session starts on the 5-day view', () => expect(cardTick(t, TickMarkType.Time, '5D')).toBe('10:30'));
  it('shows dates on the 1-month view', () => expect(cardTick(Date.UTC(2026, 9, 27) / 1000, TickMarkType.DayOfMonth, '1M')).toBe('Oct 27'));
  it('keeps every label within 6 characters', () => {
    for (const r of ['1D', '5D', '1M'] as const) for (const k of [TickMarkType.DayOfMonth, TickMarkType.Time]) expect(cardTick(t, k, r).length).toBeLessThanOrEqual(6);
  });
});
