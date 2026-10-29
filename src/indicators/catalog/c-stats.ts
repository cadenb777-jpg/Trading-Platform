/** Statistics family: regression, distribution shape, fractal/persistence estimates, risk-adjusted returns, SPY comparisons. */
import { schwab } from '../../data/schwab';
import type { Bar } from '../../types';
import { alignExternal } from '../external';
import { highest } from '../math';
import type { ExternalPoint, IndicatorDef } from '../types';
import {
  C, NaNs, annualInput, closes, fin, input, length, lineFit, logReturns, mean, median, num, pearson, percentRank, quantile, rolling, rolling2, simpleReturns, slopeOf, sorted, sourceInput, src, sum, variance, type Entry,
} from './c-math';

const line = (key: string, title: string, color: string) => ({ key, title, type: 'line' as const, color, lineWidth: 2 as const });
const histo = (key: string, title: string) => ({ key, title, type: 'histogram' as const, color: C.up, colorBy: 'sign' as const, negativeColor: C.down });

/** Hurst exponent by rescaled range: chunks of size N/2, N/4, ... (>= 8), slope of log(mean R/S) on log(size). */
export function hurstRS(w: number[]): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let s = Math.floor(w.length / 2); s >= 8; s = Math.floor(s / 2)) {
    let total = 0;
    let count = 0;
    for (let start = 0; start + s <= w.length; start += s) {
      const chunk = w.slice(start, start + s);
      const m = mean(chunk);
      let cum = 0;
      let hi = -Infinity;
      let lo = Infinity;
      for (const v of chunk) {
        cum += v - m;
        hi = Math.max(hi, cum);
        lo = Math.min(lo, cum);
      }
      const sd = Math.sqrt(variance(chunk));
      if (sd > 0) {
        total += (hi - lo) / sd;
        count++;
      }
    }
    if (count && total > 0) {
      xs.push(Math.log(s));
      ys.push(Math.log(total / count));
    }
  }
  return xs.length >= 2 ? slopeOf(xs, ys) : NaN;
}

/** Detrended fluctuation analysis: profile of demeaned values, boxes of 4, 8, 16... (<= N/4), slope of log F on log size. */
export function dfaAlpha(w: number[]): number {
  const m = mean(w);
  const profile: number[] = [];
  let cum = 0;
  for (const v of w) profile.push((cum += v - m));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let s = 4; s <= w.length / 4; s *= 2) {
    let sq = 0;
    let count = 0;
    for (let start = 0; start + s <= profile.length; start += s) {
      const box = profile.slice(start, start + s);
      const f = lineFit(box);
      for (let j = 0; j < s; j++) sq += (box[j] - (f.intercept + f.slope * j)) ** 2;
      count += s;
    }
    const F = Math.sqrt(sq / count);
    if (F > 0) {
      xs.push(Math.log(s));
      ys.push(Math.log(F));
    }
  }
  return xs.length >= 2 ? slopeOf(xs, ys) : NaN;
}

/** Sevcik's fractal dimension of a window (Long's FDI): 1 + (ln L + ln 2) / ln(2(n − 1)) on the price normalised to 0..1. */
export function fractalDim(w: number[]): number {
  const n = w.length;
  const lo = Math.min(...w);
  const range = Math.max(...w) - lo;
  const y = w.map((v) => (range ? (v - lo) / range : 0));
  const dx = 1 / (n - 1);
  let L = 0;
  for (let j = 1; j < n; j++) L += Math.sqrt((y[j] - y[j - 1]) ** 2 + dx * dx);
  return 1 + (Math.log(L) + Math.log(2)) / Math.log(2 * (n - 1));
}

/** Max drawdown (%, negative) within a window, peak measured from the window's start. */
export function maxDrawdown(w: number[]): number {
  let peak = w[0];
  let worst = 0;
  for (const v of w) {
    peak = Math.max(peak, v);
    worst = Math.min(worst, v / peak - 1);
  }
  return 100 * worst;
}

const skewness = (w: number[]) => {
  const n = w.length;
  const m = mean(w);
  const s = Math.sqrt(variance(w, true));
  return (n / ((n - 1) * (n - 2))) * sum(w.map((x) => ((x - m) / s) ** 3));
};
const exKurtosis = (w: number[]) => {
  const n = w.length;
  const m = mean(w);
  const s = Math.sqrt(variance(w, true));
  const s4 = sum(w.map((x) => ((x - m) / s) ** 4));
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
};

const cagrOf = (c: number[], n: number, annual: number) => c.map((v, i) => (i >= n ? fin(100 * ((v / c[i - n]) ** (annual / n) - 1)) : NaN));

// ---------- SPY benchmark (daily charts only) ----------

/** SPY daily closes from the Schwab helper, as outside data (the chart symbol is ignored). */
async function loadSpy(): Promise<ExternalPoint[]> {
  const bars = await schwab.loadHistory('SPY', '1D', new AbortController().signal);
  return bars.map((b) => ({ time: b.time, values: { close: b.close } }));
}

