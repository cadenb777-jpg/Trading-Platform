/**
 * Saves the user's layout and keys in this browser's localStorage.
 * Nothing here is ever sent anywhere except to the data provider it belongs to.
 */
import type { ProviderId } from './data/provider';
import type { IndicatorInstance } from './indicators/types';
import type { Timeframe } from './types';

export interface AppState {
  provider: ProviderId;
  /** Last symbol used for each provider, so switching markets remembers where you were. */
  symbols: Partial<Record<ProviderId, string>>;
  timeframe: Timeframe;
  indicators: IndicatorInstance[];
}

export interface AlpacaKeys {
  key: string;
  secret: string;
}

const STATE_KEY = 'tp:state:v1';
const ALPACA_KEY = 'tp:alpaca:v1';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private browsing); the app still works, it just won't remember.
  }
}

export const loadState = () => read<AppState>(STATE_KEY);
export const saveState = (state: AppState) => write(STATE_KEY, state);

export const loadAlpacaKeys = () => read<AlpacaKeys>(ALPACA_KEY);
export const saveAlpacaKeys = (keys: AlpacaKeys | null) => write(ALPACA_KEY, keys);
