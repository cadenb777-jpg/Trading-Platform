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

  it('the ticker text opens the security view, even inside a clickable row, card or link', () => {
    expect(clickMode(node('B', { 'data-ticker': 'AAPL' }, node('TD', {}, node('TR'))))).toBe('open');
    expect(clickMode(node('B', { 'data-ticker': 'AAPL' }, node('TD', {}, node('TR', {}, null, ['clickable']))))).toBe('open'); // the rest of the row keeps its action
    expect(clickMode(node('SPAN', { 'data-ticker': 'AAPL' }, node('DIV', { role: 'button' })))).toBe('open'); // Home index card
    const tr = node('TR');
    expect(clickMode(node('B', { 'data-ticker': 'NVDA' }, node('TD', {}, tr)), (el) => el === tr)).toBe('open'); // Setups row
  });

  it('a ticker that is itself a button or link keeps its own click', () => {
    expect(clickMode(node('BUTTON', { 'data-ticker': 'AAPL' }))).toBe('pass');
    expect(clickMode(node('A', { 'data-ticker': 'AAPL' }))).toBe('pass');
    const own = node('B', { 'data-ticker': 'AAPL' });
    expect(clickMode(own, (el) => el === own)).toBe('pass');
  });

  it('data-ticker-click overrides', () => {
    expect(clickMode(node('BUTTON', { 'data-ticker': 'AAPL', 'data-ticker-click': 'open' }))).toBe('open');
    expect(clickMode(node('SPAN', { 'data-ticker': 'AAPL', 'data-ticker-click': 'pass' }))).toBe('pass');
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
