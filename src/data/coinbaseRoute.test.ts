import { describe, expect, it } from 'vitest';
import { tryDirect } from './coinbase';

describe('crypto route', () => {
  it('tries Coinbase directly unless it failed in the last 10 minutes and the helper can step in', () => {
    expect(tryDirect(0, 1_000_000, true)).toBe(true);
    expect(tryDirect(1_000_000, 1_000_000 + 60_000, true)).toBe(false);
    expect(tryDirect(1_000_000, 1_000_000 + 11 * 60_000, true)).toBe(true);
    expect(tryDirect(1_000_000, 1_000_000 + 60_000, false)).toBe(true); // no helper route: keep trying Coinbase
  });
});
