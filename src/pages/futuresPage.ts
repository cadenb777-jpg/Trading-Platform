/**
 * Futures: the whole US futures market at a glance (read-only). Sector heat tiles, what's moving (in % and in
 * standard deviations), the board with specs and roll dates, one market's term structure and COT positioning.
 * Data: helper futures.board / futures.curve / futures.detail (Schwab quotes and history, CFTC COT).
 */
import { insightButton } from '../ai/insight';
import { clearEngineCache, engineRequest } from '../data/schwab';
import { createCotPanel } from '../futures/cot';
import { curveReading, cotTone, daysUntil, futuresPrice, heatStrength, sigmaText } from '../futures/view';
import { compact, createLineChart, dataTable, money, pageFrame, pct, statCards } from '../ui/charts';
import { openChartWindow } from '../ui/chartWindow';
import { activatableRows, h, openModal } from '../ui/dom';
import { infoTip, termLabel } from '../ui/glossary';
import { THEME } from '../ui/theme';
import { xySvg } from '../ui/xyChart';
import { isFuturesSymbol, linkPanel } from '../ui/linkGroups';

interface Positioning {
  date: string;
  commNet: number;
  specNet: number;
  smallNet: number;
  openInterest: number;
  commIndex: number | null;
  specIndex: number | null;
  smallIndex: number | null;
  note: string;
}

interface Row {
  root: string;
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
  price: number | null;
  change: number | null;
  sigma: number | null;
  w1: number | null;
  m1: number | null;
  ytd: number | null;
  hasHistory: boolean;
  quoted: boolean;
  size: string;
  mult: number;
  tick: number;
  tickValue: number;
  notional: number | null;
  contract: string;
  expiry: string;
  roll: string;
  firstNotice: string | null;
  activeSymbol: string | null;
  schwabExpiry: string | null;
  openInterest: number | null;
  positioning: Positioning | null;
}

interface Sector {
  sector: string;
  markets: number;
  priced: number;
  change: number | null;
  best: { root: string; change: number } | null;
  worst: { root: string; change: number } | null;
}

interface Mover {
  root: string;
  name: string;
  change: number | null;
  sigma: number | null;
}

interface Board {
  rows: Row[];
  sectors: Sector[];
  movers: { pct: Mover[]; sigma: Mover[] };
  asOf: number;
  errors: Record<string, string>;
}

interface Contract {
  code: string;
  expiry: string;
  roll: string;
  firstNotice: string | null;
  price?: number | null;
}

interface Curve {
  root: string;
  name: string;
  points: Contract[];
  available: boolean;
  shape: 'contango' | 'backwardation' | 'flat' | null;
}

interface Detail {
  root: string;
  row: Row;
  spec: { size: string; mult: number; tick: number; tickValue: number; exchange: string; hours: string; months: string };
  contracts: Contract[];
  closes: [number, number][];
  cot: (Omit<Positioning, 'note'> & { date: string })[];
  note: string;
  errors: Record<string, string>;
}

const shortDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
const pctCell = (v: number | null | undefined) => ({ v: pct(v), cls: tone(v) });
const indexText = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(0));
const dollars = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
/** A theme colour from the CSS variables (canvas charts can't read CSS, so read it when drawing). */
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const signed = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${compact(v)}`);

export function createFuturesPage() {
  let board: Board | null = null;
  let sector: string | null = null;
  let curveRoot = 'CL';
  const stamp = h('span', { class: 'muted small' });
  const refresh = h('button', { class: 'btn', onclick: () => load(true) }, 'Refresh');
  const ai = insightButton(() =>
    board
      ? {
          topic: 'futures',
          symbol: '',
          title: 'AI read of the futures market',
          data: {
            sectors: board.sectors.map((s) => ({ sector: s.sector, avgChange: s.change, best: s.best, worst: s.worst })),
            movers: board.movers,
            markets: board.rows.map((r) => ({
              market: `${r.root} ${r.name}`,
              sector: r.sector,
              price: r.price,
              change: r.change,
              sigma: r.sigma,
              w1: r.w1,
              m1: r.m1,
              ytd: r.ytd,
              roll: r.roll,
              commercialsIndex: r.positioning?.commIndex ?? null,
              largeSpecsIndex: r.positioning?.specIndex ?? null,
            })),
          },
        }
      : null,
    'AI summary',
  );
  const frame = pageFrame('Futures', 'The whole US futures market at a glance: prices by sector, what’s moving, the curve and who is positioned how. Read-only.', [refresh, ai.button, stamp]);
  const note = h('p', { class: 'ap-note', hidden: true });
  const tiles = h('div', { class: 'fut-tiles' });
  const moving = h('div', { class: 'fut-moving' });
  const boardHead = h('div', { class: 'panel-head' });
  const boardBox = h('div', {});
  const curveSelect = h('select', { class: 'input', 'aria-label': 'Market for the term structure' });
  const curveBox = h('div', {}, h('div', { class: 'skeleton', style: 'height:220px' }));
  const cotBox = h('div', {});
  // COT has one home: this page (the board's table here, any CFTC market or a stock's market in the panel below)
  const cotAny = createCotPanel();

  frame.body.replaceChildren(
    ai.panel,
    note,
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Sectors today'), h('span', { class: 'muted small' }, 'Average day change. Click a sector to filter the board.')), tiles),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'What’s moving'), termLabel('Biggest moves in % and in σ', 'sigma')), moving),
    h('section', { class: 'panel' }, boardHead, boardBox),
    h(
      'div',
      { class: 'two-col fut-lower' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Term structure'), curveSelect), curveBox),
      h(
        'section',
        { class: 'panel', id: 'fut-cot' },
        h('div', { class: 'panel-head' }, h('h3', {}, termLabel('Positioning (COT)', 'cotgroups')), h('span', { class: 'muted small' }, 'Net contracts and the 3-year ', termLabel('COT index', 'cotindex'))),
        cotBox,
      ),
    ),
    cotAny.el,
  );
  curveSelect.addEventListener('change', () => {
    curveRoot = curveSelect.value;
    loadCurve(curveBox, curveRoot);
  });
  // One click handler for every market on the page: chips, board rows and COT rows open the detail panel.
  frame.body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('thead, caption, .info-tip, .fut-tile, select, .insight-panel, #fut-cot-any')) return;
    const el = t.closest<HTMLElement>('[data-root]') ?? t.closest('tbody tr')?.querySelector<HTMLElement>('[data-root]');
    if (el?.dataset.root) openDetail(el.dataset.root);
  });

  function render() {
    if (!board) return;
    const b = board;
    const errs = Object.values(b.errors);
    note.hidden = !errs.length;
    note.textContent = errs.join(' ');
    tiles.replaceChildren(
      h('button', { class: `fut-tile${sector == null ? ' on' : ''}`, onclick: () => setSector(null) }, h('b', {}, 'All markets'), h('span', { class: 'muted small' }, `${b.rows.length} markets`)),
      ...b.sectors.map((s) => {
        const strength = heatStrength(s.change);
        const color = s.change == null ? 'transparent' : `color-mix(in srgb, var(${s.change >= 0 ? '--up' : '--down'}) ${Math.round(8 + strength * 40)}%, transparent)`;
        return h(
          'button',
          { class: `fut-tile${sector === s.sector ? ' on' : ''}`, style: `background:${color}`, 'aria-pressed': String(sector === s.sector), onclick: () => setSector(sector === s.sector ? null : s.sector) },
          h('b', {}, s.sector),
          h('span', { class: `fut-tile-value ${tone(s.change)}` }, s.change == null ? 'unavailable' : pct(s.change)),
          h('span', { class: 'muted small' }, s.best && s.worst && s.priced > 1 ? `${s.best.root} ${pct(s.best.change, 1)} · ${s.worst.root} ${pct(s.worst.change, 1)}` : `${s.priced}/${s.markets} priced`),
        );
      }),
    );
    const chip = (m: Mover, main: 'pct' | 'sigma') =>
      h('button', { class: 'chip fut-chip', 'data-root': m.root, title: m.name }, h('b', {}, m.root), h('span', { class: tone(m.change) }, main === 'pct' ? pct(m.change) : sigmaText(m.sigma)), h('span', { class: 'muted small' }, main === 'pct' ? sigmaText(m.sigma) : pct(m.change)));
    moving.replaceChildren(
      h('div', { class: 'fut-moving-row' }, h('span', { class: 'muted small fut-moving-label' }, 'Biggest % moves'), ...(b.movers.pct.length ? b.movers.pct.map((m) => chip(m, 'pct')) : [h('span', { class: 'muted small' }, 'No prices yet.')])),
      h(
        'div',
        { class: 'fut-moving-row' },
        h('span', { class: 'muted small fut-moving-label' }, 'Most unusual for that market'),
        ...(b.movers.sigma.length ? b.movers.sigma.map((m) => chip(m, 'sigma')) : [h('span', { class: 'muted small' }, 'Needs daily history from Schwab.')]),
      ),
    );
    renderBoard();
    renderCot();
    if (!curveSelect.options.length) {
      for (const r of b.rows) curveSelect.append(h('option', { value: r.root, selected: r.root === curveRoot }, `${r.root} · ${r.name}`));
      loadCurve(curveBox, curveRoot);
    }
  }

  function setSector(s: string | null) {
    sector = s;
    render();
  }

  function visibleRows() {
    return (board?.rows ?? []).filter((r) => sector == null || r.sector === sector);
  }

  function renderBoard() {
    const rows = visibleRows();
    boardHead.replaceChildren(
      h('h3', {}, sector ? `${sector} futures` : 'All futures'),
      h('span', { class: 'muted small' }, 'Front month (', termLabel('what is that?', 'frontmonth'), '). Click a row for details.'),
      ...(sector ? [h('button', { class: 'btn small', onclick: () => setSector(null) }, 'Show all')] : []),
    );
    const headers = ['Market', 'Price', 'Day', 'Move (σ)', '1W', '1M', 'YTD', 'Contract', 'Roll by', 'Multiplier', 'Tick value', 'Notional', 'Commercials (COT)'];
    const table = dataTable(
      headers,
      rows.map((r) => [
        h('span', { class: 'fut-market', 'data-root': r.root, title: `${r.name} · ${r.sector}` }, h('b', {}, r.root), ' ', h('span', { class: 'muted fut-name' }, r.name)),
        { v: futuresPrice(r.price, r.tick), cls: r.price == null ? 'muted' : '' },
        pctCell(r.change),
        { v: sigmaText(r.sigma), cls: r.sigma != null && Math.abs(r.sigma) >= 2 ? `${tone(r.sigma)} fut-strong` : '' },
        pctCell(r.w1),
        pctCell(r.m1),
        pctCell(r.ytd),
        r.contract,
        { v: `${shortDate(r.roll)} (${daysUntil(r.roll)}d)`, cls: daysUntil(r.roll) <= 5 ? 'fut-soon' : '' },
        dollars(r.mult),
        money(r.tickValue),
        money(r.notional),
        { v: indexText(r.positioning?.commIndex), cls: cotTone(r.positioning?.commIndex) },
      ]),
      undefined,
      { id: 'futures:board' },
    );
    table.classList.add('tr-clickable');
    activatableRows(table);
    const head = table.querySelectorAll('th');
    const tips: Record<string, string> = { 'Move (σ)': 'sigma', 'Roll by': 'roll', Multiplier: 'multiplier', 'Tick value': 'tickvalue', Notional: 'notional', 'Commercials (COT)': 'cotindex' };
    head.forEach((th) => {
      const term = tips[th.textContent?.trim() ?? ''];
      if (term) th.append(infoTip(term));
    });
    boardBox.replaceChildren(table, h('p', { class: 'muted small' }, 'Roll and expiry dates are estimates from the exchange rules; check your broker before trading. σ and 1W/1M/YTD use Schwab’s continuous front-month history, so a roll can add a jump (most in CL, NG, LE, HE and VX). "unavailable" = Schwab didn’t send it.'));
  }

  function renderCot() {
    const rows = visibleRows().filter((r) => r.positioning && !['MES', 'MNQ', 'MBT'].includes(r.root));
    if (!rows.length) {
      cotBox.replaceChildren(h('p', { class: 'muted small' }, board?.errors.cot ?? 'No COT data for these markets.'));
      return;
    }
    const table = dataTable(
      ['Market', 'Commercials', 'Large specs', 'Small specs', 'Comm. index', 'Spec index', 'Reading'],
      rows.map((r) => {
        const p = r.positioning!;
        return [
          h('span', { class: 'fut-market', 'data-root': r.root }, h('b', {}, r.root)),
          { v: signed(p.commNet), cls: tone(p.commNet) },
          { v: signed(p.specNet), cls: tone(p.specNet) },
          { v: signed(p.smallNet), cls: tone(p.smallNet) },
          { v: indexText(p.commIndex), cls: cotTone(p.commIndex) },
          indexText(p.specIndex),
          { v: p.commIndex != null && (p.commIndex >= 80 || p.commIndex <= 20) ? p.note : '—', cls: 'fut-note' },
        ];
      }),
      undefined,
      { id: 'futures:cot' },
    );
    table.classList.add('tr-clickable');
    activatableRows(table);
    const date = rows[0].positioning!.date;
    cotBox.replaceChildren(
      table,
      h('p', { class: 'muted small' }, `CFTC report of ${date} (Tuesday positions, published Friday). Larry Williams’ idea: commercials (hedgers) at an extreme, index 80+ or 20-, have often been on the right side of the next big move. A reading, not a signal on its own. Micro contracts share their parent market’s report.`),
    );
  }

  /** A section to bring into view (#futures/cot, "See all on Futures"): now, and once more when the board has drawn. */
  let scrollTarget: string | null = null;
  let boardDrawn = false;
  function scrollTo(selector: string) {
    if (!boardDrawn) scrollTarget = selector;
    requestAnimationFrame(() => frame.el.querySelector(selector)?.scrollIntoView({ block: 'start' }));
  }

  let loading = false;
  async function load(force = false) {
    if (loading) return;
    loading = true;
    if (force) clearEngineCache();
    try {
      board = await engineRequest<Board>('futures.board', {}, 90_000);
      stamp.textContent = `Updated ${new Date(board.asOf * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      render();
      boardDrawn = true;
      if (scrollTarget) scrollTo(scrollTarget);
      scrollTarget = null;
    } catch (err) {
      note.hidden = false;
      note.textContent = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  // The detail window has a link chip: opening a market tells its colour group (/ES), and while the window is open
  // another panel choosing a futures market switches it.
  let detail: { close: () => void } | null = null;
  const link = linkPanel({ id: 'futures', label: 'Futures detail', accepts: isFuturesSymbol, apply: (s) => detail && void openDetail(s.slice(1), false) });

  async function openDetail(root: string, publish = true) {
    detail?.close();
    if (publish) link.publish(`/${root}`);
    const body = h('div', { class: 'fut-detail' }, h('div', { class: 'muted pad' }, 'Loading…'));
    const row = board?.rows.find((r) => r.root === root);
    const mine: { close: () => void } = { close: () => {} };
    mine.close = openModal(row ? `${root} · ${row.name}` : root, h('div', {}, h('div', { class: 'fut-link small muted' }, link.chip, 'Linked panels of this colour follow this market'), body), {
      wide: true,
      noAutofocus: true,
      onClose: () => detail === mine && (detail = null),
    });
    detail = mine;
    try {
      const d = await engineRequest<Detail>('futures.detail', { root }, 60_000);
      renderDetail(body, d);
    } catch (err) {
      body.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  function renderDetail(body: HTMLElement, d: Detail) {
    const r = d.row;
    const priceFmt = (v: number) => futuresPrice(v, d.spec.tick);
    const line = { name: `/${d.root}`, color: THEME.accent, data: d.closes.map(([t, c]) => ({ time: t, value: c })) };
    const openChart = () => openChartWindow({ title: `/${d.root} ${r.name}`, subtitle: 'Daily closes, front month (continuous) from Schwab', lines: [line], format: priceFmt });
    const chartBox = h('div', {});
    const cotChartBox = h('div', {});
    const curveBoxD = h('div', {});
    const fact = (label: Node | string, value: Node | string) => h('div', { class: 'fut-fact' }, h('span', { class: 'muted small' }, label), h('b', {}, value));
    const last = d.cot[d.cot.length - 1];
    body.replaceChildren(
      statCards([
        { label: 'Price', value: futuresPrice(r.price, d.spec.tick) },
        { label: 'Day', value: pct(r.change), tone: tone(r.change) },
        { label: termLabel('Move (σ)', 'sigma'), value: sigmaText(r.sigma) },
        { label: '1 week', value: pct(r.w1), tone: tone(r.w1) },
        { label: '1 month', value: pct(r.m1), tone: tone(r.m1) },
        { label: 'Year to date', value: pct(r.ytd), tone: tone(r.ytd) },
      ]),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Price (1 year)'), d.closes.length ? h('button', { class: 'btn small', onclick: openChart }, 'Open chart window') : null),
        d.closes.length ? chartBox : h('p', { class: 'muted small' }, 'Daily history unavailable: Schwab didn’t return price history for this futures symbol.'),
      ),
      h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Contract specs')),
          h(
            'div',
            { class: 'fut-facts' },
            fact('Contract size', d.spec.size),
            fact(termLabel('Multiplier', 'multiplier'), `${dollars(d.spec.mult)} per 1.00`),
            fact(termLabel('Tick / tick value', 'tickvalue'), `${d.spec.tick < 0.001 ? d.spec.tick.toExponential(1) : +d.spec.tick.toFixed(6)} = ${money(d.spec.tickValue)}`),
            fact(termLabel('Notional', 'notional'), money(r.notional)),
            fact('Margin', 'Set by your broker (and the exchange); check it before trading'),
            fact('Exchange', d.spec.exchange),
            fact('Session (New York time)', d.spec.hours),
            fact(termLabel('Front contract', 'frontmonth'), `${r.contract}${r.activeSymbol ? ` (Schwab quotes ${r.activeSymbol})` : ''}`),
            fact('Last trading day', `${shortDate(r.expiry)}${r.schwabExpiry ? ` (Schwab: ${shortDate(r.schwabExpiry)})` : ''}`),
            r.firstNotice ? fact('First notice day', shortDate(r.firstNotice)) : null,
            fact(termLabel('Roll by', 'roll'), `${shortDate(r.roll)} (${daysUntil(r.roll)} days)`),
          ),
          h('p', { class: 'muted small' }, 'Dates are estimates from the exchange rules (holidays approximate). Specs from the CME Group, ICE and Cboe contract pages.'),
        ),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Term structure')), curveBoxD),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, termLabel('COT index history (3 years)', 'cotindex')), last ? h('span', { class: 'muted small' }, `Latest ${last.date}`) : null),
        d.cot.length
          ? h(
              'div',
              {},
              statCards([
                { label: termLabel('Commercials net', 'cotgroups'), value: signed(last.commNet), hint: `Index ${indexText(last.commIndex)}`, tone: cotTone(last.commIndex) },
                { label: 'Large specs net', value: signed(last.specNet), hint: `Index ${indexText(last.specIndex)}` },
                { label: 'Small specs net', value: signed(last.smallNet), hint: `Index ${indexText(last.smallIndex)}` },
                { label: 'Open interest', value: compact(last.openInterest) },
              ]),
              d.note ? h('p', { class: 'callout' }, d.note) : null,
              cotChartBox,
            )
          : h('p', { class: 'muted small' }, d.errors.cot ?? 'No COT data.'),
      ),
    );
    if (d.closes.length) createLineChart(chartBox, { height: 240, format: priceFmt, title: `/${d.root} ${r.name}` }).set([line]);
    if (d.cot.length) {
      createLineChart(cotChartBox, { height: 240, format: (v) => v.toFixed(0), title: `${d.root} COT index` }).set([
        { name: 'Commercials', color: cssVar('--warn'), data: d.cot.map((c) => ({ time: c.date, value: c.commIndex ?? NaN })) },
        { name: 'Large specs', color: THEME.accent, data: d.cot.map((c) => ({ time: c.date, value: c.specIndex ?? NaN })) },
        { name: 'Small specs', color: cssVar('--muted'), width: 1, data: d.cot.map((c) => ({ time: c.date, value: c.smallIndex ?? NaN })) },
      ]);
    }
    loadCurve(curveBoxD, d.root);
  }

  async function loadCurve(box: HTMLElement, root: string) {
    box.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
    try {
      const c = await engineRequest<Curve>('futures.curve', { root }, 30_000);
      const tick = board?.rows.find((r) => r.root === root)?.tick ?? 0.01;
      const priced = c.points.filter((p): p is Contract & { price: number } => p.price != null);
      if (!c.available) {
        box.replaceChildren(h('p', { class: 'muted small' }, `Schwab didn’t send prices for individual ${root} contracts, so the curve can’t be drawn. Next contracts: ${c.points.map((p) => p.code).join(', ')}.`));
        return;
      }
      const label = (x: number) => c.points[Math.round(x)]?.code ?? '';
      box.replaceChildren(
        xySvg([{ name: root, color: THEME.accent, points: priced.map((p) => ({ x: c.points.indexOf(p), y: p.price })) }], { x: label, y: (v) => futuresPrice(v, tick), xName: 'Contract', height: 200 }),
        h('p', { class: 'small' }, c.shape === 'contango' ? termLabel('Contango', 'contango') : c.shape === 'backwardation' ? termLabel('Backwardation', 'backwardation') : h('b', {}, 'Flat'), ': ', curveReading(c.shape, root)),
        h('p', { class: 'muted small' }, priced.map((p) => `${p.code} ${futuresPrice(p.price, tick)}`).join(' · ')),
      );
    } catch (err) {
      box.replaceChildren(h('p', { class: 'muted small' }, (err as Error).message));
    }
  }

  let started = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    el: frame.el,
    /** Opens one market's detail window (the command bar, e.g. "/ES"). */
    open(root: string) {
      void openDetail(root.toUpperCase());
    },
    /** Shows a CFTC market (code) or a stock's related market in the COT panel (other pages' "See all on Futures"). */
    openCot(target: { code?: string; symbol?: string }) {
      scrollTo('#fut-cot-any');
      void cotAny.show(target).then(() => scrollTo('#fut-cot-any')); // again once its charts have height
    },
    /** sub 'cot' (#futures/cot, and the old #flow/cot): scroll to the positioning section. */
    start(sub = '') {
      if (!started) {
        started = true;
        load();
        cotAny.start();
      }
      if (sub === 'cot') scrollTo('#fut-cot');
      // Quotes refresh every minute while the page is open (Schwab is asked at most every 15 s by the helper).
      timer ??= setInterval(() => load(), 60_000);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
