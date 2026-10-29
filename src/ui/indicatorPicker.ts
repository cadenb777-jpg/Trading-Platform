/**
 * Search, favourites and recently-used lists for the indicator picker. Kept free of the DOM so the ranking can be
 * tested; the manager window (indicatorDialogs.ts) draws the results.
 */
import type { IndicatorDef } from '../indicators/types';

/** Other names people type for an indicator (lowercase). Matched like the name itself. */
const ALIASES: Record<string, string> = {
  sma: 'ma moving average simple',
  ema: 'ma moving average exponential',
  wma: 'ma moving average linear weighted lwma',
  bb: 'bollinger bbands',
  bb3: 'bollinger bbands',
  bbpb: 'bollinger percent b %b',
  bbw: 'bollinger bandwidth width squeeze',
  psar: 'parabolic stop and reverse',
  psarext: 'parabolic stop and reverse sar',
  macd: 'moving average convergence divergence',
  rsi: 'relative strength',
  atr: 'average true range volatility',
  obv: 'on balance volume',
  vwap: 'volume weighted average price',
  vwapanchor: 'volume weighted average price anchored session weekly monthly',
  avwap: 'anchored volume weighted average price',
  ichimoku: 'kinko hyo cloud tenkan kijun senkou',
  supertrend: 'super trend atr stop',
  smma: 'rma wilder running moving average',
  trima: 'tma triangular',
  zlema: 'zero lag',
  t3: 'tillson',
  mama: 'mesa fama ehlers adaptive',
  frama: 'fractal ehlers adaptive',
  vidya: 'chande variable index dynamic',
  mcginley: 'dynamic md',
  jma: 'jurik',
  laguerre: 'ehlers',
  supersmoother: 'ehlers super smoother ssf',
  ultsmoother: 'ehlers ultimate smoother',
  itrend: 'ehlers instantaneous trendline',
  httrend: 'ehlers hilbert transform trendline ht_trendline',
  gaussian: 'ehlers gauss',
  butterworth: 'ehlers butter',
  decycler: 'ehlers',
  dsma: 'ehlers deviation scaled',
  nwkernel: 'nadaraya watson kernel regression',
  nwenvelope: 'nadaraya watson kernel envelope',
  gmma: 'guppy multiple moving average ribbon',
  maribbon: 'moving average ribbon',
  rainbow: 'widner ribbon',
  keltner: 'kc channel atr',
  keltnerclassic: 'kc channel',
  donchian: 'dc channel turtle breakout',
  pricechannel: 'donchian breakout',
  turtle: 'donchian breakout',
  chandelier: 'ce exit stop atr lebeau',
  volstop: 'volatility stop vstop atr',
  atrtrail: 'atr trailing stop',
  cksp: 'chande kroll stop',
  safezone: 'elder stop',
  kasedev: 'kase devstop deviation stop',
  hilo: 'gann hilo activator',
  alligator: 'bill williams jaw teeth lips',
  fractals: 'bill williams swing',
  zigzag: 'zig zag swing',
  zigzagatr: 'zig zag swing atr',
  pivots: 'pivot points floor support resistance',
  pivotsclassic: 'pivot points floor support resistance',
  pivotsfib: 'pivot points fibonacci',
  pivotswoodie: 'pivot points woodie',
  pivotscamarilla: 'pivot points camarilla',
  pivotsdemark: 'pivot points demark tom',
  pivotscpr: 'central pivot range cpr',
  fibretrace: 'fibonacci retracement fib levels',
  fibbands: 'fibonacci bands',
  heikinashi: 'heiken ashi ha candles',
  openingrange: 'orb opening range breakout',
  autosr: 'auto support resistance levels swing',
  starc: 'stoller average range channel',
  accbands: 'acceleration bands headley',
  sebands: 'standard error bands',
  lrc: 'linear regression channel',
  raff: 'raff regression channel',
  linreg: 'linear regression lsma least squares',
  tsf: 'time series forecast linear regression',
};

export interface PickerEntry {
  def: IndicatorDef;
  /** Lowercased name, short name, id, aliases, category and description. */
  text: string;
  name: string;
  short: string;
  id: string;
}

export function buildIndex(defs: IndicatorDef[]): PickerEntry[] {
  return defs.map((def) => {
    const extra = (def as IndicatorDef & { aliases?: string[] }).aliases?.join(' ') ?? '';
    const name = def.name.toLowerCase();
    const short = def.shortName.toLowerCase();
    const id = def.id.toLowerCase();
    return { def, name, short, id, text: `${name} ${short} ${id} ${ALIASES[def.id] ?? ''} ${extra} ${def.category.toLowerCase()} ${def.description.toLowerCase()}` };
  });
}

/**
 * Entries matching every word of the query, best first: an exact short name or id, then names starting with the
 * query, then names containing it, then matches anywhere (aliases, description). Ties keep the library order.
 */
export function searchIndex(index: PickerEntry[], query: string): PickerEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return index;
  const words = q.split(/\s+/);
  const scored: { e: PickerEntry; score: number; at: number }[] = [];
  index.forEach((e, at) => {
    if (!words.every((w) => e.text.includes(w))) return;
    let score = 4;
    if (e.short === q || e.id === q) score = 0;
    else if (e.name.startsWith(q) || e.short.startsWith(q) || e.id.startsWith(q)) score = 1;
    else if (e.name.includes(q) || e.short.includes(q)) score = 2;
    else if ((ALIASES[e.def.id] ?? '').includes(q)) score = 3;
    scored.push({ e, score, at });
  });
  scored.sort((a, b) => a.score - b.score || a.at - b.at);
  return scored.map((s) => s.e);
}

// ---------- favourites and recently used (this browser only) ----------

const FAV_KEY = 'tp.indicatorFavourites';
const RECENT_KEY = 'tp.indicatorRecent';
const RECENT_MAX = 12;

function read(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage blocked (private window): the lists just don't persist */
  }
}

export const favourites = {
  list: (): string[] => read(FAV_KEY),
  has: (id: string) => read(FAV_KEY).includes(id),
  /** Adds or removes a favourite; returns true when it is now a favourite. */
  toggle(id: string): boolean {
    const ids = read(FAV_KEY);
    const on = !ids.includes(id);
    write(FAV_KEY, on ? [...ids, id] : ids.filter((x) => x !== id));
    return on;
  },
};

export const recents = {
  list: (): string[] => read(RECENT_KEY),
  add(id: string) {
    write(RECENT_KEY, [id, ...read(RECENT_KEY).filter((x) => x !== id)].slice(0, RECENT_MAX));
  },
};
