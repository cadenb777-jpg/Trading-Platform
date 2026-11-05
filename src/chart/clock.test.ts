import { describe, expect, it } from 'vitest';
import { clockText } from './clock';
import { sessionPhase } from './session';

const utc = (s: string) => Date.parse(`${s}Z`) / 1000;

describe('clock', () => {
  it('12-hour and 24-hour times', () => {
    expect(clockText(0, 5, '12h')).toBe('12:05 AM');
    expect(clockText(9, 30, '12h')).toBe('9:30 AM');
    expect(clockText(12, 0, '12h')).toBe('12:00 PM');
    expect(clockText(16, 0, '12h')).toBe('4:00 PM');
    expect(clockText(16, 0, '24h')).toBe('16:00');
    expect(clockText(9, 5, '24h')).toBe('09:05');
  });
});

describe('session phases (New York)', () => {
  it('pre-market, regular, after-hours and closed', () => {
    // Thursday 5 Nov 2026, New York is UTC-5
    expect(sessionPhase(utc('2026-11-05T08:59:00'))).toBe('closed'); // 3:59 am
    expect(sessionPhase(utc('2026-11-05T09:00:00'))).toBe('pre'); // 4:00 am
    expect(sessionPhase(utc('2026-11-05T14:29:00'))).toBe('pre'); // 9:29 am
    expect(sessionPhase(utc('2026-11-05T14:30:00'))).toBe('regular'); // 9:30 am
    expect(sessionPhase(utc('2026-11-05T21:00:00'))).toBe('post'); // 4:00 pm
    expect(sessionPhase(utc('2026-11-06T01:00:00'))).toBe('closed'); // 8:00 pm
    expect(sessionPhase(utc('2026-11-07T15:00:00'))).toBe('closed'); // Saturday
  });
});
