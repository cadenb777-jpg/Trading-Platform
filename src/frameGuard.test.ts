import { describe, expect, it } from 'vitest';
import { isFramed } from './frameGuard';

describe('clickjacking guard', () => {
  it('a normal tab or app window is not framed', () => {
    const w = {} as Window;
    expect(isFramed({ self: w, top: w } as unknown as Window)).toBe(false);
  });
  it('inside another page is framed', () => expect(isFramed({ self: {}, top: {} } as unknown as Window)).toBe(true));
  it('a browser that refuses to say counts as framed', () => {
    const w = { self: {} } as Record<string, unknown>;
    Object.defineProperty(w, 'top', { get() { throw new Error('cross-origin'); } });
    expect(isFramed(w as unknown as Window)).toBe(true);
  });
});
