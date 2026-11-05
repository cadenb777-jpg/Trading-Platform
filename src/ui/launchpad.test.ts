import { describe, expect, it } from 'vitest';
import { launchItems, pushId, searchLaunch, toggleId } from './launchpad';

const items = launchItems();
const top = (q: string, favs: string[] = []) => searchLaunch(q, items, favs)[0];

describe('launchpad search', () => {
  it('lists every visible page and function once', () => {
    const ids = items.map((i) => i.id);
    expect(ids).toContain('page:home');
    expect(ids).toContain('page:strategy');
    expect(ids).not.toContain('page:sec');
    expect(new Set(items.map((i) => i.code)).size).toBe(items.length);
  });

  it('ranks an exact code first, in any case', () => {
    expect(top('WEI').code).toBe('WEI');
    expect(top('wei').code).toBe('WEI');
    expect(top('JRNL').id).toBe('page:journal');
    expect(top('des').code).toBe('DES');
  });

  it('then code prefixes, then names, then keywords', () => {
    expect(top('JR').id).toBe('page:journal');
    expect(top('strategy').id).toBe('page:strategy');
    expect(top('portfolios').id).toBe('page:portfolio');
    // only a keyword matches: dividends are on Account
    expect(searchLaunch('dividends', items).map((i) => i.id)).toContain('page:account');
    // a name match beats a keyword match
    const r = searchLaunch('calendar', items).map((i) => i.id);
    expect(r[0]).toBe('page:calendar');
  });

  it('favourites win ties, and nothing matches nonsense or an empty query', () => {
    const a = searchLaunch('prospect', items);
    expect(a.length).toBeGreaterThan(1);
    expect(searchLaunch('zzqx', items)).toEqual([]);
    expect(searchLaunch('  ', items)).toEqual([]);
    const twin = (code: string) => ({ id: `fn:${code}`, code, label: 'Gold watch', section: 'markets' as const, icon: 'star' as const, keywords: '' });
    const pair = [twin('AAA'), twin('BBB')];
    expect(searchLaunch('gold', pair).map((i) => i.code)).toEqual(['AAA', 'BBB']);
    expect(searchLaunch('gold', pair, ['fn:BBB']).map((i) => i.code)).toEqual(['BBB', 'AAA']);
  });

  it('keeps recents short and unique, and toggles favourites', () => {
    expect(pushId(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushId(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
});
