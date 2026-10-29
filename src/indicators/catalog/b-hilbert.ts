/**
 * Ehlers' Hilbert Transform cycle measurements, ported line for line from TA-Lib's C code (ta_HT_DCPERIOD.c,
 * ta_HT_PHASOR.c, ta_HT_DCPHASE.c, ta_HT_SINE.c, ta_HT_TRENDMODE.c; Ehlers, "Rocket Science for Traders", 2001) so the
 * values match TA-Lib's HT_* functions.
 *
 * TA-Lib warms up differently per function: DCPERIOD and PHASOR prime the 4-bar price smoother with 12 bars and
 * output from bar 32; DCPHASE, SINE, TRENDMODE and TRENDLINE prime it with 37 bars and output from bar 63. The
 * internal state starts at zero, so the two warm-ups give slightly different early values; `long` picks which.
 */
import { NaNs } from './b-util';

export interface HilbertOut {
  period: number[];
  inPhase: number[];
  quadrature: number[];
  phase: number[];
  sine: number[];
  leadSine: number[];
  trendline: number[];
  trendMode: number[];
}

export function hilbert(price: number[], long: boolean): HilbertOut {
  const n = price.length;
  const out: HilbertOut = {
    period: NaNs(n),
    inPhase: NaNs(n),
    quadrature: NaNs(n),
    phase: NaNs(n),
    sine: NaNs(n),
    leadSine: NaNs(n),
    trendline: NaNs(n),
    trendMode: NaNs(n),
  };
  const lookback = long ? 63 : 32;
  const primeLoops = long ? 34 : 9;
  if (n <= lookback || price.some((v) => Number.isNaN(v))) return out;

  const a = 0.0962;
  const b = 0.5769;
  const rad2Deg = 45 / Math.atan(1);
  const deg2Rad = 1 / rad2Deg;
  const twoPi = Math.atan(1) * 8;

  // price smoother: 4-bar WMA kept as a running sum
  let trailingIdx = 0;
  let today = 0;
  let periodWMASub = price[today];
  let periodWMASum = price[today++];
  periodWMASub += price[today];
  periodWMASum += price[today++] * 2;
  periodWMASub += price[today];
  periodWMASum += price[today++] * 3;
  let trailingValue = 0;
  for (let i = primeLoops; i > 0; i--) {
    const v = price[today++];
    periodWMASub += v;
    periodWMASub -= trailingValue;
    periodWMASum += v * 4;
    trailingValue = price[trailingIdx++];
    periodWMASum -= periodWMASub;
  }

  // Hilbert transformer state, kept separately for odd and even bars (as TA-Lib does)
  type Stage = { odd: number[]; even: number[]; prevOdd: number; prevEven: number; prevInOdd: number; prevInEven: number };
  const stage = (): Stage => ({ odd: [0, 0, 0], even: [0, 0, 0], prevOdd: 0, prevEven: 0, prevInOdd: 0, prevInEven: 0 });
  const det = stage();
  const q1s = stage();
  const jis = stage();
  const jqs = stage();
  let hIdx = 0;
  const transform = (s: Stage, input: number, even: boolean, adj: number) => {
    const t = a * input;
    let r: number;
    if (even) {
      r = -s.even[hIdx];
      s.even[hIdx] = t;
      r += t;
      r -= s.prevEven;
      s.prevEven = b * s.prevInEven;
      r += s.prevEven;
      s.prevInEven = input;
    } else {
      r = -s.odd[hIdx];
      s.odd[hIdx] = t;
      r += t;
      r -= s.prevOdd;
      s.prevOdd = b * s.prevInOdd;
      r += s.prevOdd;
      s.prevInOdd = input;
    }
    return r * adj;
  };

  let period = 0;
  let prevQ2 = 0;
  let prevI2 = 0;
  let re = 0;
  let im = 0;
  let i1EvenPrev3 = 0;
  let i1OddPrev3 = 0;
  let i1EvenPrev2 = 0;
  let i1OddPrev2 = 0;
  let smoothPeriod = 0;
  const smooth = new Array<number>(50).fill(0);
  let sIdx = 0;
  let dcPhase = 0;
  let prevDcPhase = 0;
  let sine = 0;
  let leadSine = 0;
  let prevSine = 0;
  let prevLeadSine = 0;
  let iTrend1 = 0;
  let iTrend2 = 0;
  let iTrend3 = 0;
  let daysInTrend = 0;

  while (today < n) {
    const adj = 0.075 * period + 0.54;
    const v = price[today];
    periodWMASub += v;
    periodWMASub -= trailingValue;
    periodWMASum += v * 4;
    trailingValue = price[trailingIdx++];
    const smoothed = periodWMASum * 0.1;
    periodWMASum -= periodWMASub;
    smooth[sIdx] = smoothed;

    const even = today % 2 === 0;
    const detrender = transform(det, smoothed, even, adj);
    const q1 = transform(q1s, detrender, even, adj);
    const i1 = even ? i1EvenPrev3 : i1OddPrev3;
    if (today >= lookback) {
      out.quadrature[today] = q1;
      out.inPhase[today] = i1;
    }
    const jI = transform(jis, i1, even, adj);
    const jQ = transform(jqs, q1, even, adj);
    if (even && ++hIdx === 3) hIdx = 0;
    const q2 = 0.2 * (q1 + jI) + 0.8 * prevQ2;
    const i2 = 0.2 * (i1 - jQ) + 0.8 * prevI2;
    if (even) {
      i1OddPrev3 = i1OddPrev2;
      i1OddPrev2 = detrender;
    } else {
      i1EvenPrev3 = i1EvenPrev2;
      i1EvenPrev2 = detrender;
    }

    re = 0.8 * re + 0.2 * (i2 * prevI2 + q2 * prevQ2);
    im = 0.8 * im + 0.2 * (i2 * prevQ2 - q2 * prevI2);
    prevQ2 = q2;
    prevI2 = i2;
    const prevPeriod = period;
    if (im !== 0 && re !== 0) period = 360 / (Math.atan(im / re) * rad2Deg);
    if (period > 1.5 * prevPeriod) period = 1.5 * prevPeriod;
    if (period < 0.67 * prevPeriod) period = 0.67 * prevPeriod;
    if (period < 6) period = 6;
    else if (period > 50) period = 50;
    period = 0.2 * period + 0.8 * prevPeriod;
    smoothPeriod = 0.67 * smoothPeriod + 0.33 * period;

    // dominant cycle phase from a DFT of the smoothed price over one cycle
    prevDcPhase = dcPhase;
    const dcInt = smoothPeriod + 0.5 >= 0 ? Math.trunc(smoothPeriod + 0.5) : 0;
    let realPart = 0;
    let imagPart = 0;
    let idx = sIdx;
    for (let i = 0; i < dcInt; i++) {
      const ang = (i * twoPi) / dcInt;
      realPart += Math.sin(ang) * smooth[idx];
      imagPart += Math.cos(ang) * smooth[idx];
      idx = idx === 0 ? 49 : idx - 1;
    }
    const absImag = Math.abs(imagPart);
    if (absImag > 0) dcPhase = Math.atan(realPart / imagPart) * rad2Deg;
    else if (absImag <= 0.01) {
      if (realPart < 0) dcPhase -= 90;
      else if (realPart > 0) dcPhase += 90;
    }
    dcPhase += 90;
    dcPhase += 360 / smoothPeriod;
    if (imagPart < 0) dcPhase += 180;
    if (dcPhase > 315) dcPhase -= 360;
    prevSine = sine;
    prevLeadSine = leadSine;
    sine = Math.sin(dcPhase * deg2Rad);
    leadSine = Math.sin((dcPhase + 45) * deg2Rad);

    // instantaneous trendline: raw price averaged over one cycle, then a 4-bar WMA
    let avg = 0;
    for (let j = 0; j < Math.min(dcInt, 50); j++) avg += price[today - j];
    if (dcInt > 0) avg /= dcInt;
    const trendline = (2 * iTrend2 + (4 * avg + 3 * iTrend1) + iTrend3) / 10;
    iTrend3 = iTrend2;
    iTrend2 = iTrend1;
    iTrend1 = avg;

    let trend = 1;
    if ((sine > leadSine && prevSine <= prevLeadSine) || (sine < leadSine && prevSine >= prevLeadSine)) {
      daysInTrend = 0;
      trend = 0;
    }
    daysInTrend += 1;
    if (daysInTrend < 0.5 * smoothPeriod) trend = 0;
    const dPhase = dcPhase - prevDcPhase;
    if (smoothPeriod !== 0 && dPhase > (0.67 * 360) / smoothPeriod && dPhase < (1.5 * 360) / smoothPeriod) trend = 0;
    if (trendline !== 0 && Math.abs((smooth[sIdx] - trendline) / trendline) >= 0.015) trend = 1;

    if (today >= lookback) {
      out.period[today] = smoothPeriod;
      out.phase[today] = dcPhase;
      out.sine[today] = sine;
      out.leadSine[today] = leadSine;
      out.trendline[today] = trendline;
      out.trendMode[today] = trend;
    }
    sIdx = sIdx === 49 ? 0 : sIdx + 1;
    today++;
  }
  return out;
}
