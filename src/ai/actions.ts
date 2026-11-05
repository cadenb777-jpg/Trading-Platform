/**
 * What the AI assistant can do in the platform: a typed registry of UI actions. Each one checks its arguments,
 * carries itself out through an `ActionEnv` (so tests can use a fake one), reports a short result the model sees,
 * and - when it changes something - leaves an Undo on a stack (the chat shows an Undo button per message).
 *
 * Never: anything that places, prepares or cancels an order. There is deliberately no trading action here.
 *
 * Pure apart from the env (no DOM): tested in actions.test.ts. The browser wiring is in actionsEnv.ts.
 */
import type { ChartType } from '../chart/ChartView';
import type { Drawing } from '../chart/drawings';
import type { MarketRef } from '../data/quotes';
import type { IndicatorDef, IndicatorInstance, IndicatorParams } from '../indicators/types';
import { PRICE_SOURCES } from '../indicators/types';
import { TIMEFRAMES, type Timeframe } from '../types';
import { describe, recommend, timeframeWords } from './tuning';

/** The part of the app state the actions read and change. */
export interface ActionState {
  provider: MarketRef['provider'];
  symbols: Partial<Record<MarketRef['provider'], string>>;
  timeframe: Timeframe;
  chartType: ChartType;
  indicators: IndicatorInstance[];
  watchlist: MarketRef[];
}

export interface ActionEnv {
  state: ActionState;
  /** Saves the state (and tells the rest of the page). */
  persist(): void;
  /** Applies state changes to the chart page, if it is built. */
  syncChart(): void;
  navigate(route: string): void;
  currentRoute(): string;
  /** Top-level page routes (home, chart, invest, ...). */
  routes(): string[];
  /** Shows a symbol on the chart page and goes there. */
  openChart(ref: MarketRef): void;
  guessMarket(symbol: string): MarketRef | null;
  indicators(): IndicatorDef[];
  newUid(): string;
  chartTypes: readonly ChartType[];
  createAlert(ref: MarketRef, condition: 'above' | 'below', price: number, note: string): Promise<{ where: string; undo?: () => Promise<void> | void }>;
  loadDrawings(key: string): Drawing[];
  saveDrawings(key: string, list: Drawing[]): void;
  compare(refs: MarketRef[], timeframe: Timeframe): Promise<void> | void;
  openSecurity(symbol: string, tab?: string): Promise<'opened' | 'routed' | 'unavailable'> | 'opened' | 'routed' | 'unavailable';
  runBacktest(): void;
  theme(): 'dark' | 'light';
  setTheme(name: 'dark' | 'light'): void;
  openSettings(section?: string): void;
}

export class ActionError extends Error {}

type Args = Record<string, unknown>;

export interface Outcome {
  /** One short line for the chat and the model, e.g. "Added RSI(9) — tuned for 5-minute bars". */
  message: string;
  data?: unknown;
  undo?: () => Promise<void> | void;
}

export interface ActionSpec {
  /** Read-only actions (lists, searches) never get an Undo and don't show a line in the chat. */
  readOnly?: boolean;
  /** A question to confirm with the owner first (e.g. clearing every indicator); null = no need. */
  confirm?(env: ActionEnv, args: Args): string | null;
  run(env: ActionEnv, args: Args): Promise<Outcome> | Outcome;
}

export interface ActionResult {
  ok: boolean;
  name: string;
  message: string;
  data?: unknown;
  /** Present when the action can be undone. */
  undoId?: string;
  readOnly?: boolean;
}

// ---------- argument checks ----------

function str(args: Args, key: string, required = true): string {
  const v = args[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new ActionError(`"${key}" is required`);
    return '';
  }
  if (typeof v !== 'string') throw new ActionError(`"${key}" must be text`);
  return v.trim();
}

function num(args: Args, key: string, required = true): number | null {
  const v = args[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new ActionError(`"${key}" is required`);
    return null;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ActionError(`"${key}" must be a number`);
  return n;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], key: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new ActionError(`"${key}" must be one of: ${allowed.join(', ')}`);
  return value as T;
}