/** True when bars are daily or longer (a day's close is only known at the end of the day, so intraday would look ahead). */
function dailyOrLonger(bars: Bar[]): boolean {
  if (bars.length < 2) return false;
  const gaps = bars.slice(1, 50).map((b, i) => b.time - bars[i].time).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] >= 20 * 3600;
}

/** Benchmark closes aligned with the bars, or all NaN off daily charts. */
export function benchmarkCloses(bars: Bar[], external?: ExternalPoint[]): number[] {
  return dailyOrLonger(bars) ? alignExternal(bars, external, 'close') : NaNs(bars.length);
}

const benchmark = (def: Omit<IndicatorDef, 'external' | 'category' | 'placement'>): IndicatorDef => ({ ...def, category: 'Statistics', placement: 'separate', external: { load: loadSpy } });

export const C_STATS: Entry[] = [
  {
    def: {
      id: 'lrintercept',
      name: 'Linear Regression Intercept',
      shortName: 'LR Int',
      category: 'Statistics',
      description: 'Where the best-fit line through the last N values starts, i.e. its value at the oldest bar of the window (TA-Lib LINEARREG_INTERCEPT).',
      placement: 'overlay',
      inputs: [length(14, 2), sourceInput],
      plots: [line('int', 'Intercept', C.purple)],
      compute: (bars, p) => ({ int: rolling(src(bars, p), num(p, 'length'), (w) => lineFit(w).intercept) }),
    },
    guide: {
      what: 'The starting point of the regression line fitted to the last N bars.',
      use: ['Price above the intercept line = the window\'s trend has carried price up from where it "started".'],
      signals: ['Crossings with the Linear Regression line show the slope changing sign.'],
    },
  },
  {
    def: {
      id: 'tsf',
      name: 'Time Series Forecast',
      shortName: 'TSF',
      category: 'Statistics',
      description: 'The regression line extended one bar ahead: linear regression value + slope (TA-Lib TSF).',
      placement: 'overlay',
      inputs: [length(14, 2), sourceInput],
      plots: [line('tsf', 'TSF', C.aqua)],
      compute: (bars, p) => ({ tsf: rolling(src(bars, p), num(p, 'length'), (w) => {
        const f = lineFit(w);
        return f.end + f.slope;
      }) }),
    },
    guide: {
      what: 'Where the straight-line trend of the last N bars says the next bar should be.',
      use: ['Use like a fast moving average that leans in the trend\'s direction.'],
      signals: ['Price crossing the TSF line = short-term trend change.'],
      tip: 'It is a statistical projection, not a prediction; it overshoots at turns.',
    },
  },
  {
    def: {
      id: 'lrr2',
      name: 'R-Squared (trend fit)',
      shortName: 'R²',
      category: 'Statistics',
      description: 'Coefficient of determination of price against time over N bars: 1 = prices sit exactly on a straight line.',
      placement: 'separate',
      inputs: [length(20, 3), sourceInput],
      plots: [line('r2', 'R²', C.amber)],
      levels: [0.7, 0.3],
      compute: (bars, p) => ({ r2: rolling(src(bars, p), num(p, 'length'), (w) => lineFit(w).r2) }),
    },
    guide: {
      what: 'How much of recent price movement a straight trend line explains, from 0 (none) to 1 (all).',
      use: ['High R² (above ~0.7) = a clean, strong trend in either direction; low = noise.'],
      signals: ['R² dropping from a high level = the trend is breaking down.'],
      tip: 'It doesn\'t tell direction; check the slope or the price.',
    },
  },
  {
    def: {
      id: 'stderr',
      name: 'Standard Error of Regression',
      shortName: 'StdErr',
      category: 'Statistics',
      description: 'Achelis: √(Σ residual² / (N − 2)) around the best-fit line of the last N values, in price units.',
      placement: 'separate',
      inputs: [length(21, 3), sourceInput],
      plots: [line('se', 'StdErr', C.violet)],
      compute: (bars, p) => ({ se: rolling(src(bars, p), num(p, 'length'), (w) => lineFit(w).se) }),
    },
    guide: {
      what: 'How tightly prices hug their regression trend line. Small = orderly trend; large = scattered.',
      use: ['Low and falling = a smooth trend; it is the width used by Standard Error Bands.'],
      signals: ['A sudden rise = price breaking away from its trend line.'],
    },
  },
  {
    def: {
      id: 'hurst',
      name: 'Hurst Exponent (R/S estimate)',
      shortName: 'Hurst',
      category: 'Statistics',
      description: 'Rolling Hurst exponent of log returns by rescaled range (chunks N/2, N/4, ... ≥ 8). Rough estimate: noisy on short windows and biased upward.',
      placement: 'separate',
      inputs: [length(100, 32)],
      plots: [line('h', 'Hurst', C.blue)],
      levels: [0.5],
      compute: (bars, p) => ({ h: rolling(logReturns(closes(bars)), num(p, 'length'), hurstRS) }),
    },
    guide: {
      what: 'A persistence measure: above 0.5 = moves tend to continue (trending); below 0.5 = moves tend to reverse (mean-reverting); 0.5 = random.',
      use: ['Favour trend-following when it is clearly above 0.5, mean-reversion when clearly below.'],
      signals: ['A shift across 0.5 = the market\'s character may be changing.'],
      tip: 'This R/S estimate reads a little above 0.5 even for random data; only large, lasting deviations mean much.',
    },
  },
  {
    def: {
      id: 'fdi',
      name: 'Fractal Dimension Index',
      shortName: 'FDI',
      category: 'Statistics',
      description: 'Sevcik/Long: 1 + (ln L + ln 2) / ln(2(N − 1)), L = path length of the last N closes scaled to a unit box. about 1 = straight line, 2 = space-filling noise (an approximation: on short windows even a straight line reads above 1).',
      placement: 'separate',
      inputs: [length(30, 3)],
      plots: [line('fdi', 'FDI', C.pink)],
      levels: [1.5],
      compute: (bars, p) => ({ fdi: rolling(closes(bars), num(p, 'length'), fractalDim) }),
    },
    guide: {
      what: 'How jagged the recent price path is, from about 1 (a straight line; short windows read a little higher) to 2 (pure zig-zag).',
      use: ['Below 1.5 = trending; above 1.5 = choppy and mean-reverting.'],
      signals: ['A drop below 1.5 = a trend taking hold.'],
    },
  },
  {
    def: {
      id: 'dfa',
      name: 'Detrended Fluctuation Alpha (approx.)',
      shortName: 'DFA α',
      category: 'Statistics',
      description: 'Approximate rolling DFA exponent of log returns: box sizes 4, 8, 16, ... ≤ N/4, linear detrending. ~0.5 = random, > 0.5 = persistent, < 0.5 = anti-persistent.',
      placement: 'separate',
      inputs: [length(100, 32)],
      plots: [line('alpha', 'α', C.indigo)],
      levels: [0.5],
      compute: (bars, p) => ({ alpha: rolling(logReturns(closes(bars)), num(p, 'length'), dfaAlpha) }),
    },
    guide: {
      what: 'Another persistence measure (like Hurst) that removes local trends first. 0.5 = random walk.',
      use: ['Above 0.5 = returns tend to follow each other (trending); below = tend to reverse.'],
      signals: ['Agreement with the Hurst exponent makes the reading more trustworthy.'],
      tip: 'Approximate: only a few box sizes fit in a rolling window, so treat small changes as noise.',
    },
  },
  {
    def: {
      id: 'pctrank',
      name: 'Percent Rank',
      shortName: '%Rank',
      category: 'Statistics',
      description: 'Percent of the previous N values that are at or below the current one (Pine ta.percentrank), 0-100.',
      placement: 'separate',
      inputs: [length(20, 1), sourceInput],
      plots: [line('rank', '%Rank', C.orange)],
      levels: [80, 20],
      compute: (bars, p) => ({ rank: percentRank(src(bars, p), num(p, 'length')) }),
    },
    guide: {
      what: 'Where today\'s price ranks against the last N bars: 100 = highest, 0 = lowest.',
      use: ['A simple overbought/oversold gauge that ignores how far, only the rank.'],
      signals: ['Above 80 = near the top of the recent range; below 20 = near the bottom.'],
    },
  },
  {
    def: {
      id: 'percentile',
      name: 'Rolling Percentile Channel',
      shortName: 'Pctl',
      category: 'Statistics',
      description: 'The p-th and (100 − p)-th percentiles of the last N values (linear interpolation), drawn on the price.',
      placement: 'overlay',
      inputs: [length(20, 2), input('pct', 'Percentile', 90, 50, 100, 1), sourceInput],
      plots: [line('upper', 'Upper', C.up), line('lower', 'Lower', C.down)],
      compute: (bars, p) => {
        const s = src(bars, p);
        const q = num(p, 'pct') / 100;
        return { upper: rolling(s, num(p, 'length'), (w) => quantile(sorted(w), q)), lower: rolling(s, num(p, 'length'), (w) => quantile(sorted(w), 1 - q)) };
      },
    },
    guide: {
      what: 'Two lines marking where the top 10% and bottom 10% of recent prices were (by default).',
      use: ['A distribution-based channel that is less affected by single spikes than Bollinger Bands.'],
      signals: ['Closing outside the channel = price at an extreme for the window.'],
    },
  },
  {
    def: {
      id: 'rollmedian',
      name: 'Rolling Median',
      shortName: 'Median',
      category: 'Statistics',
      description: 'Median of the last N values: the middle value, unaffected by single outliers.',
      placement: 'overlay',
      inputs: [length(20, 1), sourceInput],
      plots: [line('median', 'Median', C.amber)],
      compute: (bars, p) => ({ median: rolling(src(bars, p), num(p, 'length'), median) }),
    },
    guide: {
      what: 'The middle price of the last N bars, a moving "average" that ignores spikes.',
      use: ['Use like a moving average on stocks with occasional wild bars.'],
      signals: ['Price crossing the median = shift in the recent balance.'],
    },
  },
  {
    def: {
      id: 'meandev',
      name: 'Mean Absolute Deviation',
      shortName: 'MeanDev',
      category: 'Statistics',
      description: 'Average distance of the last N values from their mean (the deviation CCI uses), in price units.',
      placement: 'separate',
      inputs: [length(20, 1), sourceInput],
      plots: [line('md', 'MeanDev', C.sky)],
      compute: (bars, p) => ({ md: rolling(src(bars, p), num(p, 'length'), (w) => {
        const m = mean(w);
        return mean(w.map((v) => Math.abs(v - m)));
      }) }),
    },
    guide: {
      what: 'The typical distance of prices from their average, a simpler cousin of standard deviation.',
      use: ['Rising = more spread out prices (more volatile).'],
      signals: ['A very low reading = tight consolidation.'],
    },
  },
  {
    def: {
      id: 'mdad',
      name: 'Median Absolute Deviation',
      shortName: 'MAD',
      category: 'Statistics',
      description: 'Median of |value − median| over the last N values: a robust spread measure.',
      placement: 'separate',
      inputs: [length(20, 1), sourceInput],
      plots: [line('mad', 'MAD', C.indigo)],
      compute: (bars, p) => ({ mad: rolling(src(bars, p), num(p, 'length'), (w) => {
        const m = median(w);
        return median(w.map((v) => Math.abs(v - m)));
      }) }),
    },
    guide: {
      what: 'A spread measure that one outlier bar can\'t distort.',
      use: ['Use instead of standard deviation when a few huge bars would mislead.'],
      signals: ['Rising = typical moves widening.'],
    },
  },
  {
    def: {
      id: 'iqr',
      name: 'Interquartile Range',
      shortName: 'IQR',
      category: 'Statistics',
      description: '75th minus 25th percentile of the last N values (linear interpolation): the spread of the middle half.',
      placement: 'separate',
      inputs: [length(20, 2), sourceInput],
      plots: [line('iqr', 'IQR', C.purple)],
      compute: (bars, p) => ({ iqr: rolling(src(bars, p), num(p, 'length'), (w) => {
        const s = sorted(w);
        return quantile(s, 0.75) - quantile(s, 0.25);
      }) }),
    },
    guide: {
      what: 'How wide the middle 50% of recent prices is, ignoring the extremes.',
      use: ['A robust volatility gauge; compare with its own history.'],
      signals: ['Shrinking IQR = consolidation.'],
    },
  },
  {
    def: {
      id: 'skew',
      name: 'Rolling Skewness',
      shortName: 'Skew',
      category: 'Statistics',
      description: 'Sample skewness (adjusted Fisher-Pearson, as pandas) of log returns over N bars. Negative = bigger falls than rises.',
      placement: 'separate',
      inputs: [length(60, 3)],
      plots: [histo('skew', 'Skew')],
      levels: [0],
      compute: (bars, p) => ({ skew: rolling(logReturns(closes(bars)), num(p, 'length'), skewness) }),
    },
    guide: {
      what: 'Whether recent returns are lopsided: negative = occasional big drops, positive = occasional big jumps.',
      use: ['Negative skew warns of crash-like risk even when volatility looks normal.'],
      signals: ['Skew turning sharply negative = big down days have appeared.'],
    },
  },
  {
    def: {
      id: 'kurt',
      name: 'Rolling Kurtosis (excess)',
      shortName: 'Kurt',
      category: 'Statistics',
      description: 'Sample excess kurtosis (as pandas) of log returns over N bars. Above 0 = fatter tails than a normal distribution.',
      placement: 'separate',
      inputs: [length(60, 4)],
      plots: [line('kurt', 'Kurtosis', C.violet)],
      levels: [0],
      compute: (bars, p) => ({ kurt: rolling(logReturns(closes(bars)), num(p, 'length'), exKurtosis) }),
    },
    guide: {
      what: 'How often extreme moves happen compared with a normal bell curve. High = more surprise days.',
      use: ['High kurtosis = standard-deviation-based risk understates the real tail risk.'],
      signals: ['A jump = a shock bar entered the window.'],
    },
  },
  {
    def: {
      id: 'entropy',
      name: 'Return Entropy (Shannon)',
      shortName: 'Entropy',
      category: 'Statistics',
      description: 'Shannon entropy of the last N log returns sorted into equal-width bins, divided by log(bins): 0 = all alike, 1 = evenly spread.',
      placement: 'separate',
      inputs: [length(50, 2), input('bins', 'Bins', 10, 2, 100)],
      plots: [line('h', 'Entropy', C.aqua)],
      compute: (bars, p) => {
        const k = num(p, 'bins');
        return {
          h: rolling(logReturns(closes(bars)), num(p, 'length'), (w) => {
            const lo = Math.min(...w);
            const width = (Math.max(...w) - lo) / k;
            if (!width) return 0;
            const counts = new Array<number>(k).fill(0);
            for (const v of w) counts[Math.min(k - 1, Math.floor((v - lo) / width))]++;
            let h = 0;
            for (const c of counts) if (c) h -= (c / w.length) * Math.log(c / w.length);
            return h / Math.log(k);
          }),
        };
      },
    },
    guide: {
      what: 'How disordered recent returns are. Low = returns cluster in a few sizes (orderly); high = spread all over (random).',
      use: ['Falling entropy can mean a more predictable, orderly phase.'],
      signals: ['A sharp drop = one or two outsized bars dominate the window.'],
    },
  },
  {
    def: {
      id: 'sharpe',
      name: 'Rolling Sharpe Ratio',
      shortName: 'Sharpe',
      category: 'Statistics',
      description: '(mean simple return − risk-free per bar) / sample std dev of returns × √(bars per year), over N bars.',
      placement: 'separate',
      inputs: [length(252, 2), input('rf', 'Risk-free % per year', 0, 0, 100, 0.1), annualInput],
      plots: [line('sharpe', 'Sharpe', C.blue)],
      levels: [1, 0],
      compute: (bars, p) => {
        const A = num(p, 'annual');
        const rf = num(p, 'rf') / 100 / A;
        return { sharpe: rolling(simpleReturns(closes(bars)), num(p, 'length'), (w) => ((mean(w) - rf) / Math.sqrt(variance(w, true))) * Math.sqrt(A)) };
      },
    },
    guide: {
      what: 'Return earned per unit of volatility over the past year (by default), annualised.',
      use: ['Above 1 = good risk-adjusted performance; below 0 = losing money.'],
      signals: ['A falling Sharpe = returns shrinking relative to the bumps.'],
      tip: 'Past Sharpe ratios don\'t predict future ones well; use it to describe, not forecast.',
    },
  },
  {
    def: {
      id: 'sortino',
      name: 'Rolling Sortino Ratio',
      shortName: 'Sortino',
      category: 'Statistics',
      description: '(mean simple return − target) / downside deviation √(mean(min(r − target, 0)²)) × √(bars per year), over N bars; target = risk-free.',
      placement: 'separate',
      inputs: [length(252, 2), input('rf', 'Risk-free % per year', 0, 0, 100, 0.1), annualInput],
      plots: [line('sortino', 'Sortino', C.up)],
      levels: [1, 0],
      compute: (bars, p) => {
        const A = num(p, 'annual');
        const rf = num(p, 'rf') / 100 / A;
        return { sortino: rolling(simpleReturns(closes(bars)), num(p, 'length'), (w) => ((mean(w) - rf) / Math.sqrt(mean(w.map((r) => Math.min(r - rf, 0) ** 2)))) * Math.sqrt(A)) };
      },
    },
    guide: {
      what: 'Like the Sharpe ratio but only falls count as risk, so steady gains with occasional jumps aren\'t penalised.',
      use: ['Above 1-2 = good return for the downside suffered.'],
      signals: ['Sortino much higher than Sharpe = most volatility was upside.'],
    },
  },
  {
    def: {
      id: 'maxdd',
      name: 'Rolling Max Drawdown',
      shortName: 'MaxDD',
      category: 'Statistics',
      description: 'Largest peak-to-trough fall of the close within the last N bars, in % (0 or negative).',
      placement: 'separate',
      inputs: [length(252, 2)],
      plots: [{ key: 'dd', title: 'Max DD %', type: 'histogram', color: C.down }],
      compute: (bars, p) => ({ dd: rolling(closes(bars), num(p, 'length'), maxDrawdown) }),
    },
    guide: {
      what: 'The worst fall from a high to a later low during the last year (by default).',
      use: ['Shows how much a holder could have lost at worst recently; size positions so you can live with it.'],
      signals: ['A new, deeper max drawdown = risk has grown.'],
    },
  },
  {
    def: {
      id: 'drawdown',
      name: 'Drawdown from High',
      shortName: 'DD',
      category: 'Statistics',
      description: '100 × (close / highest close of the last N bars − 1): how far below its recent peak price is now.',
      placement: 'separate',
      inputs: [length(252, 1)],
      plots: [{ key: 'dd', title: 'Drawdown %', type: 'histogram', color: C.down }],
      levels: [-10, -20],
      compute: (bars, p) => {
        const c = closes(bars);
        const hc = highest(c, num(p, 'length'));
        return { dd: c.map((v, i) => fin(100 * (v / hc[i] - 1))) };
      },
    },
    guide: {
      what: 'The current fall from the highest close of the past year (by default), in percent.',
      use: ['−10% is a "correction", −20% a "bear market" by the usual rule of thumb.'],
      signals: ['Returning to 0 = a new high.'],
    },
  },
  {
    def: {
      id: 'cagr',
      name: 'Annualised Return (rolling)',
      shortName: 'CAGR',
      category: 'Statistics',
      description: 'Compound annual growth over the last N bars: 100 × ((close / close N bars ago)^(bars per year / N) − 1).',
      placement: 'separate',
      inputs: [length(252, 1), annualInput],
      plots: [histo('cagr', 'CAGR %')],
      levels: [0],
      compute: (bars, p) => ({ cagr: cagrOf(closes(bars), num(p, 'length'), num(p, 'annual')) }),
    },
    guide: {
      what: 'The yearly growth rate over the chosen window, so different window lengths compare fairly.',
      use: ['With N = 252 on daily bars it is simply the 1-year return.'],
      signals: ['Turning negative = the stock is lower than N bars ago.'],
      tip: 'Short windows annualised give huge, unrealistic numbers; use at least a few months.',
    },
  },
  {
    def: {
      id: 'logret',
      name: 'Log Return',
      shortName: 'LogRet',
      category: 'Statistics',
      description: '100 × ln(close / close N bars ago). Log returns add up over time and are symmetric for gains and losses.',
      placement: 'separate',
      inputs: [length(1, 1)],
      plots: [histo('r', 'Log return %')],
      levels: [0],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const c = closes(bars);
        return { r: c.map((v, i) => (i >= n ? fin(100 * Math.log(v / c[i - n])) : NaN)) };
      },
    },
    guide: {
      what: 'Each bar\'s return in log percent (very close to the normal % change for small moves).',
      use: ['The input many statistics use (volatility, skew, Hurst).'],
      signals: ['Clusters of large bars = a volatile spell.'],
    },
  },
  {
    def: {
      id: 'calmar',
      name: 'Rolling Calmar Ratio',
      shortName: 'Calmar',
      category: 'Statistics',
      description: 'Annualised return over N bars divided by the absolute max drawdown in the same N bars.',
      placement: 'separate',
      inputs: [length(252, 2), annualInput],
      plots: [line('calmar', 'Calmar', C.orange)],
      levels: [0],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const c = closes(bars);
        const r = cagrOf(c, n - 1, num(p, 'annual'));
        const dd = rolling(c, n, maxDrawdown);
        return { calmar: r.map((v, i) => fin(v / Math.abs(dd[i]))) };
      },
    },
    guide: {
      what: 'Return per unit of worst drawdown: how much you earned for the worst fall you had to sit through.',
      use: ['Above 1 = the yearly return beat the worst drawdown.'],
      signals: ['Falling = drawdowns growing faster than returns.'],
      tip: 'The return is measured from the first to the last bar of the same window as the drawdown.',
    },
  },
  {
    def: {
      id: 'omega',
      name: 'Rolling Omega Ratio',
      shortName: 'Omega',
      category: 'Statistics',
      description: 'Keating & Shadwick: Σ gains above the threshold / Σ losses below it, over the last N simple returns (threshold % per bar, default 0).',
      placement: 'separate',
      inputs: [length(252, 2), input('threshold', 'Threshold % per bar', 0, -10, 10, 0.01)],
      plots: [line('omega', 'Omega', C.aqua)],
      levels: [1],
      compute: (bars, p) => {
        const t = num(p, 'threshold') / 100;
        return {
          omega: rolling(simpleReturns(closes(bars)), num(p, 'length'), (w) => sum(w.map((r) => Math.max(r - t, 0))) / sum(w.map((r) => Math.max(t - r, 0)))),
        };
      },
    },
    guide: {
      what: 'Total size of the gains divided by total size of the losses. It uses the whole return distribution, not just volatility.',
      use: ['Above 1 = gains outweighed losses; below 1 = losses outweighed gains.'],
      signals: ['Crossing below 1 = the window turned into a net loser.'],
    },
  },
  {
    def: {
      id: 'uppct',
      name: 'Up Bars %',
      shortName: 'Up%',
      category: 'Statistics',
      description: 'Percent of the last N bars that closed higher than the bar before.',
      placement: 'separate',
      inputs: [length(20, 1)],
      plots: [line('up', 'Up %', C.up)],
      levels: [50],
      compute: (bars, p) => {
        const c = closes(bars);
        return { up: rolling(c.map((v, i) => (i ? (v > c[i - 1] ? 1 : 0) : NaN)), num(p, 'length'), (w) => 100 * mean(w)) };
      },
    },
    guide: {
      what: 'The share of recent bars that rose: a simple "how often" measure of buying pressure.',
      use: ['Above 60% = consistent buying; below 40% = consistent selling.'],
      signals: ['A rising trend with fewer and fewer up bars = narrowing support.'],
    },
  },
  {
    def: {
      id: 'autocorr',
      name: 'Return Autocorrelation',
      shortName: 'AutoCorr',
      category: 'Statistics',
      description: 'Pearson correlation of log returns with the same returns `lag` bars earlier, inside the last N bars (pandas Series.autocorr).',
      placement: 'separate',
      inputs: [length(60, 3), input('lag', 'Lag', 1, 1, 100)],
      plots: [histo('ac', 'AutoCorr')],
      levels: [0],
      compute: (bars, p) => {
        const k = num(p, 'lag');
        return { ac: rolling(logReturns(closes(bars)), num(p, 'length'), (w) => (w.length > k + 1 ? pearson(w.slice(k), w.slice(0, -k)) : NaN)) };
      },
    },
    guide: {
      what: 'Whether one bar\'s move tends to be followed by a move the same way (positive) or the opposite way (negative).',
      use: ['Positive = momentum behaviour; negative = mean-reverting behaviour.'],
      signals: ['Values beyond about ±2/√N are unlikely to be pure chance.'],
    },
  },
  {
    def: {
      id: 'var95',
      name: 'Historical Value at Risk',
      shortName: 'VaR',
      category: 'Statistics',
      description: 'Historical VaR: the loss (in %, shown positive) at the (100 − confidence) percentile of the last N simple returns (linear interpolation).',
      placement: 'separate',
      inputs: [length(252, 2), input('conf', 'Confidence %', 95, 50, 99.9, 0.5)],
      plots: [line('var', 'VaR %', C.down)],
      compute: (bars, p) => {
        const q = 1 - num(p, 'conf') / 100;
        return { var: rolling(simpleReturns(closes(bars)), num(p, 'length'), (w) => -100 * quantile(sorted(w), q)) };
      },
    },
    guide: {
      what: 'A bad-day estimate: at 95%, one bar in 20 lost at least this much over the past year.',
      use: ['Size positions so a VaR-sized move is a loss you accept.'],
      signals: ['Rising VaR = the bad days are getting worse.'],
      tip: 'VaR says nothing about how bad the worst days are; see Expected Shortfall.',
    },
  },
  {
    def: {
      id: 'cvar',
      name: 'Expected Shortfall (CVaR)',
      shortName: 'CVaR',
      category: 'Statistics',
      description: 'Average loss (in %, shown positive) of the last N simple returns at or below the historical VaR percentile.',
      placement: 'separate',
      inputs: [length(252, 2), input('conf', 'Confidence %', 95, 50, 99.9, 0.5)],
      plots: [line('cvar', 'CVaR %', C.pink)],
      compute: (bars, p) => {
        const q = 1 - num(p, 'conf') / 100;
        return {
          cvar: rolling(simpleReturns(closes(bars)), num(p, 'length'), (w) => {
            const cut = quantile(sorted(w), q);
            return -100 * mean(w.filter((r) => r <= cut));
          }),
        };
      },
    },
    guide: {
      what: 'The average of the worst 5% of bars (at 95%): how bad the bad days really are.',
      use: ['A stricter risk measure than VaR; regulators and risk managers prefer it.'],
      signals: ['CVaR far above VaR = fat-tailed crash risk.'],
    },
  },
  {
    def: {
      id: 'cv',
      name: 'Coefficient of Variation',
      shortName: 'CV',
      category: 'Statistics',
      description: '100 × population std dev / mean of the last N values: spread relative to the price level.',
      placement: 'separate',
      inputs: [length(20, 2), sourceInput],
      plots: [line('cv', 'CV %', C.amber)],
      compute: (bars, p) => ({ cv: rolling(src(bars, p), num(p, 'length'), (w) => (100 * Math.sqrt(variance(w))) / mean(w)) }),
    },
    guide: {
      what: 'Standard deviation as a percent of the average price, so stocks at different prices compare fairly.',
      use: ['Compare how "spread out" recent prices are across stocks.'],
      signals: ['Very low CV = tight base; often precedes a breakout.'],
    },
  },
  {
    def: {
      id: 'streak',
      name: 'Up/Down Streak',
      shortName: 'Streak',
      category: 'Statistics',
      description: 'Consecutive higher closes (+1, +2, ...) or lower closes (−1, −2, ...); an unchanged close resets to 0 (Connors).',
      placement: 'separate',
      inputs: [],
      plots: [histo('streak', 'Streak')],
      levels: [0],
      compute: (bars) => {
        let s = 0;
        return {
          streak: bars.map((b, i) => {
            if (!i) return NaN;
            const d = b.close - bars[i - 1].close;
            s = d > 0 ? Math.max(s, 0) + 1 : d < 0 ? Math.min(s, 0) - 1 : 0;
            return s;
          }),
        };
      },
    },
    guide: {
      what: 'How many bars in a row have closed up (positive) or down (negative).',
      use: ['Long streaks are uncommon; short-term traders fade them (part of Connors RSI).'],
      signals: ['A streak of 4-5 or more = stretched short-term.'],
    },
  },
  {
    def: {
      id: 'tstat',
      name: 'Return t-Statistic',
      shortName: 't-stat',
      category: 'Statistics',
      description: 'mean / (sample std dev / √N) of the last N log returns: how strongly the drift differs from zero.',
      placement: 'separate',
      inputs: [length(60, 3)],
      plots: [histo('t', 't')],
      levels: [2, 0, -2],
      compute: (bars, p) => ({ t: rolling(logReturns(closes(bars)), num(p, 'length'), (w) => mean(w) / Math.sqrt(variance(w, true) / w.length)) }),
    },
    guide: {
      what: 'A statistician\'s trend test: is the average return clearly above or below zero, given how noisy it is?',
      use: ['Beyond ±2 = the trend is statistically noticeable over the window.'],
      signals: ['Crossing back towards 0 = the trend is no longer distinguishable from noise.'],
      tip: 'Overlapping windows on one chart are not independent tests; treat it as a gauge.',
    },
  },
  {
    def: {
      id: 'vratio',
      name: 'Variance Ratio',
      shortName: 'VR(q)',
      category: 'Statistics',
      description: 'Lo-MacKinlay style: variance of overlapping q-bar log returns / (q × variance of 1-bar returns) in the last N returns (no bias correction).',
      placement: 'separate',
      inputs: [length(100, 10), input('q', 'Horizon q', 5, 2, 100)],
      plots: [line('vr', 'VR', C.purple)],
      levels: [1],
      compute: (bars, p) => {
        const q = num(p, 'q');
        return {
          vr: rolling(logReturns(closes(bars)), num(p, 'length'), (w) => {
            const sums: number[] = [];
            for (let j = q; j <= w.length; j++) sums.push(sum(w.slice(j - q, j)));
            return sums.length > 1 ? variance(sums, true) / (q * variance(w, true)) : NaN;
          }),
        };
      },
    },
    guide: {
      what: 'Checks whether multi-bar moves are bigger (trending) or smaller (mean-reverting) than a random walk predicts.',
      use: ['Above 1 = moves build on each other; below 1 = moves tend to reverse.'],
      signals: ['A lasting move away from 1 = the market\'s character is changing.'],
    },
  },
  {
    def: {
      id: 'halflife',
      name: 'Mean-Reversion Half-Life',
      shortName: 'Half-life',
      category: 'Statistics',
      description: 'Ornstein-Uhlenbeck fit over N closes: regress Δclose on the previous close; half-life = −ln 2 / slope bars (blank when not mean-reverting).',
      placement: 'separate',
      inputs: [length(100, 10)],
      plots: [line('hl', 'Half-life', C.sky)],
      compute: (bars, p) => ({
        hl: rolling(closes(bars), num(p, 'length'), (w) => {
          const b = slopeOf(w.slice(0, -1), w.slice(1).map((v, j) => v - w[j]));
          return b < 0 ? -Math.log(2) / b : NaN;
        }),
      }),
    },
    guide: {
      what: 'If price behaves like a rubber band, how many bars it takes to snap halfway back to its mean.',
      use: ['Short half-lives suit mean-reversion trades; set holding periods near the half-life.'],
      signals: ['A blank line = no mean reversion measured (trending or random).'],
    },
  },
];

