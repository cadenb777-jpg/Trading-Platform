/**
 * Indicator settings by time frame, for the AI assistant ("add a momentum indicator to my 5-minute chart").
 *
 * These are rules of thumb from practitioner literature (sources in docs/research/indicator-tuning.md), NOT values
 * optimised on data. The classic defaults were designed for daily bars; on short bars traders usually shorten the
 * lookback a little (faster reaction within a session) rather than copy the daily time span (14 days of 5-minute
 * bars would be over 1,000 bars). Indicators not in the table use one fallback rule (`scaleLookbacks`).
 *
 * Pure (no DOM): tested in tuning.test.ts.
 */
import type { IndicatorDef, IndicatorParams, NumberInput } from '../indicators/types';
import { TIMEFRAME_SECONDS, type Timeframe } from '../types';

export type Bucket = '1m' | '5m' | '15m' | '1h' | '1D' | '1W';
export const BUCKETS: Bucket[] = ['1m', '5m', '15m', '1h', '1D', '1W'];
const BUCKET_LABEL: Record<Bucket, string> = { '1m': '1-minute', '5m': '5-minute', '15m': '15-minute', '1h': 'hourly', '1D': 'daily', '1W': 'weekly' };

/** "5m" -> "5-minute", "1h" -> "1-hour", "1D" -> "daily" (for messages like "tuned for 5-minute bars"). */
export function timeframeWords(tf: Timeframe): string {
  const special: Partial<Record<Timeframe, string>> = { '1D': 'daily', '1W': 'weekly', '1M': 'monthly' };
  if (special[tf]) return special[tf]!;
  const m = /^(\d+)([smh])$/.exec(tf);
  if (!m) return tf;
  return `${m[1]}-${{ s: 'second', m: 'minute', h: 'hour' }[m[2] as 's' | 'm' | 'h']}`;
}

/** The tuning bucket a chart time frame falls in (seconds charts count as 1-minute, 4h as hourly, monthly as weekly). */
export function bucketOf(tf: Timeframe): Bucket {
  const s = TIMEFRAME_SECONDS[tf] ?? 86400;
  if (s < 240) return '1m';
  if (s < 900) return '5m';
  if (s < 3600) return '15m';
  if (s < 86400) return '1h';
  if (s < 604800) return '1D';
  return '1W';
}

interface Row {
  family: string;
  /** Settings per bucket; a missing bucket keeps the indicator's own defaults. */
  by: Partial<Record<Bucket, IndicatorParams>>;
  /** One line on why, shown to the owner by the AI. */
  why: string;
  /** Use another indicator on these buckets instead (e.g. session VWAP means nothing on weekly bars). */
  prefer?: Partial<Record<Bucket, string>>;
}

const same = (p: IndicatorParams): Partial<Record<Bucket, IndicatorParams>> => Object.fromEntries(BUCKETS.map((b) => [b, p]));
const fast = (intraday: IndicatorParams, slow: IndicatorParams, mid = slow): Partial<Record<Bucket, IndicatorParams>> => ({
  '1m': intraday,
  '5m': intraday,
  '15m': mid,
  '1h': slow,
  '1D': slow,
  '1W': slow,
});

