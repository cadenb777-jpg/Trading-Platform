/**
 * Chart > Workspace (#chart/multi): a grid of up to six panels (chart, quote, news, research facts, my position),
 * each with its own type and link colour. Panels of the same colour show the same symbol, together with every other
 * linked panel in the platform (src/ui/linkGroups.ts). Layouts 1, 2, 4, 1+2 and 6; the ready-made layouts Morning,
 * Trade and Research, and your own named ones (src/ui/workspaceLayouts.ts, saved in this browser).
 * Keyboard: Ctrl/Cmd+[ ] or F6 move between panels, Alt+1..6 jumps, typing a ticker on a panel opens the command bar
 * for that panel's group (src/ui/command.ts).
 */
import { ChartView } from '../chart/ChartView';
import { SessionShading, isRegularHours, regularHoursOnly } from '../chart/session';
import { getProvider } from '../data';
import { guessMarket, type MarketRef } from '../data/quotes';
import { engineRequest, helper, loadNews } from '../data/schwab';
import { listDocs } from '../data/store';
import { getIndicator } from '../indicators/library';
import type { Portfolio } from '../portfolio/types';
import type { CompanyData } from './researchPage';
import { newIndicatorInstance, state } from '../state';
import { TIMEFRAMES, TIMEFRAME_SECONDS, applyTrade, type Bar, type Timeframe } from '../types';
import { formatNumber, formatPrice, h, openModal, timeAgo, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { isStockSymbol, links, linkPanel } from '../ui/linkGroups';
import { openNewsSummary } from '../ui/newsSummary';
import { heldPosition, normalizeTicker, tickerAttr, tickerPreview } from '../ui/tickerCard';
import { displaySymbol } from '../ui/watchlist';
import {
  GRIDS,
  GRID_LABELS,
  GRID_SLOTS,
  GRID_TITLES,
  MAX_PANELS,
  PANEL_LABELS,
  PANEL_TYPES,
  PRESETS,
  deleteNamed,
  findLayout,
  loadWorkspaces,
  saveNamed,
  saveWorkspaces,
  type Grid,
  type PanelConfig,
  type PanelType,
  type Workspaces,
} from '../ui/workspaceLayouts';

export interface WorkspaceDeps {
  openChart(ref: MarketRef): void;
  openResearch(symbol: string): void;
}

const CELL_TIMEFRAMES = TIMEFRAMES.filter((t) => !t.endsWith('s'));
const INDEXES = /^(SPX|DJI|COMPX|VIX|RUT)$/;

const store = (() => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
})();

/** What a typed symbol means: "spx" is the S&P 500 index, "btc" Bitcoin; null when it isn't a symbol. */
function readSymbol(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (INDEXES.test(t)) return `$${t}`;
  if (t.startsWith('/')) return normalizeTicker(t);
  const ref = guessMarket(t);
  return ref ? normalizeTicker(ref.symbol) : null;
}

/** Which symbols each panel type can show. */
const ACCEPTS: Record<PanelType, (s: string) => boolean> = {
  chart: (s) => !s.startsWith('/') && !!guessMarket(s),
  quote: (s) => !!normalizeTicker(s),
  news: isStockSymbol,
  facts: isStockSymbol,
  positions: isStockSymbol,
};

interface Body {
  el: HTMLElement;
  show(symbol: string, cfg: PanelConfig): void;
  stop(): void;
}

// ---------- panel bodies ----------

