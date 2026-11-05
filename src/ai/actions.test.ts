import { beforeEach, describe, expect, it } from 'vitest';
import type { Drawing } from '../chart/drawings';
import type { MarketRef } from '../data/quotes';
import { allIndicators, defaultColors, defaultParams, getIndicator } from '../indicators/library';
import { ACTIONS, ACTION_NAMES, canUndo, checkParams, confirmationFor, parseTimeframe, resetUndo, runAction, searchIndicators, undoActions, type ActionEnv, type ActionState } from './actions';

function fakeEnv() {
  let uid = 0;
  const calls: string[] = [];
  const drawings: Record<string, Drawing[]> = {};
  let theme: 'dark' | 'light' = 'dark';
  let route = 'home';
  const rsi = getIndicator('rsi')!;
  const state: ActionState = {
    provider: 'schwab',
    symbols: { schwab: 'AAPL' },
    timeframe: '1D',
    chartType: 'candles',
    indicators: [{ uid: 'base', defId: 'rsi', params: defaultParams(rsi), colors: defaultColors(rsi), visible: true }],
    watchlist: [{ provider: 'schwab', symbol: 'SPY' }],
  };
  const alerts: string[] = [];
  const env: ActionEnv = {
    state,
    persist: () => calls.push('persist'),
    syncChart: () => calls.push('sync'),
    navigate: (r) => {
      route = r;
      calls.push(`nav:${r}`);
    },
    currentRoute: () => route,
    routes: () => ['home', 'chart', 'invest', 'research', 'backtest', 'trade'],
    openChart: (ref: MarketRef) => {
      state.provider = ref.provider;
      state.symbols[ref.provider] = ref.symbol;
      route = 'chart';
      calls.push(`chart:${ref.symbol}`);
    },
    guessMarket: (s) => (s.includes('-') ? { provider: 'coinbase', symbol: s.toUpperCase() } : { provider: 'schwab', symbol: s.toUpperCase() }),
    indicators: allIndicators,
    newUid: () => `u${++uid}`,
    chartTypes: ['candles', 'line'],
    createAlert: async (ref, condition, price) => {
      const id = `${ref.symbol}${condition}${price}`;
      alerts.push(id);
      return { where: 'helper', undo: () => void alerts.splice(alerts.indexOf(id), 1) };
    },
    loadDrawings: (k) => structuredClone(drawings[k] ?? []),
    saveDrawings: (k, list) => (drawings[k] = structuredClone(list)),
    compare: () => void calls.push('compare'),
    openSecurity: () => 'unavailable',
    runBacktest: () => calls.push('backtest'),
    theme: () => theme,
    setTheme: (t) => (theme = t),
    openSettings: (s) => calls.push(`settings:${s}`),
  };
  return { env, state, calls, drawings, alerts, route: () => route, theme: () => theme };
}

beforeEach(() => resetUndo());

describe('the owner’s example: a momentum indicator on a 5-minute chart', () => {
  it('opens the chart at 5m, adds a tuned RSI, and Undo puts everything back', async () => {
    const { env, state, route } = fakeEnv();
    const opened = await runAction(env, 'open_chart', { symbol: 'NVDA', timeframe: '5m' });
    expect(opened).toMatchObject({ ok: true, message: 'Opened NVDA 5m' });
    expect(state.timeframe).toBe('5m');
    expect(route()).toBe('chart');
    const added = await runAction(env, 'add_indicator', { id: 'rsi' });
    expect(added.ok).toBe(true);
    expect(added.message).toBe('Added RSI(9) — tuned for 5-minute bars');
    expect(state.indicators.at(-1)!.params.length).toBe(9);
    expect((added.data as { why: string }).why).toMatch(/rule of thumb/);
    expect(await undoActions([opened.undoId!, added.undoId!])).toBe(2);
    expect(state.indicators.map((i) => i.uid)).toEqual(['base']);
    expect(state.timeframe).toBe('1D');
    expect(state.symbols.schwab).toBe('AAPL');
    expect(canUndo(added.undoId!)).toBe(false);
  });
});

