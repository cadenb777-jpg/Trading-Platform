/**
 * Momentum family, part 1: indicators in the 'Momentum' category (speed and strength of price moves).
 * Sources: StockCharts ChartSchool, TA-Lib, Achelis "Technical Analysis from A to Z", the authors' own articles
 * (Blau, Chande, Pee, Brown, Elder, Raschke, Spiroglou) and TradingView's built-ins where noted.
 */
import { ema, highest, lowest, rma, rsi, sma, stdev, trueRange, wma } from '../math';
import { linreg } from '../more';
import { C, change, closes, div, emaAlpha, highs, hist, int, lag, len, line, lows, n, NaNs, roc, sourceInput, src, sum, type Entry } from './b-util';

const hl2 = (bars: { high: number; low: number }[]) => bars.map((b) => (b.high + b.low) / 2);

/** RSI from separate up/down averages; 50 when nothing moved, 100 when nothing fell. */
function rsiFrom(up: number[], down: number[]): number[] {
  return up.map((u, i) => {
    const d = down[i];
    if (Number.isNaN(u) || Number.isNaN(d)) return NaN;
    if (d === 0) return u === 0 ? 50 : 100;
    return 100 - 100 / (1 + u / d);
  });
}
const gains = (a: number[]) => change(a).map((c) => (Number.isNaN(c) ? NaN : Math.max(c, 0)));
const losses = (a: number[]) => change(a).map((c) => (Number.isNaN(c) ? NaN : Math.max(-c, 0)));

/** Blau's double smoothing: EMA(EMA(x, long), short). */
const dsmooth = (a: number[], long: number, short: number) => ema(ema(a, long), short);
/** True Strength Index style ratio of double-smoothed x to double-smoothed |x|, times `scale`. */
function tsiRatio(x: number[], long: number, short: number, scale = 100): number[] {
  const top = dsmooth(x, long, short);
  const bottom = dsmooth(x.map(Math.abs), long, short);
  return top.map((t, i) => div(scale * t, bottom[i]));
}

/** Zero-lag EMA: 2 x EMA - EMA of the EMA. */
const zlema = (a: number[], length: number) => {
  const e1 = ema(a, length);
  const e2 = ema(e1, length);
  return e1.map((v, i) => 2 * v - e2[i]);
};