const TF_ALIASES: Record<string, Timeframe> = {
  '1min': '1m', '2min': '2m', '3min': '3m', '5min': '5m', '10min': '10m', '15min': '15m', '30min': '30m', '45min': '45m',
  '60m': '1h', '1hr': '1h', '1hour': '1h', hourly: '1h', '2hr': '2h', '4hr': '4h', '1d': '1D', d: '1D', day: '1D', daily: '1D',
  '1w': '1W', w: '1W', week: '1W', weekly: '1W', month: '1M', monthly: '1M',
};

/** "5m", "5min", "daily", "1d" -> a platform timeframe. */
export function parseTimeframe(raw: string): Timeframe {
  const s = raw.trim().replace(/\s+/g, '');
  if ((TIMEFRAMES as string[]).includes(s)) return s as Timeframe;
  const alias = TF_ALIASES[s.toLowerCase()] ?? TF_ALIASES[s];
  if (alias) return alias;
  throw new ActionError(`Unknown timeframe "${raw}". Use one of: ${TIMEFRAMES.join(', ')}`);
}

function market(env: ActionEnv, symbol: string): MarketRef {
  if (!/^[A-Za-z0-9.$/^=-]{1,20}$/.test(symbol)) throw new ActionError(`"${symbol}" doesn't look like a ticker`);
  const ref = env.guessMarket(symbol);
  if (!ref) throw new ActionError(`Couldn't work out the market for "${symbol}"`);
  return ref;
}

const currentRef = (env: ActionEnv): MarketRef => ({ provider: env.state.provider, symbol: env.state.symbols[env.state.provider] ?? '' });

function findDef(env: ActionEnv, id: string): IndicatorDef {
  const defs = env.indicators();
  const q = id.toLowerCase();
  const def = defs.find((d) => d.id === id) ?? defs.find((d) => d.id.toLowerCase() === q || d.shortName.toLowerCase() === q || d.name.toLowerCase() === q);
  if (!def) {
    const near = searchIndicators(defs, id, undefined, 5).map((d) => d.id);
    throw new ActionError(`No indicator with id "${id}".${near.length ? ` Close matches: ${near.join(', ')}.` : ''} Use find_indicators to get real ids.`);
  }
  return def;
}

/**
 * Checks settings against the indicator's inputs: unknown keys are refused, numbers are clamped to min/max (noted),
 * sources must be a price source. Returns the full settings (defaults filled from `base`).
 */
