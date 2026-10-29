/** The ⓘ window for an indicator: what it does, how to use it, and what it says right now on this chart. */
import { CATALOG_GUIDES } from '../indicators/catalog';
import { runInsight } from '../ai/insight';
import { INDICATOR_GUIDES } from '../indicators/info';
import type { IndicatorDef, IndicatorParams } from '../indicators/types';
import type { Bar } from '../types';
import { formatNumber, h, openModal } from './dom';

export interface IndicatorChartContext {
  symbol: string;
  timeframe: string;
  bars: Bar[];
  values: Record<string, number[]>;
  params: IndicatorParams;
  label: string;
}

const lastFinite = (arr: number[] | undefined) => {
  if (!arr) return NaN;
  for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i];
  return NaN;
};

/** Where the latest value sits among the last `n` values (0-100). */
function percentile(arr: number[], n = 250): number | null {
  const recent = arr.slice(-n).filter(Number.isFinite);
  if (recent.length < 20) return null;
  const last = recent[recent.length - 1];
  return (100 * recent.filter((v) => v <= last).length) / recent.length;
}

/** Plain-English reading of the indicator's current values on this chart. */
function reading(def: IndicatorDef, ctx: IndicatorChartContext): string[] {
  const out: string[] = [];
  const bars = ctx.bars;
  const close = bars[bars.length - 1]?.close;
  const plots = def.plots.filter((p) => p.type !== 'marker');
  const first = plots[0];
  if (!first || !bars.length) return out;
  const main = ctx.values[first.key] ?? [];
  const latest = lastFinite(main);
  if (!Number.isFinite(latest)) return ['Not enough data on this chart yet. Try a longer timeframe or wait for the data to load.'];

  if (def.placement === 'overlay') {
    for (const p of plots.slice(0, 3)) {
      const v = lastFinite(ctx.values[p.key]);
      if (!Number.isFinite(v) || !close) continue;
      const diff = (close / v - 1) * 100;
      out.push(`Price is ${Math.abs(diff).toFixed(2)}% ${diff >= 0 ? 'above' : 'below'} ${p.title} (${formatNumber(v)}).`);
    }
    const prev = main[main.length - 6];
    if (Number.isFinite(prev)) out.push(`${first.title} is ${latest > prev ? 'rising' : latest < prev ? 'falling' : 'flat'} over the last 5 bars.`);
  } else {
    out.push(`${first.title}: ${formatNumber(latest)}.`);
    const levels = def.levels ?? [];
    if (levels.length >= 2) {
      const hi = Math.max(...levels);
      const lo = Math.min(...levels);
      if (latest >= hi) out.push(`That’s at or above ${hi}: the "high" zone (overbought / crowded long).`);
      else if (latest <= lo) out.push(`That’s at or below ${lo}: the "low" zone (oversold / crowded short).`);
      else out.push(`That’s between ${lo} and ${hi}: a neutral reading.`);
    } else if (levels.length === 1) {
      out.push(`That’s ${latest >= levels[0] ? 'above' : 'below'} the ${levels[0]} line.`);
    }
    const prev = main[main.length - 4];
    if (Number.isFinite(prev)) out.push(`It is ${latest > prev ? 'rising' : latest < prev ? 'falling' : 'flat'} over the last 3 bars.`);
    const pct = percentile(main);
    if (pct != null) out.push(`It’s higher than ${pct.toFixed(0)}% of its readings on this chart. ${pct > 90 ? 'That’s unusually high for this stock.' : pct < 10 ? 'That’s unusually low for this stock.' : ''}`);
  }
  // How much this stock moves, to tailor settings.
  const ranges = bars.slice(-20).map((b) => (b.high - b.low) / b.close);
  const avgRange = (ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length)) * 100;
  if (Number.isFinite(avgRange)) {
    out.push(
      `${ctx.symbol} moves about ${avgRange.toFixed(2)}% per ${ctx.timeframe} bar lately. ${avgRange > 3 ? 'That’s volatile, so consider longer lengths or wider bands to cut false signals.' : avgRange < 0.5 ? 'That’s calm, so shorter lengths can react faster without much noise.' : ''}`,
    );
  }
  return out;
}

export function openIndicatorInfo(def: IndicatorDef, ctx?: IndicatorChartContext) {
  const guide = INDICATOR_GUIDES[def.id] ?? CATALOG_GUIDES[def.id];
  const aiPanel = h('section', { class: 'panel insight-panel', hidden: true });
  const body = h(
    'div',
    { class: 'ind-info' },
    h('p', { class: 'ind-what' }, guide?.what ?? def.description),
    guide ? h('div', { class: 'ind-cols' }, h('div', {}, h('h4', {}, 'How to use it'), h('ul', {}, ...guide.use.map((u) => h('li', {}, u)))), h('div', {}, h('h4', {}, 'Signals to watch'), h('ul', {}, ...guide.signals.map((u) => h('li', {}, u))))) : null,
    guide?.tip ? h('p', { class: 'callout' }, h('b', {}, 'Tip: '), guide.tip) : null,
    ctx
      ? h(
          'div',
          { class: 'ind-now' },
          h('h4', {}, `On ${ctx.symbol} right now (${ctx.timeframe})`),
          h('ul', {}, ...reading(def, ctx).map((r) => h('li', {}, r))),
          h(
            'button',
            {
              class: 'btn ai-btn',
              onclick: () => {
                const plots = def.plots.filter((p) => p.type !== 'marker');
                const recent = Object.fromEntries(plots.map((p) => [p.title, (ctx.values[p.key] ?? []).slice(-60).map((v) => (Number.isFinite(v) ? +v.toFixed(4) : null))]));
                runInsight(aiPanel, {
                  topic: 'indicator',
                  symbol: ctx.symbol,
                  timeframe: ctx.timeframe,
                  indicator: ctx.label,
                  title: `${ctx.label} on ${ctx.symbol}`,
                  data: { settings: ctx.params, levels: def.levels, recentValues: recent, recentCloses: ctx.bars.slice(-60).map((b) => +b.close.toFixed(4)), reading: reading(def, ctx) },
                });
              },
            },
            h('span', { class: 'ai-spark' }, '✦'),
            ` Ask AI how to use ${def.shortName} on ${ctx.symbol}`,
          ),
          aiPanel,
        )
      : h('p', { class: 'muted small' }, 'Add it to a chart and click its ⓘ in the legend to see what it says about that stock right now.'),
  );
  openModal(def.name, body, { wide: true });
}
