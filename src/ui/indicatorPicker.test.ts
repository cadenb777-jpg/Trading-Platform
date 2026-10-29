import { describe, expect, it, beforeEach } from 'vitest';
import { allIndicators } from '../indicators/library';
import { buildIndex, favourites, recents, searchIndex } from './indicatorPicker';

const index = buildIndex(allIndicators());
const ids = (q: string) => searchIndex(index, q).map((e) => e.def.id);

describe('indicator picker search', () => {
  it('an empty query returns everything in library order', () => {
    expect(ids('')).toEqual(allIndicators().map((d) => d.id));
  });

  it('an exact short name or id comes first', () => {
    expect(ids('rsi')[0]).toBe('rsi');
    expect(ids('KAMA')[0]).toBe('kama');
    expect(ids('zlema')[0]).toBe('zlema');
  });

  it('finds indicators by alias and by every word of the query', () => {
    expect(ids('jurik')).toContain('jma');
    expect(ids('nadaraya')).toEqual(expect.arrayContaining(['nwkernel', 'nwenvelope']));
    expect(ids('pivot camarilla')).toEqual(['pivotscamarilla']);
    expect(ids('heiken')).toContain('heikinashi');
  });

  it('names starting with the query rank above matches in descriptions', () => {
    const r = ids('bollinger');
    expect(r.indexOf('bb')).toBeLessThan(r.indexOf('zchannel') === -1 ? Infinity : r.indexOf('zchannel'));
    expect(ids('nothing-called-this')).toEqual([]);
  });

  it('searches 400+ entries quickly', () => {
    const big = buildIndex(Array.from({ length: 5 }, () => allIndicators()).flat());
    const t = performance.now();
    for (const q of ['a', 'mo', 'mov', 'moving av', 'band', 'pivot']) searchIndex(big, q);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe('favourites and recently used', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage in this environment */
    }
  });

  it('toggle favourites and keep the 12 most recent adds, newest first, without duplicates', () => {
    if (typeof localStorage === 'undefined') return;
    expect(favourites.toggle('rsi')).toBe(true);
    expect(favourites.has('rsi')).toBe(true);
    expect(favourites.toggle('rsi')).toBe(false);
    for (let i = 0; i < 15; i++) recents.add(`x${i}`);
    recents.add('x10');
    const list = recents.list();
    expect(list).toHaveLength(12);
    expect(list[0]).toBe('x10');
    expect(new Set(list).size).toBe(12);
  });

  it('broken or blocked storage just gives empty lists', () => {
    if (typeof localStorage === 'undefined') {
      expect(favourites.list()).toEqual([]);
      expect(recents.list()).toEqual([]);
      return;
    }
    localStorage.setItem('tp.indicatorFavourites', '{not json');
    expect(favourites.list()).toEqual([]);
  });
});
