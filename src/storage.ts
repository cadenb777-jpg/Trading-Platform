/** Saves the user's chart layout in this browser's localStorage. */
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

const STATE_KEY = 'tp:state:v1';

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
