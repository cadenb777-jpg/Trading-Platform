import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK, createLinkBus, cyclePanel, isFuturesSymbol, isStockSymbol } from './linkGroups';

const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('link bus', () => {
  it('tells the other panels of the same colour, not the sender and not other colours', () => {
    const bus = createLinkBus(memory());
    const seen: string[] = [];
    bus.setColor('b', 'blue');
    bus.setColor('c', 'blue');
    bus.setColor('r', 'red');
    bus.subscribe('a', (s) => seen.push(`a:${s}`)); // default colour
    bus.subscribe('b', (s) => seen.push(`b:${s}`));
    bus.subscribe('c', (s) => seen.push(`c:${s}`));
    bus.subscribe('r', (s) => seen.push(`r:${s}`));
    expect(DEFAULT_LINK).toBe('blue');
    expect(bus.publish('b', 'nvda')).toBe(true);
    expect(seen).toEqual(['a:NVDA', 'c:NVDA']);
    expect(bus.symbolFor('a')).toBe('NVDA');
    expect(bus.symbolFor('r')).toBeNull();
    // the same symbol again changes nothing (so a panel applying it can't loop)
    expect(bus.publish('c', 'NVDA')).toBe(false);
    expect(seen).toHaveLength(2);
  });

  it('ignores unlinked panels both ways', () => {
    const bus = createLinkBus(memory());
    const seen: string[] = [];
    bus.setColor('solo', 'none');
    bus.subscribe('solo', (s) => seen.push(`solo:${s}`));
    bus.subscribe('x', (s) => seen.push(`x:${s}`));
    expect(bus.publish('solo', 'AAPL')).toBe(false); // tells nobody
    bus.publish('x', 'MSFT');
    expect(bus.symbolFor('solo')).toBeNull();
    expect(seen).toEqual([]);
    bus.set('solo', 'tsla'); // the command bar scoped to it changes just that panel
    expect(seen).toEqual(['solo:TSLA']);
  });

  it('set() changes the panel and its whole group', () => {
    const bus = createLinkBus(memory());
    const seen: string[] = [];
    bus.subscribe('p1', (s) => seen.push(`p1:${s}`));
    bus.subscribe('p2', (s) => seen.push(`p2:${s}`));
    bus.set('p1', 'AMD');
    expect(seen).toEqual(['p1:AMD', 'p2:AMD']);
    bus.set('p1', 'AMD'); // already the group's: still shown in the panel
    expect(seen.at(-1)).toBe('p1:AMD');
  });

  it('a panel joining a group shows its symbol', () => {
    const bus = createLinkBus(memory());
    const seen: string[] = [];
    bus.publishTo('green', 'QQQ');
    bus.subscribe('p', (s) => seen.push(s));
    bus.setColor('p', 'green');
    expect(seen).toEqual(['QQQ']);
    bus.setColor('p', 'yellow'); // empty group: nothing to show
    expect(seen).toEqual(['QQQ']);
  });

  it('remembers colours and symbols', () => {
    const store = memory();
    const a = createLinkBus(store);
    a.setColor('chart', 'red');
    a.publish('chart', 'SPY');
    const b = createLinkBus(store);
    expect(b.colorOf('chart')).toBe('red');
    expect(b.symbolFor('chart')).toBe('SPY');
  });

  it('works in memory when storage throws or holds junk', () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const bus = createLinkBus(broken);
    const seen: string[] = [];
    bus.subscribe('b', (s) => seen.push(s));
    expect(() => bus.publish('a', 'META')).not.toThrow();
    expect(seen).toEqual(['META']);
    expect(createLinkBus(null).colorOf('x')).toBe(DEFAULT_LINK);
    const junk = memory();
    junk.setItem('tp-link-groups', '{"panels":{"a":"purple","b":"red"},"symbols":{"none":"X","red":"AAPL","pink":"Y"}}');
    const j = createLinkBus(junk);
    expect(j.colorOf('a')).toBe(DEFAULT_LINK);
    expect(j.symbolFor('b')).toBe('AAPL');
    junk.setItem('tp-link-groups', 'not json');
    expect(createLinkBus(junk).colorOf('b')).toBe(DEFAULT_LINK);
  });

  it('unsubscribe stops the calls', () => {
    const bus = createLinkBus(memory());
    const seen: string[] = [];
    const off = bus.subscribe('b', (s) => seen.push(s));
    off();
    bus.publish('a', 'IBM');
    expect(seen).toEqual([]);
  });
});

describe('symbols and keyboard cycling', () => {
  it('knows stocks from futures', () => {
    expect(isStockSymbol('AAPL')).toBe(true);
    expect(isStockSymbol('BRK.B')).toBe(true);
    expect(isStockSymbol('$SPX')).toBe(false);
    expect(isStockSymbol('BTC-USD')).toBe(false);
    expect(isFuturesSymbol('/ES')).toBe(true);
    expect(isFuturesSymbol('ES')).toBe(false);
  });

  it('cycles round the panels', () => {
    expect(cyclePanel(-1, 4, 1)).toBe(0);
    expect(cyclePanel(-1, 4, -1)).toBe(3);
    expect(cyclePanel(3, 4, 1)).toBe(0);
    expect(cyclePanel(0, 4, -1)).toBe(3);
    expect(cyclePanel(1, 4, 1)).toBe(2);
    expect(cyclePanel(0, 0, 1)).toBe(-1);
  });
});
