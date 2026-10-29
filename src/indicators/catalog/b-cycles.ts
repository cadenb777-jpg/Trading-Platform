/**
 * Momentum family, part 3: indicators in the 'Cycles' category, mostly John Ehlers' digital filters
 * ("Rocket Science for Traders" 2001, "Cybernetic Analysis" 2004, "Cycle Analytics for Traders" 2013 and his
 * Stocks & Commodities articles) and TA-Lib's Hilbert Transform functions. Ehlers' EasyLanguage uses degrees and
 * 3.14159; these ports use radians and Math.PI, which can differ from his printed numbers in the 6th digit.
 */
import { ema } from '../math';
import { hilbert } from './b-hilbert';
import { C, closes, correlation, div, firstValid, highPass1, highPass2, hist, int, lag, len, line, n, NaNs, roofing, sourceInput, src, superSmoother, type Entry } from './b-util';
import { highest, lowest } from '../math';

const DEG = Math.PI / 180;

/** Ehlers' decycler oscillator line: 2-pole high-pass (period/2) of (price - 2-pole high-pass(period)), in % of price. */
function decyclerOsc(c: number[], period: number, k: number): number[] {
  const hp = highPass2(c, period);
  const decycle = c.map((v, i) => v - hp[i]);
  const osc = highPass2(decycle, 0.5 * period);
  return osc.map((v, i) => div(100 * k * v, c[i]));
}

/** Rolling Pearson correlation of the filter with itself `lag` bars back over `m` bars (Ehlers' ACP). */
function autocorr(f: number[], i: number, lagBars: number, m: number): number {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let c = 0; c < m; c++) {
    const x = f[i - c];
    const y = f[i - lagBars - c];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const d = (m * sxx - sx * sx) * (m * syy - sy * sy);
  return d > 0 ? (m * sxy - sx * sy) / Math.sqrt(d) : 0;
}

/** Weighted centre of the periods whose normalised power is at least 0.5 (Ehlers' dominant-cycle estimate). */
function centre(pwr: number[], lo: number): number {
  let sp = 0;
  let spx = 0;
  for (let k = 0; k < pwr.length; k++) {
    if (pwr[k] >= 0.5) {
      sp += pwr[k];
      spx += (lo + k) * pwr[k];
    }
  }
  return sp > 0 ? spx / sp : NaN;
}

