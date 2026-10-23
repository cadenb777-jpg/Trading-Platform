/** Indicators built from positioning data outside the chart: futures traders (COT) and short selling (FINRA). */
import { alignExternal, loadCot, loadShortVolume } from './external';
import { sma } from './math';
import type { IndicatorDef } from './types';

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
    id: 'shortvol',
    name: 'Short volume % (FINRA)',
    shortName: 'Short vol',
    category: 'Positioning',
    description: 'Share of each day’s trading volume that was short selling, with its average. Spikes show heavy selling pressure (or market makers hedging buyers).',
    placement: 'separate',
    inputs: [{ key: 'length', label: 'Average length (days)', type: 'number', default: 10, min: 2, max: 60 }],
    plots: [
      { key: 'ratio', title: 'Short %', type: 'line', color: '#ef5350', lineWidth: 1 },
      { key: 'avg', title: 'Average', type: 'line', color: '#e1e4ea', lineWidth: 2 },
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
