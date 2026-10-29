import { describe, expect, it } from 'vitest';
import {
  buildResults,
  CHORD_MS,
  codesFor,
  dispatchKey,
  flatten,
  fuzzyScore,
  loadRecents,
  NASDAQ_100,
  parseCommand,
  pushRecent,
  saveRecents,
  type Sources,
} from './command';
import scannerPy from '../../helper/engine/scanner.py?raw';

const src = (extra: Partial<Sources> = {}): Sources => ({
  symbols: [
    { symbol: 'AAPL', source: 'watchlist' },
    { symbol: 'AAP', name: 'Advance Auto Parts', source: 'search' },
    { symbol: 'AAPL', name: 'Apple Inc', source: 'search' },
    { symbol: 'FANG', source: 'nasdaq' },
    { symbol: 'FAST', source: 'nasdaq' },
    { symbol: '/ES', name: 'E-mini S&P 500', source: 'futures' },
    { symbol: 'GLD', name: 'Gold', source: 'board' },
    { symbol: '$SPX', name: 'S&P 500', source: 'board' },
  ],
  pages: [
    { route: 'home', label: 'Home' },
    { route: 'setups', label: 'Setups' },
    { route: 'trade', label: 'Trade' },
  ],
  portfolios: [
    { id: 'p1', name: 'Roth IRA', mine: true },
    { id: 'p2', name: 'Growth model', mine: false },
  ],
  clients: [{ id: 'c1', name: 'Jane Smith' }],
  actions: [{ id: 'act:alert', title: 'New alert' }, { id: 'act:sync', title: 'Sync accounts (Webull)' }],
  ...extra,
});
const top = (q: string, s = src()) => flatten(buildResults(q, s))[0];

describe('parsing', () => {
  it('reads a ticker and a code, in either order, ignoring Bloomberg filler words', () => {
    expect(parseCommand('aapl gp')).toMatchObject({ ticker: 'AAPL', pair: true, code: { code: 'GP' } });
    expect(parseCommand('DES msft')).toMatchObject({ ticker: 'MSFT', pair: true, code: { code: 'DES' } });
    expect(parseCommand('AAPL US Equity FA <GO>')).toMatchObject({ ticker: 'AAPL', pair: true, code: { code: 'FA' } });
    expect(parseCommand('nvda omon').code?.code).toBe('OMON');
    expect(parseCommand('nvda flow').code?.code).toBe('OMON'); // alias
  });
  it('reads a code alone; one word can be a ticker and a code', () => {
    expect(parseCommand('wei')).toMatchObject({ code: { code: 'WEI' }, pair: false });
    expect(parseCommand('ctm').code?.code).toBe('FUT');
    expect(parseCommand('WB').code?.code).toBe('BONDS');
    expect(parseCommand('FA')).toMatchObject({ ticker: 'FA', code: { code: 'FA' } });
  });
  it('a code that takes no ticker does not pair', () => {
    expect(parseCommand('AAPL WEI').pair).toBe(false);
    expect(parseCommand('new alert')).toMatchObject({ ticker: null, code: null, pair: false });
    expect(parseCommand('   ')).toMatchObject({ text: '', ticker: null, code: null });
  });
  it('fuzzy-matches names', () => {
    expect(fuzzyScore('apple', 'Apple Inc')).toBeGreaterThan(fuzzyScore('apple', 'Pineapple Co')!);
    expect(fuzzyScore('nwalrt', 'New alert')).not.toBeNull();
    expect(fuzzyScore('xyz', 'New alert')).toBeNull();
    expect(fuzzyScore('alert', 'New alert')!).toBeGreaterThan(fuzzyScore('nwalrt', 'New alert')!);  });
  it('short queries match only at word starts, and weak scattered matches are dropped', () => {
    expect(fuzzyScore('gold', 'Gold')).not.toBeNull();
    expect(fuzzyScore('ld', 'Gold')).toBeNull();
    expect(fuzzyScore('na', 'New alert')).not.toBeNull(); // N(ew) a(lert)
    expect(fuzzyScore('ew', 'New alert')).toBeNull();
    expect(fuzzyScore('ert', 'Vertex')).toBeNull();
    expect(fuzzyScore('ale', 'Some sale today')).toBeNull(); // substring mid-word
    expect(fuzzyScore('abcdefghij', [...'abcdefghij'].map((c) => `qqqqqqqqqqq${c}`).join(''))).toBeNull(); // scattered: below FUZZY_MIN
  });
});