export const MOMENTUM_ENTRIES: Entry[] = [
  {
    def: {
      id: 'rsi_cutler',
      name: "Cutler's RSI",
      shortName: 'Cutler RSI',
      category: 'Momentum',
      description: 'RSI built from simple averages of gains and losses (Cutler) instead of Wilder smoothing, so it does not depend on the starting bar.',
      placement: 'separate',
      inputs: [len(14), sourceInput()],
      plots: [line('rsi', 'RSI', C.purple)],
      levels: [70, 30],
      compute: (bars, p) => {
        const s = src(bars, p);
        const l = int(p, 'length');
        return { rsi: rsiFrom(sma(gains(s), l), sma(losses(s), l)) };
      },
    },
    guide: {
      what: 'The same 0-100 gauge as the normal RSI, but every bar in the window counts equally, so the value is the same whichever day your chart starts.',
      use: ['Read it like the RSI: above 70 is stretched up, below 30 stretched down.', 'It reacts a little more sharply than Wilder’s RSI because old bars drop out completely.'],
      signals: ['A move back below 70 or above 30.', 'Divergences: price makes a new high but this RSI does not.'],
    },
  },
  {
    def: {
      id: 'rsi_ema',
      name: 'RSI (EMA smoothing)',
      shortName: 'RSI EMA',
      category: 'Momentum',
      description: 'RSI whose average gain and loss use a standard EMA (2/(n+1)) instead of Wilder smoothing; faster than the classic RSI.',
      placement: 'separate',
      inputs: [len(14), sourceInput()],
      plots: [line('rsi', 'RSI', C.purple)],
      levels: [70, 30],
      compute: (bars, p) => {
        const s = src(bars, p);
        const l = int(p, 'length');
        return { rsi: rsiFrom(ema(gains(s), l), ema(losses(s), l)) };
      },
    },
    guide: {
      what: 'An RSI that forgets old bars faster, so it turns sooner than the classic version.',
      use: ['Use it where the classic RSI feels too slow, for example on short time frames.'],
      signals: ['Turns back from above 70 or below 30.', 'Crossing 50 confirms a change of short-term direction.'],
      tip: 'Faster also means more false alarms; confirm with price.',
    },
  },
  {
    def: {
      id: 'crsi',
      name: 'Connors RSI',
      shortName: 'CRSI',
      category: 'Momentum',
      description: 'Average of a 3-bar RSI, a 2-bar RSI of the up/down streak and the percent rank of the 1-bar change over 100 bars (Larry Connors).',
      placement: 'separate',
      inputs: [n('rsi', 'RSI length', 3), n('streak', 'Streak RSI length', 2), n('rank', 'Percent-rank length', 100)],
      plots: [line('crsi', 'CRSI', C.purple)],
      levels: [90, 10],
      compute: (bars, p) => {
        const c = closes(bars);
        const streak: number[] = [];
        for (let i = 0; i < c.length; i++) {
          const prev = i === 0 ? 0 : streak[i - 1];
          streak.push(i === 0 || c[i] === c[i - 1] ? 0 : c[i] > c[i - 1] ? (prev > 0 ? prev + 1 : 1) : prev < 0 ? prev - 1 : -1);
        }
        const r1 = rsi(c, int(p, 'rsi'));
        const r2 = rsi(streak, int(p, 'streak'));
        const ch = roc(c, 1);
        const k = int(p, 'rank');
        const rank = ch.map((v, i) => {
          if (i - k < 1) return NaN;
          let below = 0;
          for (let j = i - k; j < i; j++) if (ch[j] < v) below++;
          return (100 * below) / k;
        });
        return { crsi: r1.map((v, i) => (v + r2[i] + rank[i]) / 3) };
      },
    },
    guide: {
      what: 'A short-term overbought/oversold score (0-100) that mixes three things: a very fast RSI, how many days in a row price has risen or fallen, and how big today’s move is compared with the last 100 days.',
      use: ['Built for short pullback trades in a longer uptrend.', 'Readings under 10 are deeply oversold, over 90 deeply overbought.'],
      signals: ['In an uptrend (price above its 200-day average), a drop below 10 is the classic buy setup; exit when it gets back above 50-70.'],
      tip: 'It needs about 100 bars before it shows anything.',
    },
  },
  {
    def: {
      id: 'rmi',
      name: 'Relative Momentum Index',
      shortName: 'RMI',
      category: 'Momentum',
      description: 'RSI that compares each close with the close N bars earlier instead of the previous bar (Roger Altman); Wilder smoothing.',
      placement: 'separate',
      inputs: [len(14), n('momentum', 'Momentum bars', 5), sourceInput()],
      plots: [line('rmi', 'RMI', C.purple)],
      levels: [70, 30],
      compute: (bars, p) => {
        const s = src(bars, p);
        const ch = change(s, int(p, 'momentum'));
        const l = int(p, 'length');
        return { rmi: rsiFrom(rma(ch.map((c) => (Number.isNaN(c) ? NaN : Math.max(c, 0))), l), rma(ch.map((c) => (Number.isNaN(c) ? NaN : Math.max(-c, 0))), l)) };
      },
    },
    guide: {
      what: 'An RSI that measures moves over several bars instead of one, so it is smoother and stays in the extreme zones longer during trends.',
      use: ['Read it like RSI (70/30).', 'A larger momentum setting makes it smoother.'],
      signals: ['Moves back out of the 70/30 zones.', 'Holding above 50 during pullbacks = healthy uptrend.'],
    },
  },
  {
    def: {
      id: 'rsima',
      name: 'RSI of Moving Average',
      shortName: 'RSI(MA)',
      category: 'Momentum',
      description: 'RSI calculated on an EMA of price rather than on price itself, which removes much of the bar-to-bar noise.',
      placement: 'separate',
      inputs: [len(14, 'RSI length'), n('ma', 'EMA length', 10), sourceInput()],
      plots: [line('rsi', 'RSI', C.purple)],
      levels: [70, 30],
      compute: (bars, p) => ({ rsi: rsi(ema(src(bars, p), int(p, 'ma')), int(p, 'length')) }),
    },
    guide: {
      what: 'A smoothed RSI: price is averaged first, then the RSI is taken, so the line wiggles less.',
      use: ['Good for spotting the bigger momentum swings without daily noise.'],
      signals: ['Turns from above 70 or below 30.', 'Crossing 50.'],
      tip: 'Smoother lines are later; expect signals a few bars after the classic RSI.',
    },
  },
  {
    def: {
      id: 'dymi',
      name: 'Dynamic Momentum Index',
      shortName: 'DyMI',
      category: 'Momentum',
      description: 'Chande & Kroll RSI whose length shrinks when volatility rises: 14 / (5-bar stdev / its 10-bar average), kept between 5 and 30. Uses simple averages over that length.',
      placement: 'separate',
      inputs: [len(14, 'Base length'), n('vol', 'Volatility length', 5), n('avg', 'Volatility average', 10), n('min', 'Shortest length', 5), n('max', 'Longest length', 30)],
      plots: [line('dymi', 'DyMI', C.purple)],
      levels: [70, 30],
      compute: (bars, p) => {
        const c = closes(bars);
        const sd = stdev(c, int(p, 'vol'));
        const avg = sma(sd, int(p, 'avg'));
        const lo = int(p, 'min');
        const hi = Math.max(lo, int(p, 'max'));
        const base = num0(p, 'length');
        const out = c.map((_, i) => {
          if (Number.isNaN(avg[i])) return NaN;
          let td = Math.max(lo, Math.min(hi, sd[i] === 0 ? hi : Math.trunc((base * avg[i]) / sd[i])));
          td = Math.min(td, i); // early bars: use what is available
          let up = 0;
          let down = 0;
          for (let j = i - td + 1; j <= i; j++) {
            const d = c[j] - c[j - 1];
            if (d > 0) up += d;
            else down -= d;
          }
          return up + down === 0 ? 50 : (100 * up) / (up + down);
        });
        return { dymi: out };
      },
    },
    guide: {
      what: 'An RSI that changes its own length: in calm markets it looks back further, in wild markets it shortens so it reacts faster.',
      use: ['Read it like RSI (70/30).', 'Useful when a fixed 14-bar RSI is too slow in fast markets.'],
      signals: ['Turns back from the 70/30 zones.', 'Divergences with price.'],
    },
  },
  {
    def: {
      id: 'smi',
      name: 'Stochastic Momentum Index',
      shortName: 'SMI',
      category: 'Momentum',
      description: 'Blau’s SMI: close versus the midpoint of the N-bar range, double-smoothed with EMAs, from -100 to +100; with an EMA signal line.',
      placement: 'separate',
      inputs: [len(10, '%K length'), n('smooth', 'Smoothing (EMA)', 3), n('signal', 'Signal (EMA)', 3)],
      plots: [line('smi', 'SMI', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [40, -40],
      compute: (bars, p) => {
        const l = int(p, 'length');
        const d = int(p, 'smooth');
        const hh = highest(highs(bars), l);
        const ll = lowest(lows(bars), l);
        const rel = bars.map((b, i) => b.close - (hh[i] + ll[i]) / 2);
        const range = hh.map((h, i) => h - ll[i]);
        const top = ema(ema(rel, d), d);
        const bottom = ema(ema(range, d), d);
        const smi = top.map((t, i) => div(200 * t, bottom[i]));
        return { smi, signal: ema(smi, int(p, 'signal')) };
      },
    },
    guide: {
      what: 'Like the Stochastic, but measures the close against the middle of the recent range, so it swings from -100 to +100 and is much smoother.',
      use: ['Above +40 is overbought, below -40 oversold.', 'Zero = the close is right in the middle of the range.'],
      signals: ['SMI crossing its signal line.', 'Turns back from beyond ±40.'],
    },
  },
  {
    def: {
      id: 'sroc',
      name: 'Smoothed Rate of Change',
      shortName: 'S-ROC',
      category: 'Momentum',
      description: 'Rate of change (percent) of an EMA of price (Fred Schutzman / Alexander Elder): momentum without the daily noise.',
      placement: 'separate',
      inputs: [n('ema', 'EMA length', 13), n('roc', 'ROC length', 21), sourceInput()],
      plots: [line('sroc', 'S-ROC', C.blue)],
      levels: [0],
      compute: (bars, p) => ({ sroc: roc(ema(src(bars, p), int(p, 'ema')), int(p, 'roc')) }),
    },
    guide: {
      what: 'The percent change of a smoothed price over N bars. Positive = the trend is rising, negative = falling.',
      use: ['Use the direction of the line for the trend and its turns for momentum shifts.'],
      signals: ['Crossing zero = trend change.', 'Turning down while still above zero = the rise is slowing.'],
    },
  },
  {
    def: {
      id: 'ppo',
      name: 'Percentage Price Oscillator',
      shortName: 'PPO',
      category: 'Momentum',
      description: 'MACD expressed in percent: (EMA fast - EMA slow) / EMA slow x 100, with an EMA signal line and histogram. Comparable across stocks.',
      placement: 'separate',
      inputs: [n('fast', 'Fast length', 12), n('slow', 'Slow length', 26), n('signal', 'Signal length', 9), sourceInput()],
      plots: [hist('hist', 'Histogram'), line('ppo', 'PPO', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const f = ema(s, int(p, 'fast'));
        const sl = ema(s, int(p, 'slow'));
        const ppo = f.map((v, i) => div(100 * (v - sl[i]), sl[i]));
        const signal = ema(ppo, int(p, 'signal'));
        return { ppo, signal, hist: ppo.map((v, i) => v - signal[i]) };
      },
    },
    guide: {
      what: 'The MACD shown as a percentage of price, so a $20 stock and a $500 stock can be compared on the same scale.',
      use: ['Above zero = the short-term average is above the long-term one (bullish).', 'Use it instead of MACD when comparing stocks or long histories.'],
      signals: ['PPO crossing its signal line.', 'Zero-line crosses.', 'Divergences with price.'],
    },
  },
  {
    def: {
      id: 'pmo',
      name: 'Price Momentum Oscillator',
      shortName: 'PMO',
      category: 'Momentum',
      description: 'DecisionPoint PMO: the 1-bar ROC smoothed with a custom 2/35 EMA, times 10, smoothed again with 2/20, plus a 10-bar EMA signal. EMAs are SMA-seeded (approximation of the published start).',
      placement: 'separate',
      inputs: [n('first', 'First smoothing', 35), n('second', 'Second smoothing', 20), n('signal', 'Signal length', 10)],
      plots: [line('pmo', 'PMO', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const r = roc(closes(bars), 1);
        const a = int(p, 'first');
        const b = int(p, 'second');
        const s1 = emaAlpha(r, a, 2 / a).map((v) => v * 10);
        const pmo = emaAlpha(s1, b, 2 / b);
        return { pmo, signal: ema(pmo, int(p, 'signal')) };
      },
    },
    guide: {
      what: 'A smooth momentum line from DecisionPoint: a double-smoothed daily percent change.',
      use: ['Above zero and rising = strong; below zero and falling = weak.', 'Its level can be compared between stocks to rank strength.'],
      signals: ['PMO crossing its signal line (buy when crossing up, sell when crossing down).', 'Crossing zero.'],
    },
  },
  {
    def: {
      id: 'macdv',
      name: 'MACD-V (volatility normalised)',
      shortName: 'MACD-V',
      category: 'Momentum',
      description: 'Alex Spiroglou’s MACD-V: (EMA12 - EMA26) / ATR(26) x 100, with a 9-bar EMA signal. Comparable across markets; ±50 is neutral, beyond ±150 is extreme.',
      placement: 'separate',
      inputs: [n('fast', 'Fast length', 12), n('slow', 'Slow length', 26), n('atr', 'ATR length', 26), n('signal', 'Signal length', 9)],
      plots: [hist('hist', 'Histogram'), line('macdv', 'MACD-V', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [150, 50, -50, -150],
      compute: (bars, p) => {
        const c = closes(bars);
        const f = ema(c, int(p, 'fast'));
        const s = ema(c, int(p, 'slow'));
        const atr = rma(trueRange(highs(bars), lows(bars), c), int(p, 'atr'));
        const macdv = f.map((v, i) => div(100 * (v - s[i]), atr[i]));
        const signal = ema(macdv, int(p, 'signal'));
        return { macdv, signal, hist: macdv.map((v, i) => v - signal[i]) };
      },
    },
    guide: {
      what: 'The MACD divided by the stock’s typical daily range (ATR), so the same levels mean the same thing on any stock or time frame.',
      use: ['Between -50 and +50 = no real momentum (range).', 'Above +50 rising = strong uptrend; above +150 = stretched.', 'Below -50 falling = strong downtrend; below -150 = stretched.'],
      signals: ['Signal-line crosses outside the ±50 zone carry more weight.', 'Turning back from beyond ±150 warns of exhaustion.'],
    },
  },
  {
    def: {
      id: 'zlmacd',
      name: 'Zero-Lag MACD',
      shortName: 'ZL MACD',
      category: 'Momentum',
      description: 'MACD built from zero-lag EMAs (2 x EMA - EMA of EMA) for both lines, so crosses arrive earlier.',
      placement: 'separate',
      inputs: [n('fast', 'Fast length', 12), n('slow', 'Slow length', 26), n('signal', 'Signal length', 9), sourceInput()],
      plots: [hist('hist', 'Histogram'), line('macd', 'MACD', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const f = zlema(s, int(p, 'fast'));
        const sl = zlema(s, int(p, 'slow'));
        const macd = f.map((v, i) => v - sl[i]);
        const signal = zlema(macd, int(p, 'signal'));
        return { macd, signal, hist: macd.map((v, i) => v - signal[i]) };
      },
    },
    guide: {
      what: 'A faster MACD: the averages are corrected for their usual delay.',
      use: ['Read it exactly like MACD.'],
      signals: ['MACD crossing the signal line, usually a bar or two before the normal MACD.'],
      tip: 'Earlier signals come with more whipsaws in sideways markets.',
    },
  },
  {
    def: {
      id: 'kst',
      name: 'Know Sure Thing',
      shortName: 'KST',
      category: 'Momentum',
      description: 'Martin Pring’s KST: weighted sum (1-4) of four smoothed ROCs (10/15/20/30 smoothed 10/10/10/15) with a 9-bar SMA signal (StockCharts daily settings).',
      placement: 'separate',
      inputs: [
        n('r1', 'ROC 1', 10), n('r2', 'ROC 2', 15), n('r3', 'ROC 3', 20), n('r4', 'ROC 4', 30),
        n('s1', 'SMA 1', 10), n('s2', 'SMA 2', 10), n('s3', 'SMA 3', 10), n('s4', 'SMA 4', 15), n('signal', 'Signal', 9),
      ],
      plots: [line('kst', 'KST', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const parts = [1, 2, 3, 4].map((k) => sma(roc(c, int(p, 'r' + k)), int(p, 's' + k)));
        const kst = c.map((_, i) => parts[0][i] + 2 * parts[1][i] + 3 * parts[2][i] + 4 * parts[3][i]);
        return { kst, signal: sma(kst, int(p, 'signal')) };
      },
    },
    guide: {
      what: 'Combines four rates of change, from short to long, into one smooth momentum line, with the longer ones weighted more.',
      use: ['Above zero = momentum is positive on balance.', 'Works well for the medium-term trend (weeks to months).'],
      signals: ['KST crossing its signal line.', 'Crossing zero.', 'Divergences with price.'],
    },
  },
  {
    def: {
      id: 'ac',
      name: 'Accelerator Oscillator',
      shortName: 'AC',
      category: 'Momentum',
      description: 'Bill Williams’ AC: Awesome Oscillator minus its 5-bar SMA. Shows whether momentum is speeding up or slowing down.',
      placement: 'separate',
      inputs: [n('fast', 'Fast length', 5), n('slow', 'Slow length', 34), n('smooth', 'Smoothing', 5)],
      plots: [hist('ac', 'AC', 'change')],
      levels: [0],
      compute: (bars, p) => {
        const m = hl2(bars);
        const f = sma(m, int(p, 'fast'));
        const s = sma(m, int(p, 'slow'));
        const ao = f.map((v, i) => v - s[i]);
        const avg = sma(ao, int(p, 'smooth'));
        return { ac: ao.map((v, i) => v - avg[i]) };
      },
    },
    guide: {
      what: 'The change in the Awesome Oscillator: it shows momentum’s acceleration, which tends to turn before momentum itself.',
      use: ['Green bars = momentum accelerating up; red = accelerating down.'],
      signals: ['Two green bars in a row above zero (or three below zero) = buy signal in Williams’ method; the reverse for sells.'],
    },
  },
  {
    def: {
      id: 'cmo',
      name: 'Chande Momentum Oscillator',
      shortName: 'CMO',
      category: 'Momentum',
      description: 'Tushar Chande’s CMO: (sum of gains - sum of losses) / (sum of gains + sum of losses) x 100 over N bars (original simple sums).',
      placement: 'separate',
      inputs: [len(14), sourceInput()],
      plots: [line('cmo', 'CMO', C.purple)],
      levels: [50, -50],
      compute: (bars, p) => {
        const s = src(bars, p);
        const l = int(p, 'length');
        const up = sum(gains(s), l);
        const dn = sum(losses(s), l);
        return { cmo: up.map((u, i) => div(100 * (u - dn[i]), u + dn[i])) };
      },
    },
    guide: {
      what: 'Momentum from -100 to +100: how much of the recent movement was up versus down.',
      use: ['Above +50 = overbought, below -50 = oversold.', 'The further from zero, the stronger the trend.'],
      signals: ['Turns back from ±50.', 'Zero-line crosses.'],
    },
  },
  {
    def: {
      id: 'coppock',
      name: 'Coppock Curve',
      shortName: 'Coppock',
      category: 'Momentum',
      description: '10-bar WMA of the sum of the 14-bar and 11-bar ROC (Edwin Coppock; designed for monthly index charts).',
      placement: 'separate',
      inputs: [n('roc1', 'Long ROC', 14), n('roc2', 'Short ROC', 11), n('wma', 'WMA length', 10)],
      plots: [hist('coppock', 'Coppock', 'change')],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const a = roc(c, int(p, 'roc1'));
        const b = roc(c, int(p, 'roc2'));
        return { coppock: wma(a.map((v, i) => v + b[i]), int(p, 'wma')) };
      },
    },
    guide: {
      what: 'A slow momentum line made for spotting major bottoms in stock indexes on monthly charts.',
      use: ['Use on monthly (or weekly) charts of broad indexes.'],
      signals: ['The classic buy: the curve turns up from below zero.', 'It was not designed to give sell signals.'],
    },
  },
  {
    def: {
      id: 'tsi',
      name: 'True Strength Index',
      shortName: 'TSI',
      category: 'Momentum',
      description: 'William Blau’s TSI: double-smoothed (EMA 25 then 13) price change over double-smoothed absolute change, x 100, with a 7-bar EMA signal.',
      placement: 'separate',
      inputs: [n('long', 'Long length', 25), n('short', 'Short length', 13), n('signal', 'Signal length', 7), sourceInput()],
      plots: [line('tsi', 'TSI', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [25, -25],
      compute: (bars, p) => {
        const tsi = tsiRatio(change(src(bars, p)), int(p, 'long'), int(p, 'short'));
        return { tsi, signal: ema(tsi, int(p, 'signal')) };
      },
    },
    guide: {
      what: 'A smooth momentum gauge from -100 to +100 based on doubly smoothed price changes.',
      use: ['Above zero = bullish momentum, below = bearish.', 'Beyond ±25 is stretched for most stocks.'],
      signals: ['TSI crossing its signal line.', 'Zero-line crosses.', 'Divergences.'],
    },
  },
  {
    def: {
      id: 'ergodic',
      name: 'SMI Ergodic Indicator',
      shortName: 'SMIIO',
      category: 'Momentum',
      description: 'Blau’s Ergodic oscillator as on TradingView: TSI ratio (long 20, short 5, as a -1..1 fraction), its 5-bar EMA signal and the difference as a histogram.',
      placement: 'separate',
      inputs: [n('long', 'Long length', 20), n('short', 'Short length', 5), n('signal', 'Signal length', 5)],
      plots: [hist('osc', 'Oscillator'), line('erg', 'Ergodic', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const erg = tsiRatio(change(closes(bars)), int(p, 'long'), int(p, 'short'), 1);
        const signal = ema(erg, int(p, 'signal'));
        return { erg, signal, osc: erg.map((v, i) => v - signal[i]) };
      },
    },
    guide: {
      what: 'A faster version of the True Strength Index with a signal line and a histogram of the gap between them.',
      use: ['Histogram above zero = momentum improving; below = weakening.'],
      signals: ['Ergodic line crossing its signal (histogram crossing zero).'],
    },
  },
  {
    def: {
      id: 'elderray',
      name: 'Elder-Ray Bull/Bear Power',
      shortName: 'Elder-Ray',
      category: 'Momentum',
      description: 'Alexander Elder’s Bull Power (high - EMA13) and Bear Power (low - EMA13).',
      placement: 'separate',
      inputs: [len(13, 'EMA length')],
      plots: [line('bull', 'Bull power', C.up), line('bear', 'Bear power', C.down)],
      levels: [0],
      compute: (bars, p) => {
        const e = ema(closes(bars), int(p, 'length'));
        return { bull: bars.map((b, i) => b.high - e[i]), bear: bars.map((b, i) => b.low - e[i]) };
      },
    },
    guide: {
      what: 'Two lines: how far buyers pushed the high above the average price (bull power) and how far sellers pushed the low below it (bear power).',
      use: ['Use with the 13-bar EMA’s direction: trade with the trend.'],
      signals: ['Uptrend + bear power negative but rising = buy.', 'Downtrend + bull power positive but falling = sell.', 'Divergences between the power lines and price.'],
    },
  },
  {
    def: {
      id: 'bop',
      name: 'Balance of Power',
      shortName: 'BOP',
      category: 'Momentum',
      description: '(close - open) / (high - low) per bar (TA-Lib BOP), smoothed with an SMA (set 1 for the raw value).',
      placement: 'separate',
      inputs: [n('smooth', 'Smoothing', 14)],
      plots: [line('bop', 'BOP', C.blue)],
      levels: [0],
      compute: (bars, p) => ({ bop: sma(bars.map((b) => div(b.close - b.open, b.high - b.low)), int(p, 'smooth')) }),
    },
    guide: {
      what: 'Who won each bar: +1 means it opened at the low and closed at the high (buyers), -1 the opposite.',
      use: ['Above zero = buyers in control on average; below = sellers.'],
      signals: ['Zero-line crosses.', 'Divergences with price.'],
    },
  },
  {
    def: {
      id: 'squeeze',
      name: 'Squeeze Momentum',
      shortName: 'Squeeze',
      category: 'Momentum',
      description: 'LazyBear’s TTM-style squeeze: red dots under the candles show Bollinger Bands (20, 2) inside Keltner Channels (20, 1.5 x SMA of true range); histogram = linear regression of close minus the mid of the range and SMA.',
      placement: 'separate',
      inputs: [len(20, 'BB length'), n('mult', 'BB mult', 2, 0.1, 10, 0.1), n('kc', 'KC length', 20), n('kcMult', 'KC mult', 1.5, 0.1, 10, 0.1)],
      plots: [hist('mom', 'Momentum'), { key: 'on', title: 'Squeeze on', type: 'marker', marker: { shape: 'circle', position: 'belowBar' }, color: C.down }],
      compute: (bars, p) => {
        const c = closes(bars);
        const l = int(p, 'length');
        const kc = int(p, 'kc');
        const basis = sma(c, l);
        const dev = stdev(c, l).map((v) => v * num0(p, 'mult'));
        const kma = sma(c, kc);
        const rangeMa = sma(trueRange(highs(bars), lows(bars), c), kc);
        const m = num0(p, 'kcMult');
        const on = c.map((_, i) => {
          if (Number.isNaN(basis[i]) || Number.isNaN(rangeMa[i])) return NaN;
          return basis[i] - dev[i] > kma[i] - rangeMa[i] * m && basis[i] + dev[i] < kma[i] + rangeMa[i] * m ? 1 : 0;
        });
        const hh = highest(highs(bars), kc);
        const ll = lowest(lows(bars), kc);
        const x = c.map((v, i) => v - ((hh[i] + ll[i]) / 2 + kma[i]) / 2);
        return { mom: linreg(x, kc), on };
      },
    },
    guide: {
      what: 'Shows when volatility is unusually low (a "squeeze", red dots) and which way momentum points when it is released.',
      use: ['Red dots under the candles = the market is coiling; a big move often follows.', 'The histogram shows the direction and strength of momentum.'],
      signals: ['The first bar after the dots stop: trade in the direction of the histogram.', 'Histogram bars shrinking = the move is fading.'],
    },
  },
  {
    def: {
      id: 'imi',
      name: 'Intraday Momentum Index',
      shortName: 'IMI',
      category: 'Momentum',
      description: 'Tushar Chande’s IMI: RSI built from open-to-close moves: 100 x sum(up candle bodies) / sum(all bodies) over N bars.',
      placement: 'separate',
      inputs: [len(14)],
      plots: [line('imi', 'IMI', C.purple)],
      levels: [70, 30],
      compute: (bars, p) => {
        const l = int(p, 'length');
        const up = sum(bars.map((b) => Math.max(b.close - b.open, 0)), l);
        const dn = sum(bars.map((b) => Math.max(b.open - b.close, 0)), l);
        return { imi: up.map((u, i) => div(100 * u, u + dn[i], 50)) };
      },
    },
    guide: {
      what: 'An RSI that only looks at each bar’s body (open to close), ignoring overnight gaps.',
      use: ['Above 70 overbought, below 30 oversold.', 'Good for stocks that gap a lot.'],
      signals: ['Turns back from the 70/30 zones.'],
    },
  },
  {
    def: {
      id: 'cfo',
      name: 'Chande Forecast Oscillator',
      shortName: 'CFO',
      category: 'Momentum',
      description: 'Percent distance of the close from its N-bar linear-regression value: 100 x (close - forecast) / close.',
      placement: 'separate',
      inputs: [len(14), sourceInput()],
      plots: [hist('cfo', 'CFO')],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const f = linreg(s, int(p, 'length'));
        return { cfo: s.map((v, i) => div(100 * (v - f[i]), v)) };
      },
    },
    guide: {
      what: 'How far price is above or below the straight-line trend of the last N bars, in percent.',
      use: ['Positive = price is ahead of its trend line; negative = behind.'],
      signals: ['Long stretches above zero = a steady uptrend.', 'Extreme readings tend to snap back towards zero.'],
    },
  },
  {
    def: {
      id: 'velacc',
      name: 'Velocity & Acceleration',
      shortName: 'Vel/Acc',
      category: 'Momentum',
      description: 'Velocity = (close - close N bars ago) / N, the average change per bar; acceleration = (velocity - velocity N bars ago) / N.',
      placement: 'separate',
      inputs: [len(10), sourceInput()],
      plots: [hist('acc', 'Acceleration'), line('vel', 'Velocity', C.blue)],
      levels: [0],
      compute: (bars, p) => {
        const l = int(p, 'length');
        const vel = change(src(bars, p), l).map((v) => v / l);
        return { vel, acc: change(vel, l).map((v) => v / l) };
      },
    },
    guide: {
      what: 'Velocity is how fast price is moving per bar; acceleration is whether that speed is increasing or decreasing.',
      use: ['Velocity above zero = rising; acceleration above zero = rising faster.'],
      signals: ['Acceleration turning negative while velocity is still positive = the rise is slowing, an early warning.'],
    },
  },
  {
    def: {
      id: 'qstick',
      name: 'Qstick',
      shortName: 'Qstick',
      category: 'Momentum',
      description: 'Tushar Chande’s Qstick: SMA of (close - open), the average candle body.',
      placement: 'separate',
      inputs: [len(8)],
      plots: [hist('qstick', 'Qstick')],
      levels: [0],
      compute: (bars, p) => ({ qstick: sma(bars.map((b) => b.close - b.open), int(p, 'length')) }),
    },
    guide: {
      what: 'The average size of recent candle bodies: positive when green candles dominate, negative when red ones do.',
      use: ['Above zero = buying pressure inside the bars.'],
      signals: ['Zero-line crosses.'],
    },
  },
  {
    def: {
      id: 'ttf',
      name: 'Trend Trigger Factor',
      shortName: 'TTF',
      category: 'Momentum',
      description: 'M.H. Pee’s TTF: buy power (N-bar high - previous N-bar low) vs sell power (previous N-bar high - N-bar low): 100 x (BP - SP) / ((BP + SP) / 2).',
      placement: 'separate',
      inputs: [len(15)],
      plots: [line('ttf', 'TTF', C.blue)],
      levels: [100, -100],
      compute: (bars, p) => {
        const l = int(p, 'length');
        const hh = highest(highs(bars), l);
        const ll = lowest(lows(bars), l);
        const hhPrev = lag(hh, l);
        const llPrev = lag(ll, l);
        return {
          ttf: hh.map((h, i) => {
            const bp = h - llPrev[i];
            const sp = hhPrev[i] - ll[i];
            return div(100 * (bp - sp), 0.5 * (bp + sp));
          }),
        };
      },
    },
    guide: {
      what: 'Compares the latest N-bar range with the one before it to show whether buyers or sellers are gaining ground.',
      use: ['Above +100 = strong buying; below -100 = strong selling.'],
      signals: ['Crossing above +100 = buy; crossing below -100 = sell (Pee’s rules).'],
    },
  },
  {
    def: {
      id: 'tcf',
      name: 'Trend Continuation Factor',
      shortName: 'TCF',
      category: 'Momentum',
      description: 'M.H. Pee’s TCF: N-bar sums of (up change - running down streak) and (down change - running up streak). The positive line shows the trend.',
      placement: 'separate',
      inputs: [len(35)],
      plots: [line('plus', '+TCF', C.up), line('minus', '-TCF', C.down)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const l = int(p, 'length');
        const pc = NaNs(c.length);
        const mc = NaNs(c.length);
        const pcf = NaNs(c.length);
        const mcf = NaNs(c.length);
        for (let i = 1; i < c.length; i++) {
          const d = c[i] - c[i - 1];
          pc[i] = Math.max(d, 0);
          mc[i] = Math.max(-d, 0);
          pcf[i] = d > 0 ? (i > 1 ? pcf[i - 1] : 0) + d : 0;
          mcf[i] = d < 0 ? (i > 1 ? mcf[i - 1] : 0) - d : 0;
        }
        return { plus: sum(pc.map((v, i) => v - mcf[i]), l), minus: sum(mc.map((v, i) => v - pcf[i]), l) };
      },
    },
    guide: {
      what: 'Two lines that measure how persistent up moves and down moves are. Whichever line is positive shows the trend.',
      use: ['+TCF above zero = uptrend; -TCF above zero = downtrend; both negative = no trend.'],
      signals: ['A line crossing above zero starts a trend in that direction.'],
    },
  },
  {
    def: {
      id: 'macdleader',
      name: 'MACD Leader',
      shortName: 'MACD Ldr',
      category: 'Momentum',
      description: 'Giorgos Siligardos’ MACD Leader: each EMA is corrected by an EMA of the price’s distance from it, so the line leads the MACD. Shown with the plain MACD.',
      placement: 'separate',
      inputs: [n('fast', 'Fast length', 12), n('slow', 'Slow length', 26)],
      plots: [line('leader', 'Leader', C.pink), line('macd', 'MACD', C.blue, 1)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const fl = int(p, 'fast');
        const sl = int(p, 'slow');
        const f = ema(c, fl);
        const s = ema(c, sl);
        const i1 = ema(c.map((v, i) => v - f[i]), fl);
        const i2 = ema(c.map((v, i) => v - s[i]), sl);
        return { leader: f.map((v, i) => v + i1[i] - (s[i] + i2[i])), macd: f.map((v, i) => v - s[i]) };
      },
    },
    guide: {
      what: 'A version of the MACD line that turns a little earlier, drawn next to the normal MACD.',
      use: ['Watch the leader turn before the MACD does.'],
      signals: ['Leader crossing the MACD line or zero ahead of a MACD crossover.'],
    },
  },
  {
    def: {
      id: 'pzo',
      name: 'Price Zone Oscillator',
      shortName: 'PZO',
      category: 'Momentum',
      description: 'Walid Khalil & David Steckler’s PZO: 100 x EMA(sign of change x close) / EMA(close).',
      placement: 'separate',
      inputs: [len(14)],
      plots: [line('pzo', 'PZO', C.blue)],
      levels: [60, 40, 0, -40, -60],
      compute: (bars, p) => {
        const c = closes(bars);
        const l = int(p, 'length');
        const signed = c.map((v, i) => (i === 0 ? NaN : Math.sign(v - c[i - 1]) * v));
        const vp = ema(signed, l);
        const tv = ema(c, l);
        return { pzo: vp.map((v, i) => div(100 * v, tv[i])) };
      },
    },
    guide: {
      what: 'The share of recent price action that happened on up bars versus down bars, from -100 to +100.',
      use: ['Above +40 in an uptrend = overbought zone; below -40 = oversold zone.'],
      signals: ['In an uptrend, a dip to -40 and turn up = buy area.', 'Crossing zero.'],
    },
  },
  {
    def: {
      id: 'rex',
      name: 'Rex Oscillator',
      shortName: 'Rex',
      category: 'Momentum',
      description: 'SMA of the "true value of a bar" 3 x close - (low + open + high), with an SMA signal line.',
      placement: 'separate',
      inputs: [len(14), n('signal', 'Signal length', 14)],
      plots: [line('rex', 'Rex', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const rex = sma(bars.map((b) => 3 * b.close - (b.low + b.open + b.high)), int(p, 'length'));
        return { rex, signal: sma(rex, int(p, 'signal')) };
      },
    },
    guide: {
      what: 'Measures where each bar closes compared with its open, high and low, then averages it.',
      use: ['Above zero = closes are strong on balance.'],
      signals: ['Rex crossing its signal line.', 'Zero-line crosses.'],
    },
  },
  {
    def: {
      id: 'ewo',
      name: 'Elliott Wave Oscillator',
      shortName: 'EWO',
      category: 'Momentum',
      description: '5-bar SMA minus 35-bar SMA of the bar midpoint; used to count Elliott waves (wave 3 usually has the biggest reading).',
      placement: 'separate',
      inputs: [n('fast', 'Fast length', 5), n('slow', 'Slow length', 35), sourceInput('hl2')],
      plots: [hist('ewo', 'EWO')],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const f = sma(s, int(p, 'fast'));
        const sl = sma(s, int(p, 'slow'));
        return { ewo: f.map((v, i) => v - sl[i]) };
      },
    },
    guide: {
      what: 'The gap between a 5-bar and a 35-bar average, used by Elliott wave traders to spot the strongest wave.',
      use: ['The highest peak usually marks wave 3; a lower peak on a new price high suggests wave 5.'],
      signals: ['Zero-line crosses = trend change.', 'Divergence at a new price high = the move may be ending.'],
    },
  },
  {
    def: {
      id: 'pinball',
      name: 'Momentum Pinball',
      shortName: 'Pinball',
      category: 'Momentum',
      description: 'Linda Bradford Raschke’s Momentum Pinball: a 3-bar RSI of the 1-bar change.',
      placement: 'separate',
      inputs: [len(3, 'RSI length'), n('change', 'Change bars', 1)],
      plots: [line('pinball', 'Pinball', C.purple)],
      levels: [70, 30],
      compute: (bars, p) => ({ pinball: rsi(change(closes(bars), int(p, 'change')), int(p, 'length')) }),
    },
    guide: {
      what: 'A very fast overbought/oversold reading built from day-to-day changes, made for short swing trades.',
      use: ['Raschke’s rule: a reading under 30 on day 1 sets up a buy on day 2; over 70 sets up a sell.'],
      signals: ['Readings below 30 or above 70.'],
    },
  },
  {
    def: {
      id: 'osc310',
      name: '3/10 Oscillator',
      shortName: '3/10',
      category: 'Momentum',
      description: 'Raschke’s 3/10 oscillator: 3-bar SMA minus 10-bar SMA, with a 16-bar SMA of it as the slow line.',
      placement: 'separate',
      inputs: [n('fast', 'Fast length', 3), n('slow', 'Slow length', 10), n('signal', 'Slow line length', 16), sourceInput()],
      plots: [line('fast', 'Fast line', C.blue), line('slow', 'Slow line', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const f = sma(s, int(p, 'fast'));
        const sl = sma(s, int(p, 'slow'));
        const fast = f.map((v, i) => v - sl[i]);
        return { fast, slow: sma(fast, int(p, 'signal')) };
      },
    },
    guide: {
      what: 'A fast MACD-like line made with simple averages, plus a slow line that shows the trend.',
      use: ['Slow line rising = trade pullbacks in the fast line from the long side.'],
      signals: ['Fast line crossing the slow line.', 'Divergences in the fast line.'],
    },
  },
  {
    def: {
      id: 'cmiblau',
      name: 'Candlestick Momentum Index',
      shortName: 'CMI',
      category: 'Momentum',
      description: 'William Blau’s candlestick momentum: TSI-style ratio of double-smoothed (close - open) to double-smoothed |close - open|, x 100.',
      placement: 'separate',
      inputs: [n('long', 'Long length', 20), n('short', 'Short length', 5), n('signal', 'Signal length', 5)],
      plots: [line('cmi', 'CMI', C.blue), line('signal', 'Signal', C.orange, 1)],
      levels: [25, 0, -25],
      compute: (bars, p) => {
        const cmi = tsiRatio(bars.map((b) => b.close - b.open), int(p, 'long'), int(p, 'short'));
        return { cmi, signal: ema(cmi, int(p, 'signal')) };
      },
    },
    guide: {
      what: 'A smooth score of whether candles have been closing above their opens (positive) or below (negative).',
      use: ['Above zero = buyers win the bars; below = sellers.'],
      signals: ['Signal-line and zero-line crosses.'],
    },
  },
  {
    def: {
      id: 'disparity',
      name: 'Disparity Index',
      shortName: 'Disparity',
      category: 'Momentum',
      description: 'Steve Nison’s disparity index: percent distance of the close from its N-bar moving average (EMA by default, or SMA, which makes it the Kairi relative index), 100 x (close - MA) / MA.',
      placement: 'separate',
      inputs: [len(14), n('ema', 'Average type (0 = SMA, 1 = EMA)', 1, 0, 1, 1), sourceInput()],
      plots: [hist('disparity', 'Disparity')],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const e = Number(p.ema) === 0 ? sma(s, int(p, 'length')) : ema(s, int(p, 'length'));
        return { disparity: s.map((v, i) => div(100 * (v - e[i]), e[i])) };
      },
    },
    guide: {
      what: 'How far price is above or below its exponential moving average, in percent.',
      use: ['Big positive readings = stretched above the average; big negative = stretched below.'],
      signals: ['Crossing zero = price crossing the EMA.', 'Extremes compared with the stock’s own history often snap back.'],
    },
  },
];

function num0(p: Record<string, number | string>, key: string): number {
  const v = Number(p[key]);
  return Number.isFinite(v) ? v : 0;
}

export { num0, rsiFrom };
