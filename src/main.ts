import './style.css';
import { ChartView, THEME } from './chart/ChartView';
import { PROVIDERS, getProvider } from './data';
import type { ConnectionStatus, ProviderId } from './data/provider';
import { defaultColors, defaultParams, getIndicator, indicatorLabel } from './indicators/library';
import type { IndicatorDef, IndicatorInstance } from './indicators/types';
import { loadAlpacaKeys, loadState, saveState, type AppState } from './storage';
import { TIMEFRAMES, applyTrade, type Bar, type Timeframe } from './types';
import { formatNumber, h } from './ui/dom';
import { openIndicatorPicker, openIndicatorSettings } from './ui/indicatorDialogs';
import { openSettings } from './ui/settingsDialog';

const SYMBOL_SUGGESTIONS: Record<ProviderId, string[]> = {
  coinbase: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD', 'AVAX-USD', 'LINK-USD', 'LTC-USD'],
  alpaca: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AMD', 'SPY', 'QQQ'],
  demo: ['DEMO', 'TEST'],
};

const newUid = () => Math.random().toString(36).slice(2, 10);

function newInstance(def: IndicatorDef): IndicatorInstance {
  return { uid: newUid(), defId: def.id, params: defaultParams(def), colors: defaultColors(def), visible: true };
}

function defaultState(): AppState {
  return {
    provider: 'coinbase',
    symbols: {},
    timeframe: '15m',
    indicators: ['volume', 'sma', 'rsi'].map((id) => newInstance(getIndicator(id)!)),
  };
}

const state: AppState = { ...defaultState(), ...loadState() };
state.indicators = state.indicators.filter((i) => getIndicator(i.defId));
const persist = () => saveState(state);

const provider = () => getProvider(state.provider);
const symbol = () => state.symbols[state.provider] ?? provider().defaultSymbol;

// ---------- Layout ----------

const marketSelect = h('select', { class: 'input market', 'aria-label': 'Market' }, ...PROVIDERS.map((p) => h('option', { value: p.id }, p.name)));
const symbolInput = h('input', { class: 'input symbol', 'aria-label': 'Symbol', list: 'symbol-list', spellcheck: false, autocomplete: 'off' });
const symbolList = h('datalist', { id: 'symbol-list' });
const timeframeGroup = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Timeframe' });
const priceEl = h('span', { class: 'price' });
const statusEl = h('span', { class: 'status' });
const chartEl = h('div', { class: 'chart' });
const legendEl = h('div', { class: 'legend' });
const messageEl = h('div', { class: 'chart-message', hidden: true });

