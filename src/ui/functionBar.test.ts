import { describe, expect, it } from 'vitest';
import { fnKeyIndex, inFlightGuard } from './functionBar';

describe('function bar keys', () => {
  it('maps 1-9 to the chips that exist', () => {
    expect(fnKeyIndex({ key: '1' }, 4)).toBe(0);
    expect(fnKeyIndex({ key: '4' }, 4)).toBe(3);
    expect(fnKeyIndex({ key: '5' }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '0' }, 9)).toBeNull();
    expect(fnKeyIndex({ key: 'a' }, 9)).toBeNull();
  });

  it('is ignored while typing, with a modifier, with focus off the page or with any overlay open', () => {
    expect(fnKeyIndex({ key: '1', inField: true }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '1', ctrl: true }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '1', meta: true }, 4)).toBeNull();
    expect(fnKeyIndex({ key: '1', alt: true }, 4)).toBeNull(); // Alt+1-6 is the panel jump
    // the security slide-over, the AI drawer, a pop-out chart window, the launchpad: the page underneath keeps still
    expect(fnKeyIndex({ key: '4', overlayOpen: true }, 4)).toBeNull();
    // focus in the rail, the status bar or a drawer
    expect(fnKeyIndex({ key: '4', focusOutside: true }, 4)).toBeNull();
  });
});

describe('one request at a time per chip', () => {
  it('ignores presses while the request is on its way, then allows the next', async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const busy: boolean[] = [];
    const press = inFlightGuard(
      () => {
        calls++;
        return new Promise<void>((r) => (finish = r));
      },
      (b) => busy.push(b),
    );
    expect(press()).toBe(true);
    expect(press()).toBe(false);
    expect(press()).toBe(false);
    expect(calls).toBe(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(busy).toEqual([true, false]);
    expect(press()).toBe(true);
    expect(calls).toBe(2);
  });

  it('frees the chip after a failure, and never blocks plain actions', async () => {
    let fail: (e: Error) => void = () => {};
    const press = inFlightGuard(() => new Promise((_, rej) => (fail = rej)));
    press();
    fail(new Error('helper offline'));
    await new Promise((r) => setTimeout(r, 0));
    expect(press()).toBe(true);
    let n = 0;
    const plain = inFlightGuard(() => void n++);
    plain();
    plain();
    expect(n).toBe(2);
  });
});
