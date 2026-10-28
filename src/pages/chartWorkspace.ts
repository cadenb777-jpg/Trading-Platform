/**
 * The Chart page with its modes: Chart | Multi | Scripts (#chart, #chart/multi, #chart/scripts). Multi-chart and the
 * script editor used to be pages of their own (#multi and #scripts still redirect here). The mode tabs sit at the
 * start of each mode's own toolbar, so the chart keeps its height. Multi and Scripts are built on first use.
 */
import type { MarketRef } from '../data/quotes';
import { CHART_MODES, type ChartMode } from '../routes';
import { h } from '../ui/dom';
import type { createChartPage } from './chartPage';

interface Mode {
  el: HTMLElement;
  start(): void;
  stop?(): void;
}

const LABELS: Record<ChartMode, string> = { chart: 'Chart', multi: 'Workspace', scripts: 'Scripts' };
const TITLES: Record<ChartMode, string> = { chart: 'One chart with indicators and drawings', multi: 'Workspace: up to six linked panels (charts, quote, news, facts, my position)', scripts: 'Write your own indicators (Pine-style scripts)' };

export function createChartWorkspace(chart: ReturnType<typeof createChartPage>, openChart: (ref: MarketRef) => void, openResearch: (symbol: string) => void) {
  const el = h('div', { class: 'chart-ws' });
  const links = CHART_MODES.map((m) =>
    h('a', { class: 'tab', href: m === 'chart' ? '#chart' : `#chart/${m}`, 'data-mode': m, title: TITLES[m] }, LABELS[m]),
  );
  const tabs = h('nav', { class: 'tabs chart-ws-tabs', 'aria-label': 'Chart mode' }, ...links);
  const modes: Partial<Record<ChartMode, Mode>> = { chart };
  const loading: Partial<Record<ChartMode, Promise<Mode>>> = {};
  let current: ChartMode = 'chart';
  let request = 0;

  async function build(m: ChartMode): Promise<Mode> {
    if (modes[m]) return modes[m]!;
    loading[m] ??= (async () => {
      const mode: Mode =
        m === 'multi'
          ? (await import('./workspacePage')).createWorkspacePage({ openChart, openResearch })
          : (await import('./scriptsPage')).createScriptsPage({
              onAddToChart: (defId) => {
                chart.addIndicatorById(defId);
                location.hash = '#chart';
              },
              onScriptSaved: (defId) => chart.refreshIndicatorsFor(defId),
            });
      mode.el.hidden = true;
      el.append(mode.el);
      modes[m] = mode;
      return mode;
    })();
    return loading[m]!;
  }
  chart.el.hidden = true;
  el.append(chart.el);

  /** The toolbar each mode's tabs go into (the first one in its header). */
  const headerOf = (m: Mode) => m.el.querySelector<HTMLElement>('.toolbar, .script-toolbar') ?? m.el;

  async function show(m: ChartMode) {
    const mine = ++request;
    const mode = await build(m);
    if (mine !== request) return;
    current = m;
    for (const [k, v] of Object.entries(modes) as [ChartMode, Mode][]) {
      v.el.hidden = k !== m;
      if (k !== m) v.stop?.();
    }
    headerOf(mode).prepend(tabs);
    for (const a of links) {
      const on = a.dataset.mode === m;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = m === 'chart' ? document.title : `${m === 'multi' ? 'Workspace' : 'Scripts'} · Trading Platform`;
    mode.start();
  }

  return {
    el,
    /** Shows a mode: '' or 'chart' for the chart, 'multi', 'scripts'. */
    start(sub = '') {
      void show((CHART_MODES as readonly string[]).includes(sub) ? (sub as ChartMode) : 'chart');
    },
    stop() {
      request++;
      modes[current]?.stop?.();
    },
  };
}
