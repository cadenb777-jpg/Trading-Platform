/**
 * "Smart money" indicators: who is buying, professionals and insiders or the public (in the spirit of Larry Williams).
 * Price-only ones (Pro Go, VIX Fix, Williams' day patterns) work on any chart; the rest load outside data through
 * the helper (SEC Form 4 insider trades, 13F holders from the Prospecting download, options put/call, FRED sentiment).
 */
import { engineRequest } from '../../data/schwab';
import type { Bar } from '../../types';
import { alignExternal } from '../external';
import type { IndicatorGuide } from '../info';
import { highest, sma, stdev } from '../math';
import type { ExternalPoint, IndicatorDef } from '../types';

const DAY = 86400;
const dayTime = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 1000;

// ---------- Price-only maths (exported for tests) ----------

/**
 * Larry Williams' Pro Go (from his seminars; formula as in the TradingView "William's ProGo indicator" script, which
 * describes the public line as "the change from yesterday's close to today's open"): the overnight move belongs to
 * the public (orders placed outside the session), the session move (open to close) to the professionals. Each is
 * averaged over `length` bars.
 *   Public = SMA(open - previous close, length);  Pros = SMA(close - open, length)
 * The usethinkscript.com port ("Larry Williams Pro-Go Indicator") computes public as close[1] - open, the same move
 * with the sign flipped. We use open - previous close so both lines read the same way: above zero = that group bought
 * (a gap up for the public, a rise during the day for the pros), and Pros − Public compares like with like.
 */
export function proGo(bars: Bar[], length: number) {
  const pub = sma(bars.map((b, i) => (i ? b.open - bars[i - 1].close : NaN)), length);
  const pros = sma(bars.map((b) => b.close - b.open), length);
  return { public: pub, pros, diff: pros.map((p, i) => p - pub[i]) };
}

/**
 * Williams VIX Fix (Larry Williams, "The VIX Fix", Active Trader, Dec 2007): a synthetic VIX for any market,
 *   WVF = (highest close of the last `period` bars - low) / that highest close x 100,
 * with Chris Moody's CM_Williams_Vix_Fix signal: WVF at or above its upper Bollinger band (`bbLength`, `mult` SD)
 * or at or above `pct` of its highest value over `lookback` bars. `signal` marks the first bar of each such spike.
 */
export function vixFix(bars: Bar[], period: number, bbLength: number, mult: number, lookback: number, pct: number) {
  const hc = highest(bars.map((b) => b.close), period);
  const wvf = bars.map((b, i) => (hc[i] > 0 ? ((hc[i] - b.low) / hc[i]) * 100 : NaN));
  const mid = sma(wvf, bbLength);
  const sd = stdev(wvf, bbLength);
  const upper = mid.map((m, i) => m + mult * sd[i]);
  const rangeHigh = highest(wvf, lookback).map((v) => v * pct);
  // Strictly above the band (a flat series sits on it), or within `pct` of the look-back high.
  const hot = wvf.map((v, i) => v > upper[i] || v >= rangeHigh[i]);
  return { wvf, upper, rangeHigh, signal: hot.map((on, i) => (on && !hot[i - 1] ? 1 : 0)) };
}

/**
 * Larry Williams' day patterns from "Long-Term Secrets to Short-Term Trading" (2nd ed., 2011, ch. "Smash Day Patterns"
 * and "Specialists' Trap"/Oops!). Each marker sits on the bar where the trade would be entered, using only that bar
 * and earlier ones:
 * - Naked Smash Day buy: a close below the prior bar's low (the public gives up); entry when the next bar trades
 *   above the smash bar's high. Sell: a close above the prior high, then a break of the smash bar's low.
 * - Hidden Smash Day buy: an up close (above the prior close) that is still below the open and in the lowest 25% of
 *   the bar's range; entry above its high next bar. Sell: a down close above the open in the top 25%, then a break
 *   of its low.
 * - Oops! buy: the bar opens below the prior low (a gap down) and trades back up to that low. Sell: opens above the
 *   prior high and falls back to it.
 * - Outside day with a down close: higher high and lower low than the prior bar, closing below the prior low;
 *   Williams buys the next open, so the marker sits on that next (entry) bar.
 */
