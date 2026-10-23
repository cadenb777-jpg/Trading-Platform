import { describe, expect, it } from 'vitest';
import { sessionPrevClose, type Quote } from './quotes';
import type { Bar } from '../types';

const bar = (time: number, close: number): Bar => ({ time, open: close, high: close, low: close, close, volume: 0 });
const daily = [bar(1, 100), bar(2, 104), bar(3, 102)];
const q = (last: number, prevClose: number | null): Quote => ({ symbol: '$SPX', last, prevClose });

describe('sessionPrevClose', () => {
  it('uses the day before when the newest daily bar is the latest session', () => {
    expect(sessionPrevClose(q(102, 102), daily)).toBe(104);
  });
  it('uses the newest daily bar when the price has moved past it', () => {
    expect(sessionPrevClose(q(103, 103), daily)).toBe(102);
  });
  it('leaves a real change alone', () => {
    expect(sessionPrevClose(q(103, 101), daily)).toBeNull();
  });
  it('rejects bars that clearly do not match the quote', () => {
    expect(sessionPrevClose(q(6650, 6650), daily)).toBeNull();
  });
  it('needs at least two daily bars', () => {
    expect(sessionPrevClose(q(102, 102), [bar(1, 101)])).toBeNull();
  });
});
