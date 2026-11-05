import { describe, expect, it } from 'vitest';
import { latencyText, marketSession } from './statusBar';
import { beginRequest, getActivity } from '../data/health';

const at = (iso: string) => marketSession(new Date(iso));

describe('market session (New York time)', () => {
  it('follows daylight saving: 13:35 UTC is pre-market in winter, regular in summer', () => {
    // 2026: DST starts Sunday March 8 and ends Sunday November 1
    expect(at('2026-03-06T13:35:00Z')).toMatchObject({ session: 'pre', nyTime: '08:35' }); // Friday, EST
    expect(at('2026-03-09T13:35:00Z')).toMatchObject({ session: 'regular', nyTime: '09:35' }); // Monday, EDT
    expect(at('2026-10-30T19:30:00Z')).toMatchObject({ session: 'regular', nyTime: '15:30' }); // Friday, EDT
    expect(at('2026-11-02T19:30:00Z')).toMatchObject({ session: 'regular', nyTime: '14:30' }); // Monday, EST
    expect(at('2026-11-02T21:30:00Z')).toMatchObject({ session: 'after', nyTime: '16:30' });
  });

  it('has exact edges and closes weekends and nights', () => {
    expect(at('2026-11-04T14:29:00Z').session).toBe('pre'); // 9:29 EST
    expect(at('2026-11-04T14:30:00Z').session).toBe('regular'); // 9:30
    expect(at('2026-11-04T21:00:00Z').session).toBe('after'); // 16:00
    expect(at('2026-11-05T01:00:00Z').session).toBe('closed'); // 20:00
    expect(at('2026-11-04T08:59:00Z').session).toBe('closed'); // 3:59
    expect(at('2026-11-04T09:00:00Z').session).toBe('pre'); // 4:00
    expect(at('2026-11-07T16:00:00Z').session).toBe('closed'); // Saturday 11:00
    expect(at('2026-11-07T16:00:00Z').label).toBe('Closed');
  });

  it('formats latency', () => {
    expect(latencyText(null)).toBe('—');
    expect(latencyText(48.4)).toBe('48 ms');
    expect(latencyText(1234)).toBe('1.2 s');
  });

  it('counts requests on the way and the last answer time', () => {
    let t = 1000;
    const end = beginRequest(() => t);
    expect(getActivity().inflight).toBe(1);
    t = 1080;
    end(true);
    end(true); // a second call is ignored
    expect(getActivity()).toMatchObject({ inflight: 0, lastLatencyMs: 80, lastAt: 1080 });
    const failed = beginRequest(() => t);
    failed(false);
    expect(getActivity()).toMatchObject({ inflight: 0, lastLatencyMs: 80 });
  });
});
