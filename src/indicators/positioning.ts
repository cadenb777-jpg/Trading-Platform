/** Indicators built from positioning data outside the chart: futures traders (COT) and short selling (FINRA). */
import { alignExternal, loadCot, loadShortVolume } from './external';
import { sma } from './math';
import type { ExternalPoint, IndicatorDef } from './types';

/**
 * Larry Williams' COT Index: where each group's net position sits in its range over the last `weeks` reports
 * (0 = most bearish of the period, 100 = most bullish).
 */
export function williamsCotIndex(points: ExternalPoint[], field: string, weeks: number): number[] {
  const values = points.map((p) => p.values[field]);
  return values.map((v, i) => {
    if (i < weeks - 1 || !Number.isFinite(v)) return NaN;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - weeks + 1; j <= i; j++) {
      const x = values[j];
      if (Number.isFinite(x)) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    return hi > lo ? (100 * (v - lo)) / (hi - lo) : 50;
  });
}


export const POSITIONING_INDICATORS: IndicatorDef[] = [
  {
    id: 'cot',
    name: 'COT positioning (related futures)',
    shortName: 'COT',
    category: 'Positioning',
    description: 'How big speculators and hedgers are positioned in the futures market this symbol moves with (e.g. NVDA → Nasdaq-100), as a 0-100 three-year index.',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'spec', title: 'Speculators', type: 'line', color: '#2962ff', lineWidth: 2 },
      { key: 'comm', title: 'Hedgers', type: 'line', color: '#ff9800', lineWidth: 2 },
    ],
    levels: [20, 50, 80],
    external: { load: loadCot },
    compute(bars, _params, external) {
      return { spec: alignExternal(bars, external, 'spec'), comm: alignExternal(bars, external, 'comm') };
    },
  },
  {
    id: 'williamscot',
    name: 'Williams COT Index',
    shortName: 'W-COT',
    category: 'Positioning',
    description: 'Larry Williams’ COT Index: commercials (hedgers), large speculators and small traders, each scaled 0-100 over the last 26 weekly reports. Commercials above 75 = bullish setup; below 25 = bearish.',
    placement: 'separate',
    inputs: [{ key: 'weeks', label: 'Look-back (weekly reports)', type: 'number', default: 26, min: 4, max: 260 }],
    plots: [
      { key: 'comm', title: 'Commercials', type: 'line', color: '#26a69a', lineWidth: 2 },
      { key: 'large', title: 'Large specs', type: 'line', color: '#ef5350', lineWidth: 1 },
      { key: 'small', title: 'Small traders', type: 'line', color: '#ffb300', lineWidth: 1 },
    ],
    levels: [25, 50, 75],
    external: { load: loadCot },
    compute(bars, params, external) {
      const pts = external ?? [];
      const weeks = Number(params.weeks);
      const comm = williamsCotIndex(pts, 'commNet', weeks);
      const large = williamsCotIndex(pts, 'specNet', weeks);
      const small = williamsCotIndex(pts, 'smallNet', weeks);
      const withIdx = pts.map((p, i) => ({ time: p.time, values: { comm: comm[i], large: large[i], small: small[i] } }));
      return { comm: alignExternal(bars, withIdx, 'comm'), large: alignExternal(bars, withIdx, 'large'), small: alignExternal(bars, withIdx, 'small') };
    },
  },
  {
    id: 'shortvol',
    name: 'Short volume % (FINRA)',
    shortName: 'Short vol',
    category: 'Positioning',
    description: 'Share of each day’s trading volume that was short selling, with its average. Spikes show heavy selling pressure (or market makers hedging buyers).',
    placement: 'separate',
    inputs: [{ key: 'length', label: 'Average length (days)', type: 'number', default: 10, min: 2, max: 60 }],
    plots: [
      { key: 'ratio', title: 'Short %', type: 'line', color: '#ef5350', lineWidth: 1 },
      { key: 'avg', title: 'Average', type: 'line', color: '#8a8f9c', lineWidth: 2 },
    ],
    levels: [50],
    external: { load: loadShortVolume },
    compute(bars, params, external) {
      const daily = (external ?? []).map((p) => p.values.ratio);
      const avgDaily = sma(daily, Number(params.length));
      const withAvg = (external ?? []).map((p, i) => ({ time: p.time, values: { ...p.values, avg: avgDaily[i] } }));
      return { ratio: alignExternal(bars, withAvg, 'ratio'), avg: alignExternal(bars, withAvg, 'avg') };
    },
  },
];
