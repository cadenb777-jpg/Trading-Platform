/** The full chart screen: toolbar, drawing tools, chart with indicators, and watchlist. */
import { CHART_TYPES, ChartView, THEME, type ChartType } from '../chart/ChartView';
import { DRAWING_TOOLS, DrawingManager, type Tool } from '../chart/drawings';
import { SessionShading, isRegularHours, regularHoursOnly } from '../chart/session';
import { VolumeProfile } from '../chart/volumeProfile';
import { PROVIDERS, getProvider } from '../data';
import type { ConnectionStatus, ProviderId } from '../data/provider';
import { refKey, type MarketRef } from '../data/quotes';
import { getIndicator, indicatorLabel } from '../indicators/library';
import type { IndicatorDef } from '../indicators/types';
import { loadDrawings, newIndicatorInstance, onStateChange, persist, saveDrawings, state } from '../state';
import { TIMEFRAME_SECONDS, applyTrade, type Bar, type Timeframe } from '../types';
import { formatNumber, h, toast } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { openIndicatorPicker, openIndicatorSettings } from '../ui/indicatorDialogs';
import { openIndicatorInfo } from '../ui/indicatorInfo';
import { externalError } from '../indicators/external';
import { createTimeframePicker } from '../ui/timeframePicker';
import { activeAlertCount, openAlertsDialog } from '../ui/alerts';
import { createWatchlist, displaySymbol } from '../ui/watchlist';

const SYMBOL_SUGGESTIONS: Record<ProviderId, string[]> = {
  coinbase: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD', 'AVAX-USD', 'LINK-USD', 'LTC-USD'],
  schwab: ['$SPX', '$DJI', '$COMPX', 'SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AMD'],
};

const TOOL_ICONS: Record<Tool, IconName> = {
  cursor: 'cursor',
  trend: 'trend',
  ray: 'ray',
  hline: 'hline',
  vline: 'vline',
  rect: 'rect',
  fib: 'fib',
  long: 'long',
  short: 'short',
};

