import { describe, expect, it } from 'vitest';
import { selfCheckLabel } from './selfCheck';

describe('self-check in the status bar', () => {
  it('says how many problems there are', () => {
    expect(selfCheckLabel(null)).toEqual({ text: 'Self-check', state: 'idle' });
    expect(selfCheckLabel({ at: 1, ok: true, problems: 0, checked: 7, checks: [] }).state).toBe('ok');
    expect(selfCheckLabel({ at: 1, ok: false, problems: 2, checked: 7, checks: [] }).text).toBe('Self-check: 2 problems');
    expect(selfCheckLabel({ at: 1, ok: false, problems: 1, checked: 7, checks: [] }).text).toBe('Self-check: 1 problem');
  });
});