describe('ranking', () => {
  it('exact ticker first, with Chart as the Enter default and its actions after', () => {
    const groups = buildResults('aapl', src());
    expect(groups[0].label).toBe('AAPL · Apple Inc');
    expect(groups[0].items.map((i) => i.hint)).toEqual(['GP', 'DES', 'FA', 'CN', 'OMON', 'TRADE', 'ALRT', 'WL']);
    expect(groups[0].items[0].id).toBe('tk:AAPL:GP');
    // AAPL isn't listed twice
    expect(flatten(groups).filter((i) => i.symbol === 'AAPL')).toHaveLength(8);
  });
  it('ticker prefix beats a code prefix and a fuzzy name', () => {
    const items = flatten(buildResults('aa', src()));
    expect(items[0].symbol).toBe('AAP');
  });
  it('an exact code beats a longer ticker starting with it (FA = Financials, not FANG)', () => {
    const groups = buildResults('fa', src());
    expect(top('fa').id).toBe('fn:FA');
    expect(groups.find((g) => g.label === 'Symbols')!.items.map((i) => i.title)).toEqual(['FANG', 'FAST']);
  });
  it('ticker + code runs that pair first', () => {
    expect(top('aapl fa')).toMatchObject({ id: 'tk:AAPL:FA', score: 2000 });
    expect(top('MSFT GP').id).toBe('tk:MSFT:GP'); // unknown to the lists still works
    expect(top('ES GP').id).toBe('tk:/ES:GP'); // futures root without the slash
  });
  it('codes alone map to pages', () => {
    expect(top('wei').id).toBe('fn:WEI');
    expect(top('eco').id).toBe('fn:ECO');
    expect(top('btst').id).toBe('fn:BTST');
  });
  it('fuzzy names find symbols, pages, accounts, clients and actions, in groups', () => {
    expect(top('gold').symbol).toBe('GLD'); // the name beats GOLD as an unknown ticker
    expect(top('xyzq').id).toBe('tk:XYZQ:GP'); // an unknown ticker still works
    expect(top('jane').id).toBe('cl:c1');
    expect(top('roth').id).toBe('ac:p1');
    expect(buildResults('roth', src())[0].label).toBe('Accounts');
    expect(top('growth model').id).toBe('pf:p2');
    expect(top('new alert').id).toBe('act:alert');
    expect(top('home').id).toBe('page:home');
    for (const g of buildResults('a', src())) expect(g.items.length).toBeGreaterThan(0);
  });
  it('CLIENT <name> opens that client, CLIENT alone lists the clients after the code', () => {
    const two = src({ clients: [{ id: 'c1', name: 'Jane Smith' }, { id: 'c2', name: 'Robert Chen' }] });
    expect(top('client smith', two).id).toBe('cl:c1');
    expect(top('CLIENT chen', two).id).toBe('cl:c2');
    expect(top('clnt rob', two).id).toBe('cl:c2');
    expect(buildResults('client smi', two).map((g) => g.label)).toEqual(['Clients']);
    expect(top('client', two).id).toBe('fn:CLIENT'); // Enter on the code alone opens the Clients page
    expect(buildResults('client', two).find((g) => g.label === 'Clients')?.items.map((i) => i.id)).toEqual(['cl:c1', 'cl:c2']);
    expect(buildResults('client', two).filter((g) => g.label === 'Clients')).toHaveLength(1); // listed once, not twice
    expect(flatten(buildResults('client zzzz', two)).some((i) => i.id.startsWith('cl:'))).toBe(false);
    // a code alone is never offered as an unknown ticker or futures contract (QA saw "/CLIENT contract detail")
    for (const code of ['client', 'multi', 'ws'])
      expect(flatten(buildResults(code, src())).some((i) => i.id.startsWith('tk:'))).toBe(false);
  });
  it('PROS / FO / RIA open Prospecting, with text as a search', () => {
    expect(top('pros').id).toBe('fn:PROS');
    expect(top('fo').id).toBe('fn:FO');
    expect(top('ria').id).toBe('fn:RIA');
    expect(top('FO Smith family')).toMatchObject({ id: 'pr:FO:Smith family', hint: 'FO' });
    expect(top('ria boston').id).toBe('pr:RIA:boston');
    expect(top('prospect acme').id).toBe('pr:PROS:acme');
  });
  it('futures and indexes only offer what works for them', () => {
    expect(codesFor('/ES').map((c) => c.code)).toEqual(['GP']);
    expect(codesFor('$SPX').map((c) => c.code)).toEqual(['GP', 'ALRT', 'WL']);
    expect(codesFor('BTC-USD').map((c) => c.code)).toEqual(['GP', 'ALRT', 'WL']);
  });
  it('empty input lists recent commands, then the function codes', () => {
    const groups = buildResults('', src(), [{ id: 'tk:NVDA:GP', title: 'NVDA chart' }]);
    expect(groups.map((g) => g.label)).toEqual(['Recent', 'Functions']);
    expect(groups[1].items.map((i) => i.hint)).toContain('WEI');
    expect(groups[1].items.map((i) => i.hint)).not.toContain('WL'); // needs a ticker
  });
  it('Tab completion text', () => {
    expect(top('aapl').complete).toBe('AAPL GP');
    expect(flatten(buildResults('aa', src()))[0].complete).toBe('AAP ');
    expect(top('we').complete).toBe('WEI');
  });
});

