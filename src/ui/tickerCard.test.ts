import { describe, expect, it } from 'vitest';
import type { Portfolio } from '../portfolio/types';
import { clickMode, findTicker, heldPosition, normalizeTicker, tickersIn, type TickerNode } from './tickerCard';

/** A tiny stand-in for DOM elements: tag, attributes, classes and a parent. */
function node(tagName: string, attrs: Record<string, string> = {}, parent: TickerNode | null = null, classes: string[] = []): TickerNode {
  return { tagName, parentElement: parent, getAttribute: (n) => attrs[n] ?? null, classList: { contains: (c) => classes.includes(c) } };
}

describe('ticker attribute', () => {
  it('cleans up symbols and rejects non-tickers', () => {
    expect(normalizeTicker(' aapl ')).toBe('AAPL');
    expect(normalizeTicker('$SPX')).toBe('$SPX');
    expect(normalizeTicker('BRK.B')).toBe('BRK.B');
    expect(normalizeTicker('btc-usd')).toBe('BTC-USD');
    expect(normalizeTicker('/ES')).toBe('/ES');
    expect(normalizeTicker('CASH')).toBeNull();
    expect(normalizeTicker('two words')).toBeNull();
    expect(normalizeTicker('')).toBeNull();
  });

  it('finds the nearest data-ticker from the element under the pointer', () => {
    const row = node('TR', {}, null, ['clickable']);
    const cell = node('TD', {}, row);
    const sym = node('B', { 'data-ticker': 'msft' }, cell);
    const inner = node('SPAN', {}, sym);
    expect(findTicker(inner)).toEqual({ el: sym, symbol: 'MSFT' });
    expect(findTicker(cell)).toBeNull();
    expect(findTicker(node('B', { 'data-ticker': 'not a symbol' }))).toBeNull();
  });

  it('pins on click unless the ticker sits in something with its own click', () => {
    const plain = node('B', { 'data-ticker': 'AAPL' }, node('TD', {}, node('TR')));
    expect(clickMode(plain, 'mouse')).toBe('pin');
    const inRow = node('B', { 'data-ticker': 'AAPL' }, node('TD', {}, node('TR', {}, null, ['clickable'])));
    expect(clickMode(inRow, 'mouse')).toBe('pass'); // the row still opens its detail
    const inButton = node('SPAN', { 'data-ticker': 'AAPL' }, node('BUTTON'));
    expect(clickMode(inButton, 'mouse')).toBe('pass');
    expect(clickMode(node('BUTTON', { 'data-ticker': 'AAPL' }), 'mouse')).toBe('pass');
    expect(clickMode(node('SPAN', { 'data-ticker': 'AAPL' }, node('DIV', { role: 'button' })), 'pen')).toBe('pass');
  });

  it('always pins on touch (no hover there), and data-ticker-click overrides', () => {
    expect(clickMode(node('SPAN', { 'data-ticker': 'AAPL' }, node('BUTTON')), 'touch')).toBe('pin');
    expect(clickMode(node('SPAN', { 'data-ticker': 'AAPL', 'data-ticker-click': 'pin' }, node('BUTTON')), 'mouse')).toBe('pin');
    expect(clickMode(node('SPAN', { 'data-ticker': 'AAPL', 'data-ticker-click': 'pass' }), 'touch')).toBe('pass');
  });
});

describe('tickers in headlines', () => {
  it('reads $TICKER, (EXCHANGE: TICKER), (TICKER) and known symbols, in order', () => {
    expect(tickersIn('Apple (NASDAQ: AAPL) beats; $MSFT slips')).toEqual(['AAPL', 'MSFT']);
    expect(tickersIn('Nvidia (NVDA) and the Fed (FOMC) decision')).toEqual(['NVDA']);
    expect(tickersIn('Why TSLA and AMD rallied today', ['AMD', 'TSLA', 'IT'])).toEqual(['TSLA', 'AMD']);
    expect(tickersIn('Its CEO said IT spending grew', ['IT'])).toEqual([]);
    expect(tickersIn('AMDOCS is not AMD-like', ['AMD'])).toEqual(['AMD']);
    expect(tickersIn('no tickers here')).toEqual([]);
  });
});

describe('held position', () => {
  const p = (name: string, mine: boolean, holdings: Portfolio['holdings']): Portfolio => ({ name, benchmark: 'SPY', rebalance: 'none', mode: 'shares', mine, holdings });
  const all = [
    p('Brokerage', true, [{ symbol: 'aapl', shares: 10, weight: 0, assetClass: 'US stocks', kind: 'security' }, { symbol: 'CASH', amount: 500, weight: 0, assetClass: 'Cash', kind: 'cash' }]),
    p('Roth IRA', true, [{ symbol: 'AAPL', shares: 2.5, weight: 0, assetClass: 'US stocks', kind: 'security' }]),
    p('Client: Smith', false, [{ symbol: 'AAPL', shares: 1000, weight: 0, assetClass: 'US stocks', kind: 'security' }]),
  ];
  it('adds up your own accounts only', () => {
    const held = heldPosition('AAPL', all)!;
    expect(held.shares).toBe(12.5);
    expect(held.accounts.map((a) => a.account)).toEqual(['Brokerage', 'Roth IRA']);
    expect(heldPosition('MSFT', all)).toBeNull();
    expect(heldPosition('CASH', all)).toBeNull();
  });
});