export function williamsPatterns(bars: Bar[]) {
  const n = bars.length;
  const z = () => new Array<number>(n).fill(0);
  const out = { smashBuy: z(), smashSell: z(), hiddenBuy: z(), hiddenSell: z(), oopsBuy: z(), oopsSell: z(), outsideBuy: z() };
  const nakedBuy = (i: number) => i >= 1 && bars[i].close < bars[i - 1].low;
  const nakedSell = (i: number) => i >= 1 && bars[i].close > bars[i - 1].high;
  const pos = (b: Bar) => (b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5);
  const hiddenBuy = (i: number) => i >= 1 && bars[i].close > bars[i - 1].close && bars[i].close < bars[i].open && pos(bars[i]) <= 0.25;
  const hiddenSell = (i: number) => i >= 1 && bars[i].close < bars[i - 1].close && bars[i].close > bars[i].open && pos(bars[i]) >= 0.75;
  for (let i = 1; i < n; i++) {
    const b = bars[i];
    const p = bars[i - 1];
    if (nakedBuy(i - 1) && b.high > p.high) out.smashBuy[i] = 1;
    if (nakedSell(i - 1) && b.low < p.low) out.smashSell[i] = 1;
    if (hiddenBuy(i - 1) && b.high > p.high) out.hiddenBuy[i] = 1;
    if (hiddenSell(i - 1) && b.low < p.low) out.hiddenSell[i] = 1;
    if (b.open < p.low && b.high >= p.low) out.oopsBuy[i] = 1;
    if (b.open > p.high && b.low <= p.high) out.oopsSell[i] = 1;
    const pp = bars[i - 2];
    if (pp && p.high > pp.high && p.low < pp.low && p.close < pp.low) out.outsideBuy[i] = 1;
  }
  return out;
}

// ---------- Outside data ----------

/** Index of the bar holding each dated event: the last bar starting before the end of that day (or -1). */
export function barForDay(bars: Bar[], time: number): number {
  const end = time + DAY;
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < end) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // An event after the last bar's day isn't on the chart yet.
  return found >= 0 && (found < bars.length - 1 || time < bars[found].time + DAY * 7) ? found : -1;
}

/**
 * Insider trades, each placed on the day its Form 4 became public (`time` = filing date, never the earlier trade
 * date): per bar, buy/sell markers, and net dollars month to date (filings up to that bar).
 */
export function insiderSeries(bars: Bar[], points: ExternalPoint[] | undefined) {
  const n = bars.length;
  const buys = new Array<number>(n).fill(0);
  const sells = new Array<number>(n).fill(0);
  const buyMark = new Array<number>(n).fill(0);
  const sellMark = new Array<number>(n).fill(0);
  for (const p of points ?? []) {
    const i = barForDay(bars, p.time);
    if (i < 0) continue;
    if (p.values.buy) (buyMark[i] = 1), (buys[i] += p.values.value || 0);
    if (p.values.sell) (sellMark[i] = 1), (sells[i] += p.values.value || 0);
  }
  const net = new Array<number>(n).fill(NaN);
  if (points?.length) {
    let month = '';
    let total = 0;
    for (let i = 0; i < n; i++) {
      const m = new Date(bars[i].time * 1000).toISOString().slice(0, 7);
      if (m !== month) (month = m), (total = 0);
      total += buys[i] - sells[i];
      net[i] = total;
    }
  }
  return { buy: buyMark, sell: sellMark, net };
}

interface InsiderReply {
  trades: { date: string; filed: string; code: 'P' | 'S'; value: number | null; shares: number; insider: string }[];
}

async function loadInsiders(symbol: string): Promise<ExternalPoint[]> {
  const d = await engineRequest<InsiderReply>('research.insider_history', { symbol: symbol.replace(/^\$/, ''), years: 5 }, 180000);
  // The filing date, not the trade date: nobody outside the company knew about the trade before it was filed.
  return d.trades.map((t) => ({ time: dayTime(t.filed || t.date), values: { buy: t.code === 'P' ? 1 : 0, sell: t.code === 'S' ? 1 : 0, value: t.value ?? 0 } }));
}

/** 13F reports are due 45 days after the quarter ends, so a quarter's holders count from then. */
export const THIRTEEN_F_DELAY_DAYS = 45;

interface HoldersReply {
  quarters: { period: string; holders: number; shares: number; new?: number; added?: number; reduced?: number; soldOut?: number }[];
}

