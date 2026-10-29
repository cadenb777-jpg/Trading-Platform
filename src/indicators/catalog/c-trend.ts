/** Trend family: direction and strength of trends (Wilder's DMI family, Aroon, Vortex, regression, efficiency...). */
import type { Bar } from '../../types';
import { ema, highest, lowest, rma, sma, stdev, trueRange } from '../math';
import { C, NaNs, change, closes, fin, highs, input, length, lineFit, lows, num, rolling, rollingSum, sourceInput, src, type Entry } from './c-math';

/** Wilder's directional movement, smoothed with Wilder's average (TradingView's ta.dmi; seeded with an SMA). */
export function dmi(bars: Bar[], n: number) {
  const plusDm = bars.map((b, i) => {
    if (!i) return NaN;
    const up = b.high - bars[i - 1].high;
    const down = bars[i - 1].low - b.low;
    return up > down && up > 0 ? up : 0;
  });
  const minusDm = bars.map((b, i) => {
    if (!i) return NaN;
    const up = b.high - bars[i - 1].high;
    const down = bars[i - 1].low - b.low;
    return down > up && down > 0 ? down : 0;
  });
  const tr = rma(trueRange(highs(bars), lows(bars), closes(bars)).map((v, i) => (i ? v : NaN)), n);
  const plusS = rma(plusDm, n);
  const minusS = rma(minusDm, n);
  const plus = plusS.map((v, i) => fin((100 * v) / tr[i]));
  const minus = minusS.map((v, i) => fin((100 * v) / tr[i]));
  const dx = plus.map((v, i) => {
    const total = v + minus[i];
    if (Number.isNaN(total)) return NaN;
    return total ? (100 * Math.abs(v - minus[i])) / total : 0;
  });
  return { plus, minus, dx, plusS, minusS };
}

export const atrOf = (bars: Bar[], n: number) => rma(trueRange(highs(bars), lows(bars), closes(bars)), n);

/** Aroon up / down (same formula as the library's Aroon). */
function aroon(bars: Bar[], n: number) {
  const up = NaNs(bars.length);
  const down = NaNs(bars.length);
  for (let i = n; i < bars.length; i++) {
    let hi = i;
    let lo = i;
    for (let j = i - n; j <= i; j++) {
      if (bars[j].high >= bars[hi].high) hi = j;
      if (bars[j].low <= bars[lo].low) lo = j;
    }
    up[i] = (100 * (n - (i - hi))) / n;
    down[i] = (100 * (n - (i - lo))) / n;
  }
  return { up, down };
}

/** Random walk index high/low: the largest (H - L[k]) / (ATR(k) * sqrt(k)) over k = from..n (ATR = simple average of true range). */
function rwi(bars: Bar[], from: number, n: number, logPrices = false) {
  const h = highs(bars).map((v) => (logPrices ? Math.log(v) : v));
  const l = lows(bars).map((v) => (logPrices ? Math.log(v) : v));
  // true range (on log prices: max(ln H, ln C[1]) - min(ln L, ln C[1]))
  const c = closes(bars).map((v) => (logPrices ? Math.log(v) : v));
  const tr = h.map((v, i) => (i ? Math.max(v, c[i - 1]) - Math.min(l[i], c[i - 1]) : v - l[i]));
  const prefix = [0];
  for (let i = 0; i < tr.length; i++) prefix.push(prefix[i] + (i ? tr[i] : 0));
  const up = NaNs(bars.length);
  const down = NaNs(bars.length);
  for (let i = n; i < bars.length; i++) {
    let bu = -Infinity;
    let bd = -Infinity;
    for (let k = from; k <= n; k++) {
      const atr = (prefix[i + 1] - prefix[i + 1 - k]) / k;
      const scale = atr * Math.sqrt(k);
      if (!scale) continue;
      bu = Math.max(bu, (h[i] - l[i - k]) / scale);
      bd = Math.max(bd, (h[i - k] - l[i]) / scale);
    }
    up[i] = fin(bu);
    down[i] = fin(bd);
  }
  return { up, down };
}

const histo = (key: string, title: string) => ({ key, title, type: 'histogram' as const, color: C.up, colorBy: 'sign' as const, negativeColor: C.down });

