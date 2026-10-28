/** Everything the app remembers between visits, saved in this browser. */
import { CHART_TYPES, type ChartType } from './chart/ChartView';
import type { Drawing } from './chart/drawings';
import { PROVIDERS } from './data';
import type { ProviderId } from './data/provider';
import type { MarketRef } from './data/quotes';
import type { PriceAlert } from './ui/alerts';
import { defaultColors, defaultParams, getIndicator } from './indicators/library';
import type { IndicatorDef, IndicatorInstance } from './indicators/types';
import { registerAllScripts } from './script/store';
import { loadJson, saveJson } from './storage';
import { DEFAULT_FAVORITE_TIMEFRAMES, TIMEFRAMES, type Timeframe } from './types';

export interface AppState {
  provider: ProviderId;
  /** Last symbol used for each market, so switching markets remembers where you were. */
  symbols: Partial<Record<ProviderId, string>>;
  timeframe: Timeframe;
  favoriteTimeframes: Timeframe[];
  chartType: ChartType;
  indicators: IndicatorInstance[];
  watchlist: MarketRef[];
  watchlistOpen: boolean;
  volumeProfile: boolean;
  /** Show pre-market and after-hours bars on intraday stock charts. */
  extendedHours: boolean;
  alerts: PriceAlert[];
  userName: string;
}

const STATE_KEY = 'tp:state:v1';
const DRAWINGS_KEY = 'tp:drawings:v1';

const newUid = () => Math.random().toString(36).slice(2, 10);

export function newIndicatorInstance(def: IndicatorDef): IndicatorInstance {
  return { uid: newUid(), defId: def.id, params: defaultParams(def), colors: defaultColors(def), visible: true };
}

function defaultState(): AppState {
  return {
    provider: 'schwab',
    symbols: {},
    timeframe: '5m',
    favoriteTimeframes: [...DEFAULT_FAVORITE_TIMEFRAMES],
    chartType: 'candles',
    indicators: ['volume', 'sma', 'rsi'].map((id) => newIndicatorInstance(getIndicator(id)!)),
    watchlist: [
      ...['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META'].map((symbol) => ({ provider: 'schwab' as const, symbol })),
      ...['BTC-USD', 'ETH-USD', 'SOL-USD'].map((symbol) => ({ provider: 'coinbase' as const, symbol })),
    ],
    watchlistOpen: true,
    volumeProfile: false,
    extendedHours: true,
    alerts: [],
    userName: 'Caden',
  };
}

function load(): AppState {
  const saved = loadJson<Partial<AppState>>(STATE_KEY) ?? {};
  const state: AppState = { ...defaultState(), ...saved };
  // Older saved layouts may mention markets, timeframes or indicators that no longer exist.
  const validProvider = (p: string) => PROVIDERS.some((x) => x.id === p);
  if (!validProvider(state.provider)) state.provider = 'coinbase';
  if (!TIMEFRAMES.includes(state.timeframe)) state.timeframe = '5m';
  state.favoriteTimeframes = state.favoriteTimeframes.filter((t) => TIMEFRAMES.includes(t));
  if (!CHART_TYPES.some((c) => c.id === state.chartType)) state.chartType = 'candles';
  state.indicators = state.indicators.filter((i) => getIndicator(i.defId));
  state.watchlist = state.watchlist.filter((r) => validProvider(r.provider));
  return state;
}

// Your own scripts must be registered before the saved layout is checked, or their indicators would be dropped.
registerAllScripts();
export const state = load();

type Listener = () => void;
const listeners = new Set<Listener>();

/** Saves the state and tells interested parts of the page (e.g. both watchlists) that it changed. */
export function persist() {
  saveJson(STATE_KEY, state);
  for (const fn of listeners) fn();
}

export function onStateChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const drawings = loadJson<Record<string, Drawing[]>>(DRAWINGS_KEY) ?? {};

export function loadDrawings(key: string): Drawing[] {
  return structuredClone(drawings[key] ?? []);
}

export function saveDrawings(key: string, list: Drawing[]) {
  if (list.length) drawings[key] = structuredClone(list);
  else delete drawings[key];
  saveJson(DRAWINGS_KEY, drawings);
}