async function loadHolders(symbol: string): Promise<ExternalPoint[]> {
  const d = await engineRequest<HoldersReply>('prospect.holders_by_symbol', { symbol: symbol.replace(/^\$/, '') }, 60000);
  return d.quarters.map((q, i) => {
    const prev = d.quarters[i - 1];
    return {
      time: dayTime(q.period) + THIRTEEN_F_DELAY_DAYS * DAY,
      values: {
        holders: q.holders,
        shares: q.shares / 1e6,
        sharesChange: prev ? (q.shares - prev.shares) / 1e6 : NaN,
        net: q.new == null ? NaN : (q.new ?? 0) + (q.added ?? 0) - (q.reduced ?? 0) - (q.soldOut ?? 0),
      },
    };
  });
}

/** University of Michigan sentiment is dated the 1st of the survey month; the final reading is out by month end. */
export function sentimentPoints(rows: { time: string; value: number }[]): ExternalPoint[] {
  let sum = 0;
  return rows
    .filter((r) => Number.isFinite(r.value))
    .map((r, i) => {
      sum += r.value;
      const d = new Date(`${r.time.slice(0, 10)}T00:00:00Z`);
      return { time: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000, values: { value: r.value, avg: sum / (i + 1) } };
    });
}

async function loadSentiment(): Promise<ExternalPoint[]> {
  const d = await engineRequest<{ data: { time: string; value: number }[] }>('macro.series', { series: 'UMCSENT', raw: true, limit: 100000 }, 45000);
  return sentimentPoints(d.data);
}

async function loadPutCall(symbol: string): Promise<ExternalPoint[]> {
  const d = await engineRequest<{ summary: { putCallVolume: number | null; putCallOi: number | null } }>('flow.options', { symbol: symbol.replace(/^\$/, '') }, 45000);
  return [{ time: Math.floor(Date.now() / 1000), values: { vol: d.summary.putCallVolume ?? NaN, oi: d.summary.putCallOi ?? NaN } }];
}

/** Only today's reading exists (the chain is a snapshot), so it goes on the last bar alone. */
function lastBarOnly(bars: Bar[], points: ExternalPoint[] | undefined, field: string): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  const v = points?.[points.length - 1]?.values[field];
  if (bars.length && v != null) out[bars.length - 1] = v;
  return out;
}

const num = (key: string, label: string, def: number, min: number, max: number, step = 1) => ({ key, label, type: 'number' as const, default: def, min, max, step });

