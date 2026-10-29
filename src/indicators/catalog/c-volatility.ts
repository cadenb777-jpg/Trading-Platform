/** Volatility family: true-range measures, range-based volatility estimators, drawdown pain and squeeze gauges. */
import { ema, highest, lowest, sma, stdev, trueRange } from '../math';
import { atrOf } from './c-trend';
import { C, NaNs, annualInput, closes, fin, highs, input, length, logReturns, lows, mean, num, percentRank, rolling, shift, simpleReturns, sourceInput, src, variance, type Entry } from './c-math';

const LN2 = Math.log(2);
const tr = (bars: Parameters<typeof atrOf>[0]) => trueRange(highs(bars), lows(bars), closes(bars));
/** Annualised volatility in percent from a per-bar variance. */
const annualise = (v: number, annual: number) => (v >= 0 ? Math.sqrt(v * annual) * 100 : NaN);
const line = (key: string, title: string, color: string) => ({ key, title, type: 'line' as const, color, lineWidth: 2 as const });
const histo = (key: string, title: string) => ({ key, title, type: 'histogram' as const, color: C.up, colorBy: 'sign' as const, negativeColor: C.down });

/** Close-to-close historical volatility: sample std dev of log returns × √annual × 100. */
export const hvOf = (c: number[], n: number, annual: number) => rolling(logReturns(c), n, (w) => annualise(variance(w, true), annual));

/** Ulcer index over n bars: RMS of % drawdowns from the rolling n-bar highest close. */
export function ulcerOf(c: number[], n: number): number[] {
  const hc = highest(c, n);
  const dd = c.map((v, i) => (100 * (v - hc[i])) / hc[i]);
  return rolling(dd, n, (w) => Math.sqrt(mean(w.map((d) => d * d))));
}

/** Rolling mean of a per-bar quantity, annualised as a volatility. */
const rangeVol = (terms: number[], n: number, annual: number) => rolling(terms, n, (w) => annualise(mean(w), annual));