describe('shortcuts', () => {
  const t0 = 1_000_000;
  it('g then h goes Home and swallows the second key', () => {
    const first = dispatchKey(null, { key: 'g' }, t0);
    expect(first).toMatchObject({ action: null, consume: false });
    expect(dispatchKey(first.pending, { key: 'h' }, t0 + 300)).toEqual({ action: 'page:home', pending: null, consume: true });
    expect(dispatchKey(first.pending, { key: 's' }, t0 + 300).action).toBe('page:setups'); // not the Trade page's Sell
    expect(dispatchKey(dispatchKey(null, { key: 'n' }, t0).pending, { key: 'a' }, t0 + 10).action).toBe('act:alert');
  });
  it('a chord times out, and other keys pass through untouched', () => {
    const first = dispatchKey(null, { key: 'g' }, t0);
    expect(dispatchKey(first.pending, { key: 'h' }, t0 + CHORD_MS + 1).action).toBeNull();
    expect(dispatchKey(first.pending, { key: 'b' }, t0 + 10)).toEqual({ action: null, pending: null, consume: false });
    expect(dispatchKey(null, { key: 'f' }, t0)).toEqual({ action: null, pending: null, consume: false }); // chart's fit
  });
  it('/ and ? open the palette and the sheet; Ctrl/Cmd+K and +I work anywhere', () => {
    expect(dispatchKey(null, { key: '/' }, t0).action).toBe('palette');
    expect(dispatchKey(null, { key: '?' }, t0).action).toBe('help');
    expect(dispatchKey(null, { key: 'k', ctrl: true, inField: true }, t0).action).toBe('palette');
    expect(dispatchKey(null, { key: 'K', meta: true }, t0).action).toBe('palette');
    expect(dispatchKey(null, { key: 'i', ctrl: true }, t0).action).toBe('ai');
    expect(dispatchKey(null, { key: 's', ctrl: true }, t0).action).toBeNull(); // the Scripts editor's save
  });
  it('never fires inside inputs or dialogs', () => {
    for (const k of ['/', '?', 'g']) {
      expect(dispatchKey(null, { key: k, inField: true }, t0)).toEqual({ action: null, pending: null, consume: false });
      expect(dispatchKey(null, { key: k, modalOpen: true }, t0).action).toBeNull();
    }
    const first = dispatchKey(null, { key: 'g' }, t0);
    expect(dispatchKey(first.pending, { key: 'h', inField: true }, t0 + 10).action).toBeNull();  });
  it('with a dialog open (e.g. the order confirm window) nothing fires, not even Ctrl/Cmd+K', () => {
    expect(dispatchKey(null, { key: 'k', ctrl: true, modalOpen: true }, t0)).toEqual({ action: null, pending: null, consume: false });
    expect(dispatchKey(null, { key: 'k', meta: true, modalOpen: true }, t0).action).toBeNull();
    expect(dispatchKey(null, { key: 'i', ctrl: true, modalOpen: true }, t0).action).toBeNull();
    const first = dispatchKey(null, { key: 'g' }, t0);
    expect(dispatchKey(first.pending, { key: 'h', modalOpen: true }, t0 + 10).action).toBeNull();
  });
});

