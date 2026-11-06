import { describe, expect, it } from 'vitest';
import { tapeChange, tapeSymbols } from '../home/tickerTape';
import { clampPos, moodFor, petLine } from './buddy';

describe('market buddy', () => {
  it('mood follows the S&P 500', () => {
    expect(moodFor(null)).toBe('calm');
    expect(moodFor(0.5)).toBe('happy');
    expect(moodFor(0.2)).toBe('calm');
    expect(moodFor(-0.31)).toBe('sad');
    expect(moodFor(Number.NaN)).toBe('calm');
  });
  it('says something about the market when petted', () => {
    expect(petLine(1.234, 0)).toContain('+1.23%');
    expect(petLine(-0.8, 0)).toContain('−0.80%');
    expect(petLine(null, 1)).toMatch(/Waiting/);
  });
  it('stays on screen', () => {
    expect(clampPos(-50, -50, 1000, 800)).toEqual([4, 4]);
    expect(clampPos(5000, 5000, 1000, 800)).toEqual([1000 - 78 - 4, 800 - 78 - 30]);
  });
});

describe('ticker tape', () => {
  it('core list plus new watchlist stocks, capped', () => {
    const s = tapeSymbols(['SPY', 'AMD', 'BTC-USD', 'PLTR']);
    expect(s.slice(0, 2)).toEqual(['SPY', 'QQQ']);
    expect(s).toContain('AMD');
    expect(s).toContain('PLTR');
    expect(s).not.toContain('BTC-USD');
    expect(s.filter((x) => x === 'SPY')).toHaveLength(1);
  });
  it('change text with an arrow', () => {
    expect(tapeChange({ symbol: 'X', last: 101, prevClose: 100 })).toEqual({ text: '▲ +1.00%', tone: 'up' });
    expect(tapeChange({ symbol: 'X', last: 99, prevClose: 100 })).toEqual({ text: '▼ −1.00%', tone: 'down' });
    expect(tapeChange(undefined).text).toBe('—');
  });
});

import { COATS, pixelRects } from './buddy';
describe('pixel dog', () => {
  it('merges runs into rects and skips empty pixels', () => {
    expect(pixelRects(['.OO.', 'FW..'])).toBe('<rect class="p-o" x="1" y="0" width="2" height="1"/><rect class="p-f" x="0" y="1" width="1" height="1"/><rect class="p-w" x="1" y="1" width="1" height="1"/>');
  });
  it('every coat has fur, ears and outline colours', () => {
    for (const c of Object.values(COATS)) expect(c.every((x) => /^#[0-9a-f]{6}$/i.test(x))).toBe(true);
  });
});

import { nearestFree } from './buddy';
describe('buddy keeps clear of the page', () => {
  it('moves to the nearest free spot, or stays when already free', () => {
    const busy = (x: number) => x < 500; // everything left of 500 px is content
    expect(nearestFree(600, 300, 1440, 900, (x) => !busy(x))).toEqual([600, 300]);
    const spot = nearestFree(400, 300, 1440, 900, (x) => !busy(x))!;
    expect(spot[0]).toBeGreaterThanOrEqual(500);
    expect(spot[0]).toBeLessThan(560);
    expect(nearestFree(400, 300, 1440, 900, () => false)).toBeNull();
  });
});

import { spotIsFree } from './buddy';
describe('buddy sees a thin row of buttons', () => {
  it('a 24 px button row across the middle of the box is not free', () => {
    // box 0..78 x 0..78; a button row from y 40 to 64 (the old 3 x 3 grid sampled y 7.8, 39 and 70.2 and missed it)
    const btn = { closest: (sel: string) => (sel.includes('button') ? btn : null), childNodes: [] } as unknown as Element;
    const gap = { closest: () => null, childNodes: [] } as unknown as Element;
    expect(spotIsFree(0, 0, 78, 78, (_x, y) => (y >= 40 && y <= 64 ? btn : gap))).toBe(false);
    expect(spotIsFree(0, 0, 78, 78, () => gap)).toBe(true);
  });
});