function chartBody(price: HTMLElement, status: HTMLElement): Body {
  const chartEl = h('div', { class: 'chart' });
  const message = h('div', { class: 'chart-message', hidden: true });
  const el = h('div', { class: 'chart-wrap ws-chart' }, chartEl, message);
  let chart: ChartView | null = null;
  let shading: SessionShading | null = null;
  let bars: Bar[] = [];
  let stopLive = () => {};
  let controller: AbortController | null = null;
  let pendingFrom: number | null = null;
  let shown = '';

  async function load(symbol: string, timeframe: Timeframe) {
    const ref = guessMarket(symbol);
    if (!ref) return;
    stopLive();
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    message.hidden = true;
    price.textContent = '';
    status.className = 'status connecting';
    chart ??= (() => {
      const view = new ChartView(chartEl);
      view.onDataError = (text) => {
        message.hidden = false;
        message.replaceChildren(h('p', {}, text));
      };
      view.addIndicator(newIndicatorInstance(getIndicator('volume')!));
      shading = new SessionShading(view);
      return view;
    })();
    chart.symbol = ref.symbol;
    try {
      bars = await getProvider(ref.provider).loadHistory(ref.symbol, timeframe, ctl.signal);
    } catch (err) {
      if (ctl.signal.aborted) return;
      bars = [];
      chart.setBars(bars, timeframe);
      status.className = 'status error';
      message.hidden = false;
      message.replaceChildren(h('p', {}, `${displaySymbol(ref.symbol)}: ${(err as Error).message}`));
      return;
    }
    if (ctl.signal.aborted) return;
    const ext = ref.provider === 'schwab' && TIMEFRAME_SECONDS[timeframe] < 86400; // the main chart's extended-hours setting
    if (ext && !state.extendedHours) bars = regularHoursOnly(bars);
    shading?.setEnabled(ext && state.extendedHours);
    chart.setBars(bars, timeframe);
    price.textContent = bars.length ? formatNumber(bars[bars.length - 1].close) : '';
    stopLive = getProvider(ref.provider).subscribe(
      ref.symbol,
      {
        onTrade: (t) => {
          if (ext && !state.extendedHours && !isRegularHours(t.time)) return;
          if (!applyTrade(bars, timeframe, t.price, t.size, t.time)) return;
          const i = bars.length - 1;
          if (pendingFrom === null)
            requestAnimationFrame(() => {
              if (pendingFrom === null || !chart) return;
              chart.updateFrom(pendingFrom);
              pendingFrom = null;
              price.textContent = formatNumber(bars[bars.length - 1].close);
            });
          pendingFrom = Math.min(pendingFrom ?? i, i);
        },
        onStatus: (s, msg) => {
          status.className = `status ${s}`;
          status.title = msg ?? s;
        },
      },
      bars[bars.length - 1]?.close ?? 100,
    );
  }

  return {
    el,
    show(symbol, cfg) {
      const key = `${symbol}|${cfg.timeframe}`;
      if (key === shown) return;
      shown = key;
      void load(symbol, cfg.timeframe);
    },
    stop() {
      shown = '';
      stopLive();
      stopLive = () => {};
      controller?.abort();
      status.className = 'status';
      price.textContent = '';
    },
  };
}

/** A body that reloads when its symbol changes and every `everyMs` while shown. */
function refreshingBody(cls: string, everyMs: number, fill: (el: HTMLElement, symbol: string, still: () => boolean) => unknown): Body {
  const el = h('div', { class: `ws-body ${cls}` });
  let shown = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let seq = 0;
  const run = (symbol: string) => {
    const mine = ++seq;
    void fill(el, symbol, () => mine === seq && el.isConnected);
  };
  return {
    el,
    show(symbol) {
      if (symbol !== shown) {
        shown = symbol;
        el.replaceChildren(h('div', { class: 'muted pad small' }, 'Loading…'));
        run(symbol);
      }
      clearInterval(timer);
      timer = setInterval(() => !document.hidden && run(shown), everyMs);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      seq++;
      shown = '';
    },
  };
}

const helperNote = (text: string) => h('div', { class: 'muted pad small' }, text);
async function helperUp() {
  return helper.isConnected || (await helper.connect().then(() => true, () => false));
}

const quoteBody = () =>
  refreshingBody('ws-quote', 30_000, (el, symbol, still) => {
    const card = tickerPreview(symbol);
    if (still()) el.replaceChildren(card);
  });

const newsBody = () =>
  refreshingBody('ws-news', 5 * 60_000, async (el, symbol, still) => {
    if (!(await helperUp())) return still() && el.replaceChildren(helperNote('Headlines appear when the helper is running.'));
    try {
      const { items } = await loadNews([symbol]);
      if (!still()) return;
      const rows = [...items].sort((a, b) => b.published - a.published).slice(0, 25);
      el.replaceChildren(
        ...(rows.length
          ? rows.map((item) =>
              h('button', { type: 'button', class: 'ws-news-row', onclick: () => openNewsSummary(item) }, h('b', {}, item.title), h('span', { class: 'muted tiny' }, `${item.source} · ${timeAgo(item.published)}`)),
            )
          : [helperNote(`No recent headlines for ${symbol}.`)]),
      );
    } catch (err) {
      if (still()) el.replaceChildren(helperNote((err as Error).message || 'Couldn’t load headlines.'));
    }
  });