/** Keyed by indicator id. Only inputs that change are listed; the rest stay at the indicator's defaults. */
export const TUNING: Record<string, Row> = {
  rsi: {
    family: 'RSI',
    by: { '1m': { length: 7 }, '5m': { length: 9 }, '15m': { length: 14 }, '1h': { length: 14 }, '1D': { length: 14 }, '1W': { length: 14 } },
    why: 'Wilder’s 14 is the standard; intraday traders often shorten it to 7-9 so it reacts within a session.',
  },
  stoch: {
    family: 'Stochastic',
    by: { '1m': { k: 5, smooth: 3, d: 3 }, '5m': { k: 5, smooth: 3, d: 3 }, '15m': { k: 8, smooth: 3, d: 3 }, '1h': { k: 14, smooth: 3, d: 3 }, '1D': { k: 14, smooth: 3, d: 3 }, '1W': { k: 14, smooth: 3, d: 3 } },
    why: 'Lane’s 14-3-3 on longer bars; the faster 5-3-3 is a common intraday choice.',
  },
  stochrsi: {
    family: 'Stochastic RSI',
    by: { ...same({ k: 3, d: 3, rsi: 14, stoch: 14 }), '1m': { k: 3, d: 3, rsi: 9, stoch: 9 }, '5m': { k: 3, d: 3, rsi: 9, stoch: 9 } },
    why: 'Chande & Kroll’s 14/14 with 3/3 smoothing; 9/9 on very short bars, since it is already very fast.',
  },
  macd: {
    family: 'MACD',
    by: { '1m': { fast: 3, slow: 10, signal: 16 }, '5m': { fast: 8, slow: 17, signal: 9 }, '15m': { fast: 12, slow: 26, signal: 9 }, '1h': { fast: 12, slow: 26, signal: 9 }, '1D': { fast: 12, slow: 26, signal: 9 }, '1W': { fast: 12, slow: 26, signal: 9 } },
    why: 'Appel’s 12-26-9 on 15-minute bars and up; his faster 8-17-9 on 5-minute and Raschke’s 3-10-16 on 1-minute bars.',
  },
  ppo: {
    family: 'PPO',
    by: { '1m': { fast: 3, slow: 10, signal: 16 }, '5m': { fast: 8, slow: 17, signal: 9 }, '15m': { fast: 12, slow: 26, signal: 9 }, '1h': { fast: 12, slow: 26, signal: 9 }, '1D': { fast: 12, slow: 26, signal: 9 }, '1W': { fast: 12, slow: 26, signal: 9 } },
    why: 'PPO is MACD in percent, so it uses the same settings by time frame.',
  },
  roc: {
    family: 'Rate of Change',
    by: { '1m': { length: 9 }, '5m': { length: 9 }, '15m': { length: 12 }, '1h': { length: 12 }, '1D': { length: 12 }, '1W': { length: 13 } },
    why: '12 bars is the classic daily setting (about a fortnight); 9 on short bars; 13 weeks (a quarter) on weekly.',
  },
  mom: {
    family: 'Momentum',
    by: { '1m': { length: 9 }, '5m': { length: 9 }, '15m': { length: 10 }, '1h': { length: 10 }, '1D': { length: 10 }, '1W': { length: 13 } },
    why: 'The classic 10-bar momentum; slightly shorter on 1- and 5-minute bars, a quarter (13) on weekly.',
  },
  cci: {
    family: 'CCI',
    by: fast({ length: 14 }, { length: 20 }),
    why: 'Lambert’s 20 is the standard; 14 is a common faster intraday choice.',
  },
  willr: {
    family: 'Williams %R',
    by: fast({ length: 10 }, { length: 14 }),
    why: '14 is the usual setting; Larry Williams also used 10, which suits short bars.',
  },
  cmo: {
    family: 'Chande Momentum',
    by: { '1m': { length: 9 }, '5m': { length: 9 }, '15m': { length: 9 }, '1h': { length: 14 }, '1D': { length: 14 }, '1W': { length: 20 } },
    why: 'Chande used 9-20 bars; 9 on intraday bars, 14 hourly/daily, 20 weekly.',
  },
  tsi: {
    family: 'True Strength Index',
    by: { ...same({ long: 25, short: 13, signal: 7 }), '1m': { long: 13, short: 7, signal: 7 }, '5m': { long: 13, short: 7, signal: 7 } },
    why: 'Blau’s 25/13 smoothing; roughly halved (13/7) on 1- and 5-minute bars, where 25/13 lags a lot.',
  },
  adx: {
    family: 'ADX',
    by: fast({ length: 10, smoothing: 10 }, { length: 14, smoothing: 14 }),
    why: 'Wilder’s 14; 10 on very short bars so trend strength shows up within the session.',
  },
  atr: {
    family: 'ATR',
    by: same({ length: 14 }),
    why: 'Wilder’s 14 works on every time frame; it measures the typical bar size, so it already adapts to the bar length.',
  },
  bb: {
    family: 'Bollinger Bands',
    by: same({ length: 20, mult: 2 }),
    why: 'Bollinger’s own 20 bars and 2 standard deviations; he found they work across time frames.',
  },
  keltner: {
    family: 'Keltner Channels',
    by: same({ length: 20, mult: 2, atr: 10 }),
    why: 'The modern Keltner (Raschke): a 20-bar EMA with bands 2 ATR(10) away, on every time frame.',
  },
  vwap: {
    family: 'VWAP',
    by: {},
    why: 'Session VWAP resets each day, so it is an intraday tool; on daily or weekly bars use a rolling VWAP.',
    prefer: { '1D': 'vwaprolling', '1W': 'vwaprolling' },
  },
  vwapbands: {
    family: 'VWAP bands',
    by: {},
    why: 'Session VWAP with 1-3 standard-deviation bands: an intraday tool.',
    prefer: { '1D': 'vwaprolling', '1W': 'vwaprolling' },
  },
  vwaprolling: {
    family: 'Rolling VWAP',
    by: { '1m': { length: 30 }, '5m': { length: 78 }, '15m': { length: 26 }, '1h': { length: 35 }, '1D': { length: 20 }, '1W': { length: 13 } },
    why: 'About one trading session on 5- and 15-minute bars (78 and 26), a week on hourly, a month daily and a quarter weekly.',
  },
  ema: {
    family: 'EMA',
    by: { '1m': { length: 9 }, '5m': { length: 20 }, '15m': { length: 20 }, '1h': { length: 50 }, '1D': { length: 50 }, '1W': { length: 40 } },
    why: '9 and 20 are the usual intraday EMAs, 50 for the hourly and daily trend, 40 weeks (about 200 days) on weekly.',
  },
  sma: {
    family: 'SMA',
    by: { '1m': { length: 9 }, '5m': { length: 20 }, '15m': { length: 20 }, '1h': { length: 50 }, '1D': { length: 50 }, '1W': { length: 40 } },
    why: '20 bars for short bars, 50 for the hourly and daily trend, 40 weeks (about 200 days) on weekly.',
  },
  emacloud: {
    family: 'EMA ribbon',
    by: { ...same({ f1: 5, s1: 12, f2: 34, s2: 50 }), '1W': { f1: 4, s1: 10, f2: 30, s2: 40 } },
    why: 'The 5/12 and 34/50 EMA clouds were built for intraday charts and are used on daily too; a little shorter on weekly.',
  },
};

