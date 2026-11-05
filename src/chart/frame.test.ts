import { describe, expect, it } from 'vitest';
import { approach, frameBatch, latestPerFrame, mixColor, withAlpha } from './frame';
import { shouldPulse } from './livePrice';

/** A hand-cranked "animation frame" so tests decide when frames happen. */
function fakeFrames() {
  let queue: (() => void)[] = [];
  return {
    schedule: (cb: () => void) => queue.push(cb),
    tick() {
      const run = queue;
      queue = [];
      run.forEach((cb) => cb());
    },
    get waiting() {
      return queue.length;
    },
  };
}

describe('frameBatch', () => {
  it('runs once per frame with every push merged', () => {
    const frames = fakeFrames();
    const runs: number[] = [];
    const batch = frameBatch<number>((v) => runs.push(v), Math.min, frames.schedule);
    batch.push(9);
    batch.push(4);
    batch.push(7);
    expect(frames.waiting).toBe(1);
    expect(batch.pending).toBe(true);
    frames.tick();
    expect(runs).toEqual([4]);
    expect(batch.pending).toBe(false);
    batch.push(5);
    frames.tick();
    expect(runs).toEqual([4, 5]);
    frames.tick();
    expect(runs).toEqual([4, 5]);
  });

  it('flushes early and cancels', () => {
    const frames = fakeFrames();
    const runs: number[] = [];
    const batch = frameBatch<number>((v) => runs.push(v), Math.min, frames.schedule);
    batch.push(3);
    batch.flush();
    expect(runs).toEqual([3]);
    frames.tick(); // the scheduled frame no longer runs anything
    expect(runs).toEqual([3]);
    batch.push(8);
    batch.cancel();
    frames.tick();
    expect(runs).toEqual([3]);
    batch.push(2); // usable again after a cancel
    frames.tick();
    expect(runs).toEqual([3, 2]);
  });

  it('latestPerFrame keeps only the newest value', () => {
    const frames = fakeFrames();
    const seen: string[] = [];
    const latest = latestPerFrame<string>((v) => seen.push(v), frames.schedule);
    latest.push('a');
    latest.push('b');
    latest.push('c');
    frames.tick();
    expect(seen).toEqual(['c']);
  });
});

describe('last-price pulse', () => {
  it('fires on a new bar, or a move of a tick or more at least a second after the last pulse', () => {
    expect(shouldPulse(true, 0, 0.01, 10)).toBe(true);
    expect(shouldPulse(false, 0.01, 0.01, 1000)).toBe(true);
    expect(shouldPulse(false, -0.03, 0.01, 2500)).toBe(true);
    expect(shouldPulse(false, 0.005, 0.01, 5000)).toBe(false); // less than a tick
    expect(shouldPulse(false, 0.5, 0.01, 300)).toBe(false); // fast ticks: not every one
  });
});

describe('easing and colours', () => {
  it('approach moves toward the target and settles on it', () => {
    let v = 0;
    const steps: number[] = [];
    for (let i = 0; i < 100 && v !== 10; i++) steps.push((v = approach(v, 10, 16, 50)));
    expect(steps[0]).toBeGreaterThan(0);
    expect(steps[0]).toBeLessThan(10);
    expect(v).toBe(10);
    expect(approach(NaN, 5, 16, 50)).toBe(5);
  });

  it('withAlpha and mixColor', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
    expect(withAlpha('#f00', 0.25)).toBe('rgba(255,0,0,0.25)');
    expect(withAlpha('#ff000080', 0.5)).toBe('rgba(255,0,0,0.251)');
    expect(withAlpha('rgba(1,2,3,0.5)', 0.5)).toBe('rgba(1,2,3,0.25)');
    expect(withAlpha('red', 0.5)).toBe('red');
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColor('#102030', '#ffffff', 0)).toBe('#102030');
  });
});