export function checkParams(def: IndicatorDef, raw: unknown, base: IndicatorParams): { params: IndicatorParams; notes: string[] } {
  if (raw === undefined || raw === null) return { params: { ...base }, notes: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ActionError('"params" must be an object like {"length": 9}');
  const params = { ...base };
  const notes: string[] = [];
  for (const [key, value] of Object.entries(raw as Args)) {
    const input = def.inputs.find((i) => i.key === key);
    if (!input) throw new ActionError(`${def.name} has no setting "${key}". Its settings: ${def.inputs.map((i) => i.key).join(', ') || 'none'}`);
    if (input.type === 'source') {
      params[key] = oneOf(String(value), PRICE_SOURCES, key);
      continue;
    }
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new ActionError(`"${key}" must be a number`);
    let v = input.step && input.step >= 1 ? Math.round(n) : n;
    if (input.toggle) v = v ? 1 : 0;
    const clamped = Math.min(input.max ?? Infinity, Math.max(input.min ?? -Infinity, v));
    if (clamped !== v) notes.push(`${key} ${v} is outside ${input.min ?? '-∞'}-${input.max ?? '∞'}, used ${clamped}`);
    params[key] = clamped;
  }
  return { params, notes };
}

// ---------- indicator search (for the model's find_indicators) ----------

const WELL_KNOWN = ['rsi', 'macd', 'stoch', 'roc', 'cci', 'willr', 'cmo', 'tsi', 'ppo', 'adx', 'bb', 'keltner', 'atr', 'vwap', 'ema', 'sma', 'emacloud', 'stochrsi', 'mom', 'vwaprolling', 'obv', 'volume'];

/** Ranks indicators for a plain query ("momentum", "volatility bands", "rsi"). */
export function searchIndicators(defs: IndicatorDef[], query: string, category?: string, limit = 12): IndicatorDef[] {
  const words = query.toLowerCase().split(/[^a-z0-9%]+/).filter((w) => w.length > 1 || w === '%');
  const cat = category?.toLowerCase();
  const scored = defs
    .filter((d) => !cat || d.category.toLowerCase().includes(cat))
    .map((d) => {
      const id = d.id.toLowerCase();
      const short = d.shortName.toLowerCase();
      const name = d.name.toLowerCase();
      const category = d.category.toLowerCase();
      const text = `${name} ${short} ${id} ${category} ${d.description.toLowerCase()}`;
      let score = 0;
      for (const w of words) {
        if (id === w || short === w) score += 10;
        else if (name.split(/\W+/).includes(w) || category.split(/\W+/).includes(w)) score += 5;
        else if (category.includes(w)) score += 3;
        else if (text.includes(w)) score += 1;
      }
      if (!words.length) score = 1;
      const known = WELL_KNOWN.indexOf(d.id);
      if (score > 0 && known >= 0) score += 2 + (WELL_KNOWN.length - known) / WELL_KNOWN.length;
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.d);
}

// ---------- the registry ----------

const indicatorSummary = (def: IndicatorDef, i: IndicatorInstance) => ({
  uid: i.uid,
  id: def.id,
  name: def.name,
  label: describe(def, i.params),
  params: i.params,
  placement: i.placement ?? def.placement,
  visible: i.visible,
});

function ensureChart(env: ActionEnv) {
  if (env.currentRoute() !== 'chart') env.navigate('chart');
}

const THEMES = ['dark', 'light'] as const;

export const ACTIONS: Record<string, ActionSpec> = {
  open_page: {
    run(env, args) {
      const route = str(args, 'route').replace(/^#/, '');
      const top = route.split('/')[0];
      if (!env.routes().includes(top)) throw new ActionError(`Unknown page "${route}". Pages: ${env.routes().join(', ')}`);
      const before = env.currentRoute();
      env.navigate(route);
      return { message: `Opened ${route}`, undo: before !== route ? () => env.navigate(before) : undefined };
    },
  },

  open_chart: {
    run(env, args) {
      const ref = market(env, str(args, 'symbol'));
      const tfRaw = str(args, 'timeframe', false);
      const tf = tfRaw ? parseTimeframe(tfRaw) : env.state.timeframe;
      const before = { provider: env.state.provider, symbol: env.state.symbols[ref.provider], timeframe: env.state.timeframe };
      env.state.timeframe = tf;
      env.persist();
      env.openChart(ref);
      env.syncChart();
      return {
        message: `Opened ${ref.symbol} ${tf}`,
        data: { symbol: ref.symbol, market: ref.provider, timeframe: tf },
        undo: () => {
          env.state.provider = before.provider;
          if (before.symbol) env.state.symbols[ref.provider] = before.symbol;
          env.state.timeframe = before.timeframe;
          env.persist();
          env.syncChart();
        },
      };
    },
  },

  set_timeframe: {
    run(env, args) {
      const tf = parseTimeframe(str(args, 'timeframe'));
      const before = env.state.timeframe;
      env.state.timeframe = tf;
      env.persist();
      env.syncChart();
      return {
        message: before === tf ? `Chart already on ${tf}` : `Switched the chart to ${tf}`,
        data: { timeframe: tf, before },
        undo: before === tf ? undefined : () => {
          env.state.timeframe = before;
          env.persist();
          env.syncChart();
        },
      };
    },
  },

  set_chart_type: {
    run(env, args) {
      const type = oneOf(str(args, 'type'), env.chartTypes, 'type');
      const before = env.state.chartType;
      env.state.chartType = type;
      env.persist();
      env.syncChart();
      return {
        message: `Chart type: ${type}`,
        undo: () => {
          env.state.chartType = before;
          env.persist();
          env.syncChart();
        },
      };
    },
  },

  add_indicator: {
    run(env, args) {
      let def = findDef(env, str(args, 'id'));
      const tf = env.state.timeframe;
      const hasParams = args.params !== undefined && args.params !== null;
      let rec = recommend(def, tf);
      let swapped = '';
      if (!hasParams && rec.prefer) {
        const better = env.indicators().find((d) => d.id === rec.prefer);
        if (better) {
          swapped = `${def.shortName} suits intraday bars, so I used ${better.name} instead. `;
          def = better;
          rec = recommend(def, tf);
        }
      }
      const defaults: IndicatorParams = Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
      const { params, notes } = hasParams ? checkParams(def, args.params, defaults) : { params: rec.params, notes: [] };
      const placementRaw = str(args, 'placement', false);
      const placement = placementRaw ? oneOf(placementRaw, ['overlay', 'separate'] as const, 'placement') : undefined;
      const instance: IndicatorInstance = {
        uid: env.newUid(),
        defId: def.id,
        params,
        colors: Object.fromEntries(def.plots.map((p) => [p.key, p.color])),
        visible: true,
        ...(placement ? { placement } : {}),
      };
      env.state.indicators.push(instance);
      env.persist();
      ensureChart(env);
      env.syncChart();
      const label = describe(def, params);
      const tuned = !hasParams && rec.source !== 'default';
      const message = `${swapped}Added ${label}${tuned ? ` — tuned for ${timeframeWords(tf)} bars` : ''}${notes.length ? ` (${notes.join('; ')})` : ''}`;
      return {
        message,
        data: { uid: instance.uid, id: def.id, label, params, timeframe: tf, why: hasParams ? 'Settings as requested.' : rec.why },
        undo: () => {
          env.state.indicators = env.state.indicators.filter((i) => i.uid !== instance.uid);
          env.persist();
          env.syncChart();
        },
      };
    },
  },

  edit_indicator: {
    run(env, args) {
      const uid = str(args, 'uid');
      const instance = env.state.indicators.find((i) => i.uid === uid);
      if (!instance) throw new ActionError(`No indicator with uid "${uid}" on the chart. Use list_chart_indicators.`);
      const def = findDef(env, instance.defId);
      if (args.params === undefined) throw new ActionError('"params" is required');
      const { params, notes } = checkParams(def, args.params, instance.params);
      const before = instance.params;
      instance.params = params;
      env.persist();
      env.syncChart();
      return {
        message: `Changed ${describe(def, before)} to ${describe(def, params)}${notes.length ? ` (${notes.join('; ')})` : ''}`,
        data: indicatorSummary(def, instance),
        undo: () => {
          const now = env.state.indicators.find((i) => i.uid === uid);
          if (!now) return;
          now.params = before;
          env.persist();
          env.syncChart();
        },
      };
    },
  },

  remove_indicator: {
    run(env, args) {
      const uid = str(args, 'uid', false);
      const id = str(args, 'id', false);
      if (!uid && !id) throw new ActionError('Give the indicator\'s "uid" (from list_chart_indicators) or its "id"');
      const index = env.state.indicators.findIndex((i) => (uid ? i.uid === uid : i.defId === id));
      if (index < 0) throw new ActionError(`That indicator isn't on the chart. Use list_chart_indicators.`);
      const [removed] = env.state.indicators.splice(index, 1);
      env.persist();
      env.syncChart();
      const def = env.indicators().find((d) => d.id === removed.defId);
      return {
        message: `Removed ${def ? describe(def, removed.params) : removed.defId}`,
        undo: () => {
          env.state.indicators.splice(Math.min(index, env.state.indicators.length), 0, removed);
          env.persist();
          env.syncChart();
        },
      };
    },
  },

  list_chart_indicators: {
    readOnly: true,
    run(env) {
      const defs = env.indicators();
      const list = env.state.indicators.flatMap((i) => {
        const def = defs.find((d) => d.id === i.defId);
        return def ? [indicatorSummary(def, i)] : [];
      });
      return { message: `${list.length} indicator${list.length === 1 ? '' : 's'} on the chart`, data: { symbol: currentRef(env).symbol, timeframe: env.state.timeframe, indicators: list } };
    },
  },

  clear_indicators: {
    confirm: (env) => (env.state.indicators.length ? `Remove all ${env.state.indicators.length} indicators from the chart?` : null),
    run(env) {
      const before = env.state.indicators;
      if (!before.length) return { message: 'The chart has no indicators' };
      env.state.indicators = [];
      env.persist();
      env.syncChart();
      return {
        message: `Removed all ${before.length} indicators`,
        undo: () => {
          env.state.indicators = [...before, ...env.state.indicators];
          env.persist();
          env.syncChart();
        },
      };
    },
  },

  compare_symbol: {
    async run(env, args) {
      const other = market(env, str(args, 'symbol'));
      const base = str(args, 'base', false);
      const first = base ? market(env, base) : currentRef(env);
      if (!first.symbol) throw new ActionError('Which symbol should it be compared with? Give "base".');
      const tfRaw = str(args, 'timeframe', false);
      const tf = tfRaw ? parseTimeframe(tfRaw) : '1D';
      await env.compare([first, other], tf);
      return { message: `Compared ${first.symbol} with ${other.symbol} (${tf}, % change) in a chart window` };
    },
  },

  add_to_watchlist: {
    run(env, args) {
      const ref = market(env, str(args, 'symbol'));
      if (env.state.watchlist.some((r) => r.provider === ref.provider && r.symbol === ref.symbol)) return { message: `${ref.symbol} is already on the watchlist` };
      env.state.watchlist.push(ref);
      env.persist();
      return {
        message: `Added ${ref.symbol} to the watchlist`,
        undo: () => {
          env.state.watchlist = env.state.watchlist.filter((r) => !(r.provider === ref.provider && r.symbol === ref.symbol));
          env.persist();
        },
      };
    },
  },

  remove_from_watchlist: {
    run(env, args) {
      const ref = market(env, str(args, 'symbol'));
      const index = env.state.watchlist.findIndex((r) => r.provider === ref.provider && r.symbol === ref.symbol);
      if (index < 0) return { message: `${ref.symbol} isn't on the watchlist` };
      const [removed] = env.state.watchlist.splice(index, 1);
      env.persist();
      return {
        message: `Removed ${ref.symbol} from the watchlist`,
        undo: () => {
          env.state.watchlist.splice(Math.min(index, env.state.watchlist.length), 0, removed);
          env.persist();
        },
      };
    },
  },

  create_alert: {
    async run(env, args) {
      const ref = market(env, str(args, 'symbol'));
      const condition = oneOf(str(args, 'condition'), ['above', 'below'] as const, 'condition');
      const price = num(args, 'price')!;
      if (price <= 0) throw new ActionError('"price" must be above 0');
      const note = str(args, 'note', false).slice(0, 200) || 'Set by AI';
      const saved = await env.createAlert(ref, condition, price, note);
      return {
        message: `Alert: ${ref.symbol} ${condition} ${price}${saved.where === 'helper' ? ' (works with the platform closed)' : ''}`,
        undo: saved.undo,
      };
    },
  },

  draw_level: {
    run(env, args) {
      const symbol = str(args, 'symbol', false);
      const ref = symbol ? market(env, symbol) : currentRef(env);
      if (!ref.symbol) throw new ActionError('"symbol" is required');
      const price = num(args, 'price')!;
      if (price <= 0) throw new ActionError('"price" must be above 0');
      const label = str(args, 'label', false).slice(0, 40);
      const key = `${ref.provider}:${ref.symbol}`;
      const drawing: Drawing = { id: env.newUid(), type: 'hline', points: [{ time: Math.floor(Date.now() / 1000), price }], color: '#f7a600', ...(label ? { label } : {}) };
      env.saveDrawings(key, [...env.loadDrawings(key), drawing]);
      env.syncChart();
      return {
        message: `Drew a line at ${price} on ${ref.symbol}${label ? ` (${label})` : ''}`,
        undo: () => {
          env.saveDrawings(key, env.loadDrawings(key).filter((d) => d.id !== drawing.id));
          env.syncChart();
        },
      };
    },
  },

  open_security: {
    async run(env, args) {
      const symbol = str(args, 'symbol').toUpperCase();
      market(env, symbol);
      const tab = str(args, 'tab', false);
      const how = await env.openSecurity(symbol, tab || undefined);
      if (how === 'unavailable') throw new ActionError('The security view isn’t in this version of the platform yet; try open_page research instead.');
      return { message: `Opened ${symbol}${tab ? ` (${tab})` : ''}` };
    },
  },

  run_backtest: {
    run(env) {
      if (!env.state.indicators.length) throw new ActionError('The chart has no indicators to build rules from. Add some first.');
      env.runBacktest();
      return { message: `Opened the backtester with the chart's ${currentRef(env).symbol} ${env.state.timeframe} indicators` };
    },
  },

  set_theme: {
    run(env, args) {
      const theme = oneOf(str(args, 'theme'), THEMES, 'theme');
      const before = env.theme();
      env.setTheme(theme);
      return { message: `Switched to the ${theme} theme`, undo: before !== theme ? () => env.setTheme(before) : undefined };
    },
  },

  open_settings: {
    run(env, args) {
      const section = str(args, 'section', false);
      env.openSettings(section || undefined);
      return { message: `Opened Settings${section ? ` (${section})` : ''}` };
    },
  },

  find_indicators: {
    readOnly: true,
    run(env, args) {
      const query = str(args, 'query', false);
      const category = str(args, 'category', false) || undefined;
      const tfRaw = str(args, 'timeframe', false);
      const tf = tfRaw ? parseTimeframe(tfRaw) : env.state.timeframe;
      const limit = Math.max(1, Math.min(25, num(args, 'limit', false) ?? 10));
      const found = searchIndicators(env.indicators(), query, category, limit);
      return {
        message: `${found.length} indicators found`,
        data: {
          timeframe: tf,
          indicators: found.map((d) => {
            const rec = recommend(d, tf);
            return {
              id: d.id,
              name: d.name,
              category: d.category,
              placement: d.placement,
              description: d.description.slice(0, 160),
              inputs: d.inputs.map((i) => (i.type === 'number' ? { key: i.key, default: i.default, min: i.min, max: i.max } : { key: i.key, default: i.default, options: PRICE_SOURCES })),
              recommended: { params: rec.params, source: rec.source, why: rec.why, ...(rec.prefer ? { preferId: rec.prefer } : {}) },
            };
          }),
        },
      };
    },
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

// ---------- running and undoing ----------

const undoStack = new Map<string, { name: string; message: string; undo: () => Promise<void> | void }>();
let undoCounter = 0;
const MAX_UNDO = 100;

/** Runs one action. Never throws: problems come back as { ok: false, message }. */
export async function runAction(env: ActionEnv, name: string, raw: unknown): Promise<ActionResult> {
  const spec = ACTIONS[name];
  if (!spec) return { ok: false, name, message: `Unknown action "${name}"` };
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Args) : {};
  try {
    const out = await spec.run(env, args);
    const result: ActionResult = { ok: true, name, message: out.message, ...(out.data !== undefined ? { data: out.data } : {}), ...(spec.readOnly ? { readOnly: true } : {}) };
    if (out.undo) {
      const undoId = `u${++undoCounter}`;
      undoStack.set(undoId, { name, message: out.message, undo: out.undo });
      if (undoStack.size > MAX_UNDO) undoStack.delete(undoStack.keys().next().value!);
      result.undoId = undoId;
    }
    return result;
  } catch (err) {
    return { ok: false, name, message: err instanceof ActionError ? err.message : `Failed: ${(err as Error).message ?? String(err)}` };
  }
}

/** The confirmation question an action needs before it runs, if any. */
export function confirmationFor(env: ActionEnv, name: string, raw: unknown): string | null {
  const spec = ACTIONS[name];
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Args) : {};
  return spec?.confirm?.(env, args) ?? null;
}

export const canUndo = (undoId: string) => undoStack.has(undoId);

/** Undoes the given actions, newest first (one chat message's actions). Returns how many were undone. */
export async function undoActions(undoIds: string[]): Promise<number> {
  let done = 0;
  for (const id of [...undoIds].reverse()) {
    const entry = undoStack.get(id);
    if (!entry) continue;
    undoStack.delete(id);
    await entry.undo();
    done++;
  }
  return done;
}

/** For tests: forget every undo. */
export function resetUndo() {
  undoStack.clear();
}
