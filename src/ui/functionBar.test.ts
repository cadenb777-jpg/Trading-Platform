import { describe, expect, it } from 'vitest';
import { fnKeyIndex } from './functionBar';

describe('function bar keys', () => {
  it('maps 1-9 to the chips that exist', () => {
    expect(fnKeyIndex({ key: '1' }, 4)).toBe(0);
    expect(fnKeyIndex({ key: '4' }, 4)).toBe(3);
    expect(fnKeyIndex({ key: '5' }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '0' }, 9)).toBeNull();
    expect(fnKeyIndex({ key: 'a' }, 9)).toBeNull();
  });

  it('is ignored while typing, with a dialog open, or with a modifier', () => {
    expect(fnKeyIndex({ key: '1', inField: true }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '1', modalOpen: true }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '1', ctrl: true }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '1', meta: true }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '1', alt: true }, 4)).toBeNull(); // Alt+1-6 is the panel jump
  });
});