const money = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(0)}`;
const pctOf = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
const times = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}×`);
const lastOf = (list: (number | null)[] | undefined) => [...(list ?? [])].reverse().find((v) => v != null) ?? null;

const factsBody = (openResearch: (s: string) => void) =>
  refreshingBody('ws-facts', 30 * 60_000, async (el, symbol, still) => {
    if (!(await helperUp())) return still() && el.replaceChildren(helperNote('Company facts appear when the helper is running.'));
    try {
      const d = await engineRequest<CompanyData>('research.company', { symbol }, 90_000);
      if (!still()) return;
      const v = d.valuation;
      const fact = (label: string, value: string) => h('div', { class: 'ws-fact' }, h('span', { class: 'muted small' }, label), h('b', {}, value));
      el.replaceChildren(
        h('div', { class: 'ws-facts-head' }, h('b', tickerAttr(d.symbol), d.profile.name), h('span', { class: 'muted small' }, [d.profile.industry, d.profile.exchange].filter(Boolean).join(' · '))),
        h(
          'div',
          { class: 'ws-fact-grid' },
          fact('Price', formatPrice(v.price)),
          fact('Market value', money(v.marketCap)),
          fact('P/E', times(v.pe)),
          fact('EV / EBITDA', times(v.evEbitda)),
          fact('Free cash flow yield', pctOf(v.fcfYield)),
          fact('Revenue growth', pctOf(lastOf(d.ratios.revenueGrowth))),
          fact('Net margin', pctOf(lastOf(d.ratios.netMargin))),
          fact('1-year total return', pctOf(d.totalReturn?.tr1y ?? null)),
        ),
        h('div', { class: 'ws-foot' }, h('span', { class: 'muted tiny' }, 'SEC filings via the helper'), h('button', { type: 'button', class: 'btn small', onclick: () => openResearch(d.symbol) }, 'Full research →')),
      );
    } catch (err) {
      if (still()) el.replaceChildren(helperNote((err as Error).message || 'Couldn’t load company facts.'));
    }
  });

const positionsBody = () =>
  refreshingBody('ws-positions', 60_000, async (el, symbol, still) => {
    if (!(await helperUp())) return still() && el.replaceChildren(helperNote('Your positions appear when the helper is running.'));
    try {
      const held = heldPosition(symbol, await listDocs<Portfolio>('portfolios'));
      if (!still()) return;
      const shares = (n: number) => `${+n.toFixed(4)} sh`;
      el.replaceChildren(
        held
          ? h(
              'div',
              {},
              h('div', { class: 'ws-held' }, h('b', {}, `You hold ${displaySymbol(symbol)}: `), held.shares ? shares(held.shares) : '', held.shares && held.amount ? ' + ' : '', held.amount ? money(held.amount) : ''),
              h('ul', { class: 'ws-accts small' }, ...held.accounts.map((a) => h('li', {}, h('span', {}, a.account), h('b', {}, a.shares ? shares(a.shares) : money(a.amount))))),
            )
          : helperNote(`You don’t hold ${displaySymbol(symbol)} in your accounts.`),
        h('div', { class: 'ws-foot' }, h('span', { class: 'muted tiny' }, 'All your accounts (read-only)'), h('a', { class: 'btn small', href: '#account' }, 'Account →')),
      );
    } catch (err) {
      if (still()) el.replaceChildren(helperNote((err as Error).message || 'Couldn’t read your accounts.'));
    }
  });

// ---------- one panel ----------

