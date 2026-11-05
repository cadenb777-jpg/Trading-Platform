/** Connects the AI assistant's actions (actions.ts) to the real platform: state, chart page, alerts, drawings, theme. */
import { CHART_TYPES } from '../chart/ChartView';
import { getProvider } from '../data';
import { guessMarket, type MarketRef } from '../data/quotes';
import { allIndicators } from '../indicators/library';
import { loadDrawings, persist, saveDrawings, state } from '../state';
import { createPriceAlert, deleteHelperAlert, helperAlerts } from '../ui/alerts';
import { openChartWindow } from '../ui/chartWindow';
import { openSettings } from '../ui/settings';
import { currentTheme, setTheme } from '../ui/theme';
import type { ActionEnv } from './actions';

export interface EnvDeps {
  /** The chart page's sync() (null until the chart page is built: state is then read when it starts). */
  syncChart(): void;
  openChart(ref: MarketRef): void;
  navigate(route: string): void;
  currentRoute(): string;
  routes(): string[];
}

/**
 * The security view (another part of the platform) registers its opener here when it loads; until then the
 * action falls back to its route (#sec/SYMBOL/TAB) when that route exists.
 */
let securityOpener: ((symbol: string, tab?: string) => void) | null = null;
export function registerSecurityOpener(fn: (symbol: string, tab?: string) => void) {
  securityOpener = fn;
}

export function createActionEnv(deps: EnvDeps): ActionEnv {
  return {
    state,
    persist,
    syncChart: deps.syncChart,
    navigate: (route) => {
      location.hash = `#${route}`;
    },
    currentRoute: deps.currentRoute,
    routes: deps.routes,
    openChart: deps.openChart,
    guessMarket,
    indicators: allIndicators,
    newUid: () => Math.random().toString(36).slice(2, 10),
    chartTypes: CHART_TYPES.map((c) => c.id),
    async createAlert(ref, condition, price, note) {
      const before = new Set(helperAlerts().map((a) => a.id));
      const localBefore = new Set(state.alerts.map((a) => a.id));
      const where = await createPriceAlert(ref, condition, price, note);
      const undo = async () => {
        if (where === 'helper') {
          const added = helperAlerts().find((a) => !before.has(a.id) && a.symbol === ref.symbol);
          if (added) await deleteHelperAlert({ docId: added.id });
        } else {
          state.alerts = state.alerts.filter((a) => localBefore.has(a.id));
          persist();
        }
      };
      return { where, undo };
    },
    loadDrawings,
    saveDrawings,
    async compare(refs, timeframe) {
      const loaded = await Promise.all(refs.map((r) => getProvider(r.provider).loadHistory(r.symbol, timeframe, new AbortController().signal)));
      const colors = ['#2962ff', '#f7a600', '#26a69a'];
      openChartWindow({
        title: `${refs.map((r) => r.symbol).join(' vs ')} (${timeframe})`,
        subtitle: '% change from the first bar shown',
        format: (v) => `${v.toFixed(2)}%`,
        changeAs: 'points',
        lines: loaded.map((bars, i) => {
          const first = bars[0]?.close;
          return { name: refs[i].symbol, color: colors[i % colors.length], data: first ? bars.map((b) => ({ time: b.time, value: (b.close / first - 1) * 100 })) : [] };
        }),
      });
    },
    openSecurity(symbol, tab) {
      if (securityOpener) {
        securityOpener(symbol, tab);
        return 'opened';
      }
      if (!deps.routes().includes('sec')) return 'unavailable';
      location.hash = `#sec/${encodeURIComponent(symbol)}${tab ? `/${encodeURIComponent(tab)}` : ''}`;
      return 'routed';
    },
    runBacktest: () => window.dispatchEvent(new Event('tp:backtest-chart')),
    theme: currentTheme,
    setTheme,
    openSettings: (section) => void openSettings(section),
  };
}