document.querySelector('#app')!.append(
  h(
    'header',
    { class: 'toolbar' },
    h('div', { class: 'brand', title: 'Trading Platform' }, '◆'),
    marketSelect,
    symbolInput,
    symbolList,
    timeframeGroup,
    h('button', { class: 'btn', onclick: () => openIndicatorPicker(addIndicator) }, h('span', { class: 'fx' }, 'ƒx'), ' Indicators'),
    h('span', { class: 'spacer' }),
    priceEl,
    statusEl,
    h('button', { class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings', onclick: () => openSettings(reload) }, '⚙'),
  ),
  h('main', { class: 'chart-wrap' }, chartEl, legendEl, messageEl),
);

const chart = new ChartView(chartEl);

// ---------- Toolbar ----------

function renderToolbar() {
  marketSelect.value = state.provider;
  symbolInput.value = symbol();
  symbolInput.placeholder = provider().symbolPlaceholder;
  symbolList.replaceChildren(...SYMBOL_SUGGESTIONS[state.provider].map((s) => h('option', { value: s })));
  timeframeGroup.replaceChildren(
    ...TIMEFRAMES.map((tf) =>
      h('button', { class: tf === state.timeframe ? 'active' : '', 'aria-pressed': tf === state.timeframe, onclick: () => setTimeframe(tf) }, tf),
    ),
  );
}

marketSelect.addEventListener('change', () => {
  state.provider = marketSelect.value as ProviderId;
  persist();
  reload();
});

const commitSymbol = () => {
  const next = provider().normalizeSymbol(symbolInput.value);
  if (!next || next === symbol()) return (symbolInput.value = symbol());
  state.symbols[state.provider] = next;
  persist();
  reload();
};
symbolInput.addEventListener('change', commitSymbol);
symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && symbolInput.blur());
symbolInput.addEventListener('focus', () => symbolInput.select());

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

// ---------- Indicators ----------

function addIndicator(def: IndicatorDef) {
  const instance = newInstance(def);
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

for (const instance of state.indicators) chart.addIndicator(instance);

// ---------- Legend (top-left of the chart and of each indicator pane) ----------

let hoverIndex: number | null = null;

function renderLegend() {
  const index = hoverIndex ?? chart.barCount - 1;
  const bar = chart.barAt(index);
  const prev = chart.barAt(index - 1);
  legendEl.replaceChildren();
  // Legends for indicators in their own pane sit directly in the chart wrapper, at the pane's top.
  document.querySelectorAll('.chart-wrap > .pane-legend').forEach((el) => el.remove());

  const ohlc = h('div', { class: 'legend-row legend-title' }, h('b', {}, `${symbol()} · ${state.timeframe} · ${provider().name}`));
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
      h('span', { class: 'legend-name' }, indicatorLabel(def, instance.params)),
      ...chart
        .valuesAt(instance.uid, index)
        .map((v) => h('span', { class: 'legend-value', style: `color:${v.color}`, title: v.title }, formatNumber(v.value))),
      h(
        'span',
        { class: 'legend-actions' },
        h('button', { class: 'mini-btn', title: instance.visible ? 'Hide' : 'Show', onclick: () => toggleIndicator(instance.uid) }, instance.visible ? '👁' : '◌'),
        h('button', { class: 'mini-btn', title: 'Settings', onclick: () => editIndicator(instance.uid) }, '⚙'),
        h('button', { class: 'mini-btn', title: 'Remove', onclick: () => removeIndicator(instance.uid) }, '✕'),
      ),
    );
    if (def.placement === 'separate') {
      row.classList.add('pane-legend');
      row.style.top = `${chart.paneTop(instance.uid) + 4}px`;
      chartEl.parentElement!.append(row);
    } else {
      legendEl.append(row);
    }
  }
}

chart.onHover = (index) => {
  hoverIndex = index >= chart.barCount - 1 ? null : index;
  renderLegend();
};
chart.onLayout = renderLegend;

// ---------- Data loading and live updates ----------

let bars: Bar[] = [];
let stopLive: () => void = () => {};
let loadController: AbortController | null = null;
let pendingFrom: number | null = null;

function showMessage(text: string | null, actions: Node[] = []) {
  messageEl.hidden = !text;
  messageEl.replaceChildren(...(text ? [h('p', {}, text), h('div', { class: 'message-actions' }, ...actions)] : []));
}

function flushLive() {
  if (pendingFrom === null) return;
  chart.updateFrom(pendingFrom);
  pendingFrom = null;
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
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  renderToolbar();
  setStatus('connecting');
  showMessage(null);
  priceEl.textContent = '';
  const p = provider();
  const sym = symbol();
  const tf = state.timeframe;
  document.title = `${sym} · Trading Platform`;

  if (p.id === 'alpaca' && !loadAlpacaKeys()) {
    bars = [];
    chart.setBars(bars);
    renderLegend();
    setStatus('error', 'Alpaca keys missing');
    showMessage('Stock data needs free Alpaca API keys. It takes about 2 minutes to set up.', [
      h('button', { class: 'btn primary', onclick: () => openSettings(reload) }, 'Add Alpaca keys'),
      h('button', { class: 'btn', onclick: () => switchProvider('demo') }, 'Use demo data'),
    ]);
    return;
  }

  try {
    bars = await p.loadHistory(sym, tf, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) return;
    bars = [];
    chart.setBars(bars);
    renderLegend();
    setStatus('error', (err as Error).message);
    showMessage(`Couldn't load ${sym}: ${(err as Error).message}`, [
      h('button', { class: 'btn primary', onclick: reload }, 'Try again'),
      h('button', { class: 'btn', onclick: () => switchProvider('demo') }, 'Use demo data'),
    ]);
    return;
  }
  if (controller.signal.aborted) return;

  chart.setBars(bars);
  priceEl.textContent = bars.length ? formatNumber(bars[bars.length - 1].close) : '';
  renderLegend();

  stopLive = p.subscribe(
    sym,
    {
      onTrade: (trade) => {
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

function switchProvider(id: ProviderId) {
  state.provider = id;
  persist();
  reload();
}

reload();