function createPanel(index: number, cfg: () => PanelConfig, change: (patch: Partial<PanelConfig>) => void, deps: WorkspaceDeps, isActive: () => boolean) {
  const id = `ws${index + 1}`;
  const label = `Panel ${index + 1}`;
  const typeSelect = h('select', { class: 'input ws-type', 'aria-label': `${label} type`, title: 'What this panel shows' }, ...PANEL_TYPES.map((t) => h('option', { value: t }, PANEL_LABELS[t])));
  const symbolInput = h('input', { class: 'input ws-symbol', spellcheck: false, autocomplete: 'off', 'aria-label': `${label} symbol`, title: 'Type a symbol (e.g. NVDA, SPX, BTC) and press Enter' });
  const tfSelect = h('select', { class: 'input ws-tf', 'aria-label': `${label} time frame` }, ...CELL_TIMEFRAMES.map((t) => h('option', { value: t }, t)));
  const price = h('span', { class: 'ws-price' });
  const status = h('span', { class: 'status' });
  const openBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Open in the full chart', 'aria-label': `${label}: open in the full chart` }, icon('chart', 18));
  const slot = h('div', { class: 'ws-slot' });
  const el = h('section', { class: 'ws-panel', 'aria-label': label });

  const visible = () => isActive() && !el.hidden;
  const link = linkPanel({
    id,
    label,
    el,
    accepts: (s) => ACCEPTS[cfg().type](s),
    // the group's symbol becomes the panel's own, so it stays when the panel is unlinked later
    apply: (s) => (change({ symbol: s }), render()),
  });
  el.prepend(
    h(
      'header',
      { class: 'ws-head' },
      h('span', { class: 'ws-num', title: `Alt+${index + 1} jumps here` }, String(index + 1)),
      link.chip,
      symbolInput,
      typeSelect,
      tfSelect,
      price,
      h('span', { class: 'spacer' }),
      status,
      openBtn,
    ),
    slot,
  );

  const bodies: Partial<Record<PanelType, Body>> = {};
  const bodyFor = (t: PanelType): Body =>
    (bodies[t] ??= t === 'chart' ? chartBody(price, status) : t === 'quote' ? quoteBody() : t === 'news' ? newsBody() : t === 'facts' ? factsBody(deps.openResearch) : positionsBody());

  /** The symbol shown: the group's when the panel is linked and can show it, else its own. */
  const symbol = () => {
    const s = links.symbolFor(id);
    return s && ACCEPTS[cfg().type](s) ? s : cfg().symbol;
  };

  function render() {
    const c = cfg();
    const s = symbol();
    typeSelect.value = c.type;
    tfSelect.value = c.timeframe;
    if (document.activeElement !== symbolInput) symbolInput.value = displaySymbol(s);
    const isChart = c.type === 'chart';
    tfSelect.hidden = !isChart;
    openBtn.hidden = !isChart;
    if (!isChart) price.textContent = '';
    if (!isChart) status.className = 'status';
    for (const [t, b] of Object.entries(bodies) as [PanelType, Body][]) if (t !== c.type) b.stop();
    if (!visible()) return bodies[c.type]?.stop();
    const body = bodyFor(c.type);
    if (body.el.parentElement !== slot) slot.replaceChildren(body.el);
    if (!ACCEPTS[c.type](s)) {
      body.stop();
      body.el.replaceChildren(helperNote(`${PANEL_LABELS[c.type]} needs a stock symbol (${displaySymbol(s)} isn’t one).`));
      return;
    }
    body.show(s, c);
  }

  symbolInput.addEventListener('change', () => {
    const s = readSymbol(symbolInput.value);
    if (!s) return (symbolInput.value = displaySymbol(symbol()));
    change({ symbol: s });
    link.publish(s);
    render();
  });
  symbolInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') symbolInput.blur();
    else if (e.key === 'Escape') ((symbolInput.value = displaySymbol(symbol())), el.focus());
  });
  symbolInput.addEventListener('focus', () => symbolInput.select());
  typeSelect.addEventListener('change', () => (change({ type: typeSelect.value as PanelType }), render()));
  tfSelect.addEventListener('change', () => (change({ timeframe: tfSelect.value as Timeframe }), render()));
  openBtn.addEventListener('click', () => {
    const ref = guessMarket(symbol());
    if (ref) deps.openChart(ref);
  });
  links.onColorChange((panel, color) => panel === id && (change({ link: color }), render()));

  return {
    id,
    el,
    render,
    stop: () => Object.values(bodies).forEach((b) => b.stop()),
  };
}

// ---------- the page ----------