export function createChartPage() {
  const provider = () => getProvider(state.provider);
  const symbol = () => state.symbols[state.provider] ?? provider().defaultSymbol;
  const currentRef = (): MarketRef => ({ provider: state.provider, symbol: symbol() });

  // ---------- Layout ----------

  const marketSelect = h('select', { class: 'input market', 'aria-label': 'Market' }, ...PROVIDERS.map((p) => h('option', { value: p.id }, p.name)));
  const symbolInput = h('input', { class: 'input symbol', 'aria-label': 'Symbol', list: 'symbol-list', spellcheck: false, autocomplete: 'off' });
  const symbolList = h('datalist', { id: 'symbol-list' });
  const typeSelect = h(
    'select',
    { class: 'input chart-type', 'aria-label': 'Chart type', title: 'Chart type' },
    ...CHART_TYPES.map((t) => h('option', { value: t.id }, t.label)),
  );
  const priceEl = h('span', { class: 'price' });
  const statusEl = h('span', { class: 'status' });
  const chartEl = h('div', { class: 'chart' });
  const legendEl = h('div', { class: 'legend' });
  const messageEl = h('div', { class: 'chart-message', hidden: true });
  const chartWrap = h('main', { class: 'chart-wrap' }, chartEl, legendEl, messageEl);
  const drawBar = h('div', { class: 'draw-bar', role: 'toolbar', 'aria-label': 'Drawing tools' });
  const watchToggle = h('button', { class: 'icon-btn', title: 'Show or hide watchlist', 'aria-label': 'Toggle watchlist' }, icon('list', 22));
  const profileBtn = h('button', { class: 'btn fit-btn', title: 'Volume profile: volume traded at each price', 'aria-label': 'Volume profile' }, icon('profile', 18));
  const alertBtn = h('button', { class: 'btn fit-btn', title: 'Price alerts', 'aria-label': 'Price alerts' }, icon('bell', 18), h('span', { class: 'alert-count' }));
  const updateAlertCount = () => {
    const alerts = activeAlertCount(currentRef());
    alertBtn.querySelector('.alert-count')!.textContent = alerts ? ` ${alerts}` : '';
  };
  onStateChange(updateAlertCount);
  alertBtn.addEventListener('click', () => openAlertsDialog(currentRef(), bars[bars.length - 1]?.close ?? null));
  const extBtn = h('button', { class: 'btn fit-btn ext-btn', title: 'Extended hours: show pre-market (4:00-9:30 am ET) and after-hours (4-8 pm ET) trading on intraday stock charts. Shaded areas are outside regular hours.', 'aria-label': 'Extended hours' }, 'Ext');
  const fitBtn = h('button', { class: 'btn fit-btn', title: 'Fit the chart to the candles (F)', 'aria-label': 'Fit chart', onclick: () => chart?.fit() }, icon('fit', 18), ' Fit');
  const side = h('aside', { class: 'watch-side' });

  const tfPicker = createTimeframePicker({
    getCurrent: () => state.timeframe,
    getFavorites: () => state.favoriteTimeframes,
    onSelect: (tf) => setTimeframe(tf),
    onFavoritesChange: (favorites) => {
      state.favoriteTimeframes = favorites;
      persist();
    },
  });

  const el = h(
    'div',
    { class: 'chart-page' },
    h(
      'header',
      { class: 'toolbar' },
      marketSelect,
      symbolInput,
      symbolList,
      tfPicker.el,
      typeSelect,
      h('button', { class: 'btn', onclick: () => openIndicatorPicker(addIndicator) }, h('span', { class: 'fx' }, 'ƒx'), ' Indicators'),
      profileBtn,
      alertBtn,
      extBtn,
      fitBtn,
      h('span', { class: 'spacer' }),
      priceEl,
      statusEl,
      watchToggle,
    ),
    h('div', { class: 'chart-body' }, drawBar, chartWrap, side),
  );

  let chart: ChartView;
  let drawings: DrawingManager;
  let profile: VolumeProfile;
  let shading: SessionShading;
  /** Extended hours apply to intraday stock charts (Schwab), not crypto or daily bars. */
  const extendedApplies = () => provider().id === 'schwab' && TIMEFRAME_SECONDS[state.timeframe] < 86400;
  let started = false;

  // ---------- Toolbar ----------

  function renderToolbar() {
    marketSelect.value = state.provider;
    symbolInput.value = symbol();
    symbolInput.placeholder = provider().symbolPlaceholder;
    symbolList.replaceChildren(...SYMBOL_SUGGESTIONS[state.provider].map((s) => h('option', { value: s })));
    typeSelect.value = state.chartType;
    tfPicker.render();
    el.classList.toggle('watch-open', state.watchlistOpen);
    updateAlertCount();
  }

  marketSelect.addEventListener('change', () => {
    state.provider = marketSelect.value as ProviderId;
    persist();
    reload();
  });

  symbolInput.addEventListener('change', () => {
    const next = provider().normalizeSymbol(symbolInput.value);
    if (!next || next === symbol()) return (symbolInput.value = symbol());
    state.symbols[state.provider] = next;
    persist();
    reload();
  });
  symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && symbolInput.blur());
  symbolInput.addEventListener('focus', () => symbolInput.select());

  typeSelect.addEventListener('change', () => {
    state.chartType = typeSelect.value as ChartType;
    persist();
    chart.setChartType(state.chartType);
  });

  watchToggle.addEventListener('click', () => {
    state.watchlistOpen = !state.watchlistOpen;
    persist();
    renderToolbar();
  });

  function setTimeframe(tf: Timeframe) {
    state.timeframe = tf;
    persist();
    reload();
  }

  function setStatus(status: ConnectionStatus, message?: string) {
    const labels: Record<ConnectionStatus, string> = { connecting: 'Connecting…', live: 'Live', error: 'Offline', closed: 'Stopped' };
    statusEl.className = `status ${status}`;
    statusEl.textContent = labels[status];
    statusEl.title = message ?? labels[status];
  }

  // ---------- Drawing tools ----------

  function renderDrawBar() {
    drawBar.replaceChildren(
      ...DRAWING_TOOLS.map((t) =>
        h(
          'button',
          {
            class: `tool-btn${drawings.tool === t.id ? ' active' : ''}`,
            title: t.label,
            'aria-label': t.label,
            'aria-pressed': drawings.tool === t.id,
            onclick: () => drawings.setTool(drawings.tool === t.id ? 'cursor' : t.id),
          },
          icon(TOOL_ICONS[t.id], 24),
        ),
      ),
      h('span', { class: 'tool-sep' }),
      h(
        'button',
        {
          class: `tool-btn${drawings.magnet ? ' active' : ''}`,
          title: 'Magnet: snap to candle prices',
          'aria-label': 'Magnet',
          'aria-pressed': drawings.magnet,
          onclick: () => {
            drawings.magnet = !drawings.magnet;
            renderDrawBar();
          },
        },
        icon('magnet', 24),
      ),
      h(
        'button',
        {
          class: 'tool-btn',
          title: 'Delete selected drawing (or all drawings)',
          'aria-label': 'Delete drawings',
          onclick: () => {
            if (drawings.deleteSelected()) return;
            if (!drawings.drawings.length) return toast('No drawings on this chart');
            if (confirm(`Remove all ${drawings.drawings.length} drawings from ${displaySymbol(symbol())}?`)) drawings.clearAll();
          },
        },
        icon('trash', 24),
      ),
    );
  }

  document.addEventListener('keydown', (e) => {
    if (!started || el.hidden || (e.target as HTMLElement).closest('input, select, textarea, .modal')) return;
    if (drawings.handleKey(e)) e.preventDefault();
    else if (e.key === 'f' && !e.ctrlKey && !e.metaKey) chart.fit();
  });

  // ---------- Indicators ----------

  function addIndicator(def: IndicatorDef) {
    const instance = newIndicatorInstance(def);
    state.indicators.push(instance);
    persist();
    chart.addIndicator(instance);
    renderLegend();
  }

  function editIndicator(uid: string) {
    const instance = state.indicators.find((i) => i.uid === uid);
    const def = instance && getIndicator(instance.defId);
    if (!instance || !def) return;
    openIndicatorSettings(
      def,
      instance,
      state.timeframe,
      (updated) => {
        state.indicators = state.indicators.map((i) => (i.uid === uid ? updated : i));
        persist();
        chart.updateIndicator(updated);
        renderLegend();
      },
      () => removeIndicator(uid),
    );
  }

  function toggleIndicator(uid: string) {
    const instance = state.indicators.find((i) => i.uid === uid);
    if (!instance) return;
    instance.visible = !instance.visible;
    persist();
    chart.updateIndicator(instance);
    renderLegend();
  }

  function removeIndicator(uid: string) {
    state.indicators = state.indicators.filter((i) => i.uid !== uid);
    persist();
    chart.removeIndicator(uid);
    renderLegend();
  }

  // ---------- Legend (top-left of the chart and of each indicator pane) ----------

  let hoverIndex: number | null = null;

  function renderLegend() {
    const index = hoverIndex ?? chart.barCount - 1;
    const bar = chart.barAt(index);
    const prev = chart.barAt(index - 1);
    legendEl.replaceChildren();
    chartWrap.querySelectorAll(':scope > .pane-legend').forEach((n) => n.remove());

    const ohlc = h('div', { class: 'legend-row legend-title' }, h('b', {}, `${displaySymbol(symbol())} · ${state.timeframe} · ${provider().name}`));
    if (bar) {
      const color = bar.close >= bar.open ? THEME.up : THEME.down;
      const change = prev ? ((bar.close - prev.close) / prev.close) * 100 : 0;
      for (const [label, value] of [['O', bar.open], ['H', bar.high], ['L', bar.low], ['C', bar.close]] as const) {
        ohlc.append(h('span', { class: 'kv' }, label, h('span', { style: `color:${color}` }, formatNumber(value))));
      }
      ohlc.append(h('span', { style: `color:${color}` }, `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`));
    }
    legendEl.append(ohlc);

    for (const instance of state.indicators) {
      const def = getIndicator(instance.defId)!;
      const row = h(
        'div',
        { class: `legend-row indicator${instance.visible ? '' : ' hidden-ind'}` },
        h('span', { class: 'legend-name' }, indicatorLabel(def, instance)),
        def.external && externalError(def, symbol()) ? h('span', { class: 'legend-error', title: externalError(def, symbol()) }, `unavailable: ${externalError(def, symbol())}`) : null,
        ...chart
          .valuesAt(instance.uid, index)
          .map((v) => h('span', { class: 'legend-value', style: `color:${v.color}`, title: v.title }, formatNumber(v.value))),
        h(
          'span',
          { class: 'legend-actions' },
          h('button', { class: 'mini-btn', title: 'What is this and what is it saying?', onclick: () => showIndicatorInfo(instance.uid) }, 'ⓘ'),
          h('button', { class: 'mini-btn', title: instance.visible ? 'Hide' : 'Show', onclick: () => toggleIndicator(instance.uid) }, instance.visible ? '👁' : '◌'),
          h('button', { class: 'mini-btn', title: 'Settings', onclick: () => editIndicator(instance.uid) }, '⚙'),
          h('button', { class: 'mini-btn', title: 'Remove', onclick: () => removeIndicator(instance.uid) }, '✕'),
        ),
      );
      if (chart.isSeparatePane(instance.uid)) {
        row.classList.add('pane-legend');
        row.style.top = `${chart.paneTop(instance.uid) + 4}px`;
        chartWrap.append(row);
      } else {
        legendEl.append(row);
      }
    }
  }

  function showIndicatorInfo(uid: string) {
    const instance = state.indicators.find((i) => i.uid === uid);
    const def = instance && getIndicator(instance.defId);
    const snap = chart.indicatorSnapshot(uid);
    if (!instance || !def) return;
    openIndicatorInfo(def, snap ? { symbol: displaySymbol(symbol()), timeframe: state.timeframe, bars: snap.bars, values: snap.values, params: instance.params, label: indicatorLabel(def, instance) } : undefined);
  }

  // ---------- Data loading and live updates ----------

  let bars: Bar[] = [];
  let stopLive: () => void = () => {};
  let loadController: AbortController | null = null;
  let pendingFrom: number | null = null;
  let waitingForTrades = false;

  function showMessage(text: string | null, actions: Node[] = []) {
    messageEl.hidden = !text;
    messageEl.replaceChildren(...(text ? [h('p', {}, text), h('div', { class: 'message-actions' }, ...actions)] : []));
  }

  function flushLive() {
    if (pendingFrom === null) return;
    chart.updateFrom(pendingFrom);
    pendingFrom = null;
    if (waitingForTrades) {
      waitingForTrades = false;
      showMessage(null);
    }
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    if (last) {
      priceEl.textContent = formatNumber(last.close);
      priceEl.className = `price ${prev && last.close < prev.close ? 'down' : 'up'}`;
    }
    if (hoverIndex === null) renderLegend();
  }

  async function reload() {
    stopLive();
    pendingFrom = null;
    waitingForTrades = false;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    renderToolbar();
    watchlist.render();
    setStatus('connecting');
    showMessage(null);
    priceEl.textContent = '';
    const p = provider();
    const sym = symbol();
    const tf = state.timeframe;
    const drawingsKey = refKey(currentRef());
    document.title = `${displaySymbol(sym)} · Trading Platform`;

    chart.symbol = sym;
    try {
      bars = await p.loadHistory(sym, tf, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      bars = [];
      chart.setBars(bars, tf);
      drawings.setDrawings([]);
      renderLegend();
      setStatus('error', (err as Error).message);
      showMessage(`Couldn't load ${displaySymbol(sym)}: ${(err as Error).message}`, [h('button', { class: 'btn primary', onclick: reload }, 'Try again')]);
      return;
    }
    if (controller.signal.aborted) return;
    const ext = extendedApplies();
    if (ext && !state.extendedHours) bars = regularHoursOnly(bars);
    extBtn.hidden = !ext;
    extBtn.classList.toggle('on', state.extendedHours);
    shading.setEnabled(ext && state.extendedHours);

    chart.setBars(bars, tf);
    drawings.setDrawings(loadDrawings(drawingsKey));
    drawings.onChange = (list) => saveDrawings(drawingsKey, list);
    priceEl.textContent = bars.length ? formatNumber(bars[bars.length - 1].close) : '';
    renderLegend();
    if (!bars.length && TIMEFRAME_SECONDS[tf] < 60) {
      waitingForTrades = true;
      showMessage('Waiting for trades… Second charts have no history, so they build live from now on.');
    }

    stopLive = p.subscribe(
      sym,
      {
        onTrade: (trade) => {
          if (extendedApplies() && !state.extendedHours && !isRegularHours(trade.time)) return;
          const result = applyTrade(bars, tf, trade.price, trade.size, trade.time);
          if (!result) return;
          const index = bars.length - 1;
          if (pendingFrom === null) requestAnimationFrame(flushLive);
          pendingFrom = Math.min(pendingFrom ?? index, index);
        },
        onStatus: setStatus,
      },
      bars[bars.length - 1]?.close ?? 100,
    );
  }

  const watchlist = createWatchlist({
    onSelect: (ref) => open(ref),
    isActive: (ref) => refKey(ref) === refKey(currentRef()),
  });
  side.append(watchlist.el);

  // ---------- Public ----------

  // On narrow screens the watchlist covers the chart, so keep it closed until asked for.
  const narrow = () => window.matchMedia('(max-width: 1000px)').matches;

  function start() {
    if (started) return;
    started = true;
    if (narrow()) state.watchlistOpen = false;
    chart = new ChartView(chartEl);
    chart.setChartType(state.chartType);
    drawings = new DrawingManager(chart, chartWrap);
    profile = new VolumeProfile(chart);
    shading = new SessionShading(chart);
    extBtn.addEventListener('click', () => {
      state.extendedHours = !state.extendedHours;
      persist();
      reload();
    });
    profile.setEnabled(state.volumeProfile);
    profileBtn.classList.toggle('on', state.volumeProfile);
    profileBtn.addEventListener('click', () => {
      state.volumeProfile = !state.volumeProfile;
      persist();
      profile.setEnabled(state.volumeProfile);
      profileBtn.classList.toggle('on', state.volumeProfile);
    });
    drawings.onToolChange = renderDrawBar;
    renderDrawBar();
    for (const instance of state.indicators) chart.addIndicator(instance);
    chart.onHover = (index) => {
      hoverIndex = index >= chart.barCount - 1 ? null : index;
      renderLegend();
    };
    chart.onLayout = renderLegend;
    chart.onDataError = (message) => showMessage(message, [h('button', { class: 'btn primary', onclick: reload }, 'Try again')]);
    reload();
  }

  /** Shows a symbol, e.g. when clicked in a watchlist. */
  function open(ref: MarketRef) {
    state.provider = ref.provider;
    state.symbols[ref.provider] = ref.symbol;
    if (narrow()) state.watchlistOpen = false;
    persist();
    if (started) reload();
  }

  /** Adds an indicator by id, e.g. a script from the Scripts page. */
  function addIndicatorById(defId: string) {
    const def = getIndicator(defId);
    if (!def) return;
    if (started) addIndicator(def);
    else {
      state.indicators.push(newIndicatorInstance(def));
      persist();
    }
  }

  /** Redraws indicators of one type after its script was edited or deleted. */
  function refreshIndicatorsFor(defId: string) {
    const def = getIndicator(defId);
    if (!def) state.indicators = state.indicators.filter((i) => i.defId !== defId);
    persist();
    if (!started) return;
    for (const instance of state.indicators.filter((i) => i.defId === defId)) {
      chart.removeIndicator(instance.uid);
      chart.addIndicator(instance);
    }
    // Indicators removed because their script was deleted.
    chart.removeMissingIndicators(new Set(state.indicators.map((i) => i.uid)));
    renderLegend();
  }

  return { el, start, open, addIndicatorById, refreshIndicatorsFor };
}
