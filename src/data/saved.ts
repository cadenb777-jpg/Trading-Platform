/**
 * Screens that open instantly (T2, owner: "it feels like a demo when you wait"). The last reply of each market-data
 * request is kept in this browser, so a screen draws it at once and then quietly replaces it with the fresh reply.
 * Only public market data is kept here (quotes, futures, the curve, Fed odds, movers, daily closes): never accounts,
 * portfolios, settings or keys, which stay in the helper on your computer.
 * The helper itself also answers from its saved copy while it refreshes (engine/core.py `cached(..., stale_ok=True)`)
 * and warms these requests when it starts (schwab_helper.WARM_UP).
 */
import { engineRequest, stableKey } from './schwab';
import { quietFlashes } from '../term/flash';

export const SAVED_TYPES = new Set(['invest.board', 'futures.board', 'macro.curve', 'macro.fedodds', 'invest.movers', 'invest.history', 'bonds.market']);
const PREFIX = 'tp-saved:';
const INDEX = 'tp-saved-index';
const MAX_ENTRIES = 60;
const MAX_BYTES = 400_000;

interface Saved<T> {
  at: number;
  data: T;
}

const keyOf = (type: string, params: Record<string, unknown>) => `${PREFIX}${type} ${stableKey(params)}`;

function readIndex(store: Storage): string[] {
  try {
    const v = JSON.parse(store.getItem(INDEX) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function savedReply<T>(type: string, params: Record<string, unknown> = {}, store: Storage | null = safeStorage()): Saved<T> | null {
  if (!store || !SAVED_TYPES.has(type)) return null;
  try {
    const raw = store.getItem(keyOf(type, params));
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved<T>;
    return v && typeof v.at === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function rememberReply(type: string, params: Record<string, unknown>, data: unknown, store: Storage | null = safeStorage(), now = Date.now()) {
  if (!store || !SAVED_TYPES.has(type)) return;
  const key = keyOf(type, params);
  try {
    const raw = JSON.stringify({ at: now, data });
    if (raw.length > MAX_BYTES) return;
    store.setItem(key, raw);
    const index = [key, ...readIndex(store).filter((k) => k !== key)];
    for (const old of index.splice(MAX_ENTRIES)) store.removeItem(old); // oldest out
    store.setItem(INDEX, JSON.stringify(index));
  } catch {
    // storage full or blocked: the screen just waits for the helper next time
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Draws the saved reply straight away (when there is one), then the fresh one. `draw(data, at, saved)` runs once or
 * twice; the promise settles with the fresh reply (and rejects when the helper fails, after the saved copy was drawn).
 */
export async function savedThenFresh<T>(type: string, params: Record<string, unknown>, timeoutMs: number, draw: (data: T, at: number, saved: boolean) => void): Promise<T> {
  const s = savedReply<T>(type, params);
  if (s) {
    try {
      draw(s.data, s.at, true);
    } catch {
      // an old saved shape: ignore it, the fresh reply follows
    }
  }
  const data = await engineRequest<T>(type, params, timeoutMs);
  rememberReply(type, params, data);
  if (s) quietFlashes(); // the saved copy turning into the fresh one is not a price change worth flashing
  draw(data, Date.now(), false);
  return data;
}