describe('validation', () => {
  it('refuses unknown actions, ids, settings and timeframes with a plain message', async () => {
    const { env } = fakeEnv();
    expect(await runAction(env, 'place_order', {})).toMatchObject({ ok: false, message: 'Unknown action "place_order"' });
    expect((await runAction(env, 'add_indicator', { id: 'nope-indicator' })).message).toMatch(/No indicator with id/);
    expect((await runAction(env, 'add_indicator', { id: 'rsi', params: { bogus: 3 } })).message).toMatch(/no setting "bogus"/);
    expect((await runAction(env, 'set_timeframe', { timeframe: '7m' })).message).toMatch(/Unknown timeframe/);
    expect((await runAction(env, 'open_chart', {})).message).toMatch(/"symbol" is required/);
    expect((await runAction(env, 'open_chart', { symbol: 'AAPL; DROP' })).message).toMatch(/doesn't look like a ticker/);
    expect((await runAction(env, 'create_alert', { symbol: 'AAPL', condition: 'sideways', price: 1 })).message).toMatch(/must be one of/);
    expect((await runAction(env, 'open_page', { route: 'nowhere' })).message).toMatch(/Unknown page/);
    expect((await runAction(env, 'set_chart_type', { type: 'pie' })).message).toMatch(/must be one of/);
  });

  it('clamps out-of-range settings and says so', () => {
    const rsi = getIndicator('rsi')!;
    const { params, notes } = checkParams(rsi, { length: 5000 }, defaultParams(rsi));
    expect(params.length).toBe(1000);
    expect(notes[0]).toMatch(/outside/);
    expect(() => checkParams(rsi, { source: 'volume' }, defaultParams(rsi))).toThrow(/must be one of/);
  });

  it('reads common timeframe spellings', () => {
    expect(parseTimeframe('5min')).toBe('5m');
    expect(parseTimeframe('daily')).toBe('1D');
    expect(parseTimeframe('1d')).toBe('1D');
    expect(parseTimeframe('1 hour')).toBe('1h');
    expect(parseTimeframe('1W')).toBe('1W');
  });

  it('has no action that could trade', () => {
    for (const name of ACTION_NAMES) expect(name).not.toMatch(/order|trade|buy|sell|ticket|webull|place/i);
  });
});

describe('each changing action can be undone', () => {
  it('explicit settings are kept, edits and removals undo', async () => {
    const { env, state } = fakeEnv();
    const added = await runAction(env, 'add_indicator', { id: 'macd', params: { fast: 5, slow: 35, signal: 5 } });
    expect(added.message).toBe('Added MACD(5, 35, 5)');
    const uid = (added.data as { uid: string }).uid;
    const edited = await runAction(env, 'edit_indicator', { uid, params: { signal: 9 } });
    expect(edited.message).toBe('Changed MACD(5, 35, 5) to MACD(5, 35, 9)');
    await undoActions([edited.undoId!]);
    expect(state.indicators.find((i) => i.uid === uid)!.params.signal).toBe(5);
    const removed = await runAction(env, 'remove_indicator', { uid: 'base' });
    expect(state.indicators.some((i) => i.uid === 'base')).toBe(false);
    await undoActions([removed.undoId!]);
    expect(state.indicators[0].uid).toBe('base');
  });

  it('clear_indicators asks first and undo restores them', async () => {
    const { env, state } = fakeEnv();
    expect(confirmationFor(env, 'clear_indicators', {})).toMatch(/Remove all 1 indicators/);
    const cleared = await runAction(env, 'clear_indicators', {});
    expect(state.indicators).toEqual([]);
    await undoActions([cleared.undoId!]);
    expect(state.indicators.map((i) => i.uid)).toEqual(['base']);
    expect(confirmationFor(env, 'add_indicator', { id: 'rsi' })).toBeNull();
  });

  it('watchlist, alert, level, theme and chart type', async () => {
    const { env, state, drawings, alerts, theme } = fakeEnv();
    const w = await runAction(env, 'add_to_watchlist', { symbol: 'msft' });
    expect(state.watchlist.map((r) => r.symbol)).toEqual(['SPY', 'MSFT']);
    expect((await runAction(env, 'add_to_watchlist', { symbol: 'MSFT' })).undoId).toBeUndefined();
    const a = await runAction(env, 'create_alert', { symbol: 'AAPL', condition: 'above', price: 250 });
    expect(alerts).toEqual(['AAPLabove250']);
    const l = await runAction(env, 'draw_level', { price: 180.5, label: 'Support' });
    expect(drawings['schwab:AAPL'][0]).toMatchObject({ type: 'hline', label: 'Support', points: [{ price: 180.5 }] });
    const t = await runAction(env, 'set_theme', { theme: 'light' });
    const c = await runAction(env, 'set_chart_type', { type: 'line' });
    expect(theme()).toBe('light');
    await undoActions([w.undoId!, a.undoId!, l.undoId!, t.undoId!, c.undoId!]);
    expect(state.watchlist.map((r) => r.symbol)).toEqual(['SPY']);
    expect(alerts).toEqual([]);
    expect(drawings['schwab:AAPL']).toEqual([]);
    expect(theme()).toBe('dark');
    expect(state.chartType).toBe('candles');
  });
});

describe('read-only actions', () => {
  it('lists chart indicators and finds indicators with recommended settings', async () => {
    const { env } = fakeEnv();
    const list = await runAction(env, 'list_chart_indicators', {});
    expect(list).toMatchObject({ ok: true, readOnly: true });
    expect(list.undoId).toBeUndefined();
    expect((list.data as { indicators: { uid: string; label: string }[] }).indicators[0]).toMatchObject({ uid: 'base', label: 'RSI(14)' });
    const found = await runAction(env, 'find_indicators', { query: 'momentum', timeframe: '5m' });
    const items = (found.data as { indicators: { id: string; recommended: { params: Record<string, number> } }[] }).indicators;
    expect(items.length).toBeGreaterThan(3);
    expect(items[0].id).toBe('rsi');
    expect(items[0].recommended.params.length).toBe(9);
  });

  it('search puts exact names first', () => {
    expect(searchIndicators(allIndicators(), 'macd')[0].id).toBe('macd');
    expect(searchIndicators(allIndicators(), 'bollinger')[0].id).toBe('bb');
    expect(searchIndicators(allIndicators(), '', 'Volatility').every((d) => d.category === 'Volatility')).toBe(true);
  });

  it('every action has a run function', () => {
    for (const spec of Object.values(ACTIONS)) expect(typeof spec.run).toBe('function');
  });
});
