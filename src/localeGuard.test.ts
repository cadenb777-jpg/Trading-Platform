import { describe, expect, it } from 'vitest';
import { defaultLocaleWorks, installLocaleGuard, withFallback } from './localeGuard';

describe('locale guard', () => {
  it('a refused locale falls back to US English; other errors still throw', () => {
    expect(() => (1234.5).toLocaleString('en-US@posix')).toThrow(RangeError);
    expect(withFallback('en-US@posix', (loc) => (1234.5).toLocaleString(loc as string))).toBe('1,234.5');
    expect(withFallback('de-DE', (loc) => (1234.5).toLocaleString(loc as string))).toBe('1.234,5');
    expect(() => withFallback('en-US', () => { throw new TypeError('not a locale problem'); })).toThrow(TypeError);
  });

  it('a good default locale is left alone; once installed, the built-ins survive a broken locale', () => {
    expect(defaultLocaleWorks('en-US')).toBe(true);
    expect(defaultLocaleWorks('en-US@posix')).toBe(false);
    expect(installLocaleGuard()).toBe(false);
    installLocaleGuard(true);
    expect((1234.5).toLocaleString('en-US@posix')).toBe('1,234.5');
    expect(new Intl.NumberFormat('en-US@posix', { maximumFractionDigits: 0 }).format(1234.5)).toBe('1,235');
    expect(Intl.DateTimeFormat('en-US@posix', { timeZone: 'UTC', year: 'numeric' }).format(0)).toBe('1970');
    expect(new Date(0).toLocaleDateString('en-US@posix', { timeZone: 'UTC' })).toBe('1/1/1970');
    expect('a'.localeCompare('b', 'en-US@posix')).toBe(-1);
    expect(new Intl.NumberFormat('en-US') instanceof Intl.NumberFormat).toBe(true);
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Not/AZone' })).toThrow(RangeError);
  });
});
