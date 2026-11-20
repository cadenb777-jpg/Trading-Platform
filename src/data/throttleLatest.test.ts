import { describe, expect, it } from 'vitest';
import { throttleLatest } from './quotes';

describe('one price change per second on screen', () => {
  it('shows the first at once, holds bursts and then shows only the newest', () => {
    let t = 0;
    const timers: { at: number; f: () => void }[] = [];
    const seen: number[] = [];
    const push = throttleLatest<number>((v) => seen.push(v), 1000, () => t, (f, ms) => timers.push({ at: t + ms, f }));
    push(1);
    t = 100; push(2);
    t = 300; push(3);
    t = 600; push(4);
    expect(seen).toEqual([1]);
    t = 1000; timers.shift()!.f();
    expect(seen).toEqual([1, 4]); // 2 and 3 were never painted
    t = 2500; push(5);
    expect(seen).toEqual([1, 4, 5]);
  });
});