/** Inputs that are lookbacks (bar counts), so the fallback can scale them. Multipliers, levels and switches aren't. */
const LOOKBACK_KEY = /^(length|len|period|periods|fast|slow|middle|long|short|signal|smooth|smoothing|k|d|rsi|stoch|atr|ma|ema|roc|wma|lookback|kc|first|second)$/i;
const NOT_LOOKBACK = /mult|dev|level|upper|lower|offset|threshold|percent|factor|alpha|step|min|max/i;

/** How much shorter than the daily default a lookback gets on short bars (practitioners shorten, not span the same time). */
export const SCALE: Record<Bucket, number> = { '1m': 0.5, '5m': 0.65, '15m': 0.8, '1h': 1, '1D': 1, '1W': 1 };

export function isLookback(i: NumberInput): boolean {
  return !i.toggle && LOOKBACK_KEY.test(i.key) && !NOT_LOOKBACK.test(i.key);
}

function clamp(v: number, i: NumberInput) {
  return Math.min(i.max ?? Infinity, Math.max(i.min ?? 1, v));
}

/** Fallback: shorten lookbacks on short bars by SCALE (small smoothing values of 3 or less are left alone). */
export function scaleLookbacks(def: IndicatorDef, bucket: Bucket): IndicatorParams {
  const out: IndicatorParams = {};
  for (const i of def.inputs) {
    if (i.type !== 'number') {
      out[i.key] = i.default;
      continue;
    }
    out[i.key] = isLookback(i) && i.default > 3 ? clamp(Math.max(2, Math.round(i.default * SCALE[bucket])), i) : i.default;
  }
  return out;
}

export interface Recommendation {
  /** Full settings for every input (defaults filled in), clamped to each input's min/max. */
  params: IndicatorParams;
  /** 'table' = from the documented table, 'scaled' = fallback rule, 'default' = the indicator's own defaults. */
  source: 'table' | 'scaled' | 'default';
  /** One plain sentence the AI can repeat. */
  why: string;
  /** A better-suited indicator id for this time frame, when there is one (e.g. rolling VWAP on daily bars). */
  prefer?: string;
}

/** Recommended settings for `def` on a `tf` chart. */
export function recommend(def: IndicatorDef, tf: Timeframe): Recommendation {
  const bucket = bucketOf(tf);
  const label = BUCKET_LABEL[bucket];
  const defaults: IndicatorParams = Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
  const row = TUNING[def.id];
  if (row) {
    const wanted = row.by[bucket] ?? {};
    const params = { ...defaults };
    for (const i of def.inputs) {
      const v = wanted[i.key];
      if (v === undefined) continue;
      params[i.key] = i.type === 'number' && typeof v === 'number' ? clamp(v, i) : v;
    }
    return { params, source: 'table', why: `${describe(def, params)} for ${label} bars: ${row.why.replace(/\.$/, '')} (rule of thumb).`, prefer: row.prefer?.[bucket] };
  }
  const scaled = scaleLookbacks(def, bucket);
  const changed = def.inputs.some((i) => scaled[i.key] !== defaults[i.key]);
  if (!changed) {
    return { params: defaults, source: 'default', why: `${describe(def, defaults)}: its standard settings suit ${label} bars (rule of thumb).` };
  }
  return {
    params: scaled,
    source: 'scaled',
    why: `${describe(def, scaled)} for ${label} bars: lookbacks shortened to about ${Math.round(SCALE[bucket] * 100)}% of the daily default so it reacts within a session (rule of thumb).`,
  };
}

/** "RSI(9)", "MACD(8, 17, 9)". */
export function describe(def: IndicatorDef, params: IndicatorParams): string {
  const nums = def.inputs.filter((i) => i.type === 'number' && !(i as NumberInput).toggle).map((i) => params[i.key] ?? i.default);
  return nums.length ? `${def.shortName}(${nums.join(', ')})` : def.shortName;
}
