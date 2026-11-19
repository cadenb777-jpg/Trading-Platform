import { describe, expect, it } from 'vitest';
import { checkWords, oldHelperSteps } from './updateCheck';

describe('check for updates', () => {
  it('says what failed and how to fix it', () => {
    const w = checkWords({ ok: false, mode: 'git', current: 90, message: 'Some files in your platform folder were changed on this computer.', fix: 'Run git stash.' });
    expect(w.tone).toBe('bad');
    expect(w.text).toContain('Fix: Run git stash.');
  });
  it('marks an install as in progress and up to date as fine', () => {
    expect(checkWords({ ok: true, mode: 'download', current: 90, latest: 91, restarting: true, message: 'Installing version 91' }).tone).toBe('warn');
    expect(checkWords({ ok: true, mode: 'git', current: 90, message: 'Up to date' }).tone).toBe('ok');
  });
  it('gives an old helper the one manual step', () => {
    expect(oldHelperSteps(82)).toContain('version 82');
    expect(oldHelperSteps(82)).toContain('git pull');
  });
});
