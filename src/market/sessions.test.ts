import { describe, expect, it } from 'vitest';
import { isTradingDay, nextOpenLabel, sessionAt, sessionLabel } from './sessions';
import { marketStatus } from '../ui/marketClock';
import { marketSession } from '../ui/statusBar';

const at = (iso: string) => sessionAt(new Date(iso));

describe('NYSE sessions', () => {
  it('closes on holidays (Thanksgiving 2026, Good Friday, observed days)', () => {
    expect(at('2026-11-26T15:00:00Z')).toMatchObject({ session: 'closed', holiday: 'Thanksgiving' });
    expect(at('2026-04-03T15:00:00Z').session).toBe('closed');
    expect(at('2026-07-03T15:00:00Z').session).toBe('closed'); // July 4 is a Saturday
    expect(at('2027-12-24T15:00:00Z').session).toBe('closed');
    expect(isTradingDay('2026-11-25')).toBe(true);
    expect(isTradingDay('2026-11-28')).toBe(false); // Saturday
    expect(marketSession(new Date('2026-11-26T15:00:00Z')).label).toBe('Closed: Thanksgiving');
  });

  it('closes early at 1:00 PM on the day after Thanksgiving and Christmas Eve, after hours to 5:00 PM', () => {
    expect(at('2026-11-27T17:59:00Z')).toMatchObject({ session: 'regular', earlyClose: true, minutesLeft: 1 }); // 12:59 EST
    expect(at('2026-11-27T18:00:00Z').session).toBe('after'); // 13:00
    expect(at('2026-11-27T21:59:00Z').session).toBe('after'); // 16:59
    expect(at('2026-11-27T22:00:00Z').session).toBe('closed'); // 17:00
    expect(at('2026-12-24T18:30:00Z').session).toBe('after');
    expect(sessionLabel(new Date('2026-11-27T15:00:00Z'))).toContain('early close 1:00 PM');
    expect(sessionLabel(new Date('2026-11-27T19:00:00Z'))).toBe('After hours · closed at 1:00 PM ET');
  });

  it('says when it opens next, skipping weekends and holidays', () => {
    expect(nextOpenLabel(new Date('2026-11-25T23:00:00Z'))).toBe('Friday'); // Wed evening → Thanksgiving skipped
    expect(nextOpenLabel(new Date('2026-11-04T12:00:00Z'))).toBe('today'); // 7:00 on a Wednesday
    expect(nextOpenLabel(new Date('2026-11-05T02:00:00Z'))).toBe('tomorrow'); // Wed 21:00
    expect(nextOpenLabel(new Date('2026-11-07T15:00:00Z'))).toBe('Monday');
    expect(sessionLabel(new Date('2026-11-26T15:00:00Z'))).toBe('Market closed (Thanksgiving) · opens tomorrow 9:30 AM ET');
  });

  it('feeds Home’s market pill (marketClock) from the same rules', () => {
    expect(marketStatus(new Date('2026-11-26T15:00:00Z')).phase).toBe('closed');
    expect(marketStatus(new Date('2026-11-27T15:00:00Z')).phase).toBe('open');
    expect(marketStatus(new Date('2026-11-27T19:00:00Z')).phase).toBe('post');
  });
});