export const C_TREND: Entry[] = [
  {
    def: {
      id: 'adxr',
      name: 'Average Directional Movement Rating (ADXR)',
      shortName: 'ADXR',
      category: 'Trend',
      description: 'Wilder\'s ADXR: the average of today\'s ADX and the ADX from length−1 bars ago, a slower, steadier trend-strength reading.',
      placement: 'separate',
      inputs: [length(14, 2)],
      plots: [
        { key: 'adx', title: 'ADX', type: 'line', color: C.orange, lineWidth: 1 },
        { key: 'adxr', title: 'ADXR', type: 'line', color: C.blue, lineWidth: 2 },
      ],
      levels: [25, 20],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const adx = rma(dmi(bars, n).dx, n);
        return { adx, adxr: adx.map((v, i) => (i >= n - 1 ? (v + adx[i - n + 1]) / 2 : NaN)) };
      },
    },
    guide: {
      what: 'A smoothed version of ADX: today\'s trend strength averaged with the reading from about two weeks ago.',
      use: ['Use it to judge whether a trend is strong enough to trade with trend-following methods.', 'ADXR above 25 = trending; below 20 = choppy, range trading works better.'],
      signals: ['ADX crossing above ADXR = trend strength picking up.', 'Both falling = trend fading.'],
      tip: 'Like ADX, it measures strength only, not direction; pair it with +DI/−DI or price.',
    },
  },
  {
    def: {
      id: 'dx',
      name: 'Directional Movement Index (DX)',
      shortName: 'DX',
      category: 'Trend',
      description: 'Wilder\'s DX = 100 × |+DI − −DI| / (+DI + −DI): the raw, unsmoothed trend strength that ADX averages.',
      placement: 'separate',
      inputs: [length(14, 2)],
      plots: [{ key: 'dx', title: 'DX', type: 'line', color: C.orange, lineWidth: 2 }],
      levels: [25],
      compute: (bars, p) => ({ dx: dmi(bars, num(p, 'length')).dx }),
    },
    guide: {
      what: 'How one-sided recent price movement has been, from 0 (balanced) to 100 (all in one direction). ADX is its average.',
      use: ['Shows fast changes in trend strength that ADX smooths away.'],
      signals: ['Spikes above 40-50 = a strong burst in one direction.', 'Readings near 0 = buyers and sellers evenly matched.'],
      tip: 'It is jumpy; most traders watch ADX or ADXR instead and use DX for detail.',
    },
  },
  {
    def: {
      id: 'dmiosc',
      name: 'DMI Oscillator (+DI − −DI)',
      shortName: 'DMI Osc',
      category: 'Trend',
      description: 'The gap between Wilder\'s +DI and −DI. Above zero = upward movement dominates; below = downward.',
      placement: 'separate',
      inputs: [length(14, 2)],
      plots: [histo('osc', 'DMI Osc')],
      levels: [0],
      compute: (bars, p) => {
        const d = dmi(bars, num(p, 'length'));
        return { osc: d.plus.map((v, i) => v - d.minus[i]) };
      },
    },
    guide: {
      what: 'One line for trend direction: +DI minus −DI from the DMI system.',
      use: ['Green bars = buyers pushing highs up harder than sellers push lows down; red = the opposite.'],
      signals: ['Crossing above zero = +DI crossed above −DI (bullish).', 'Crossing below zero = bearish.'],
      tip: 'Signals are more reliable when ADX is above 20-25.',
    },
  },
  {
    def: {
      id: 'dm',
      name: 'Directional Movement (+DM / −DM)',
      shortName: '±DM',
      category: 'Trend',
      description: 'Wilder\'s smoothed directional movement (TA-Lib PLUS_DM / MINUS_DM): how far highs extend up and lows extend down, summed Wilder-style.',
      placement: 'separate',
      inputs: [length(14, 1)],
      plots: [
        { key: 'plus', title: '+DM', type: 'line', color: C.up, lineWidth: 2 },
        { key: 'minus', title: '−DM', type: 'line', color: C.down, lineWidth: 2 },
      ],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const d = dmi(bars, n);
        return { plus: d.plusS.map((v) => v * n), minus: d.minusS.map((v) => v * n) };
      },
    },
    guide: {
      what: 'The building blocks of the DMI: +DM measures upward reach (higher highs), −DM downward reach (lower lows), in price units.',
      use: ['Compare the two lines: the higher one shows which side is extending the range.'],
      signals: ['+DM crossing above −DM = upward pressure taking over.'],
      tip: 'Because they are in price units they rise with price; +DI/−DI divide by ATR to make them comparable.',
    },
  },
  {
    def: {
      id: 'aroonosc',
      name: 'Aroon Oscillator',
      shortName: 'AroonOsc',
      category: 'Trend',
      description: 'Aroon Up minus Aroon Down (−100 to +100): positive when recent highs are fresher than recent lows.',
      placement: 'separate',
      inputs: [length(25, 1)],
      plots: [histo('osc', 'Aroon Osc')],
      levels: [50, 0, -50],
      compute: (bars, p) => {
        const a = aroon(bars, num(p, 'length'));
        return { osc: a.up.map((v, i) => v - a.down[i]) };
      },
    },
    guide: {
      what: 'Shows whether the latest high or the latest low happened more recently, as one number from −100 to +100.',
      use: ['Above zero = uptrend bias; below zero = downtrend bias.'],
      signals: ['Above +50 = strong uptrend; below −50 = strong downtrend.', 'Crossing zero = possible trend change.'],
    },
  },
  {
    def: {
      id: 'vortex',
      name: 'Vortex Indicator',
      shortName: 'VI',
      category: 'Trend',
      description: 'Botes & Siepman: VI+ = Σ|H − L[1]| / ΣTR and VI− = Σ|L − H[1]| / ΣTR over N bars. VI+ above VI− = uptrend.',
      placement: 'separate',
      inputs: [length(14, 2)],
      plots: [
        { key: 'plus', title: 'VI+', type: 'line', color: C.up, lineWidth: 2 },
        { key: 'minus', title: 'VI−', type: 'line', color: C.down, lineWidth: 2 },
      ],
      levels: [1],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const vmp = bars.map((b, i) => (i ? Math.abs(b.high - bars[i - 1].low) : NaN));
        const vmm = bars.map((b, i) => (i ? Math.abs(b.low - bars[i - 1].high) : NaN));
        const tr = trueRange(highs(bars), lows(bars), closes(bars)).map((v, i) => (i ? v : NaN));
        const st = rollingSum(tr, n);
        const sp = rollingSum(vmp, n);
        const sm = rollingSum(vmm, n);
        return { plus: sp.map((v, i) => fin(v / st[i])), minus: sm.map((v, i) => fin(v / st[i])) };
      },
    },
    guide: {
      what: 'Two lines comparing upward movement (today\'s high vs yesterday\'s low) with downward movement (today\'s low vs yesterday\'s high).',
      use: ['VI+ above VI− = uptrend; VI− above VI+ = downtrend.'],
      signals: ['VI+ crossing above VI− = buy signal; the reverse = sell signal.', 'A wide gap between the lines = strong trend.'],
      tip: 'Crosses whip back and forth in sideways markets; confirm with a breakout or ADX.',
    },
  },
  {
    def: {
      id: 'chop',
      name: 'Choppiness Index',
      shortName: 'CHOP',
      category: 'Trend',
      description: 'Dreiss: 100 × log10(ΣTR / (highest high − lowest low)) / log10(N). High = choppy sideways market; low = trending.',
      placement: 'separate',
      inputs: [length(14, 2)],
      plots: [{ key: 'chop', title: 'CHOP', type: 'line', color: C.purple, lineWidth: 2 }],
      levels: [61.8, 38.2],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const st = rollingSum(trueRange(highs(bars), lows(bars), closes(bars)), n);
        const hh = highest(highs(bars), n);
        const ll = lowest(lows(bars), n);
        return { chop: st.map((v, i) => fin((100 * Math.log10(v / (hh[i] - ll[i]))) / Math.log10(n))) };
      },
    },
    guide: {
      what: 'A 0-100 gauge of whether the market is trending or chopping sideways. It says nothing about direction.',
      use: ['Above 61.8 = choppy: avoid trend trades or expect a breakout to come.', 'Below 38.2 = strong trend in place (often late in the move).'],
      signals: ['A drop from above 61.8 = a trend may be starting.', 'A rise from below 38.2 = the trend is tiring.'],
    },
  },
  {
    def: {
      id: 'vhf',
      name: 'Vertical Horizontal Filter',
      shortName: 'VHF',
      category: 'Trend',
      description: 'White: (highest close − lowest close) / Σ|close change| over N bars. High = trending; low = congestion.',
      placement: 'separate',
      inputs: [length(28, 2)],
      plots: [{ key: 'vhf', title: 'VHF', type: 'line', color: C.sky, lineWidth: 2 }],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const c = closes(bars);
        const hc = highest(c, n);
        const lc = lowest(c, n);
        const path = rollingSum(change(c).map(Math.abs), n);
        return { vhf: path.map((v, i) => fin((hc[i] - lc[i]) / v)) };
      },
    },
    guide: {
      what: 'Compares how far price travelled overall (top to bottom) with the total distance it wandered bar by bar.',
      use: ['Rising VHF = a trend is developing: favour trend-following tools.', 'Falling VHF = sideways: favour oscillators.'],
      signals: ['A turn up from a low reading often comes before a breakout.'],
      tip: 'Compare with its own history; there is no fixed threshold.',
    },
  },
  {
    def: {
      id: 'tii',
      name: 'Trend Intensity Index',
      shortName: 'TII',
      category: 'Trend',
      description: 'M.H. Pee: 100 × positive deviations / all deviations of close from its SMA over the last `period` bars.',
      placement: 'separate',
      inputs: [length(60, 2, 'SMA length'), input('period', 'Deviation bars', 30, 1, 1000)],
      plots: [{ key: 'tii', title: 'TII', type: 'line', color: C.orange, lineWidth: 2 }],
      levels: [80, 50, 20],
      compute: (bars, p) => {
        const c = closes(bars);
        const dev = sma(c, num(p, 'length')).map((m, i) => c[i] - m);
        const pos = rollingSum(dev.map((d) => Math.max(d, 0)), num(p, 'period'));
        const neg = rollingSum(dev.map((d) => Math.max(-d, 0)), num(p, 'period'));
        return { tii: pos.map((v, i) => fin((100 * v) / (v + neg[i]))) };
      },
    },
    guide: {
      what: 'What share of recent closes were above their 60-bar average, weighted by how far above. 0-100.',
      use: ['Above 80 = a strong uptrend; below 20 = a strong downtrend.'],
      signals: ['Crossing 50 = the balance shifting between up and down.'],
    },
  },
  {
    def: {
      id: 'ravi',
      name: 'Range Action Verification Index (RAVI)',
      shortName: 'RAVI',
      category: 'Trend',
      description: 'Chande: 100 × |SMA(fast) − SMA(slow)| / SMA(slow). Above 3% = trending; below = ranging.',
      placement: 'separate',
      inputs: [input('fast', 'Fast SMA', 7, 1, 500), input('slow', 'Slow SMA', 65, 2, 1000)],
      plots: [{ key: 'ravi', title: 'RAVI', type: 'line', color: C.aqua, lineWidth: 2 }],
      levels: [3],
      compute: (bars, p) => {
        const c = closes(bars);
        const f = sma(c, num(p, 'fast'));
        const s = sma(c, num(p, 'slow'));
        return { ravi: f.map((v, i) => fin((100 * Math.abs(v - s[i])) / s[i])) };
      },
    },
    guide: {
      what: 'How far a fast moving average is from a slow one, in percent. A wide gap means a trend; a narrow one means a range.',
      use: ['Above 3% = trending market; below 3% = range-bound.'],
      signals: ['A rise through 3% = a trend may be starting.'],
      tip: 'The 3% line suits stocks on daily bars; adjust it for very calm or very wild markets.',
    },
  },
  {
    def: {
      id: 'tdi',
      name: 'Trend Detection Index',
      shortName: 'TDI',
      category: 'Trend',
      description: 'M.H. Pee: TDI = |Σmom| − (Σ|mom| over 2N − Σ|mom| over N), mom = close − close N bars ago; Direction = Σmom.',
      placement: 'separate',
      inputs: [length(20, 1)],
      plots: [
        { key: 'tdi', title: 'TDI', type: 'line', color: C.orange, lineWidth: 2 },
        { key: 'dir', title: 'Direction', type: 'line', color: C.blue, lineWidth: 1 },
      ],
      levels: [0],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const mom = change(closes(bars), n);
        const dir = rollingSum(mom, n);
        const abs = mom.map(Math.abs);
        const a1 = rollingSum(abs, n);
        const a2 = rollingSum(abs, 2 * n);
        return { tdi: dir.map((v, i) => Math.abs(v) - (a2[i] - a1[i])), dir };
      },
    },
    guide: {
      what: 'Tells trending from non-trending periods: positive TDI = a trend; the Direction line says which way.',
      use: ['Trade with the trend only when TDI is above zero; Direction above zero = up, below = down.'],
      signals: ['TDI turning positive = a trend has started.'],
    },
  },
  {
    def: {
      id: 'lrslope',
      name: 'Linear Regression Slope',
      shortName: 'LR Slope',
      category: 'Trend',
      description: 'Slope of the best-fit straight line through the last N values (price units per bar, TA-Lib LINEARREG_SLOPE).',
      placement: 'separate',
      inputs: [length(14, 2), sourceInput],
      plots: [histo('slope', 'Slope')],
      levels: [0],
      compute: (bars, p) => ({ slope: rolling(src(bars, p), num(p, 'length'), (w) => lineFit(w).slope) }),
    },
    guide: {
      what: 'How steeply price has been rising or falling, measured by a best-fit line through recent bars.',
      use: ['Above zero = rising trend; below = falling.'],
      signals: ['Crossing zero = the trend line flipped direction.', 'Slope shrinking towards zero = trend losing steam.'],
      tip: 'It is in price units, so compare it only on the same stock; LR Slope % compares across stocks.',
    },
  },
  {
    def: {
      id: 'lrslopepct',
      name: 'Linear Regression Slope %',
      shortName: 'LR Slope %',
      category: 'Trend',
      description: 'Regression slope as a percent of the current value per bar (100 × slope / value), comparable across stocks.',
      placement: 'separate',
      inputs: [length(20, 2), sourceInput],
      plots: [histo('slope', 'Slope %')],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        return { slope: rolling(s, num(p, 'length'), (w) => (100 * lineFit(w).slope) / w[w.length - 1]) };
      },
    },
    guide: {
      what: 'The trend line\'s slope in percent per bar, so 0.2 means price has been climbing about 0.2% a bar.',
      use: ['Compare trend speed between different stocks or periods.'],
      signals: ['Crossing zero = trend turned.', 'Very high values = a steep run that often cools off.'],
    },
  },
  {
    def: {
      id: 'lrangle',
      name: 'Linear Regression Angle',
      shortName: 'LR Angle',
      category: 'Trend',
      description: 'atan(regression slope) in degrees (TA-Lib LINEARREG_ANGLE). Depends on price units, so compare only on one chart.',
      placement: 'separate',
      inputs: [length(14, 2), sourceInput],
      plots: [{ key: 'angle', title: 'Angle', type: 'line', color: C.purple, lineWidth: 2 }],
      levels: [0],
      compute: (bars, p) => ({ angle: rolling(src(bars, p), num(p, 'length'), (w) => (Math.atan(lineFit(w).slope) * 180) / Math.PI) }),
    },
    guide: {
      what: 'The regression slope turned into an angle in degrees.',
      use: ['Positive = rising; negative = falling. Larger angles = steeper trends.'],
      signals: ['The angle flattening towards 0 = trend slowing.'],
      tip: 'The angle depends on the price level (one point per bar), not on how the chart looks.',
    },
  },
  {
    def: {
      id: 'corrtime',
      name: 'Correlation Trend (price vs time)',
      shortName: 'CorrTrend',
      category: 'Trend',
      description: 'Pearson correlation of price with time over N bars (Ehlers\' Correlation Trend Indicator): +1 = a perfect straight rise.',
      placement: 'separate',
      inputs: [length(20, 2), sourceInput],
      plots: [{ key: 'r', title: 'r', type: 'line', color: C.aqua, lineWidth: 2 }],
      levels: [0.5, 0, -0.5],
      compute: (bars, p) => ({ r: rolling(src(bars, p), num(p, 'length'), (w) => lineFit(w).r) }),
    },
    guide: {
      what: 'How closely recent prices follow a straight line up (+1) or down (−1). Near 0 = no trend.',
      use: ['Above +0.5 = clean uptrend; below −0.5 = clean downtrend.'],
      signals: ['Crossing zero = trend change.', 'Falling from near +1 = the uptrend is getting ragged.'],
    },
  },
  {
    def: {
      id: 'er',
      name: 'Efficiency Ratio (Kaufman)',
      shortName: 'ER',
      category: 'Trend',
      description: 'Kaufman: |close − close N bars ago| / Σ|close change| over N bars. 1 = straight-line move; 0 = pure noise.',
      placement: 'separate',
      inputs: [length(10, 1), sourceInput],
      plots: [{ key: 'er', title: 'ER', type: 'line', color: C.amber, lineWidth: 2 }],
      levels: [0.3],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const s = src(bars, p);
        const net = change(s, n).map(Math.abs);
        const path = rollingSum(change(s).map(Math.abs), n);
        return { er: net.map((v, i) => fin(v / path[i])) };
      },
    },
    guide: {
      what: 'How efficiently price moved: the net distance divided by the total distance travelled. It powers Kaufman\'s adaptive average (KAMA).',
      use: ['High (above ~0.3-0.5) = clean trend; low = noisy, back-and-forth market.'],
      signals: ['A rise in ER as price breaks out = a real move rather than noise.'],
    },
  },
  {
    def: {
      id: 'pfe',
      name: 'Polarized Fractal Efficiency',
      shortName: 'PFE',
      category: 'Trend',
      description: 'Hannula: ±100 × straight-line distance / bar-by-bar path length over N bars (one unit of time per bar), EMA-smoothed. Original unscaled formula.',
      placement: 'separate',
      inputs: [length(10, 1), input('smooth', 'Smoothing', 5, 1, 100)],
      plots: [{ key: 'pfe', title: 'PFE', type: 'line', color: C.pink, lineWidth: 2 }],
      levels: [50, 0, -50],
      compute: (bars, p) => {
        const n = num(p, 'length');
        const c = closes(bars);
        const step = c.map((v, i) => (i ? Math.sqrt((v - c[i - 1]) ** 2 + 1) : NaN));
        const path = rollingSum(step, n);
        const raw = c.map((v, i) => {
          if (i < n || Number.isNaN(path[i])) return NaN;
          const d = v - c[i - n];
          return fin(((d > 0 ? 1 : d < 0 ? -1 : 0) * 100 * Math.sqrt(d * d + n * n)) / path[i]);
        });
        return { pfe: ema(raw, num(p, 'smooth')) };
      },
    },
    guide: {
      what: 'How straight (efficient) the recent path of price was, with a sign for direction: +100 = a straight rise, −100 = a straight fall.',
      use: ['Above zero = efficient up-move; below zero = efficient down-move; near zero = choppy.'],
      signals: ['Turning back from beyond ±50 = the move is losing efficiency.'],
      tip: 'The formula counts one time unit per bar next to raw price differences, so low-priced stocks read closer to ±100 and high-priced ones nearer the plain efficiency ratio.',
    },
  },
  {
    def: {
      id: 'trendscore',
      name: 'Trend Score (Chande)',
      shortName: 'TScore',
      category: 'Trend',
      description: 'Chande: sum of +1/−1 for whether close is above or below the close k bars ago, for each k from `from` to `to` (default 11-20 → −10..+10).',
      placement: 'separate',
      inputs: [input('from', 'From bars ago', 11, 1, 500), input('to', 'To bars ago', 20, 1, 500)],
      plots: [histo('score', 'Score')],
      levels: [0],
      compute: (bars, p) => {
        const a = Math.min(num(p, 'from'), num(p, 'to'));
        const b = Math.max(num(p, 'from'), num(p, 'to'));
        const c = closes(bars);
        return {
          score: c.map((v, i) => {
            if (i < b) return NaN;
            let s = 0;
            for (let k = a; k <= b; k++) s += v > c[i - k] ? 1 : v < c[i - k] ? -1 : 0;
            return s;
          }),
        };
      },
    },
    guide: {
      what: 'Counts how many of the closes from 11 to 20 bars ago today\'s close beats (+1) or trails (−1).',
      use: ['+10 = above all of them (strong uptrend); −10 = below all (strong downtrend).'],
      signals: ['Crossing zero = trend flip.', 'Readings stuck near ±10 = persistent trend.'],
    },
  },
  {
    def: {
      id: 'impulse',
      name: 'Elder Impulse System',
      shortName: 'Impulse',
      category: 'Trend',
      description: 'Elder: +1 (green) when the 13-EMA and the MACD(12,26,9) histogram both rise, −1 (red) when both fall, 0 (blue / no bar) otherwise.',
      placement: 'separate',
      inputs: [input('ema', 'EMA length', 13, 1, 500), input('fast', 'MACD fast', 12, 1, 500), input('slow', 'MACD slow', 26, 1, 500), input('signal', 'MACD signal', 9, 1, 500)],
      plots: [histo('impulse', 'Impulse')],
      compute: (bars, p) => {
        const c = closes(bars);
        const e = ema(c, num(p, 'ema'));
        const fast = ema(c, num(p, 'fast'));
        const macd = ema(c, num(p, 'slow')).map((v, i) => fast[i] - v);
        const sig = ema(macd, num(p, 'signal'));
        const hist = macd.map((v, i) => v - sig[i]);
        return {
          impulse: c.map((_, i) => {
            if (!i || [e[i], e[i - 1], hist[i], hist[i - 1]].some(Number.isNaN)) return NaN;
            if (e[i] > e[i - 1] && hist[i] > hist[i - 1]) return 1;
            if (e[i] < e[i - 1] && hist[i] < hist[i - 1]) return -1;
            return 0;
          }),
        };
      },
    },
    guide: {
      what: 'Elder\'s traffic light: green when both trend (13-EMA) and momentum (MACD histogram) are rising, red when both are falling.',
      use: ['Green = buying allowed, don\'t short; red = shorting allowed, don\'t buy; no bar (blue) = either.'],
      signals: ['The first green bar after a red run = momentum turning up.', 'Loss of green in an uptrend = time to tighten stops.'],
      tip: 'Elder uses it as a filter ("what not to do") on a higher timeframe more than as an entry signal.',
    },
  },
  {
    def: {
      id: 'dti',
      name: 'Directional Trend Index (Blau)',
      shortName: 'DTI',
      category: 'Trend',
      description: 'Blau: 100 × EMA³(HMU − LMD) / EMA³(|HMU − LMD|), HMU = rise in the high, LMD = fall in the low, triple-smoothed with lengths r, s, u.',
      placement: 'separate',
      inputs: [input('r', 'First smoothing', 14, 1, 500), input('s', 'Second smoothing', 10, 1, 500), input('u', 'Third smoothing', 5, 1, 500)],
      plots: [{ key: 'dti', title: 'DTI', type: 'line', color: C.blue, lineWidth: 2 }],
      levels: [25, 0, -25],
      compute: (bars, p) => {
        const diff = bars.map((b, i) => (i ? Math.max(b.high - bars[i - 1].high, 0) - Math.max(bars[i - 1].low - b.low, 0) : NaN));
        const tri = (v: number[]) => ema(ema(ema(v, num(p, 'r')), num(p, 's')), num(p, 'u'));
        const top = tri(diff);
        const bot = tri(diff.map(Math.abs));
        return { dti: top.map((v, i) => fin((100 * v) / bot[i])) };
      },
    },
    guide: {
      what: 'A smooth −100..+100 trend gauge built from how much each bar\'s high rises versus how much its low falls.',
      use: ['Above zero = upward pressure; below = downward.'],
      signals: ['Above +25 = strong uptrend; below −25 = strong downtrend.', 'Zero-line crosses = trend change.'],
    },
  },
  {
    def: {
      id: 'rwi',
      name: 'Random Walk Index',
      shortName: 'RWI',
      category: 'Trend',
      description: 'Poulos: the largest (high − low k bars ago) / (ATR(k) × √k) over k = 2..N (and the mirror for lows). Above 1 = moving more than a random walk would.',
      placement: 'separate',
      inputs: [length(14, 2)],
      plots: [
        { key: 'up', title: 'RWI High', type: 'line', color: C.up, lineWidth: 2 },
        { key: 'down', title: 'RWI Low', type: 'line', color: C.down, lineWidth: 2 },
      ],
      levels: [1],
      compute: (bars, p) => rwi(bars, 2, num(p, 'length')),
    },
    guide: {
      what: 'Compares how far price has really moved with how far a random walk would go in the same time.',
      use: ['RWI High above 1 = a real uptrend; RWI Low above 1 = a real downtrend.'],
      signals: ['High crossing above Low = bullish; Low above High = bearish.'],
      tip: 'Both below 1 = price is just wandering; trend signals there are weak.',
    },
  },
  {
    def: {
      id: 'kasepo',
      name: 'Kase-style Peak Oscillator (approx.)',
      shortName: 'PeakOsc≈',
      category: 'Trend',
      description: 'Approximation of Kase\'s Peak Oscillator: random-walk index on log prices over lookbacks 8..N, high minus low, 3-bar SMA. Not Kase\'s exact proprietary formula.',
      placement: 'separate',
      inputs: [length(65, 8, 'Longest lookback')],
      plots: [histo('po', 'Peak Osc')],
      levels: [0],
      compute: (bars, p) => {
        const r = rwi(bars, 8, num(p, 'length'), true);
        return { po: sma(r.up.map((v, i) => v - r.down[i]), 3) };
      },
    },
    guide: {
      what: 'An approximation of Cynthia Kase\'s Peak Oscillator: how strongly price is trending up versus down, measured against random movement.',
      use: ['Above zero = upward trend strength; below zero = downward.'],
      signals: ['Extreme readings that turn back can mark trend peaks.', 'Divergence with price = momentum fading.'],
      tip: 'This is labelled approximate: Kase\'s published indicator uses her own statistical bands.',
    },
  },
  {
    def: {
      id: 'inertia',
      name: 'Inertia (Dorsey)',
      shortName: 'Inertia',
      category: 'Trend',
      description: 'Dorsey: linear regression (N bars) of the Relative Volatility Index (10-bar std dev split by up/down closes, 14-bar EMA). Above 50 = positive inertia.',
      placement: 'separate',
      inputs: [length(20, 2, 'Regression length'), input('rvi', 'RVI length', 14, 1, 500), input('sd', 'Std dev length', 10, 2, 500)],
      plots: [{ key: 'inertia', title: 'Inertia', type: 'line', color: C.violet, lineWidth: 2 }],
      levels: [50],
      compute: (bars, p) => {
        const c = closes(bars);
        const sd = stdev(c, num(p, 'sd'));
        const ch = change(c);
        const u = ema(sd.map((v, i) => (Number.isNaN(v) || Number.isNaN(ch[i]) ? NaN : ch[i] > 0 ? v : 0)), num(p, 'rvi'));
        const d = ema(sd.map((v, i) => (Number.isNaN(v) || Number.isNaN(ch[i]) ? NaN : ch[i] < 0 ? v : 0)), num(p, 'rvi'));
        const rvi = u.map((v, i) => fin((100 * v) / (v + d[i])));
        return { inertia: rolling(rvi, num(p, 'length'), (w) => lineFit(w).end) };
      },
    },
    guide: {
      what: 'A smoothed trend reading built from the Relative Volatility Index: is volatility happening more on up days or down days?',
      use: ['Above 50 = the trend has positive inertia (up); below 50 = negative (down).'],
      signals: ['Crossing 50 = trend direction change.'],
    },
  },
  {
    def: {
      id: 'atrtrail',
      name: 'ATR Trailing Stop',
      shortName: 'ATR Trail',
      category: 'Trend',
      description: 'A stop mult × ATR from the close that only moves in the trade\'s favour, flipping side when the close crosses it.',
      placement: 'overlay',
      inputs: [length(14, 1, 'ATR length'), input('mult', 'ATR multiple', 3, 0.1, 20, 0.1)],
      plots: [
        { key: 'long', title: 'Long stop', type: 'line', color: C.up, lineWidth: 2, style: 'dots' },
        { key: 'short', title: 'Short stop', type: 'line', color: C.down, lineWidth: 2, style: 'dots' },
      ],
      compute: (bars, p) => {
        const atr = atrOf(bars, num(p, 'length'));
        const m = num(p, 'mult');
        const long = NaNs(bars.length);
        const short = NaNs(bars.length);
        let prev = NaN;
        bars.forEach((b, i) => {
          if (Number.isNaN(atr[i])) return;
          const loss = m * atr[i];
          const c = b.close;
          const pc = i ? bars[i - 1].close : c;
          let stop: number;
          if (Number.isNaN(prev)) stop = c - loss;
          else if (c > prev && pc > prev) stop = Math.max(prev, c - loss);
          else if (c < prev && pc < prev) stop = Math.min(prev, c + loss);
          else stop = c > prev ? c - loss : c + loss;
          prev = stop;
          if (stop <= c) long[i] = stop;
          else short[i] = stop;
        });
        return { long, short };
      },
    },
    guide: {
      what: 'A trailing stop line set a few ATRs away from price. Green dots under price = long side; red dots above = short side.',
      use: ['Hold a long while price stays above the green dots; exit when the close falls through.'],
      signals: ['Dots switching side = trend flip (close crossed the stop).'],
      tip: 'A bigger multiple gives the trade more room but gives back more profit at the exit.',
    },
  },
  {
    def: {
      id: 'volstop',
      name: 'Volatility Stop (Wilder)',
      shortName: 'VolStop',
      category: 'Trend',
      description: 'Wilder\'s Volatility System: stop = highest close of the trend − mult × ATR (or lowest close + mult × ATR); flips when a close crosses it.',
      placement: 'overlay',
      inputs: [length(7, 1, 'ATR length'), input('mult', 'ATR multiple (ARC)', 3, 0.1, 20, 0.1)],
      plots: [
        { key: 'long', title: 'Long stop', type: 'line', color: C.up, lineWidth: 2, style: 'dots' },
        { key: 'short', title: 'Short stop', type: 'line', color: C.down, lineWidth: 2, style: 'dots' },
      ],
      compute: (bars, p) => {
        const atr = atrOf(bars, num(p, 'length'));
        const m = num(p, 'mult');
        const long = NaNs(bars.length);
        const short = NaNs(bars.length);
        let up = true;
        let extreme = NaN;
        bars.forEach((b, i) => {
          if (Number.isNaN(atr[i])) return;
          const c = b.close;
          if (Number.isNaN(extreme)) extreme = c;
          extreme = up ? Math.max(extreme, c) : Math.min(extreme, c);
          let stop = up ? extreme - m * atr[i] : extreme + m * atr[i];
          if (up && c < stop) {
            up = false;
            extreme = c;
            stop = c + m * atr[i];
          } else if (!up && c > stop) {
            up = true;
            extreme = c;
            stop = c - m * atr[i];
          }
          if (up) long[i] = stop;
          else short[i] = stop;
        });
        return { long, short };
      },
    },
    guide: {
      what: 'Wilder\'s stop-and-reverse line: it hangs a fixed number of ATRs below the best close of an uptrend (or above the lowest close of a downtrend).',
      use: ['Stay long above the green dots and short (or out) below the red dots.'],
      signals: ['A close through the line = reverse or exit.'],
      tip: 'Wilder used 7-bar ATR and a multiple of about 3 (2.8-3.1).',
    },
  },
  {
    def: {
      id: 'maslope',
      name: 'EMA Slope %',
      shortName: 'EMA Slope',
      category: 'Trend',
      description: 'Percent change of an EMA from the previous bar: 100 × (EMA / EMA[1] − 1). Above zero = the average is rising.',
      placement: 'separate',
      inputs: [length(20, 1), sourceInput],
      plots: [histo('slope', 'Slope %')],
      levels: [0],
      compute: (bars, p) => {
        const e = ema(src(bars, p), num(p, 'length'));
        return { slope: e.map((v, i) => (i ? fin(100 * (v / e[i - 1] - 1)) : NaN)) };
      },
    },
    guide: {
      what: 'Whether a moving average is pointing up or down, and how steeply, in percent per bar.',
      use: ['Green = rising average (uptrend); red = falling (downtrend).'],
      signals: ['Slope turning from red to green = the average has bottomed.'],
    },
  },
  {
    def: {
      id: 'trendage',
      name: 'Trend Age (bars vs SMA)',
      shortName: 'TrendAge',
      category: 'Trend',
      description: 'Bars since the close last crossed its N-bar SMA: +k = k bars in a row above it, −k = below (0 = on the average).',
      placement: 'separate',
      inputs: [length(50, 1), sourceInput],
      plots: [histo('age', 'Bars')],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const m = sma(s, num(p, 'length'));
        let age = 0;
        return {
          age: s.map((v, i) => {
            if (Number.isNaN(m[i])) return NaN;
            const side = v > m[i] ? 1 : v < m[i] ? -1 : 0;
            age = side === 0 ? 0 : Math.sign(age) === side ? age + side : side;
            return age;
          }),
        };
      },
    },
    guide: {
      what: 'How long price has stayed on one side of its moving average: a count of bars, positive above and negative below.',
      use: ['Young trends (small counts) have more room to run; very old ones are mature.', 'Compare with the stock\'s history: how long do its trends usually last?'],
      signals: ['A flip from a long positive run to −1 = the first close below the average.'],
    },
  },
];