export const SMART_MONEY: IndicatorDef[] = [
  {
    id: 'progo',
    name: 'Williams Pro Go',
    shortName: 'Pro Go',
    category: 'Positioning',
    description: 'Larry Williams’ professionals vs the public: the average overnight move (previous close to open, the public) against the average session move (open to close, the pros).',
    placement: 'separate',
    inputs: [num('length', 'Average length', 14, 2, 200)],
    plots: [
      { key: 'diff', title: 'Pros − Public', type: 'histogram', color: '#26a69a', colorBy: 'sign', negativeColor: '#ef5350' },
      { key: 'public', title: 'Public', type: 'line', color: '#ff9800', lineWidth: 2 },
      { key: 'pros', title: 'Pros', type: 'line', color: '#2962ff', lineWidth: 2 },
    ],
    levels: [0],
    compute: (bars, p) => proGo(bars, Number(p.length)),
  },
  {
    id: 'vixfix',
    name: 'Williams VIX Fix',
    shortName: 'VIX Fix',
    category: 'Volatility',
    description: 'Larry Williams’ synthetic VIX for any stock: how far the low sits below the highest close of the last 22 bars. Spikes (above the band) mark fear and often bottoms.',
    placement: 'separate',
    inputs: [num('period', 'Highest-close look-back', 22, 2, 200), num('bbLength', 'Band length', 20, 2, 200), num('mult', 'Band SDs', 2, 0.5, 5, 0.1), num('lookback', 'Percentile look-back', 50, 5, 500), num('pct', 'Percentile (of the high)', 0.85, 0.5, 1, 0.01)],
    plots: [
      { key: 'wvf', title: 'VIX Fix', type: 'histogram', color: '#8a8f9c' },
      { key: 'upper', title: 'Upper band', type: 'line', color: '#ef5350', lineWidth: 1 },
      { key: 'rangeHigh', title: 'Range high', type: 'line', color: '#ff9800', lineWidth: 1 },
      { key: 'signal', title: 'Fear spike', type: 'marker', marker: { shape: 'circle', position: 'belowBar' }, color: '#26a69a' },
    ],
    compute: (bars, p) => vixFix(bars, Number(p.period), Number(p.bbLength), Number(p.mult), Number(p.lookback), Number(p.pct)),
  },
  {
    id: 'williamspatterns',
    name: 'Williams patterns (Smash Day, Oops!, Outside day)',
    shortName: 'W-patterns',
    category: 'Candlestick Patterns',
    description: 'Larry Williams’ short-term entry patterns from "Long-Term Secrets to Short-Term Trading": naked and hidden Smash Days, Oops! gaps and outside days with a down close, marked where the entry triggers.',
    placement: 'overlay',
    inputs: [],
    plots: [
      { key: 'smashBuy', title: 'Smash Day buy', type: 'marker', marker: { shape: 'arrowUp', position: 'belowBar', text: 'Smash' }, color: '#26a69a' },
      { key: 'smashSell', title: 'Smash Day sell', type: 'marker', marker: { shape: 'arrowDown', position: 'aboveBar', text: 'Smash' }, color: '#ef5350' },
      { key: 'hiddenBuy', title: 'Hidden Smash buy', type: 'marker', marker: { shape: 'arrowUp', position: 'belowBar', text: 'Hidden' }, color: '#00897b' },
      { key: 'hiddenSell', title: 'Hidden Smash sell', type: 'marker', marker: { shape: 'arrowDown', position: 'aboveBar', text: 'Hidden' }, color: '#c62828' },
      { key: 'oopsBuy', title: 'Oops! buy', type: 'marker', marker: { shape: 'arrowUp', position: 'belowBar', text: 'Oops!' }, color: '#2962ff' },
      { key: 'oopsSell', title: 'Oops! sell', type: 'marker', marker: { shape: 'arrowDown', position: 'aboveBar', text: 'Oops!' }, color: '#ab47bc' },
      { key: 'outsideBuy', title: 'Outside day down close (buy)', type: 'marker', marker: { shape: 'circle', position: 'belowBar', text: 'OD' }, color: '#ff9800' },
    ],
    compute: (bars) => williamsPatterns(bars),
  },
  {
    id: 'insiders',
    name: 'Insider buying/selling (SEC Form 4)',
    shortName: 'Insiders',
    category: 'Positioning',
    description: 'Open-market buys (B) and sales (S) by the company’s officers, directors and 10% owners from their SEC Form 4 filings, shown on the day the filing became public, plus net insider dollars for each month so far.',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'net', title: 'Net insider $ (month to date)', type: 'histogram', color: '#26a69a', colorBy: 'sign', negativeColor: '#ef5350' },
      { key: 'buy', title: 'Insider buy', type: 'marker', marker: { shape: 'arrowUp', position: 'belowBar', text: 'B' }, color: '#26a69a' },
      { key: 'sell', title: 'Insider sale', type: 'marker', marker: { shape: 'arrowDown', position: 'aboveBar', text: 'S' }, color: '#ef5350' },
    ],
    levels: [0],
    external: { load: loadInsiders },
    compute: (bars, _p, external) => insiderSeries(bars, external),
  },
  {
    id: 'inst13f',
    name: 'Institutional holders (13F)',
    shortName: '13F holders',
    category: 'Positioning',
    description: 'How many institutions ($100M+ managers filing 13F) hold the stock each quarter, and the net number adding (new + added − reduced − sold out). Needs the 13F download on the Prospecting page.',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'holders', title: 'Holders', type: 'line', color: '#2962ff', lineWidth: 2 },
      { key: 'net', title: 'Net adding', type: 'histogram', color: '#26a69a', colorBy: 'sign', negativeColor: '#ef5350' },
    ],
    external: { load: loadHolders },
    compute: (bars, _p, external) => ({ holders: alignExternal(bars, external, 'holders'), net: alignExternal(bars, external, 'net') }),
  },
  {
    id: 'inst13fshares',
    name: 'Institutional shares held (13F)',
    shortName: '13F shares',
    category: 'Positioning',
    description: 'Total shares (millions) held by 13F institutions each quarter and the change from the quarter before. Needs the 13F download on the Prospecting page.',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'shares', title: 'Shares held (M)', type: 'line', color: '#7e57c2', lineWidth: 2 },
      { key: 'sharesChange', title: 'Change (M)', type: 'histogram', color: '#26a69a', colorBy: 'sign', negativeColor: '#ef5350' },
    ],
    external: { load: loadHolders },
    compute: (bars, _p, external) => ({ shares: alignExternal(bars, external, 'shares'), sharesChange: alignExternal(bars, external, 'sharesChange') }),
  },
  {
    id: 'putcall',
    name: 'Put/call ratio (today)',
    shortName: 'P/C',
    category: 'Positioning',
    description: 'Today’s put/call ratio for this stock’s options (volume and open interest, all expirations), read in the legend. Only the current reading: there is no free daily history.',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'vol', title: 'P/C volume', type: 'line', color: '#ef5350', lineWidth: 2, style: 'dots' },
      { key: 'oi', title: 'P/C open interest', type: 'line', color: '#2962ff', lineWidth: 2, style: 'dots' },
    ],
    levels: [0.7, 1],
    external: { load: loadPutCall },
    compute: (bars, _p, external) => ({ vol: lastBarOnly(bars, external, 'vol'), oi: lastBarOnly(bars, external, 'oi') }),
  },
  {
    id: 'umcsent',
    name: 'Consumer sentiment (U. of Michigan)',
    shortName: 'Sentiment',
    category: 'Positioning',
    description: 'The University of Michigan Consumer Sentiment index (FRED UMCSENT, monthly) with its long-run average: how the public feels. Extremes are contrarian.',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'value', title: 'Sentiment', type: 'line', color: '#ff9800', lineWidth: 2 },
      { key: 'avg', title: 'Long-run average', type: 'line', color: '#8a8f9c', lineWidth: 1 },
    ],
    external: { load: () => loadSentiment() },
    compute: (bars, _p, external) => ({ value: alignExternal(bars, external, 'value'), avg: alignExternal(bars, external, 'avg') }),
  },
];

