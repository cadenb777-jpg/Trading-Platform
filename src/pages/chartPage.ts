/** The full chart screen: toolbar, drawing tools, chart with indicators, and watchlist. */
import { CHART_TYPES, ChartView, THEME, type ChartType } from '../chart/ChartView';
import { DRAWING_TOOLS, DrawingManager, type Tool } from '../chart/drawings';
import { getClock, setClock } from '../chart/clock';
import { SessionShading, isRegularHours, regularHoursOnly } from '../chart/session';
import { VolumeProfile } from '../chart/volumeProfile';
import { PROVIDERS, getProvider } from '../data';
import type { ConnectionStatus, ProviderId } from '../data/provider';
import { guessMarket, refKey, type MarketRef } from '../data/quotes';
import { getIndicator, indicatorLabel } from '../indicators/library';
import type { IndicatorDef } from '../indicators/types';
import { loadDrawings, newIndicatorInstance, onStateChange, persist, saveDrawings, state } from '../state';
import { TIMEFRAME_SECONDS, applyTrade, type Bar, type Timeframe } from '../types';
import { formatNumber, h, toast } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { openIndicatorManager, openIndicatorSettings } from '../ui/indicatorDialogs';
import { openIndicatorInfo } from '../ui/indicatorInfo';
import { externalError } from '../indicators/external';
import { createTimeframePicker } from '../ui/timeframePicker';
import { activeAlertCount, onAlertsChange, openAlertsDialog } from '../ui/alerts';
import { createWatchlist, displaySymbol } from '../ui/watchlist';
import { linkPanel } from '../ui/linkGroups';
import { frameBatch, latestPerFrame } from '../chart/frame';
import { HoverCard, type CardNote, type CardRow } from '../chart/hoverCard';
import type { PointerInfo } from '../chart/ChartView';
import { INDICATOR_GUIDES } from '../indicators/info';
import { CATALOG_GUIDES } from '../indicators/catalog';
import { createSecurityHeader } from '../chart/securityHeader';
import { createRangeBar } from '../chart/rangeBar';
import { LegendBox } from '../chart/legendBox';
import { createChartState } from '../chart/chartState';
import { daySummary } from '../chart/summary';
import { marketTimeZone } from '../chart/range';

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
  const header = createSecurityHeader();
  const chartState = createChartState();
  const statusEl = h('span', { class: 'status' });
  const chartEl = h('div', { class: 'chart' });
  const legendEl = h('div', { class: 'legend' });
  const messageEl = h('div', { class: 'chart-message', hidden: true });
  const chartWrap = h('div', { class: 'chart-wrap' }, chartEl, legendEl, chartState.el, messageEl);
  const drawBar = h('div', { class: 'draw-bar', role: 'toolbar', 'aria-label': 'Drawing tools' });
  const watchToggle = h('button', { class: 'icon-btn', title: 'Show or hide watchlist', 'aria-label': 'Toggle watchlist' }, icon('list', 22));
  const profileBtn = h('button', { class: 'btn fit-btn', title: 'Volume profile: volume traded at each price', 'aria-label': 'Volume profile' }, icon('profile', 18));
  const alertBtn = h('button', { class: 'btn fit-btn', title: 'Price alerts', 'aria-label': 'Price alerts' }, icon('bell', 18), h('span', { class: 'alert-count' }));
  const updateAlertCount = () => {
    const alerts = activeAlertCount(currentRef());
    alertBtn.querySelector('.alert-count')!.textContent = alerts ? ` ${alerts}` : '';
  };
  onStateChange(updateAlertCount);
  onAlertsChange(updateAlertCount);
  alertBtn.addEventListener('click', () => openAlertsDialog(currentRef(), bars[bars.length - 1]?.close ?? null));
  const extBtn = h('button', { class: 'btn fit-btn ext-btn', title: 'Extended hours: show pre-market (4:00-9:30 am ET) and after-hours (4-8 pm ET) trading on intraday stock charts. Shading: pre-market blue, after-hours copper, overnight grey; the open (green) and close (red) times are marked on the time axis.', 'aria-label': 'Extended hours' }, 'Ext');
  // 12- or 24-hour times on every chart's time axis, crosshair and legend (src/chart/clock.ts)
  const clockBtn = h('button', { class: 'btn fit-btn clock-btn', title: 'Clock: switch chart times between 12-hour (2:30 PM) and 24-hour (14:30)', 'aria-label': `Clock: ${getClock()}` }, getClock());
  clockBtn.addEventListener('click', () => {
    setClock(getClock() === '12h' ? '24h' : '12h');
    clockBtn.textContent = getClock();
    clockBtn.setAttribute('aria-label', `Clock: ${getClock()}`);
  });
  const fitBtn = h('button', { class: 'btn fit-btn', title: 'Fit the chart to the candles (F)', 'aria-label': 'Fit chart', onclick: () => chart?.fit() }, icon('fit', 18));
  const side = h('aside', { class: 'watch-side' });
  // the chart's link chip: other panels of its colour follow its symbol, and it follows theirs
  const link = linkPanel({
    id: 'chart',
    label: 'Chart',
    el: chartWrap,
    accepts: (s) => !s.startsWith('/') && !!guessMarket(s),
    apply: (s) => show(guessMarket(s)!),
    active: () => started && !el.hidden,
  });
  chartWrap.dataset.linkKeys = 'own'; // its letters are its own (f fits); the command bar is / here

  /** Extra history the range bar asked for on the next load. */
  let forcedDays: number | undefined;
  const rangeBar = createRangeBar({
    view: () => (started ? chart : null),
    timeframe: () => state.timeframe,
    maxDays: () => provider().maxHistoryDays(state.timeframe),
    reload: (days) => {
      forcedDays = days;
      reload();
    },
  });

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
      link.chip,
      marketSelect,
      symbolInput,
      symbolList,
      tfPicker.el,
      rangeBar.el,
      typeSelect,
      h('button', { class: 'btn', onclick: openManager }, h('span', { class: 'fx' }, 'ƒx'), ' Indicators'),
      profileBtn,
      alertBtn,
      extBtn,
      clockBtn,
      fitBtn,
      h('button', { class: 'btn fit-btn', title: 'Backtest this chart: a strategy from its symbol, timeframe and indicators', 'aria-label': 'Backtest this chart', onclick: () => window.dispatchEvent(new Event('tp:backtest-chart')) }, icon('backtest', 18)),
      h('span', { class: 'spacer' }),
      statusEl,
      watchToggle,
    ),
    header.el,
    h('div', { class: 'chart-body' }, drawBar, chartWrap, side),
  );

  let chart: ChartView;
  let drawings: DrawingManager;
  let profile: VolumeProfile;
  let shading: SessionShading;
  /** Extended hours apply to intraday stock charts (Schwab), not crypto or daily bars. */
  const extendedApplies = () => provider().id === 'schwab' && TIMEFRAME_SECONDS[state.timeframe] < 86400;
  let started = false;
  let legendBox: LegendBox;
  /** The symbol/timeframe the chart last finished drawing (the loading card shows only for something new). */
  let shownKey = '';
  /** What the chart last loaded (market:symbol:timeframe:extended), so sync() knows when to reload. */
  let loadedKey = '';

  // ---------- Toolbar ----------

  function renderToolbar() {
    marketSelect.value = state.provider;
    symbolInput.value = symbol();
    symbolInput.placeholder = provider().symbolPlaceholder;
    symbolList.replaceChildren(...SYMBOL_SUGGESTIONS[state.provider].map((s) => h('option', { value: s })));
    typeSelect.value = state.chartType;
    tfPicker.render();
    rangeBar.render();
    el.classList.toggle('watch-open', state.watchlistOpen);
    updateAlertCount();
  }

  marketSelect.addEventListener('change', () => {
    state.provider = marketSelect.value as ProviderId;
    persist();
    reload();
    link.publish(symbol());
  });

  symbolInput.addEventListener('change', () => {
    const next = provider().normalizeSymbol(symbolInput.value);
    if (!next || next === symbol()) return (symbolInput.value = symbol());
    state.symbols[state.provider] = next;
    persist();
    reload();
    link.publish(next);
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
    // While drawing, the crosshair follows the mouse exactly unless the drawing magnet is on.
    chart.setCrosshairMagnet(drawings.tool === 'cursor' || drawings.magnet);
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
    if (!started || el.hidden || (e.target instanceof Element && e.target.closest('input, select, textarea, .modal'))) return;
    if (drawings.handleKey(e)) e.preventDefault();
    else if (e.key === 'f' && !e.ctrlKey && !e.metaKey) chart.fit();
  });

  // ---------- Indicators ----------

  let manager: { refresh: () => void } | null = null;
  function openManager() {
    const m = openIndicatorManager({
      list: () => state.indicators,
      label: (i) => indicatorLabel(getIndicator(i.defId)!, i),
      add: addIndicator,
      edit: editIndicator,
      toggle: toggleIndicator,
      remove: removeIndicator,
      togglePlot,
    });
    manager = m;
  }

  /** After any indicator change: redraw the legend and the manager window if it's open. */
  function indicatorsChanged() {
    renderLegend();
    legendBox.schedule();
    if (manager && document.querySelector('.mgr')) manager.refresh();
    else manager = null;
  }

  function addIndicator(def: IndicatorDef) {
    const instance = newIndicatorInstance(def);
    state.indicators.push(instance);
    persist();
    chart.addIndicator(instance);
    indicatorsChanged();
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
        indicatorsChanged();
      },
      () => removeIndicator(uid),
    );
  }

  function togglePlot(uid: string, key: string) {
    const instance = state.indicators.find((i) => i.uid === uid);
    if (!instance) return;
    const hidden = new Set(instance.hiddenPlots ?? []);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    instance.hiddenPlots = [...hidden];
    persist();
    chart.updateIndicator(instance);
    indicatorsChanged();
  }

  function toggleIndicator(uid: string) {
    const instance = state.indicators.find((i) => i.uid === uid);
    if (!instance) return;
    instance.visible = !instance.visible;
    persist();
    chart.updateIndicator(instance);
    indicatorsChanged();
  }

  function removeIndicator(uid: string) {
    state.indicators = state.indicators.filter((i) => i.uid !== uid);
    persist();
    chart.removeIndicator(uid);
    indicatorsChanged();
  }

  // ---------- Legend (top-left of the chart and of each indicator pane) ----------

  let hoverIndex: number | null = null;
  // The legend is rebuilt only when its layout changes (indicators, visibility, panes). Live prices and the
  // crosshair just update the numbers in place, so the buttons stay put under the mouse.
  let legendLayout = '';
  let legendValues: { uid: string; spans: HTMLElement[]; nums: (HTMLElement | null)[]; row: HTMLElement }[] = [];
  let ohlcValues: HTMLElement | null = null;
  let ohlcNums: HTMLElement[] = [];

  const legendBtn = (iconName: IconName, title: string, onclick: () => void, extra = '') =>
    h('button', { class: `legend-btn${extra}`, title, 'aria-label': title, onclick: (e: Event) => (e.stopPropagation(), onclick()) }, icon(iconName, 16));

  function renderLegend() {
    const index = hoverIndex ?? chart.barCount - 1;
    const layout = JSON.stringify([
      symbol(),
      state.timeframe,
      state.indicators.map((i) => [i.uid, i.visible, i.hiddenPlots ?? [], indicatorLabel(getIndicator(i.defId)!, i), chart.isSeparatePane(i.uid) ? chart.paneTop(i.uid) : -1, externalError(getIndicator(i.defId)!, symbol()) ?? '']),
    ]);
    if (layout !== legendLayout) buildLegend(layout);
    updateLegendValues(index);
  }

  function buildLegend(layout: string) {
    legendLayout = layout;
    legendBox.title.replaceChildren();
    legendBox.rows.replaceChildren();
    chartWrap.querySelectorAll(':scope > .pane-legend').forEach((n) => n.remove());
    ohlcNums = [0, 1, 2, 3, 4].map(() => h('span', { class: 'legend-num' }));
    ohlcValues = h('span', { class: 'legend-ohlc' }, ...['O', 'H', 'L', 'C'].map((label, i) => h('span', { class: 'kv' }, label, ohlcNums[i])), ohlcNums[4]);
    legendBox.title.append(h('div', { class: 'legend-row legend-title' }, h('b', {}, `${displaySymbol(symbol())} · ${state.timeframe} · ${provider().name}`), ohlcValues));
    legendValues = [];
    for (const instance of state.indicators) {
      const def = getIndicator(instance.defId)!;
      const error = def.external && externalError(def, symbol());
      const spans = chart.valuesAt(instance.uid, chart.barCount - 1).map((v) =>
        h(
          'button',
          {
            class: `legend-value${v.hidden ? ' off' : ''}`,
            style: `--c:${v.color}`,
            title: `${v.title}: click to ${v.hidden ? 'show' : 'hide'} this line`,
            onclick: (e: Event) => (e.stopPropagation(), togglePlot(instance.uid, v.key)),
          },
          h('i', {}),
          h('span', { class: 'legend-num' }),
        ),
      );
      const row = h(
        'div',
        {
          class: `legend-row indicator${instance.visible ? '' : ' hidden-ind'}`,
          // Hovering a legend row lifts its lines on the chart and dims the rest.
          onpointerenter: () => hoverLegend(instance.uid),
          onpointerleave: () => hoverLegend(null),
        },
        h('button', { class: 'legend-name', title: 'Settings', onclick: () => editIndicator(instance.uid) }, indicatorLabel(def, instance)),
        error ? h('span', { class: 'legend-error', title: error }, `unavailable: ${error}`) : null,
        ...spans,
        h(
          'span',
          { class: 'legend-actions' },
          legendBtn(instance.visible ? 'eye' : 'eyeOff', instance.visible ? 'Hide indicator' : 'Show indicator', () => toggleIndicator(instance.uid)),
          legendBtn('gear', 'Settings: inputs, colours, lines', () => editIndicator(instance.uid)),
          legendBtn('info', 'What is this and what is it saying?', () => showIndicatorInfo(instance.uid)),
          legendBtn('trash', 'Remove from chart', () => removeIndicator(instance.uid), ' danger'),
        ),
      );
      legendValues.push({ uid: instance.uid, spans, nums: spans.map((s) => s.querySelector('.legend-num')), row });
      if (chart.isSeparatePane(instance.uid)) {
        row.classList.add('pane-legend');
        row.style.top = `${chart.paneTop(instance.uid) + 4}px`;
        chartWrap.append(row);
      } else {
        legendBox.rows.append(row);
      }
    }
  }

  const setText = (el: HTMLElement | null | undefined, text: string) => {
    if (el && el.textContent !== text) el.textContent = text;
  };

  /** Updates the legend's numbers in place (no DOM rebuild), so it costs almost nothing per frame. */
  function updateLegendValues(index: number) {
    const bar = chart.barAt(index);
    const prev = chart.barAt(index - 1);
    if (ohlcValues) {
      // The bar under the crosshair; at rest the header row already shows the day.
      ohlcValues.hidden = !bar || hoverIndex === null;
      if (bar) {
        ohlcValues.style.setProperty('--c', bar.close >= bar.open ? THEME.up : THEME.down);
        const change = prev ? ((bar.close - prev.close) / prev.close) * 100 : 0;
        [bar.open, bar.high, bar.low, bar.close].forEach((v, i) => setText(ohlcNums[i], formatNumber(v)));
        setText(ohlcNums[4], `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`);
      }
    }
    // On the latest bar an indicator may not have caught up yet (it follows ticks a little behind, or is still in the
    // worker): keep its last number until onValues brings the new one, instead of blanking to a dash.
    const latest = index >= chart.barCount - 1;
    for (const { uid, nums } of legendValues) {
      chart.valuesAt(uid, index).forEach((v, i) => {
        if (latest && !Number.isFinite(v.value) && nums[i]?.textContent) return;
        setText(nums[i], legendNumber(v.value));
      });
    }
  }

  // ---------- Hover: highlight, crosshair card, signals explained ----------

  /**
   * Legend hover focuses one indicator (others dim); resting the cursor on a line only lifts that line and lights its
   * legend row. Restyling makes the library rebuild series, so chart hovers wait for the cursor to settle.
   */
  let highlighted = '';
  let legendHovered: string | null = null;
  let lineTimer: ReturnType<typeof setTimeout> | undefined;
  function setHighlight(uid: string | null, dimOthers: boolean) {
    const key = uid === null ? '' : `${uid}:${dimOthers}`;
    if (key === highlighted) return;
    highlighted = key;
    chart.highlight(uid, dimOthers);
    for (const l of legendValues) l.row.classList.toggle('lit', l.uid === uid);
    chartWrap.classList.toggle('has-lit', uid !== null && dimOthers);
  }
  function hoverLegend(uid: string | null) {
    legendHovered = uid;
    clearTimeout(lineTimer);
    setHighlight(uid, true);
  }
  let lineUid: string | null = null;
  function hoverLine(uid: string | null) {
    if (legendHovered || uid === lineUid) return;
    lineUid = uid;
    clearTimeout(lineTimer);
    lineTimer = setTimeout(() => setHighlight(lineUid, false), uid ? 140 : 220);
  }

  /** Indicator values: whole numbers (volume) grouped, "6,027" rather than "6027.00". */
  const legendNumber = (v: number) => (Number.isInteger(v) && Math.abs(v) >= 1000 && Math.abs(v) < 1e4 ? v.toLocaleString('en-US') : formatNumber(v));
  let card: HoverCard;
  const fmtVolume = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : formatNumber(v));
  const intradayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dailyFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const timeLabel = (t: number) => (TIMEFRAME_SECONDS[state.timeframe] < 86400 ? intradayFormat : dailyFormat).format(t * 1000);

  /** Signals (pattern/strategy markers) on a bar, with the first line of the indicator's guide explaining them. */
  function signalsAt(index: number): CardNote[] {
    const notes: CardNote[] = [];
    for (const instance of state.indicators) {
      const def = getIndicator(instance.defId);
      if (!def || !instance.visible) continue;
      for (const plot of def.plots) {
        if (plot.type !== 'marker' || instance.hiddenPlots?.includes(plot.key)) continue;
        const v = chart.markerValueAt(instance.uid, plot.key, index);
        if (!v) continue;
        const guide = INDICATOR_GUIDES[def.id] ?? CATALOG_GUIDES[def.id];
        const title = plot.title === def.name || def.plots.length === 1 ? def.name : `${def.shortName}: ${plot.title}`;
        notes.push({ title, text: guide ? ` ${guide.signals[0] ?? guide.what}` : '', color: instance.colors[plot.key] ?? plot.color });
        if (notes.length >= 3) return notes;
      }
    }
    return notes;
  }

  function showCard(p: PointerInfo) {
    const bar = chart.barAt(p.index);
    if (!bar) return card.hide();
    const prev = chart.barAt(p.index - 1);
    const change = prev ? bar.close - prev.close : 0;
    const pctChange = prev ? (change / prev.close) * 100 : 0;
    const dir = bar.close >= bar.open ? THEME.up : THEME.down;
    const rows: CardRow[] = [
      { label: 'Open', value: formatNumber(bar.open) },
      { label: 'High', value: formatNumber(bar.high) },
      { label: 'Low', value: formatNumber(bar.low) },
      { label: 'Close', value: formatNumber(bar.close), color: dir },
      { label: 'Change', value: `${change >= 0 ? '+' : '−'}${chart.formatPrice(Math.abs(change))} (${pctChange >= 0 ? '+' : '−'}${Math.abs(pctChange).toFixed(2)}%)`, color: change >= 0 ? THEME.up : THEME.down },
      { label: 'Volume', value: fmtVolume(bar.volume) },
    ];
    if (!card.narrow) {
      for (const instance of state.indicators) {
        if (!instance.visible || instance.defId === 'volume') continue;
        const def = getIndicator(instance.defId);
        if (!def) continue;
        for (const v of chart.valuesAt(instance.uid, p.index)) {
          if (v.hidden || !Number.isFinite(v.value)) continue;
          rows.push({ label: def.plots.length > 1 ? `${def.shortName} ${v.title}` : indicatorLabel(def, instance), value: legendNumber(v.value), color: v.color });
          if (rows.length >= 14) break;
        }
        if (rows.length >= 14) break;
      }
    }
    card.show(p.x, p.y, p.snappedY, { title: timeLabel(bar.time), rows, notes: signalsAt(p.index) });
  }

  const pointerFrame = latestPerFrame<PointerInfo | null>((p) => {
    if (!p) {
      card.hide();
      hoverLine(null);
      return;
    }
    showCard(p);
    hoverLine(p.hoveredUid);
  });

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
  let waitingForTrades = false;
  // Live trades are folded into the bars as they arrive; the chart redraws once per frame from the earliest changed bar.
  const live = frameBatch<number>((from) => flushLive(from), Math.min);

  function showMessage(text: string | null, actions: Node[] = []) {
    messageEl.hidden = !text;
    messageEl.replaceChildren(...(text ? [h('p', {}, text), h('div', { class: 'message-actions' }, ...actions)] : []));
  }

  function flushLive(from: number) {
    chart.updateFrom(from);
    if (waitingForTrades) {
      waitingForTrades = false;
      showMessage(null);
    }
    paintHeaderSoon();
    if (hoverIndex === null) updateLegendValues(chart.barCount - 1);
    legendBox.schedule();
  }

  /** Time of the latest live trade, for the header's "At". */
  let lastTradeAt: number | null = null;
  let headerTimer: ReturnType<typeof setTimeout> | 0 = 0;
  function paintHeader() {
    const p = provider();
    header.update({
      symbol: displaySymbol(symbol()),
      summary: daySummary(bars, state.timeframe, marketTimeZone(p.id)),
      at: lastTradeAt,
      daily: TIMEFRAME_SECONDS[state.timeframe] >= 86400,
      market: p.id,
      price: (v) => (started && bars.length ? chart.formatPrice(v) : formatNumber(v)),
    });
  }
  /** Live ticks repaint the header at most 4 times a second (it sums the day's bars). */
  function paintHeaderSoon() {
    if (!headerTimer) headerTimer = setTimeout(() => ((headerTimer = 0), paintHeader()), 250);
  }

  async function reload() {
    stopLive();
    live.cancel();
    waitingForTrades = false;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    renderToolbar();
    watchlist.render();
    setStatus('connecting');
    showMessage(null);
    lastTradeAt = null;
    const p = provider();
    const sym = symbol();
    const tf = state.timeframe;
    const drawingsKey = refKey(currentRef());
    loadedKey = `${drawingsKey}:${tf}:${state.extendedHours}`;
    document.title = `${displaySymbol(sym)} · Trading Platform`;

    chart.symbol = sym;
    chart.market = p.id;
    const days = Math.max(forcedDays ?? 0, rangeBar.daysWanted() ?? 0) || undefined;
    forcedDays = undefined;
    if (!bars.length || loadedKey !== shownKey) chartState.loading(`Loading ${displaySymbol(sym)} · ${tf}…`);
    header.update({ symbol: displaySymbol(sym), summary: null, daily: TIMEFRAME_SECONDS[tf] >= 86400, market: p.id });
    try {
      bars = await p.loadHistory(sym, tf, controller.signal, days);
    } catch (err) {
      if (controller.signal.aborted) return;
      chartState.hide();
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
    shading.setGuides(ext);

    chart.setBars(bars, tf);
    rangeBar.apply();
    shownKey = loadedKey;
    chartState.hide();
    if (!bars.length && TIMEFRAME_SECONDS[tf] >= 60) chartState.empty(`No price history for ${displaySymbol(sym)} at ${tf}`);
    drawings.setDrawings(loadDrawings(drawingsKey));
    drawings.onChange = (list) => saveDrawings(drawingsKey, list);
    paintHeader();
    renderLegend();
    legendBox.schedule();
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
          lastTradeAt = trade.time;
          live.push(bars.length - 1);
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
    const wanted = link.wanted(symbol()); // the linked group's symbol changed while the chart was hidden
    if (started) return void (wanted && show(guessMarket(wanted)!));
    if (wanted) show(guessMarket(wanted)!);
    started = true;
    if (narrow()) state.watchlistOpen = false;
    chart = new ChartView(chartEl);
    chart.setChartType(state.chartType);
    legendBox = new LegendBox(chart);
    legendEl.replaceWith(legendBox.el);
    if (chartWrap.clientWidth && chartWrap.clientWidth < 560) legendBox.el.classList.add('folded');
    card = new HoverCard(chart.overlay);
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
    // Crosshair moves only touch the legend's numbers, at most once per frame.
    const legendFrame = latestPerFrame<number>((index) => updateLegendValues(index));
    chart.onHover = (index) => {
      hoverIndex = index >= chart.barCount - 1 ? null : index;
      legendFrame.push(hoverIndex ?? chart.barCount - 1);
    };
    chart.onPointer = (p) => pointerFrame.push(p);
    chart.onValues = () => hoverIndex === null && legendFrame.push(chart.barCount - 1);
    chart.onLayout = renderLegend;
    chart.onDataError = (message) => showMessage(message, [h('button', { class: 'btn primary', onclick: reload }, 'Try again')]);
    reload();
  }

  /** Shows a symbol without telling the link group (the group told us). */
  function show(ref: MarketRef) {
    state.provider = ref.provider;
    state.symbols[ref.provider] = ref.symbol;
    persist();
    if (started) reload();
  }

  /** Shows a symbol, e.g. when clicked in a watchlist; panels linked to the chart follow. */
  function open(ref: MarketRef) {
    if (narrow()) state.watchlistOpen = false;
    show(ref);
    link.publish(ref.symbol);
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

  /**
   * Brings the chart in line with `state` after something else changed it (the AI assistant's actions and their
   * Undo): symbol, market, timeframe, chart type, indicators and drawings.
   */
  function sync() {
    renderToolbar();
    if (!started) return;
    chart.setChartType(state.chartType);
    if (loadedKey !== `${refKey(currentRef())}:${state.timeframe}:${state.extendedHours}`) {
      reload();
    } else if (loadedKey) {
      drawings.setDrawings(loadDrawings(refKey(currentRef())));
    }
    chart.removeMissingIndicators(new Set(state.indicators.map((i) => i.uid)));
    for (const instance of state.indicators) {
      if (chart.hasIndicator(instance.uid)) chart.updateIndicator(instance);
      else chart.addIndicator(instance);
    }
    indicatorsChanged();
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

  return { el, start, open, addIndicatorById, refreshIndicatorsFor, sync };
}
