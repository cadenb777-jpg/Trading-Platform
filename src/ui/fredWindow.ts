/** Opens any FRED series (yields, spreads, economic data) in a chart window with its full daily history. */
import { engineRequest } from '../data/schwab';
import { toast } from './dom';
import { openChartWindow } from './chartWindow';

/** Yield-curve labels → the FRED series behind them. */
export const CURVE_SERIES: Record<string, string> = { '1M': 'DGS1MO', '3M': 'DGS3MO', '6M': 'DGS6MO', '1Y': 'DGS1', '2Y': 'DGS2', '5Y': 'DGS5', '10Y': 'DGS10', '30Y': 'DGS30' };

const CURVE_NAMES: Record<string, string> = { DGS1MO: '1-month Treasury yield', DGS3MO: '3-month Treasury yield', DGS6MO: '6-month Treasury yield', DGS1: '1-year Treasury yield', DGS2: '2-year Treasury yield', DGS5: '5-year Treasury yield', DGS10: '10-year Treasury yield', DGS30: '30-year Treasury yield' };

export async function openFredWindow(id: string, name = CURVE_NAMES[id] ?? id, unit = '%') {
  toast(`Loading ${name}…`);
  try {
    const d = await engineRequest<{ data: { time: string; value: number }[]; date: string }>('macro.series', { series: id, raw: true, limit: 100000 }, 45000);
    const format = (v: number) => (unit === '%' ? `${v.toFixed(2)}%` : unit === '$' ? `$${v.toFixed(2)}` : Math.abs(v) >= 10000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
    openChartWindow({ title: name, subtitle: `FRED ${id} · latest ${d.date}`, lines: [{ name, color: '#2962ff', data: d.data }], format, changeAs: unit === '%' ? 'points' : 'percent' });
  } catch (err) {
    toast((err as Error).message);
  }
}