const holdersGuide = (what: string): IndicatorGuide => ({
  what,
  use: [
    '13F filers are institutions managing $100M+ (funds, pensions, banks, hedge funds): the "institutions" side of the market. The public isn’t in it.',
    'It shows the two newest quarters in the download: the step between them, and the bars for who opened, added, cut or sold out (only among filers who reported both quarters).',
    'Each quarter counts from 45 days after it ends (the filing deadline), so the chart never shows it before it was public.',
  ],
  signals: ['Holders and shares rising while price falls = institutions buying weakness (bullish over months).', 'Many selling out while price still rises = distribution.'],
  tip: 'Needs the 13F download on the Prospecting page (it keeps each filer’s two newest quarters). Share classes (GOOGL/GOOG, BRK.A/BRK.B) are kept apart. 13F data is 45+ days old, long only, and leaves out shorts and most options.',
});

export const SMART_MONEY_GUIDES: Record<string, IndicatorGuide> = {
  progo: {
    what: 'Larry Williams’ Pro Go splits each bar in two. The move from yesterday’s close to today’s open belongs to the public (orders placed overnight, on news and emotion). The move from today’s open to the close belongs to the professionals, who trade during the session. Both are averaged over 14 bars; the histogram is Pros minus Public.',
    use: ['Williams’ idea: professionals buy during the day what the public sold at the open, and the other way round.', 'Pros line above zero and above the Public line = the session is being bought: professionals are accumulating.', 'Works on daily bars; on intraday bars the "open" is each bar’s own open, which loses the overnight meaning.'],
    signals: ['Pros crossing above Public (histogram turning green) = professionals buying; bullish.', 'Pros crossing below Public, or the Pros line falling below zero while price rises = the rally is on public buying only; caution.', 'Price making new lows while the Pros line rises = accumulation (bullish divergence).'],
    tip: 'A context tool, not an entry signal on its own: combine it with trend and a price trigger.',
  },
  vixfix: {
    what: 'Larry Williams’ VIX Fix: a fear gauge for any stock. It measures how far today’s low is below the highest close of the last 22 bars, as a %. When it spikes, holders are panicking. The red band (average + 2 SD) and orange line (85% of the 50-bar high) mark unusual spikes, as in Chris Moody’s version.',
    use: ['Fear spikes come from the public selling in a hurry; professionals tend to buy them.', 'A green dot under the candle marks the first bar of each spike.', 'Works best on daily charts of stocks and indexes in a long-term uptrend.'],
    signals: ['VIX Fix above the band, then falling back = selling exhausted; look for a buy trigger.', 'Repeated spikes in a downtrend = still dangerous; wait for price to confirm.'],
    tip: 'It finds bottoms, not tops: low readings don’t mean a top is near.',
  },
  williamspatterns: {
    what: 'Larry Williams’ short-term patterns from "Long-Term Secrets to Short-Term Trading". Each arrow sits on the bar where his entry would trigger. Smash Day: a close beyond the previous bar’s range (below its low for a buy) that the next bar reverses (trades above the smash bar’s high). Hidden Smash Day: an up close that is still below the open and in the bottom 25% of the range (a buy), or the mirror for a sell; entry on a break of its high/low. Oops!: a gap open beyond the previous bar’s low or high that trades back to it. OD: an outside day (higher high, lower low) that closed below the prior low; the circle is on the next bar, where Williams buys the open.',
    use: ['The idea: the public panics into the close or the open; professionals take the other side when price reverses.', 'Use on daily bars, with the trend (buy signals in uptrends, sell signals in downtrends).', 'Each signal can be hidden on its own from the legend.'],
    signals: ['Smash buy / Hidden buy: buy above the signal bar’s high; stop below its low.', 'Oops! buy: a gap down that fills back to yesterday’s low; stop below today’s low.', 'OD: buy the next open; Williams used a quick exit (first profitable open).'],
    tip: 'Patterns fire often. Test them on Backtest before trusting them, and skip ones against the bigger trend.',
  },
  insiders: {
    what: 'Insider trading from SEC Form 4: open-market buys (B, green) and sales (S, red) by the company’s officers, directors and 10%+ owners, shown on the day the filing became public (up to two business days after the trade), with net insider dollars month to date (by filing date) in the pane. Awards, option exercises, tax withholding and gifts are left out because they aren’t a choice to buy or sell with their own money.',
    use: ['Insiders know the business best. Buying with their own money is rare and meaningful; selling is common (taxes, diversification, planned 10b5-1 sales).', 'Clusters matter: several insiders buying in the same few weeks is the strongest signal.', 'Markers sit on the filing day, so the chart never shows a trade before the public could know about it.'],
    signals: ['Cluster of B arrows after a fall = insiders see value; bullish over months.', 'Big net selling by several executives at highs = caution, especially without planned-sale notes.'],
    tip: 'Loads 5 years of filings the first time (it can take a minute), then it’s cached. Needs the SEC email in Settings.',
  },
  inst13f: holdersGuide('How many institutions report holding the stock each quarter (13F filings), and how many more are adding than cutting: new positions + added − reduced − sold out.'),
  inst13fshares: holdersGuide('The total number of shares (millions) that 13F institutions report holding each quarter, and the change from the quarter before.'),
  putcall: {
    what: 'The put/call ratio for this stock’s options today: put volume ÷ call volume (red) and put open interest ÷ call open interest (blue), across every expiration Schwab lists. It only shows the latest reading on the last bar (read it in the legend): there’s no free daily history for single stocks.',
    use: ['Below about 0.7 = many more calls than puts (bullish crowd); above 1 = more puts (fearful crowd or hedging).', 'For single stocks, big funds use puts to hedge, so read it as a crowd reading, not as "smart money".'],
    signals: ['Extreme readings are contrarian: very high put/call after a fall can mark a bottom.', 'Compare with the Flow page’s options tab for the detail by expiration.'],
  },
  umcsent: {
    what: 'The University of Michigan Consumer Sentiment index (FRED series UMCSENT): a monthly survey of how ordinary households feel about their finances and the economy. The grey line is its long-run average up to each month. Each reading starts at the end of its survey month, when the final number is out.',
    use: ['This is the public’s mood. Williams and other contrarians treat extremes as signals against the crowd.', 'Use on daily or weekly charts of indexes and consumer stocks.'],
    signals: ['Very low sentiment (far below average) has often come near market bottoms.', 'Very high sentiment after long rallies = complacency; caution.'],
    tip: 'Monthly data: it moves slowly and is a backdrop, not a timing tool.',
  },
};
