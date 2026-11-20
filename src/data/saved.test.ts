import { describe, expect, it } from 'vitest';
import { rememberReply, savedReply } from './saved';

class Mem implements Storage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('saved replies', () => {
  it('keeps market data and gives it back for the same request', () => {
    const s = new Mem();
    rememberReply('invest.board', { symbols: ['SPY'] }, { rows: [1] }, s, 5);
    expect(savedReply('invest.board', { symbols: ['SPY'] }, s)).toEqual({ at: 5, data: { rows: [1] } });
    expect(savedReply('invest.board', { symbols: ['QQQ'] }, s)).toBeNull();
  });
  it('never keeps account, portfolio or settings replies', () => {
    const s = new Mem();
    for (const t of ['webull.snapshot', 'store.list', 'settings.get', 'dividends.portfolio', 'portfolio.analyze']) rememberReply(t, {}, { x: 1 }, s);
    expect(s.length).toBe(0);
  });
  it('drops the oldest beyond its limit', () => {
    const s = new Mem();
    for (let i = 0; i < 70; i++) rememberReply('invest.history', { symbol: `S${i}` }, { i }, s);
    expect(savedReply('invest.history', { symbol: 'S0' }, s)).toBeNull();
    expect(savedReply('invest.history', { symbol: 'S69' }, s)).not.toBeNull();
  });
});