/**
 * SPY comparisons (loaded through IndicatorDef.external from the Schwab helper). Not registered yet: the shared
 * library test feeds every outside-data indicator hourly bars without a `close` field, and these are deliberately
 * blank there (daily charts only, no look-ahead). Add them to TREND_STATS once that test supplies daily SPY closes.
 */
export const C_BENCHMARK: Entry[] = [
  {
    def: benchmark({
      id: 'relspy',
      name: 'Price Ratio vs SPY',
      shortName: '÷SPY',
      description: 'Close divided by SPY\'s close (relative strength line). Daily or longer charts only; SPY comes from the Schwab helper.',
      inputs: [length(50, 1, 'Ratio average')],
      plots: [line('ratio', 'Ratio', C.blue), { key: 'ma', title: 'Average', type: 'line', color: C.orange, lineWidth: 1 }],
      compute: (bars, p, external) => {
        const spy = benchmarkCloses(bars, external);
        const ratio = bars.map((b, i) => fin(b.close / spy[i]));
        return { ratio, ma: rolling(ratio, num(p, 'length'), mean) };
      },
    }),
    guide: {
      what: 'The stock\'s price divided by the S&P 500 ETF (SPY). A rising line = the stock is beating the market.',
      use: ['Prefer stocks whose ratio line is rising and above its average.'],
      signals: ['Ratio making new highs before price does = strong leadership.', 'Ratio falling while price rises = lagging the market.'],
      tip: 'Needs the Schwab helper; it shows nothing on intraday charts (SPY\'s daily close isn\'t known until the end of the day).',
    },
  },
  {
    def: benchmark({
      id: 'betaspy',
      name: 'Rolling Beta vs SPY',
      shortName: 'β SPY',
      description: 'Covariance of simple daily returns with SPY / variance of SPY\'s returns over N bars. Daily or longer charts only.',
      inputs: [length(60, 3)],
      plots: [line('beta', 'Beta', C.purple)],
      levels: [1, 0],
      compute: (bars, p, external) => {
        const r = simpleReturns(closes(bars));
        const rb = simpleReturns(benchmarkCloses(bars, external));
        return { beta: rolling2(rb, r, num(p, 'length'), slopeOf) };
      },
    }),
    guide: {
      what: 'How much the stock tends to move when the market moves 1%: beta 1.5 = about 1.5%.',
      use: ['High beta = amplifies the market (more risk); below 1 = calmer than the market.'],
      signals: ['Beta rising = the stock is getting more tied to (and more sensitive to) the market.'],
      tip: 'Needs the Schwab helper and a daily chart.',
    },
  },
  {
    def: benchmark({
      id: 'corrspy',
      name: 'Rolling Correlation vs SPY',
      shortName: 'ρ SPY',
      description: 'Pearson correlation of simple daily returns with SPY\'s over N bars (−1..+1). Daily or longer charts only.',
      inputs: [length(60, 3)],
      plots: [line('corr', 'Correlation', C.aqua)],
      levels: [0.5, 0, -0.5],
      compute: (bars, p, external) => {
        const r = simpleReturns(closes(bars));
        const rb = simpleReturns(benchmarkCloses(bars, external));
        return { corr: rolling2(r, rb, num(p, 'length'), pearson) };
      },
    }),
    guide: {
      what: 'How closely the stock\'s daily moves follow the market\'s: +1 = in lockstep, 0 = unrelated.',
      use: ['Low correlation = the stock is moving on its own news; good for diversification.'],
      signals: ['A drop in correlation = something stock-specific is driving it.'],
      tip: 'Needs the Schwab helper and a daily chart.',
    },
  },
];