export function createWorkspacePage(deps: WorkspaceDeps) {
  let ws: Workspaces = loadWorkspaces(store);
  let active = false;
  const persistWs = () => saveWorkspaces(ws, store);

  const grid = h('div', { class: 'ws-grid' });
  const gridButtons = GRIDS.map((g) => h('button', { type: 'button', 'data-grid': g, title: GRID_TITLES[g], 'aria-label': `Layout: ${GRID_TITLES[g]}`, onclick: () => setGrid(g) }, GRID_LABELS[g]));
  const layoutSelect = h('select', { class: 'input ws-layouts', 'aria-label': 'Saved layouts', title: 'Load a ready-made or saved layout' });
  const deleteBtn = h('button', { type: 'button', class: 'btn small', title: 'Delete this saved layout', onclick: () => removeLayout() }, 'Delete');
  const el = h(
    'div',
    { class: 'multi-page ws-page' },
    h(
      'header',
      { class: 'toolbar ws-toolbar' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Grid' }, ...gridButtons),
      layoutSelect,
      h('button', { type: 'button', class: 'btn small', title: 'Save these panels as a named layout', onclick: () => saveDialog() }, 'Save as…'),
      deleteBtn,
      h(
        'span',
        { class: 'muted small ws-hint' },
        'Same colour chip = same symbol everywhere. ',
        h('kbd', {}, 'Ctrl+]'),
        ' next panel · ',
        h('kbd', {}, 'Alt+1'),
        '-',
        h('kbd', {}, '6'),
        ' jump · type a ticker on a panel',
      ),
    ),
    grid,
  );

  const panels = Array.from({ length: MAX_PANELS }, (_, i) =>
    createPanel(
      i,
      () => ws.current.panels[i],
      (patch) => {
        ws.current.panels[i] = { ...ws.current.panels[i], ...patch };
        persistWs();
      },
      deps,
      () => active,
    ),
  );

  /** The bus holds each panel's colour; a loaded layout sets them. */
  function applyColors() {
    ws.current.panels.forEach((p, i) => links.colorOf(panels[i].id) !== p.link && links.setColor(panels[i].id, p.link));
  }

  function drawLayouts() {
    const opt = (name: string) => h('option', { value: name, selected: name === ws.current.name }, name);
    const known = PRESETS.some((l) => l.name === ws.current.name) || ws.saved.some((l) => l.name === ws.current.name);
    layoutSelect.replaceChildren(
      ...(known ? [] : [opt(ws.current.name)]),
      h('optgroup', { label: 'Ready-made' }, ...PRESETS.map((l) => opt(l.name))),
      ...(ws.saved.length ? [h('optgroup', { label: 'Yours' }, ...ws.saved.map((l) => opt(l.name)))] : []),
    );
    deleteBtn.hidden = !ws.saved.some((l) => l.name === ws.current.name);
  }

  function render() {
    const count = GRID_SLOTS[ws.current.grid];
    grid.dataset.grid = ws.current.grid;
    gridButtons.forEach((b) => {
      const on = b.dataset.grid === ws.current.grid;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    grid.replaceChildren(...panels.slice(0, count).map((p) => p.el));
    panels.forEach((p, i) => {
      p.el.hidden = i >= count;
      if (i >= count) p.stop();
      p.render();
    });
    drawLayouts();
  }

  function setGrid(g: Grid) {
    ws.current.grid = g;
    persistWs();
    render();
  }

  function loadLayout(name: string) {
    const l = findLayout(ws, name);
    if (!l) return;
    ws.current = l;
    persistWs();
    applyColors();
    render();
  }
  layoutSelect.addEventListener('change', () => loadLayout(layoutSelect.value));

  function saveDialog() {
    const input = h('input', { class: 'input', 'aria-label': 'Layout name', maxlength: 40, placeholder: 'e.g. Earnings week', value: ws.saved.some((l) => l.name === ws.current.name) ? ws.current.name : '' });
    const error = h('p', { class: 'ap-error small', hidden: true, role: 'alert' });
    const form = h(
      'form',
      { class: 'ws-save' },
      h('label', { class: 'small' }, 'Name', input),
      h('p', { class: 'muted small' }, 'Saves the grid and each panel’s type, link colour, symbol and time frame in this browser. Saving with an existing name replaces it.'),
      error,
      h('div', { class: 'message-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Save layout')),
    );
    const close = openModal('Save layout', form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = saveNamed(ws, ws.current, input.value);
      if ('error' in r) {
        error.hidden = false;
        error.textContent = r.error;
        return;
      }
      ws = r;
      if (!persistWs()) toast('Saved for now; this browser isn’t keeping site data, so it is gone after a reload');
      else toast(`Saved layout “${ws.current.name}”`);
      close();
      drawLayouts();
    });
  }

  function removeLayout() {
    const name = ws.current.name;
    if (!ws.saved.some((l) => l.name === name) || !confirm(`Delete the layout “${name}”? The panels on screen stay as they are.`)) return;
    ws = deleteNamed(ws, name);
    ws.current = { ...ws.current, name: 'Unsaved layout' };
    persistWs();
    drawLayouts();
  }

  applyColors();

  return {
    el,
    start() {
      if (active) return;
      active = true;
      render();
    },
    stop() {
      active = false;
      panels.forEach((p) => p.stop());
    },
  };
}
