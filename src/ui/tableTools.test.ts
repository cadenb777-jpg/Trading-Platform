import { describe, expect, it } from 'vitest';
import { compareCells, detectType, hasFilters, isActive, isBlank, loadState, matches, nextSort, parseNumber, saveState, tableView, type TableState } from './tableTools';

describe('parseNumber', () => {
  it('reads the formats the app prints', () => {
    expect(parseNumber('1.2%')).toBe(1.2);
    expect(parseNumber('+1.23%')).toBe(1.23);
    expect(parseNumber('-0.5%')).toBe(-0.5);
    expect(parseNumber('$3.4B')).toBe(3.4e9);
    expect(parseNumber('−$1.5M')).toBe(-1.5e6);
    expect(parseNumber('12.5K')).toBe(12500);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1.8×')).toBe(1.8);
    expect(parseNumber('25 bp')).toBe(25);
    expect(parseNumber('(2.5)')).toBe(-2.5);
    expect(parseNumber('2025')).toBe(2025);
  });
  it('rejects words, dates and placeholders', () => {
    for (const s of ['—', '', 'n/a', 'Apple', '2026-10-24', '10Y', '3 months', 'new']) expect(parseNumber(s)).toBeNull();
  });
  it('knows blanks', () => {
    expect(isBlank(' — ')).toBe(true);
    expect(isBlank('No quote')).toBe(true);
    expect(isBlank('0')).toBe(false);
  });
});

describe('detectType', () => {
  it('numbers when most filled cells are numbers', () => {
    expect(detectType(['1.2%', '—', '-3%', 'new', '4%', '5%', '6%'])).toBe('number');
  });
  it('pick-list for a few repeated values', () => {
    expect(detectType(['Long', 'Short', 'Long', 'Long'])).toBe('pick');
  });
  it('ISO dates are text, not a pick-list', () => {
    expect(detectType(['2026-10-23', '2026-10-24', '2026-10-23', '2026-10-24'])).toBe('text');
  });
  it('text for unique or many values', () => {
    expect(detectType(['Apple', 'Microsoft', 'Nvidia'])).toBe('text');
    expect(detectType(Array.from({ length: 20 }, (_, i) => `Fund ${String.fromCharCode(65 + (i % 10))}`))).toBe('text');
  });
  it('nothing to filter in empty or constant columns', () => {
    
    expect(detectType(['', '—'])).toBe('none');
    expect(detectType(['Filing', 'Filing', 'Filing'])).toBe('none');
  });
});

describe('sorting', () => {
  it('numbers sort numerically with blanks last both ways', () => {
    const vals = ['10%', '—', '-2%', '3.5%'];
    const sorted = (dir: 'asc' | 'desc') => [...vals].sort((a, b) => compareCells(a, b, 'number', dir));
    expect(sorted('desc')).toEqual(['10%', '3.5%', '-2%', '—']);
    expect(sorted('asc')).toEqual(['-2%', '3.5%', '10%', '—']);
  });
  it('text sorts alphabetically, numbers inside text naturally', () => {
    expect(['b', 'Item 10', 'a', 'Item 2', '—'].sort((x, y) => compareCells(x, y, 'text', 'asc'))).toEqual(['a', 'b', 'Item 2', 'Item 10', '—']);
  });
  it('header clicks cycle: numbers desc, asc, off; text asc, desc, off', () => {
    let s: TableState = { filters: {} };
    s.sort = nextSort(s, 'Price', 'number');
    expect(s.sort).toEqual({ col: 'Price', dir: 'desc' });
    s.sort = nextSort(s, 'Price', 'number');
    expect(s.sort).toEqual({ col: 'Price', dir: 'asc' });
    s.sort = nextSort(s, 'Price', 'number');
    expect(s.sort).toBeUndefined();
    s = { filters: {} };
    expect(nextSort(s, 'Name', 'text')).toEqual({ col: 'Name', dir: 'asc' });
  });
});

describe('filters', () => {
  it('text contains, ignoring case', () => {
    expect(matches('Apple Inc', 'text', { text: 'app' })).toBe(true);
    expect(matches('Microsoft', 'text', { text: 'app' })).toBe(false);
  });
  it('number min/max, parsing what you type', () => {
    expect(matches('$3.4B', 'number', { min: '1B' })).toBe(true);
    expect(matches('$300M', 'number', { min: '1B' })).toBe(false);
    expect(matches('5%', 'number', { min: '2', max: '6' })).toBe(true);
    expect(matches('—', 'number', { min: '0' })).toBe(false);
    expect(matches('—', 'number', { min: '' })).toBe(true);
  });
  it('pick-list hides unticked values', () => {
    expect(matches('Short', 'pick', { hide: ['Short'] })).toBe(false);
    expect(matches('Long', 'pick', { hide: ['Short'] })).toBe(true);
  });
  it('only filter fields matching the column type count', () => {
    expect(isActive('number', { hide: ['x'] })).toBe(false);
    expect(isActive('pick', { hide: ['x'] })).toBe(true);
    expect(isActive('text', { min: '2' })).toBe(false);
    const cols = [{ key: 'A', type: 'number' as const }];
    expect(hasFilters({ filters: { A: { hide: ['stale'] } } }, cols)).toBe(false);
    expect(hasFilters({ filters: { A: { min: '1' } } }, cols)).toBe(true);
  });
  it('leaves the order alone when nothing is sorted', () => {
    expect(tableView([['b'], ['a']], [{ key: 'x', type: 'text' }], { filters: {} }).order).toBeNull();
  });
  it('tableView filters and sorts together, keeping ties in their original order', () => {
    const rows = [
      ['Apple', 'Tech', '3%'],
      ['Exxon', 'Energy', '1%'],
      ['Microsoft', 'Tech', '3%'],
      ['Nvidia', 'Tech', '9%'],
    ];
    const cols = [
      { key: 'Name', type: 'text' as const },
      { key: 'Sector', type: 'pick' as const },
      { key: 'Today', type: 'number' as const },
    ];
    const v = tableView(rows, cols, { sort: { col: 'Today', dir: 'desc' }, filters: { Sector: { hide: ['Energy'] } } });
    expect(v.order).toEqual([3, 0, 2, 1]);
    expect(v.keep).toEqual([true, false, true, true]);
    expect([v.shown, v.total]).toEqual([3, 4]);
  });
});

describe('persistence', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
  };
  it('round-trips sort and filters per table id', () => {
    const store = memory();
    saveState('a', { sort: { col: 'Price', dir: 'asc' }, filters: { Name: { text: 'x' } } }, store);
    expect(loadState('a', store)).toEqual({ sort: { col: 'Price', dir: 'asc' }, filters: { Name: { text: 'x' } } });
    expect(loadState('b', store)).toEqual({ filters: {} });
    saveState('a', { filters: { Name: { text: '' } } }, store);
    expect(store.data.size).toBe(0);
  });
  it('falls back quietly when storage throws or holds junk', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadState('a', broken)).toEqual({ filters: {} });
    expect(() => saveState('a', { sort: { col: 'x', dir: 'asc' }, filters: {} }, broken)).not.toThrow();
    expect(loadState('a', { getItem: () => '{not json' })).toEqual({ filters: {} });
    expect(loadState('a', undefined)).toEqual({ filters: {} });
  });
});