describe('panel keys', () => {
  const t0 = 1_000_000;
  const P = { hasPanels: true };
  it('Ctrl+[ ] and F6 move between panels, Alt+1-6 jumps', () => {
    expect(dispatchKey(null, { key: ']', ctrl: true, ...P }, t0)).toEqual({ action: 'panel:next', pending: null, consume: true });
    expect(dispatchKey(null, { key: '[', ctrl: true, ...P }, t0).action).toBe('panel:prev');
    expect(dispatchKey(null, { key: 'F6', ...P }, t0).action).toBe('panel:next');
    expect(dispatchKey(null, { key: 'F6', shift: true, ...P }, t0).action).toBe('panel:prev');
    expect(dispatchKey(null, { key: '¡', code: 'Digit1', alt: true, ...P }, t0).action).toBe('panel:1'); // a Mac's Alt+1
    expect(dispatchKey(null, { key: '6', code: 'Digit6', alt: true, ...P }, t0).action).toBe('panel:6');
    expect(dispatchKey(null, { key: '7', code: 'Digit7', alt: true, ...P }, t0).action).toBeNull();
  });
  it('leaves Cmd+[ ] (Mac Back/Forward) and pages without panels to the browser', () => {
    expect(dispatchKey(null, { key: '[', meta: true, ...P }, t0)).toEqual({ action: null, pending: null, consume: false });
    expect(dispatchKey(null, { key: ']', meta: true, ...P }, t0).consume).toBe(false);
    for (const k of [{ key: ']', ctrl: true }, { key: 'F6' }, { key: '1', code: 'Digit1', alt: true }]) expect(dispatchKey(null, k, t0)).toEqual({ action: null, pending: null, consume: false });
  });
  it('a letter on a panel opens the scoped command bar; elsewhere letters stay the page’s', () => {
    expect(dispatchKey(null, { key: 'a', inPanel: true }, t0)).toEqual({ action: 'panel-type', pending: null, consume: true, text: 'A' });
    expect(dispatchKey(null, { key: 'T', inPanel: true }, t0).action).toBe('panel-type');
    expect(dispatchKey(null, { key: 'f' }, t0).action).toBeNull(); // the chart's fit (the Chart opts out of typing)
    expect(dispatchKey(null, { key: '1', inPanel: true }, t0).action).toBeNull();
    expect(dispatchKey(null, { key: '/', inPanel: true }, t0).action).toBe('palette');
  });
  it('g and n still start two-key shortcuts on a focused panel', () => {
    const g = dispatchKey(null, { key: 'g', inPanel: true }, t0);
    expect(g).toMatchObject({ action: null, consume: false, pending: { key: 'g' } });
    expect(dispatchKey(g.pending, { key: 't', inPanel: true }, t0 + 200)).toEqual({ action: 'page:trade', pending: null, consume: true });
    const n = dispatchKey(null, { key: 'n', inPanel: true }, t0);
    expect(dispatchKey(n.pending, { key: 'a', inPanel: true }, t0 + 200).action).toBe('act:alert');
    // "g" then "o" isn't a shortcut: it was a ticker (GOOGL), and the g isn't lost
    expect(dispatchKey(g.pending, { key: 'o', inPanel: true }, t0 + 200)).toEqual({ action: 'panel-type', pending: null, consume: true, text: 'GO' });
    // after the chord window a lone letter starts fresh
    expect(dispatchKey(g.pending, { key: 'o', inPanel: true }, t0 + CHORD_MS + 1).text).toBe('O');
  });
  it('panel keys never fire in a field or a dialog', () => {
    for (const k of [{ key: ']', ctrl: true, ...P }, { key: 'F6', ...P }, { key: '1', code: 'Digit1', alt: true, ...P }, { key: 'a', inPanel: true }]) {
      expect(dispatchKey(null, { ...k, inField: true }, t0).action).toBeNull();
      expect(dispatchKey(null, { ...k, modalOpen: true }, t0).action).toBeNull();
    }
  });
});

describe('recent commands', () => {
  it('moves a repeat to the front and keeps at most 8', () => {
    let list = pushRecent([], { id: 'a', title: 'A' });
    list = pushRecent(list, { id: 'b', title: 'B' });
    list = pushRecent(list, { id: 'a', title: 'A' });
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    for (let i = 0; i < 20; i++) list = pushRecent(list, { id: `x${i}`, title: 'X' });
    expect(list).toHaveLength(8);
    expect(list[0].id).toBe('x19');
  });
  it('saves and loads, and survives broken or missing storage', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveRecents([{ id: 'fn:WEI', title: 'World equity indices' }], store);
    expect(loadRecents(store)).toEqual([{ id: 'fn:WEI', title: 'World equity indices' }]);
    mem.set('tp-command-recent', '{not json');
    expect(loadRecents(store)).toEqual([]);
    mem.set('tp-command-recent', JSON.stringify([{ id: 1 }, { id: 'ok', title: 'Ok' }]));
    expect(loadRecents(store)).toEqual([{ id: 'ok', title: 'Ok' }]);
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadRecents(throwing)).toEqual([]);
    expect(() => saveRecents([], throwing)).not.toThrow();
    expect(loadRecents(null)).toEqual([]);
  });
});

describe('lists', () => {
  it('the Nasdaq-100 matches the helper scanner’s list', () => {
    const block = /NASDAQ_100 = \[([\s\S]*?)\]/.exec(scannerPy)![1];
    expect(NASDAQ_100).toEqual([...block.matchAll(/'([A-Z.]+)'/g)].map((m) => m[1]));
  });
});