export const C_VOLATILITY: Entry[] = [
  {
    def: {
      id: 'mass',
      name: 'Mass Index',
      shortName: 'Mass',
      category: 'Volatility',
      description: 'Dorsey: sum over 25 bars of EMA9(high − low) / EMA9(EMA9(high − low)). A "reversal bulge" rises above 27 then falls below 26.5.',
      placement: 'separate',
      inputs: [input('ema', 'EMA length', 9, 1, 500), length(25, 1, 'Sum length')],
      plots: [line('mass', 'Mass', C.purple)],
      levels: [27, 26.5],
      compute: (bars, p) => {
        const e1 = ema(bars.map((b) => b.high - b.low), num(p, 'ema'));
        const e2 = ema(e1, num(p, 'ema'));
        const ratio = e1.map((v, i) => fin(v / e2[i]));
        return { mass: rolling(ratio, num(p, 'length'), (w) => w.reduce((a, b) => a + b, 0)) };
      },
    },
    guide: {
      what: 'Watches the high-low range widen and narrow. A sudden widening (a "bulge") often comes near trend reversals.',
      use: ['Wait for the line to rise above 27, then drop back below 26.5: the "reversal bulge".'],
      signals: ['After a bulge, the direction of the next move is set by price (e.g. a moving-average turn), not by the index.'],
      tip: 'It shows that a reversal may be coming, not which way; use a trend tool for direction.',
    },
  },
  {
    def: {
      id: 'natr',
      name: 'Normalized ATR (%)',
      shortName: 'NATR',
      category: 'Volatility',
      description: 'ATR as a percent of the close: 100 × ATR(N) / close (TA-Lib NATR). Comparable across stocks and prices.',
      placement: 'separate',
      inputs: [length(14, 1)],
      plots: [line('natr', 'NATR', C.down)],
      compute: (bars, p) => {
        const atr = atrOf(bars, num(p, 'length'));
        return { natr: atr.map((v, i) => fin((100 * v) / bars[i].close)) };
      },
    },
    guide: {
      what: 'The average bar size in percent of price, so 2 means a typical bar moves about 2%.',
      use: ['Compare how volatile different stocks are, or the same stock at different price levels.', 'Size positions: higher NATR = smaller position for the same risk.'],
      signals: ['Rising NATR = volatility expanding; falling = calming down.'],
    },
  },
  {
    def: {
      id: 'trange',
      name: 'True Range',
      shortName: 'TR',
      category: 'Volatility',
      description: 'Wilder\'s true range of each bar: max(high, previous close) − min(low, previous close). Includes gaps.',
      placement: 'separate',
      inputs: [],
      plots: [{ key: 'tr', title: 'TR', type: 'histogram', color: C.sky }],
      compute: (bars) => ({ tr: tr(bars) }),
    },
    guide: {
      what: 'The full size of each bar including any gap from the previous close. ATR is its average.',
      use: ['Spot unusually large bars (news, earnings) against the typical size.'],
      signals: ['A bar two or more times the usual true range = a volatility shock.'],
    },
  },
  {
    def: {
      id: 'atrsma',
      name: 'ATR (simple average)',
      shortName: 'ATR SMA',
      category: 'Volatility',
      description: 'Average true range smoothed with a simple moving average instead of Wilder\'s average.',
      placement: 'separate',
      inputs: [length(14, 1)],
      plots: [line('atr', 'ATR', C.down)],
      compute: (bars, p) => ({ atr: sma(tr(bars), num(p, 'length')) }),
    },
    guide: {
      what: 'The plain average size of the last N bars (with gaps). Reacts a little faster than Wilder\'s ATR and drops old bars all at once.',
      use: ['Use like ATR for stops and position sizing.'],
      signals: ['Rising = volatility expanding.'],
    },
  },
  {
    def: {
      id: 'atrema',
      name: 'ATR (exponential average)',
      shortName: 'ATR EMA',
      category: 'Volatility',
      description: 'Average true range smoothed with a standard EMA (α = 2/(N+1)), faster than Wilder\'s ATR.',
      placement: 'separate',
      inputs: [length(14, 1)],
      plots: [line('atr', 'ATR', C.orange)],
      compute: (bars, p) => ({ atr: ema(tr(bars), num(p, 'length')) }),
    },
    guide: {
      what: 'Average bar size weighted towards the latest bars, so it reacts quickly when volatility changes.',
      use: ['Use for tighter, more reactive volatility stops.'],
      signals: ['A quick jump = a sudden rise in volatility.'],
    },
  },
  {
    def: {
      id: 'adr',
      name: 'Average Daily Range',
      shortName: 'ADR',
      category: 'Volatility',
      description: 'Simple average of high − low over N bars (no gaps, unlike ATR).',
      placement: 'separate',
      inputs: [length(20, 1)],
      plots: [line('adr', 'ADR', C.amber)],
      compute: (bars, p) => ({ adr: sma(bars.map((b) => b.high - b.low), num(p, 'length')) }),
    },
    guide: {
      what: 'The typical distance between each bar\'s high and low, in price units.',
      use: ['Day traders use it to judge how much room is left today: if the day already moved one ADR, more range is less likely.'],
      signals: ['Today\'s range far above ADR = an unusual day.'],
    },
  },
  {
    def: {
      id: 'adrpct',
      name: 'Average Daily Range %',
      shortName: 'ADR%',
      category: 'Volatility',
      description: 'ADR% = 100 × (SMA(high / low, N) − 1): the typical bar range in percent.',
      placement: 'separate',
      inputs: [length(20, 1)],
      plots: [line('adr', 'ADR%', C.amber)],
      compute: (bars, p) => ({ adr: sma(bars.map((b) => fin(b.high / b.low)), num(p, 'length')).map((v) => 100 * (v - 1)) }),
    },
    guide: {
      what: 'The average high-to-low range in percent of price.',
      use: ['Momentum traders often look for stocks with ADR% above 3-4% (enough movement to trade).'],
      signals: ['Falling ADR% = the stock is getting quieter (often before a breakout).'],
    },
  },
  {
    def: {
      id: 'rangepct',
      name: 'Bar Range %',
      shortName: 'Range%',
      category: 'Volatility',
      description: '100 × (high − low) / close for each bar.',
      placement: 'separate',
      inputs: [],
      plots: [{ key: 'range', title: 'Range %', type: 'histogram', color: C.sky }],
      compute: (bars) => ({ range: bars.map((b) => fin((100 * (b.high - b.low)) / b.close)) }),
    },
    guide: {
      what: 'How big each bar was in percent of price.',
      use: ['Find wide-range bars (strong moves) and narrow ones (quiet coils).'],
      signals: ['A very wide bar closing near its high = strong buying; near its low = strong selling.'],
    },
  },
  {
    def: {
      id: 'gappct',
      name: 'Opening Gap %',
      shortName: 'Gap%',
      category: 'Volatility',
      description: 'Gap between the open and the previous close: 100 × (open / previous close − 1).',
      placement: 'separate',
      inputs: [],
      plots: [histo('gap', 'Gap %')],
      levels: [0],
      compute: (bars) => ({ gap: bars.map((b, i) => (i ? fin(100 * (b.open / bars[i - 1].close - 1)) : NaN)) }),
    },
    guide: {
      what: 'How far each bar opened above (green) or below (red) the previous close.',
      use: ['Spot gaps from overnight news and earnings.'],
      signals: ['Large gaps that hold through the day show conviction; gaps that fill (price returns to the previous close) show weakness.'],
      tip: 'On crypto and 24-hour markets gaps are almost always zero.',
    },
  },
  {
    def: {
      id: 'chaikinvol',
      name: 'Chaikin Volatility',
      shortName: 'ChVol',
      category: 'Volatility',
      description: 'Chaikin: % change over `roc` bars of the EMA of (high − low): 100 × (EMA − EMA[roc]) / EMA[roc].',
      placement: 'separate',
      inputs: [length(10, 1, 'EMA length'), input('roc', 'Change over bars', 10, 1, 500)],
      plots: [line('cv', 'Chaikin Vol', C.violet)],
      levels: [0],
      compute: (bars, p) => {
        const e = ema(bars.map((b) => b.high - b.low), num(p, 'length'));
        const prev = shift(e, num(p, 'roc'));
        return { cv: e.map((v, i) => fin((100 * (v - prev[i])) / prev[i])) };
      },
    },
    guide: {
      what: 'Whether the average high-low range is widening (positive) or narrowing (negative) compared with a few bars ago.',
      use: ['A sharp rise often comes near market bottoms (panic); a long decline near tops (complacency).'],
      signals: ['A spike up after a sell-off = possible capitulation low.'],
    },
  },
  {
    def: {
      id: 'hv',
      name: 'Historical Volatility (close-to-close)',
      shortName: 'HV',
      category: 'Volatility',
      description: 'Sample std dev of log returns over N bars × √(bars per year) × 100: annualised volatility in percent.',
      placement: 'separate',
      inputs: [length(20, 2), annualInput],
      plots: [line('hv', 'HV', C.blue)],
      compute: (bars, p) => ({ hv: hvOf(closes(bars), num(p, 'length'), num(p, 'annual')) }),
    },
    guide: {
      what: 'The classic volatility number: how much the stock has been moving, scaled to a yearly percent (like an option\'s implied volatility).',
      use: ['20 means a one-standard-deviation yearly move of about 20%; divide by about 16 for a typical daily move.', 'Set "Bars per year" to match the chart (252 daily, 52 weekly, ~1638 hourly).'],
      signals: ['Very low HV compared with its history = a quiet spell that often ends with a big move.'],
    },
  },
  {
    def: {
      id: 'parkinson',
      name: 'Parkinson Volatility',
      shortName: 'Parkinson',
      category: 'Volatility',
      description: 'Parkinson (1980): √(mean(ln(H/L)²) / (4 ln 2)) annualised. Uses the high-low range; ignores gaps.',
      placement: 'separate',
      inputs: [length(20, 1), annualInput],
      plots: [line('vol', 'Parkinson', C.sky)],
      compute: (bars, p) => ({ vol: rangeVol(bars.map((b) => Math.log(b.high / b.low) ** 2 / (4 * LN2)), num(p, 'length'), num(p, 'annual')) }),
    },
    guide: {
      what: 'Annualised volatility estimated from each bar\'s high and low, which uses more information than closes alone.',
      use: ['Compare with close-to-close HV: Parkinson is steadier with the same number of bars.'],
      signals: ['Rising = intrabar swings growing.'],
      tip: 'It misses overnight gaps, so it reads low for stocks that gap a lot; Yang-Zhang includes them.',
    },
  },
  {
    def: {
      id: 'garmanklass',
      name: 'Garman-Klass Volatility',
      shortName: 'GK',
      category: 'Volatility',
      description: 'Garman & Klass (1980): √(mean(½ ln(H/L)² − (2 ln 2 − 1) ln(C/O)²)) annualised. Uses open, high, low and close; ignores gaps.',
      placement: 'separate',
      inputs: [length(20, 1), annualInput],
      plots: [line('vol', 'Garman-Klass', C.aqua)],
      compute: (bars, p) => ({
        vol: rangeVol(bars.map((b) => 0.5 * Math.log(b.high / b.low) ** 2 - (2 * LN2 - 1) * Math.log(b.close / b.open) ** 2), num(p, 'length'), num(p, 'annual')),
      }),
    },
    guide: {
      what: 'Annualised volatility from the open, high, low and close of each bar, one of the most efficient range estimators.',
      use: ['Use as a less noisy alternative to close-to-close HV.'],
      signals: ['Rising = volatility expanding.'],
      tip: 'Assumes no drift and no gaps; Rogers-Satchell handles trends, Yang-Zhang handles gaps.',
    },
  },
  {
    def: {
      id: 'rogerssatchell',
      name: 'Rogers-Satchell Volatility',
      shortName: 'RS Vol',
      category: 'Volatility',
      description: 'Rogers & Satchell (1991): √(mean(ln(H/C)·ln(H/O) + ln(L/C)·ln(L/O))) annualised. Unaffected by trend (drift).',
      placement: 'separate',
      inputs: [length(20, 1), annualInput],
      plots: [line('vol', 'Rogers-Satchell', C.indigo)],
      compute: (bars, p) => ({
        vol: rangeVol(bars.map((b) => Math.log(b.high / b.close) * Math.log(b.high / b.open) + Math.log(b.low / b.close) * Math.log(b.low / b.open)), num(p, 'length'), num(p, 'annual')),
      }),
    },
    guide: {
      what: 'Annualised volatility from open, high, low and close that stays accurate when the stock is trending strongly.',
      use: ['Prefer it over Garman-Klass for stocks in steady trends.'],
      signals: ['Rising = volatility expanding.'],
    },
  },
  {
    def: {
      id: 'gkyz',
      name: 'Garman-Klass-Yang-Zhang Volatility',
      shortName: 'GKYZ',
      category: 'Volatility',
      description: 'Garman-Klass plus the overnight gap: √(mean(ln(O/C[1])² + ½ ln(H/L)² − (2 ln 2 − 1) ln(C/O)²)) annualised.',
      placement: 'separate',
      inputs: [length(20, 1), annualInput],
      plots: [line('vol', 'GKYZ', C.pink)],
      compute: (bars, p) => ({
        vol: rangeVol(
          bars.map((b, i) => (i ? Math.log(b.open / bars[i - 1].close) ** 2 + 0.5 * Math.log(b.high / b.low) ** 2 - (2 * LN2 - 1) * Math.log(b.close / b.open) ** 2 : NaN)),
          num(p, 'length'),
          num(p, 'annual'),
        ),
      }),
    },
    guide: {
      what: 'Garman-Klass volatility with overnight gaps added in, so stocks that gap are measured fairly.',
      use: ['Use for stocks; for 24-hour markets it matches Garman-Klass.'],
      signals: ['Rising = volatility expanding (including gap risk).'],
    },
  },
  {
    def: {
      id: 'yangzhang',
      name: 'Yang-Zhang Volatility',
      shortName: 'YZ',
      category: 'Volatility',
      description: 'Yang & Zhang (2000): σ² = σ²(overnight) + k·σ²(open-to-close) + (1 − k)·σ²(Rogers-Satchell), k = 0.34 / (1.34 + (N+1)/(N−1)); annualised.',
      placement: 'separate',
      inputs: [length(20, 2), annualInput],
      plots: [line('vol', 'Yang-Zhang', C.violet)],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const k = 0.34 / (1.34 + (n + 1) / (n - 1));
        const on = bars.map((b, i) => (i ? Math.log(b.open / bars[i - 1].close) : NaN));
        const oc = bars.map((b) => Math.log(b.close / b.open));
        const rs = bars.map((b) => Math.log(b.high / b.close) * Math.log(b.high / b.open) + Math.log(b.low / b.close) * Math.log(b.low / b.open));
        const vOn = rolling(on, n, (w) => variance(w, true));
        const vOc = rolling(oc, n, (w) => variance(w, true));
        const vRs = rolling(rs, n, mean);
        return { vol: vOn.map((v, i) => annualise(v + k * vOc[i] + (1 - k) * vRs[i], num(p, 'annual'))) };
      },
    },
    guide: {
      what: 'The most complete of the range-based estimators: it combines overnight gaps, open-to-close moves and intrabar range.',
      use: ['A good default for stock volatility when you have open/high/low/close data.'],
      signals: ['Compare with its own history: high readings = turbulent, low = calm.'],
    },
  },
  {
    def: {
      id: 'ewmavol',
      name: 'EWMA Volatility (RiskMetrics)',
      shortName: 'EWMA Vol',
      category: 'Volatility',
      description: 'RiskMetrics: σ²ₜ = λσ²ₜ₋₁ + (1 − λ)r²ₜ on log returns (λ = 0.94), seeded with the mean of the first N squared returns; annualised.',
      placement: 'separate',
      inputs: [input('lambda', 'Decay λ', 0.94, 0.5, 0.999, 0.01), length(20, 1, 'Seed bars'), annualInput],
      plots: [line('vol', 'EWMA Vol', C.orange)],
      compute: (bars, p) => {
        const r = logReturns(closes(bars));
        const lam = num(p, 'lambda');
        const n = num(p, 'length');
        const out = NaNs(bars.length);
        let v = NaN;
        for (let i = n; i < bars.length; i++) {
          if (Number.isNaN(v)) v = mean(r.slice(1, n + 1).map((x) => x * x));
          else v = lam * v + (1 - lam) * r[i] ** 2;
          out[i] = annualise(v, num(p, 'annual'));
        }
        return { vol: out.map(fin) };
      },
    },
    guide: {
      what: 'Annualised volatility that weights recent returns most (the method banks use for daily risk).',
      use: ['Reacts to shocks within a day or two, then fades them out gradually.'],
      signals: ['A jump = a fresh volatility shock.'],
      tip: 'Higher λ = slower, smoother; 0.94 is the RiskMetrics daily standard.',
    },
  },
  {
    def: {
      id: 'ulcer',
      name: 'Ulcer Index',
      shortName: 'Ulcer',
      category: 'Volatility',
      description: 'Martin: √(mean of squared % drawdowns from the N-bar highest close) over N bars. Measures downside pain only.',
      placement: 'separate',
      inputs: [length(14, 1)],
      plots: [line('ui', 'Ulcer', C.down)],
      compute: (bars, p) => ({ ui: ulcerOf(closes(bars), num(p, 'length')) }),
    },
    guide: {
      what: 'How deep and how long price has been below its recent high. Upside volatility does not count, only drawdowns.',
      use: ['Lower is calmer for holders. Compare investments by how much "pain" they cause.'],
      signals: ['Rising Ulcer = a deepening or lasting drawdown.'],
    },
  },
  {
    def: {
      id: 'upi',
      name: 'Ulcer Performance Index',
      shortName: 'UPI',
      category: 'Volatility',
      description: 'Martin ratio, rolling: (annualised return over N bars − risk-free %) / Ulcer index over the same N bars.',
      placement: 'separate',
      inputs: [length(126, 2), input('rf', 'Risk-free % per year', 0, 0, 100, 0.1), annualInput],
      plots: [line('upi', 'UPI', C.up)],
      levels: [0],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const c = closes(bars);
        const ui = ulcerOf(c, n);
        return { upi: c.map((v, i) => (i >= n ? fin((100 * ((v / c[i - n]) ** (num(p, 'annual') / n) - 1) - num(p, 'rf')) / ui[i]) : NaN)) };
      },
    },
    guide: {
      what: 'Return earned per unit of drawdown pain (like a Sharpe ratio that only penalises falls).',
      use: ['Higher = better reward for the drawdowns suffered. Above 1 is decent, above 2 good.'],
      signals: ['Falling UPI = returns shrinking or drawdowns deepening.'],
    },
  },
  {
    def: {
      id: 'variance',
      name: 'Variance',
      shortName: 'Var',
      category: 'Volatility',
      description: 'Population variance of the source over N bars (TA-Lib VAR): the standard deviation squared.',
      placement: 'separate',
      inputs: [length(20, 1), sourceInput],
      plots: [line('var', 'Variance', C.amber)],
      compute: (bars, p) => ({ var: rolling(src(bars, p), num(p, 'length'), (w) => variance(w)) }),
    },
    guide: {
      what: 'How spread out prices are around their average, in squared price units.',
      use: ['Mostly a building block; standard deviation is easier to read.'],
      signals: ['Rising = prices more spread out (more volatile).'],
    },
  },
  {
    def: {
      id: 'bbwp',
      name: 'Bollinger Bandwidth Percentile',
      shortName: 'BBWP',
      category: 'Volatility',
      description: 'Percent of the last `lookback` bars whose Bollinger Bandwidth (N, mult) was at or below today\'s (0-100).',
      placement: 'separate',
      inputs: [length(20, 2), input('mult', 'Std dev', 2, 0.1, 10, 0.1), input('lookback', 'Lookback', 252, 2, 5000)],
      plots: [line('bbwp', 'BBWP', C.indigo)],
      levels: [90, 10],
      compute: (bars, p) => {
        const c = closes(bars);
        const n = num(p, 'length');
        const basis = sma(c, n);
        const dev = stdev(c, n);
        const bbw = basis.map((b, i) => fin((2 * num(p, 'mult') * dev[i]) / b));
        return { bbwp: percentRank(bbw, num(p, 'lookback')) };
      },
    },
    guide: {
      what: 'Where today\'s Bollinger Band width ranks against the past year: 5 means the bands are narrower than 95% of the time.',
      use: ['Below 10 = a squeeze: volatility is unusually low and a big move often follows.', 'Above 90 = volatility already extreme; moves tend to calm down.'],
      signals: ['Rising out of a low reading = the squeeze is releasing.'],
    },
  },
  {
    def: {
      id: 'kcw',
      name: 'Keltner Channel Width',
      shortName: 'KCW',
      category: 'Volatility',
      description: 'Width of Keltner Channels (EMA(N) ± mult × ATR(atr)) as a percent of the middle line: 100 × 2 × mult × ATR / EMA.',
      placement: 'separate',
      inputs: [length(20, 1, 'EMA length'), input('atr', 'ATR length', 10, 1, 500), input('mult', 'ATR multiple', 2, 0.1, 10, 0.1)],
      plots: [line('kcw', 'KCW %', C.purple)],
      compute: (bars, p) => {
        const mid = ema(closes(bars), num(p, 'length'));
        const atr = atrOf(bars, num(p, 'atr'));
        return { kcw: mid.map((m, i) => fin((200 * num(p, 'mult') * atr[i]) / m)) };
      },
    },
    guide: {
      what: 'How wide the Keltner Channels are, in percent of price: an ATR-based volatility gauge.',
      use: ['Narrow = quiet; wide = volatile. Compare with Bollinger width to spot squeezes (Bollinger inside Keltner).'],
      signals: ['Widening from a low = a move is starting.'],
    },
  },
  {
    def: {
      id: 'dcw',
      name: 'Donchian Channel Width',
      shortName: 'DCW',
      category: 'Volatility',
      description: 'Width of the N-bar high-low channel in percent of its middle: 100 × (HH − LL) / ((HH + LL) / 2).',
      placement: 'separate',
      inputs: [length(20, 1)],
      plots: [line('dcw', 'DCW %', C.sky)],
      compute: (bars, p) => {
        const hh = highest(highs(bars), num(p, 'length'));
        const ll = lowest(lows(bars), num(p, 'length'));
        return { dcw: hh.map((h, i) => fin((200 * (h - ll[i])) / (h + ll[i]))) };
      },
    },
    guide: {
      what: 'The size of the recent trading range (highest high to lowest low) in percent.',
      use: ['A tight range (low width) = consolidation; breakouts from tight ranges are often strong.'],
      signals: ['Width at a multi-month low = a coil worth watching.'],
    },
  },
  {
    def: {
      id: 'volratio',
      name: 'Volatility Ratio (Schwager)',
      shortName: 'VR',
      category: 'Volatility',
      description: 'Schwager: today\'s true range / the true range of the previous N bars (max(HH, close before them) − min(LL, close before them)).',
      placement: 'separate',
      inputs: [length(14, 1)],
      plots: [{ key: 'vr', title: 'VR', type: 'histogram', color: C.amber }],
      levels: [0.5],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const t = tr(bars);
        const hh = highest(highs(bars), n);
        const ll = lowest(lows(bars), n);
        return {
          vr: bars.map((_, i) => {
            if (i < n + 1) return NaN;
            const pc = bars[i - n - 1].close;
            return fin(t[i] / (Math.max(hh[i - 1], pc) - Math.min(ll[i - 1], pc)));
          }),
        };
      },
    },
    guide: {
      what: 'How big today\'s bar is compared with the whole range of the last two or three weeks.',
      use: ['Readings above 0.5 = today alone covered half the recent range: a wide-range, often trend-changing day.'],
      signals: ['A high reading with a close against the trend = possible reversal.'],
      tip: 'Platforms define it differently; this is Schwager\'s range version.',
    },
  },
  {
    def: {
      id: 'atrratio',
      name: 'ATR Ratio (short / long)',
      shortName: 'ATR Ratio',
      category: 'Volatility',
      description: 'Wilder ATR(fast) / ATR(slow). Above 1 = recent volatility higher than usual (expansion); below 1 = contraction.',
      placement: 'separate',
      inputs: [input('fast', 'Fast ATR', 5, 1, 500), input('slow', 'Slow ATR', 50, 1, 1000)],
      plots: [line('ratio', 'Ratio', C.orange)],
      levels: [1],
      compute: (bars, p) => {
        const f = atrOf(bars, num(p, 'fast'));
        const s = atrOf(bars, num(p, 'slow'));
        return { ratio: f.map((v, i) => fin(v / s[i])) };
      },
    },
    guide: {
      what: 'Compares short-term with long-term average bar size.',
      use: ['Below 1 = contraction (quiet before a possible breakout); above 1 = expansion (a move is under way).'],
      signals: ['Crossing up through 1 after a long time below = volatility breakout.'],
    },
  },
  {
    def: {
      id: 'hvrank',
      name: 'Historical Volatility Percentile',
      shortName: 'HV Pctl',
      category: 'Volatility',
      description: 'Percent of the last `lookback` bars whose close-to-close HV(N) was at or below today\'s (0-100).',
      placement: 'separate',
      inputs: [length(20, 2), input('lookback', 'Lookback', 252, 2, 5000)],
      plots: [line('rank', 'HV Pctl', C.blue)],
      levels: [80, 20],
      compute: (bars, p) => ({ rank: percentRank(hvOf(closes(bars), num(p, 'length'), 252), num(p, 'lookback')) }),
    },
    guide: {
      what: 'Where today\'s volatility ranks against the past year: 90 = more volatile than 90% of days.',
      use: ['Low readings = cheap, quiet conditions; high = turbulent.'],
      signals: ['Very low readings often come before volatility expands.'],
    },
  },
  {
    def: {
      id: 'nrn',
      name: 'Narrowest Range (NR-N)',
      shortName: 'NR',
      category: 'Volatility',
      description: 'Marks bars whose high − low is smaller than each of the previous N − 1 bars (Crabel\'s NR7 with N = 7).',
      placement: 'overlay',
      inputs: [length(7, 2)],
      plots: [{ key: 'nr', title: 'NR', type: 'marker', marker: { shape: 'circle', position: 'aboveBar', text: 'NR' }, color: C.amber }],
      compute: (bars, p) => {
        const n = num(p, 'length');
        return {
          nr: bars.map((b, i) => {
            if (i < n - 1) return NaN;
            const r = b.high - b.low;
            for (let j = i - n + 1; j < i; j++) if (bars[j].high - bars[j].low <= r) return 0;
            return 1;
          }),
        };
      },
    },
    guide: {
      what: 'Flags the quietest bar of the last 7 (or N). Narrow bars often come right before an expansion.',
      use: ['Place a buy-stop above and a sell-stop below an NR7 bar; trade whichever breaks.'],
      signals: ['NR7 that is also an inside bar = an even tighter coil.'],
    },
  },
  {
    def: {
      id: 'gri',
      name: 'Gopalakrishnan Range Index',
      shortName: 'GAPO',
      category: 'Volatility',
      description: 'Gopalakrishnan: log(highest high − lowest low over N) / log(N). Higher = more erratic.',
      placement: 'separate',
      inputs: [length(5, 2)],
      plots: [line('gapo', 'GAPO', C.violet)],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const hh = highest(highs(bars), n);
        const ll = lowest(lows(bars), n);
        return { gapo: hh.map((h, i) => fin(Math.log(h - ll[i]) / Math.log(n))) };
      },
    },
    guide: {
      what: 'A log-scaled measure of the recent high-low range: how erratic the market has been.',
      use: ['Rising = wider swings; falling = calming.'],
      signals: ['A spike = an erratic, news-driven stretch.'],
      tip: 'It is in log price units, so compare it only on one stock.',
    },
  },
  {
    def: {
      id: 'downdev',
      name: 'Downside Deviation',
      shortName: 'DownDev',
      category: 'Volatility',
      description: 'Semi-deviation of simple returns below 0: √(mean(min(r, 0)²)) over N bars, annualised %. Upside moves don\'t count.',
      placement: 'separate',
      inputs: [length(20, 1), annualInput],
      plots: [line('dd', 'DownDev', C.down)],
      compute: (bars, p) => ({ dd: rolling(simpleReturns(closes(bars)), num(p, 'length'), (w) => annualise(mean(w.map((r) => Math.min(r, 0) ** 2)), num(p, 'annual'))) }),
    },
    guide: {
      what: 'Annualised volatility of the falls only. The risk measure behind the Sortino ratio.',
      use: ['Compare with HV: much lower downside deviation = most of the volatility is on the way up.'],
      signals: ['Rising = down days getting bigger.'],
    },
  },
  {
    def: {
      id: 'sigmamove',
      name: 'Sigma Move (return z-score)',
      shortName: 'σ Move',
      category: 'Volatility',
      description: 'Today\'s log return divided by the sample std dev of the previous N log returns: how many "sigmas" the bar moved.',
      placement: 'separate',
      inputs: [length(20, 2)],
      plots: [histo('z', 'σ')],
      levels: [2, -2],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const r = logReturns(closes(bars));
        const sd = rolling(r, n, (w) => Math.sqrt(variance(w, true)));
        return { z: r.map((v, i) => (i ? fin(v / sd[i - 1]) : NaN)) };
      },
    },
    guide: {
      what: 'How unusual today\'s move was compared with recent volatility: 3 means a three-standard-deviation day.',
      use: ['Spot outsized moves that may mark news, breakouts or exhaustion.'],
      signals: ['Beyond ±2 = an unusual bar; beyond ±3 = rare.'],
    },
  },
];
