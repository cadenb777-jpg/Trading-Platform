import { describe, expect, it } from 'vitest';
import { PAGE_SUGGESTIONS } from '../ai/screen';
import { REDIRECTS, resolveHash } from '../routes';
import { CODES, findCode } from './command';
import { FUNCTIONS, PAGES, ROUTES, SECTIONS, pageOf, sectionPages, sectionTarget } from './nav';
import mainSrc from '../main.ts?raw';

describe('nav registry', () => {
  it('registers every page the app builds (each LOADERS entry in main.ts) and nothing else', () => {
    const block = mainSrc.slice(mainSrc.indexOf('const LOADERS'), mainSrc.indexOf('const pages: PageEntry[]'));
    const loaders = [...block.matchAll(/^ {2}([a-z]+): /gm)].map((m) => m[1]);
    expect([...loaders].sort()).toEqual([...ROUTES].sort());
  });

  it('keeps the six sections in order, with the asked-for pages', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['Markets', 'Analyze', 'Money', 'Business', 'AI']);
    expect(sectionPages('markets').map((p) => p.label)).toEqual(['Home', 'Investments', 'Futures', 'Macro', 'Calendar', 'Flow']);
    expect(sectionPages('analyze').map((p) => p.label)).toEqual(['Chart', 'Research', 'Setups', 'Backtest', 'Strategy Lab']);
    expect(sectionPages('money').map((p) => p.label)).toEqual(['Account', 'Portfolios', 'Trade', 'Journal']);
    expect(sectionPages('business').map((p) => p.label)).toEqual(['Clients', 'Prospects']);
  });

  it('gives every visible page a unique code, and never one an older code already means for another page', () => {
    const visible = PAGES.filter((p) => !('hidden' in p && p.hidden));
    const codes = [...visible.map((p) => p.code), ...FUNCTIONS.map((f) => f.code)];
    expect(new Set(codes).size).toBe(codes.length);
    for (const p of visible) {
      expect(p.code).toMatch(/^[A-Z]{2,6}$/);
      const c = findCode(p.code);
      expect(c, p.code).not.toBeNull();
    }
    // every code the command bar knows is listed once
    const all = CODES.flatMap((c) => [c.code, ...(c.aliases ?? [])]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps old routes working: every redirect and every hash a page uses lands on a registered page', () => {
    for (const from of Object.keys(REDIRECTS)) expect(ROUTES).toContain(resolveHash(`#${from}`, ROUTES).route);
    for (const key of Object.keys(PAGE_SUGGESTIONS)) expect(ROUTES, key).toContain(key.split('/')[0]);
    for (const f of FUNCTIONS.filter((x) => x.target.startsWith('page:'))) expect(ROUTES).toContain(f.target.slice(5).split('/')[0]);
  });

  it('opens a section on the page last visited there, else its first page', () => {
    expect(sectionTarget('money')).toBe('account');
    expect(sectionTarget('money', { money: 'journal' })).toBe('journal');
    expect(sectionTarget('analyze', { analyze: 'chart/multi' })).toBe('chart/multi');
    expect(sectionTarget('money', { money: 'home' })).toBe('account'); // not a page of that section
    expect(sectionTarget('ai')).toBeNull();
    expect(pageOf('sec')?.hidden).toBe(true);
  });
});