export const CYCLE_ENTRIES: Entry[] = [
  {
    def: {
      id: 'cog',
      name: 'Center of Gravity',
      shortName: 'CoG',
      category: 'Cycles',
      description: 'Ehlers’ Center of Gravity oscillator: -Σ(k+1)·price[k] / Σprice[k] + (N+1)/2 on the bar midpoint, with the previous value as trigger.',
      placement: 'separate',
      inputs: [len(10), sourceInput('hl2')],
      plots: [line('cog', 'CoG', C.blue), line('trigger', 'Trigger', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const l = int(p, 'length');
        const cog = s.map((_, i) => {
          if (i < l - 1) return NaN;
          let num = 0;
          let den = 0;
          for (let k = 0; k < l; k++) {
            num += (k + 1) * s[i - k];
            den += s[i - k];
          }
          return den === 0 ? 0 : -num / den + (l + 1) / 2;
        });
        return { cog, trigger: lag(cog, 1) };
      },
    },
    guide: {
      what: 'A nearly lag-free cycle oscillator: it shows where the "weight" of recent prices sits, turning at cycle peaks and troughs.',
      use: ['Use it to time turns inside a range or pullbacks inside a trend.'],
      signals: ['CoG crossing its trigger line: up = buy, down = sell.'],
    },
  },
  {
    def: {
      id: 'cybercycle',
      name: 'Cyber Cycle',
      shortName: 'Cyber Cycle',
      category: 'Cycles',
      description: 'Ehlers’ Cyber Cycle (Cybernetic Analysis): a high-pass filter of the 4-bar smoothed midpoint (alpha 0.07), with the previous value as trigger.',
      placement: 'separate',
      inputs: [n('alpha', 'Alpha', 0.07, 0.01, 0.99, 0.01), sourceInput('hl2')],
      plots: [line('cycle', 'Cycle', C.blue), line('trigger', 'Trigger', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const a = Number(p.alpha);
        const sm = s.map((_, i) => (i < 3 ? NaN : (s[i] + 2 * s[i - 1] + 2 * s[i - 2] + s[i - 3]) / 6));
        const cyc = NaNs(s.length);
        for (let i = 2; i < s.length; i++) {
          if (i < 7) cyc[i] = (s[i] - 2 * s[i - 1] + s[i - 2]) / 4;
          else cyc[i] = (1 - 0.5 * a) ** 2 * (sm[i] - 2 * sm[i - 1] + sm[i - 2]) + 2 * (1 - a) * cyc[i - 1] - (1 - a) ** 2 * cyc[i - 2];
        }
        return { cycle: cyc, trigger: lag(cyc, 1) };
      },
    },
    guide: {
      what: 'Removes the trend and keeps the swing (cycle) part of price, so turning points stand out.',
      use: ['Works best in sideways, swinging markets.'],
      signals: ['Cycle crossing its trigger line.'],
    },
  },
  {
    def: {
      id: 'ht_dcperiod',
      name: 'Hilbert Transform - Dominant Cycle Period',
      shortName: 'HT Period',
      category: 'Cycles',
      description: 'TA-Lib HT_DCPERIOD: the dominant cycle length in bars (6-50) measured with Ehlers’ Hilbert Transform homodyne discriminator.',
      placement: 'separate',
      inputs: [sourceInput()],
      plots: [line('period', 'Period', C.blue)],
      compute: (bars, p) => ({ period: hilbert(src(bars, p), false).period }),
    },
    guide: {
      what: 'Estimates how many bars a full market cycle (trough to trough) currently lasts.',
      use: ['Use it to set the length of other indicators: many traders use half the cycle for oscillators.'],
      signals: ['A stable reading = a clear rhythm; a jumping reading = no reliable cycle (trend or noise).'],
    },
  },
  {
    def: {
      id: 'ht_dcphase',
      name: 'Hilbert Transform - Dominant Cycle Phase',
      shortName: 'HT Phase',
      category: 'Cycles',
      description: 'TA-Lib HT_DCPHASE: the phase angle (degrees, -45..315) of the dominant cycle.',
      placement: 'separate',
      inputs: [sourceInput()],
      plots: [line('phase', 'Phase', C.blue)],
      compute: (bars, p) => ({ phase: hilbert(src(bars, p), true).phase }),
    },
    guide: {
      what: 'Where we are within the current cycle, as an angle: it climbs steadily through a cycle and resets.',
      use: ['A steady climb = the market is cycling; a flat phase = it is trending.'],
      signals: ['Resets (the big drop) mark the start of a new cycle.'],
    },
  },
  {
    def: {
      id: 'ht_phasor',
      name: 'Hilbert Transform - Phasor Components',
      shortName: 'HT Phasor',
      category: 'Cycles',
      description: 'TA-Lib HT_PHASOR: the in-phase and quadrature components of the detrended price.',
      placement: 'separate',
      inputs: [sourceInput()],
      plots: [line('inPhase', 'In-phase', C.blue), line('quadrature', 'Quadrature', C.orange)],
      levels: [0],
      compute: (bars, p) => {
        const h = hilbert(src(bars, p), false);
        return { inPhase: h.inPhase, quadrature: h.quadrature };
      },
    },
    guide: {
      what: 'The two building blocks Ehlers uses to measure cycles: the detrended price and a copy shifted by a quarter cycle.',
      use: ['Mostly of interest to cycle analysts; the quadrature line leads the in-phase line.'],
      signals: ['The two lines crossing hint at cycle turns.'],
    },
  },
  {
    def: {
      id: 'ht_sine',
      name: 'Hilbert Transform - SineWave',
      shortName: 'HT Sine',
      category: 'Cycles',
      description: 'TA-Lib HT_SINE (Ehlers’ MESA sine wave): sine of the dominant cycle phase and a lead line 45° ahead.',
      placement: 'separate',
      inputs: [sourceInput()],
      plots: [line('sine', 'Sine', C.blue), line('leadSine', 'Lead sine', C.orange)],
      levels: [0],
      compute: (bars, p) => {
        const h = hilbert(src(bars, p), true);
        return { sine: h.sine, leadSine: h.leadSine };
      },
    },
    guide: {
      what: 'Two waves that follow the market’s cycle. When the market is cycling they cross near tops and bottoms.',
      use: ['Use only in ranges: in a trend the lines wander and cross often (switch to trend tools).'],
      signals: ['Lead sine crossing above sine = cycle bottom (buy); below = cycle top (sell).'],
    },
  },
  {
    def: {
      id: 'ht_trendmode',
      name: 'Hilbert Transform - Trend vs Cycle Mode',
      shortName: 'HT Trend',
      category: 'Cycles',
      description: 'TA-Lib HT_TRENDMODE: 1 when the market is trending, 0 when it is in a cycle (sine-wave and trendline rules).',
      placement: 'separate',
      inputs: [sourceInput()],
      plots: [hist('mode', 'Trend mode')],
      compute: (bars, p) => ({ mode: hilbert(src(bars, p), true).trendMode }),
    },
    guide: {
      what: 'A switch: 1 = trending, 0 = cycling (sideways swings).',
      use: ['Use trend-following tools when it shows 1 and oscillators when it shows 0.'],
      signals: ['A change from 0 to 1 = a breakout into a trend.'],
    },
  },
  {
    def: {
      id: 'decosc',
      name: 'Decycler Oscillator',
      shortName: 'DecOsc',
      category: 'Cycles',
      description: 'Ehlers’ Decycler Oscillator (2015): a 2-pole high-pass (half period) of the decycler (price minus its high-pass), in percent of price; lines for periods 125 (x1) and 100 (x1.2).',
      placement: 'separate',
      inputs: [n('slow', 'Slow period', 125, 4), n('fast', 'Fast period', 100, 4), n('k', 'Fast multiplier', 1.2, 0.1, 10, 0.1)],
      plots: [line('slow', 'Slow', C.blue), line('fast', 'Fast', C.orange)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        return { slow: decyclerOsc(c, Number(p.slow), 1), fast: decyclerOsc(c, Number(p.fast), Number(p.k)) };
      },
    },
    guide: {
      what: 'Two lines that show the trend with the short cycles filtered out; their crossing marks trend changes.',
      use: ['Both lines above zero = uptrend.'],
      signals: ['The fast line crossing the slow line = trend reversal.'],
    },
  },
  {
    def: {
      id: 'roofing',
      name: 'Roofing Filter',
      shortName: 'Roofing',
      category: 'Cycles',
      description: 'Ehlers’ Roofing filter: a 2-pole high-pass (48 bars) followed by a Super Smoother (10 bars), keeping only the cycles in between.',
      placement: 'separate',
      inputs: [n('hp', 'High-pass period', 48, 2), n('lp', 'Smoother period', 10, 2), sourceInput()],
      plots: [line('roof', 'Roofing', C.blue), line('trigger', 'Trigger (2 bars ago)', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const roof = roofing(src(bars, p), Number(p.hp), Number(p.lp));
        return { roof, trigger: lag(roof, 2) };
      },
    },
    guide: {
      what: 'Price with both the trend (slow moves) and the noise (fast wiggles) removed; what is left is the tradeable swing.',
      use: ['A clean input for spotting cycle highs and lows.'],
      signals: ['Crossing its trigger line or zero.'],
    },
  },
  {
    def: {
      id: 'bandpass',
      name: 'Bandpass Filter',
      shortName: 'Bandpass',
      category: 'Cycles',
      description: 'Ehlers’ bandpass with trigger (2016): 1-pole high-pass, then a 20-bar bandpass (bandwidth 0.3), normalised by its decaying peak; trigger = a 1-pole high-pass of that. Approx.: uses the textbook (1 - alpha/2) high-pass gain where the printed code shows (1 + alpha/2).',
      placement: 'separate',
      inputs: [len(20, 'Period'), n('bw', 'Bandwidth', 0.3, 0.05, 1, 0.05), sourceInput()],
      plots: [line('signal', 'Bandpass', C.blue), line('trigger', 'Trigger', C.orange, 1)],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const P = int(p, 'length', 2);
        const bw = Number(p.bw);
        // Ehlers' angle 0.25 x bandwidth x 360 / P is a 1-pole high-pass with cut-off period P / (0.25 x bandwidth)
        const hp = highPass1(s, P / (0.25 * bw));
        const beta = Math.cos((2 * Math.PI) / P);
        const gamma = 1 / Math.cos((2 * Math.PI * bw) / P);
        const alpha = gamma - Math.sqrt(gamma * gamma - 1);
        const bp = NaNs(s.length);
        const signal = NaNs(s.length);
        const st = firstValid(hp);
        let peak = 0;
        for (let i = st; i < s.length; i++) {
          bp[i] = i < st + 2 ? 0 : 0.5 * (1 - alpha) * (hp[i] - hp[i - 2]) + beta * (1 + alpha) * bp[i - 1] - alpha * bp[i - 2];
          peak *= 0.991;
          if (Math.abs(bp[i]) > peak) peak = Math.abs(bp[i]);
          signal[i] = peak === 0 ? 0 : bp[i] / peak;
        }
        return { signal, trigger: highPass1(signal, P / (1.5 * bw)) };
      },
    },
    guide: {
      what: 'Keeps only price swings close to the chosen cycle length and scales them to ±1.',
      use: ['Set the period to the cycle you see on the chart (for example 20 bars).'],
      signals: ['Trigger crossing the bandpass line: up = cycle low, down = cycle high.'],
    },
  },
  {
    def: {
      id: 'ebsw',
      name: 'Even Better Sinewave',
      shortName: 'EBSW',
      category: 'Cycles',
      description: 'Ehlers’ Even Better Sinewave (Cycle Analytics): 1-pole high-pass (40), Super Smoother (10), then the 3-bar wave divided by its RMS power, about -1..+1.',
      placement: 'separate',
      inputs: [n('hp', 'Duration (high-pass)', 40, 2), n('lp', 'Smoother period', 10, 2), sourceInput()],
      plots: [line('wave', 'Wave', C.blue)],
      levels: [0.85, 0, -0.85],
      compute: (bars, p) => {
        const s = src(bars, p);
        const d = Number(p.hp);
        const a1 = (1 - Math.sin((2 * Math.PI) / d)) / Math.cos((2 * Math.PI) / d);
        const hp = NaNs(s.length);
        const st = firstValid(s);
        for (let i = st; i < s.length; i++) hp[i] = i === st ? 0 : 0.5 * (1 + a1) * (s[i] - s[i - 1]) + a1 * hp[i - 1];
        const f = superSmoother(hp, Number(p.lp));
        return {
          wave: f.map((v, i) => {
            if (i < 2 || Number.isNaN(f[i - 2])) return NaN;
            const w = (v + f[i - 1] + f[i - 2]) / 3;
            const pwr = (v * v + f[i - 1] ** 2 + f[i - 2] ** 2) / 3;
            return pwr === 0 ? 0 : w / Math.sqrt(pwr);
          }),
        };
      },
    },
    guide: {
      what: 'A wave that sits near +1 in uptrends and -1 in downtrends and swings between them in cycling markets.',
      use: ['Readings flat near ±1 = trend; swinging = cycle.'],
      signals: ['Crossing up through -0.85 = buy; down through +0.85 = sell (in cycling markets).'],
    },
  },
  {
    def: {
      id: 'acp',
      name: 'Autocorrelation Periodogram',
      shortName: 'ACP Cycle',
      category: 'Cycles',
      description: 'Ehlers’ autocorrelation periodogram (Cycle Analytics ch. 8): roofing filter (48/10), Pearson autocorrelation at lags 0-48 (3-bar average for short lags), DFT of the correlations, smoothed power; dominant cycle = power-weighted centre of periods 10-48 with power ≥ 0.5.',
      placement: 'separate',
      inputs: [n('min', 'Shortest period', 10, 4, 100), n('max', 'Longest period', 48, 6, 100), n('avg', 'Average length', 3, 0, 50)],
      plots: [line('cycle', 'Dominant cycle', C.blue)],
      compute: (bars, p) => {
        const c = closes(bars);
        const lo = int(p, 'min', 4);
        const hi = Math.max(lo + 1, int(p, 'max', 6));
        const avgLen = int(p, 'avg', 0);
        const f = roofing(c, 48, 10);
        const out = NaNs(c.length);
        const R = new Array<number>(hi - lo + 1).fill(0);
        let maxPwr = 0;
        const need = hi + Math.max(avgLen, hi);
        for (let i = need; i < c.length; i++) {
          const corr = new Array<number>(hi + 1).fill(0);
          for (let L = 0; L <= hi; L++) corr[L] = autocorr(f, i, L, avgLen === 0 ? L : avgLen);
          const pwr: number[] = [];
          maxPwr *= 0.995;
          for (let P = lo; P <= hi; P++) {
            let cp = 0;
            let sp = 0;
            for (let N = 3; N <= hi; N++) {
              cp += corr[N] * Math.cos((2 * Math.PI * N) / P);
              sp += corr[N] * Math.sin((2 * Math.PI * N) / P);
            }
            const sq = cp * cp + sp * sp;
            R[P - lo] = 0.2 * sq * sq + 0.8 * R[P - lo];
            if (R[P - lo] > maxPwr) maxPwr = R[P - lo];
          }
          for (let P = lo; P <= hi; P++) pwr.push(maxPwr === 0 ? 0 : R[P - lo] / maxPwr);
          // Ehlers keeps the previous cycle when no period has enough power (If Sp <> 0)
          const dc = centre(pwr, lo);
          const prev = i > need && !Number.isNaN(out[i - 1]) ? out[i - 1] : lo;
          out[i] = Math.min(hi, Math.max(lo, Number.isNaN(dc) ? prev : dc));
        }
        return { cycle: out };
      },
    },
    guide: {
      what: 'Another way of measuring the market’s current cycle length (in bars), less jumpy than the Hilbert method.',
      use: ['Use it to tune other indicators to the market’s rhythm.'],
      signals: ['A steady reading = a reliable cycle you can trade.'],
      tip: 'It needs about 100 bars to start and is slower to compute than most indicators.',
    },
  },
  {
    def: {
      id: 'mesastoch',
      name: 'MESA Stochastic',
      shortName: 'MESA Stoch',
      category: 'Cycles',
      description: 'Ehlers’ roofing-filtered Stochastic (Cycle Analytics): stochastic (0-1) of the roofing filter over 20 bars, then a 10-bar Super Smoother.',
      placement: 'separate',
      inputs: [len(20, 'Stochastic length'), n('hp', 'High-pass period', 48, 2), n('lp', 'Smoother period', 10, 2)],
      plots: [line('stoch', 'Stochastic', C.blue)],
      levels: [0.8, 0.2],
      compute: (bars, p) => {
        const f = roofing(closes(bars), Number(p.hp), Number(p.lp));
        const l = int(p, 'length');
        const hh = highest(f, l);
        const ll = lowest(f, l);
        const raw = f.map((v, i) => (Number.isNaN(hh[i]) ? NaN : hh[i] === ll[i] ? 0.5 : (v - ll[i]) / (hh[i] - ll[i])));
        return { stoch: superSmoother(raw, Number(p.lp)) };
      },
    },
    guide: {
      what: 'A Stochastic that first strips out trend and noise, so it swings cleanly between 0 and 1 with the market’s cycles.',
      use: ['Above 0.8 = cycle high zone; below 0.2 = cycle low zone.'],
      signals: ['Crossing up through 0.2 = buy; down through 0.8 = sell.'],
    },
  },
  {
    def: {
      id: 'reflex',
      name: 'Reflex',
      shortName: 'Reflex',
      category: 'Cycles',
      description: 'Ehlers’ Reflex (2020): average distance of the Super Smoothed price (half period) from the straight line between now and N bars ago, scaled by its RMS. Shows cycle turns.',
      placement: 'separate',
      inputs: [len(20)],
      plots: [line('reflex', 'Reflex', C.blue)],
      levels: [0],
      compute: (bars, p) => {
        const l = int(p, 'length', 2);
        const f = superSmoother(closes(bars), l / 2);
        const out = NaNs(f.length);
        let ms = 0;
        for (let i = l; i < f.length; i++) {
          const sl = (f[i - l] - f[i]) / l;
          let s = 0;
          for (let k = 1; k <= l; k++) s += f[i] + k * sl - f[i - k];
          s /= l;
          ms = 0.04 * s * s + 0.96 * ms;
          out[i] = ms === 0 ? 0 : s / Math.sqrt(ms);
        }
        return { reflex: out };
      },
    },
    guide: {
      what: 'A cycle oscillator with almost no lag: it peaks and dips with the swings around the trend.',
      use: ['Pair it with Trendflex: Reflex for the swings, Trendflex for the trend.'],
      signals: ['Turns from extremes (beyond about ±1.5) and zero-line crosses.'],
    },
  },
  {
    def: {
      id: 'trendflex',
      name: 'Trendflex',
      shortName: 'Trendflex',
      category: 'Cycles',
      description: 'Ehlers’ Trendflex (2020): average difference between the Super Smoothed price now and over the last N bars, scaled by its RMS. Keeps the trend component.',
      placement: 'separate',
      inputs: [len(20)],
      plots: [line('trendflex', 'Trendflex', C.blue)],
      levels: [0],
      compute: (bars, p) => {
        const l = int(p, 'length', 2);
        const f = superSmoother(closes(bars), l / 2);
        const out = NaNs(f.length);
        let ms = 0;
        for (let i = l; i < f.length; i++) {
          let s = 0;
          for (let k = 1; k <= l; k++) s += f[i] - f[i - k];
          s /= l;
          ms = 0.04 * s * s + 0.96 * ms;
          out[i] = ms === 0 ? 0 : s / Math.sqrt(ms);
        }
        return { trendflex: out };
      },
    },
    guide: {
      what: 'A low-lag trend oscillator: above zero while the smoothed price is rising, below while it falls.',
      use: ['Stays positive through an uptrend; use with Reflex for timing.'],
      signals: ['Zero-line crosses = trend changes.'],
    },
  },
  {
    def: {
      id: 'superpb',
      name: 'Super Passband Filter',
      shortName: 'Super PB',
      category: 'Cycles',
      description: 'Ehlers’ Super Passband (2016): difference of two EMA-like filters (alphas 5/40 and 5/60) with ±RMS (50 bars) bands.',
      placement: 'separate',
      inputs: [n('p1', 'Fast period', 40, 6), n('p2', 'Slow period', 60, 6), n('rms', 'RMS length', 50)],
      plots: [line('pb', 'Passband', C.blue), line('rmsUp', '+RMS', C.grey, 1), line('rmsDn', '-RMS', C.grey, 1)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const a1 = 5 / Number(p.p1);
        const a2 = 5 / Number(p.p2);
        const pb = NaNs(c.length);
        for (let i = 0; i < c.length; i++) {
          if (i < 2) pb[i] = 0;
          else pb[i] = (a1 - a2) * c[i] + (a2 * (1 - a1) - a1 * (1 - a2)) * c[i - 1] + (1 - a1 + (1 - a2)) * pb[i - 1] - (1 - a1) * (1 - a2) * pb[i - 2];
        }
        const r = int(p, 'rms');
        const rmsUp = pb.map((_, i) => {
          if (i < r - 1) return NaN;
          let s = 0;
          for (let k = 0; k < r; k++) s += pb[i - k] ** 2;
          return Math.sqrt(s / r);
        });
        return { pb, rmsUp, rmsDn: rmsUp.map((v) => -v) };
      },
    },
    guide: {
      what: 'A wide band-pass filter that keeps the main swings with very little lag, with bands showing their usual size.',
      use: ['Crossing the bands = a swing is unusually large.'],
      signals: ['Crossing up through -RMS = buy; down through +RMS = sell.'],
    },
  },
  {
    def: {
      id: 'dsp',
      name: 'Detrended Synthetic Price',
      shortName: 'DSP',
      category: 'Cycles',
      description: 'Ehlers’ DSP, fixed-period form: EMA over a quarter cycle minus EMA over a half cycle of the bar midpoint (the original uses the measured dominant cycle).',
      placement: 'separate',
      inputs: [len(40, 'Cycle period'), sourceInput('hl2')],
      plots: [hist('dsp', 'DSP')],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const P = int(p, 'length', 4);
        const q = ema(s, Math.max(1, Math.round(P / 4)));
        const h = ema(s, Math.max(1, Math.round(P / 2)));
        return { dsp: q.map((v, i) => v - h[i]) };
      },
    },
    guide: {
      what: 'A smooth wave built from two moving averages tuned to the cycle length; it crosses zero near cycle turns.',
      use: ['Set the period to the market’s cycle length (see HT Period or ACP).'],
      signals: ['Zero-line crosses.'],
    },
  },
  {
    def: {
      id: 'voss',
      name: 'Voss Predictive Filter',
      shortName: 'Voss',
      category: 'Cycles',
      description: 'Ehlers’ Voss predictor (2019): a 20-bar bandpass (bandwidth 0.25) and a filter that leads it by 3 bars using negative group delay.',
      placement: 'separate',
      inputs: [len(20, 'Period'), n('predict', 'Bars of prediction', 3), n('bw', 'Bandwidth', 0.25, 0.05, 1, 0.05)],
      plots: [line('voss', 'Voss', C.blue), line('filt', 'Bandpass', C.orange)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const P = int(p, 'length', 2);
        const order = 3 * int(p, 'predict');
        const f1 = Math.cos((2 * Math.PI) / P);
        const g1 = Math.cos((Number(p.bw) * 2 * Math.PI) / P);
        const s1 = 1 / g1 - Math.sqrt(1 / (g1 * g1) - 1);
        const filt = new Array<number>(c.length).fill(0);
        const voss = new Array<number>(c.length).fill(0);
        for (let i = 0; i < c.length; i++) {
          if (i <= 5) continue;
          filt[i] = 0.5 * (1 - s1) * (c[i] - c[i - 2]) + f1 * (1 + s1) * filt[i - 1] - s1 * filt[i - 2];
          let sc = 0;
          for (let k = 0; k < order; k++) sc += ((k + 1) / order) * (i - order + k >= 0 ? voss[i - order + k] : 0);
          voss[i] = ((3 + order) / 2) * filt[i] - sc;
        }
        return { voss, filt };
      },
    },
    guide: {
      what: 'A cycle filter plus a "predictor" line that tends to turn a few bars before it.',
      use: ['Works in cycling markets; in strong trends the lines lose their rhythm.'],
      signals: ['Voss crossing above the bandpass line = buy; below = sell.'],
    },
  },
  {
    def: {
      id: 'univosc',
      name: 'Universal Oscillator',
      shortName: 'Universal',
      category: 'Cycles',
      description: 'Ehlers’ Universal Oscillator (2015): Super Smoother (band edge 20) of the 2-bar "whitened" change, divided by its slowly decaying peak (automatic gain control), -1..+1.',
      placement: 'separate',
      inputs: [len(20, 'Band edge')],
      plots: [line('osc', 'Universal', C.blue)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const white = c.map((v, i) => (i < 2 ? NaN : (v - c[i - 2]) / 2));
        const f = superSmoother(white, int(p, 'length', 2));
        let peak = 0;
        return {
          osc: f.map((v) => {
            if (Number.isNaN(v)) return NaN;
            peak *= 0.991;
            if (Math.abs(v) > peak) peak = Math.abs(v);
            return peak === 0 ? 0 : v / peak;
          }),
        };
      },
    },
    guide: {
      what: 'A smooth momentum wave that automatically scales itself to ±1 on any market.',
      use: ['Above zero = upward swing; below = downward swing.'],
      signals: ['Zero-line crosses; turns near ±1.'],
    },
  },
  {
    def: {
      id: 'dftcycle',
      name: 'DFT Dominant Cycle',
      shortName: 'DFT Cycle',
      category: 'Cycles',
      description: 'Dominant cycle from a discrete Fourier transform of the roofing-filtered price (simplified Ehlers method): power at periods 10-48 over one period of data, normalised; power-weighted centre where power ≥ 0.5.',
      placement: 'separate',
      inputs: [n('min', 'Shortest period', 10, 4, 100), n('max', 'Longest period', 48, 6, 100)],
      plots: [line('cycle', 'Dominant cycle', C.blue)],
      compute: (bars, p) => {
        const c = closes(bars);
        const lo = int(p, 'min', 4);
        const hi = Math.max(lo + 1, int(p, 'max', 6));
        const f = roofing(c, 48, 10);
        const out = NaNs(c.length);
        for (let i = hi; i < c.length; i++) {
          const pw: number[] = [];
          for (let P = lo; P <= hi; P++) {
            let cp = 0;
            let sp = 0;
            for (let k = 0; k < P; k++) {
              cp += f[i - k] * Math.cos((2 * Math.PI * k) / P);
              sp += f[i - k] * Math.sin((2 * Math.PI * k) / P);
            }
            pw.push(cp * cp + sp * sp);
          }
          const mx = Math.max(...pw);
          out[i] = mx === 0 ? NaN : centre(pw.map((v) => v / mx), lo);
        }
        return { cycle: out };
      },
    },
    guide: {
      what: 'Estimates the current cycle length (in bars) by checking which wave lengths fit recent prices best.',
      use: ['Compare with HT Period and ACP; when they agree the cycle is reliable.'],
      signals: ['A steady reading = a tradeable rhythm.'],
    },
  },
  {
    def: {
      id: 'corrcycle',
      name: 'Correlation Cycle',
      shortName: 'Corr Cycle',
      category: 'Cycles',
      description: 'Ehlers’ correlation cycle (2020): correlation of the last N closes with a cosine (real) and a negative sine (imaginary) wave of period N.',
      placement: 'separate',
      inputs: [len(20, 'Period')],
      plots: [line('real', 'Real', C.blue), line('imag', 'Imaginary', C.orange)],
      levels: [0],
      compute: (bars, p) => corrCycle(closes(bars), int(p, 'length', 2)),
    },
    guide: {
      what: 'Two lines that show how much recent prices look like a wave of the chosen length, and where in that wave we are.',
      use: ['When the lines circle each other the market is cycling; when they flatten it is trending.'],
      signals: ['Real crossing imaginary marks cycle turns.'],
    },
  },
  {
    def: {
      id: 'corrangle',
      name: 'Correlation Cycle Angle',
      shortName: 'Corr Angle',
      category: 'Cycles',
      description: 'Ehlers’ correlation angle (2020): phase angle from the correlation cycle’s real and imaginary parts, never allowed to run backwards (degrees).',
      placement: 'separate',
      inputs: [len(20, 'Period')],
      plots: [line('angle', 'Angle', C.blue)],
      levels: [0],
      compute: (bars, p) => {
        const { real, imag } = corrCycle(closes(bars), int(p, 'length', 2));
        const angle = NaNs(real.length);
        for (let i = 0; i < real.length; i++) {
          if (Number.isNaN(real[i])) continue;
          let a = imag[i] !== 0 ? 90 + Math.atan(real[i] / imag[i]) / DEG : 90;
          if (imag[i] > 0) a -= 180;
          const prev = i > 0 ? angle[i - 1] : NaN;
          if (!Number.isNaN(prev) && prev - a < 270 && a < prev) a = prev;
          angle[i] = a;
        }
        return { angle };
      },
    },
    guide: {
      what: 'The phase of the market’s cycle as an angle; it advances steadily in a cycling market and stalls in a trend.',
      use: ['A steadily rising angle = cycle mode; a flat angle = trend mode.'],
      signals: ['A stall near 0° or ±180° often marks the start of a trend.'],
    },
  },
  {
    def: {
      id: 'rmosc',
      name: 'Recursive Median Oscillator',
      shortName: 'RMO',
      category: 'Cycles',
      description: 'Ehlers’ recursive median oscillator (2018): an EMA (alpha from a 12-bar period) of the 5-bar median close, then a 2-pole high-pass (30 bars).',
      placement: 'separate',
      inputs: [n('lp', 'Low-pass period', 12, 2), n('hp', 'High-pass period', 30, 2)],
      plots: [line('rmo', 'RMO', C.blue)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const w = (2 * Math.PI) / Number(p.lp);
        const a = (Math.cos(w) + Math.sin(w) - 1) / Math.cos(w);
        const rm = NaNs(c.length);
        for (let i = 4; i < c.length; i++) {
          const med = c.slice(i - 4, i + 1).sort((x, y) => x - y)[2];
          rm[i] = i === 4 ? med : a * med + (1 - a) * rm[i - 1];
        }
        return { rmo: highPass2(rm, Number(p.hp)) };
      },
    },
    guide: {
      what: 'A cycle oscillator built on median prices, so single spikes (news gaps) disturb it less.',
      use: ['Above zero = upward swing; below = downward swing.'],
      signals: ['Zero-line crosses and turning points.'],
    },
  },
];

function corrCycle(c: number[], P: number): { real: number[]; imag: number[] } {
  const cosW = Array.from({ length: P }, (_, k) => Math.cos((2 * Math.PI * k) / P));
  const sinW = Array.from({ length: P }, (_, k) => -Math.sin((2 * Math.PI * k) / P));
  const real = NaNs(c.length);
  const imag = NaNs(c.length);
  for (let i = P - 1; i < c.length; i++) {
    const x = Array.from({ length: P }, (_, k) => c[i - k]);
    real[i] = correlation(x, cosW, P)[P - 1];
    imag[i] = correlation(x, sinW, P)[P - 1];
  }
  return { real, imag };
}
