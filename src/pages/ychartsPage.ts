/**
 * Markets → YCharts (#ycharts, code YC): any figure YCharts has, for any company or ETF, mutual fund (M:TICKER), index
 * (^SPX) or economic indicator (I:...), with the owner's own YCharts API key (Settings > Data connections > YCharts).
 *   - the latest value of every metric typed (one row each; a metric the plan doesn't include says so);
 *   - their history over the chosen dates as lines (one chart, each metric scaled to start at 100 when several are
 *     compared, so different units fit), and the table of points with filters and CSV;
 *   - several ids at once (comma-separated) to compare one metric across companies or funds.
 *   - YCharts' own calculations over a period (average, highest and when, % change, standard deviation ...) and
 *     resampling (weekly, monthly ...), with the Excel add-in;
 *   - "Find a metric": search every code in the owner's YCharts reference workbook (loaded once, kept in this browser).
 * Codes are YCharts' own; examples per kind fill the boxes.
 */
import { helper, HELPER_NOT_RUNNING } from '../data/schwab';
import { CALCULATIONS, EXAMPLES, FREQUENCIES, KIND_LABELS, YCHARTS_EXCEL_HELPER_VERSION, YCHARTS_HELPER_VERSION, importCatalog, loadCatalog, searchCatalog, yCalc, yFormat, yPoints, ySeries, yStatus, ychartsReady, type YKind } from '../data/ycharts';
import { createLineChart, pageFrame, type LineSpec } from '../ui/charts';
import { h } from '../ui/dom';
import { tableTools } from '../ui/tableTools';

const KINDS: YKind[] = ['companies', 'mutual_funds', 'indices', 'indicators'];
const COLORS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', '#b79cff', '#f2c14e', '#f07aa8'];
const KEY = 'tp-ycharts-explorer';

const list = (s: string, upper = false) => s.split(',').map((x) => (upper ? x.trim().toUpperCase() : x.trim().toLowerCase())).filter(Boolean);
const yearsAgo = (n: number) => new Date(Date.now() - n * 365.25 * 86400e3).toISOString().slice(0, 10);

/** Draws lines with real CSS colours (the chart can't read variables). */
const colourOf = (i: number) => {
  const c = COLORS[i % COLORS.length];
  return c.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() || '#5aaae6' : c;
};

export function createYchartsPage() {
  const kind = h('select', { class: 'input', 'aria-label': 'What to look up' }, ...KINDS.map((k) => h('option', { value: k }, KIND_LABELS[k])));
  const ids = h('input', { class: 'input yc-ids', 'aria-label': 'YCharts ids (comma-separated)', placeholder: 'AAPL, MSFT' });
  const metrics = h('input', { class: 'input yc-metrics', 'aria-label': 'Metric codes (comma-separated)', placeholder: 'price, pe_ratio' });
  const start = h('input', { class: 'input', type: 'date', 'aria-label': 'From', value: yearsAgo(5) });
  const end = h('input', { class: 'input', type: 'date', 'aria-label': 'To' });
  const freq = h('select', { class: 'input', 'aria-label': 'Frequency' }, ...FREQUENCIES.map(([v, l]) => h('option', { value: v }, l)));
  const go = h('button', { type: 'button', class: 'btn primary' }, 'Show');
  const test = h('button', { type: 'button', class: 'btn' }, 'Test YCharts');
  // Find a metric: every code in the owner's YCharts reference workbook
  const find = h('input', { class: 'input yc-find', type: 'search', 'aria-label': 'Find a YCharts metric by name', placeholder: 'Find a metric by name, e.g. free cash flow, sharpe, expense' });
  const found = h('div', { class: 'yc-found', role: 'list' });
  const fileIn = h('input', { type: 'file', accept: '.xlsx', class: 'visually-hidden', 'aria-label': 'YCharts reference workbook' }) as HTMLInputElement;
  const loadRef = h('button', { type: 'button', class: 'btn' }, 'Load my YCharts reference sheet');
  const catNote = h('span', { class: 'muted small' });
  // Calculate: YCharts' own statistic of each metric over the dates
  const calcSel = h('select', { class: 'input', 'aria-label': 'Calculation' }, ...CALCULATIONS.map(([v, l]) => h('option', { value: v }, l)));
  const calcGo = h('button', { type: 'button', class: 'btn' }, 'Calculate');
  const calcOut = h('div', { class: 'yc-calc-out' });
  const examples = h('div', { class: 'chip-row yc-examples' });
  const frame = pageFrame('YCharts', 'Any YCharts figure for companies, ETFs, mutual funds, indexes and economic indicators, with your YCharts API key.', [test]);
  const latest = h('div', { class: 'panel yc-latest' });
  const chartBox = h('div', { class: 'yc-chart' });
  const chartPanel = h('div', { class: 'panel yc-chart-panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'History')), chartBox, h('p', { class: 'muted small yc-chart-note' }));
  const tableBox = h('div', { class: 'panel yc-table' });
  const status = h('p', { class: 'muted small yc-status', role: 'status' });
  frame.body.append(
    h('div', { class: 'panel yc-form' }, h('div', { class: 'yc-row' }, kind, ids, metrics, start, end, freq, go), examples, status),
    h('div', { class: 'panel yc-find-panel' }, h('div', { class: 'yc-row' }, find, loadRef, fileIn), catNote, found),
    h('div', { class: 'yc-grid' }, latest, chartPanel),
    h('div', { class: 'panel yc-calc' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Calculate over the dates above')), h('div', { class: 'yc-row' }, calcSel, calcGo), calcOut),
    tableBox,
  );
  let catalog = loadCatalog();
  const showCatNote = () =>
    (catNote.textContent = catalog.length
      ? `${catalog.length.toLocaleString('en-US')} YCharts metrics from your reference sheet (kept in this browser). Click one to add it.`
      : 'Load your YCharts Excel reference workbook once to search every metric YCharts offers by name.');
  showCatNote();
  const kindGroup = () => ({ companies: 'Company', mutual_funds: 'Mutual Fund', indices: 'Company', indicators: 'Macroeconomic' })[kind.value as YKind];
  find.addEventListener('input', () => {
    const hits = searchCatalog(catalog, find.value.trim(), kindGroup());
    found.replaceChildren(
      ...hits.map((e) =>
        h(
          'button',
          {
            type: 'button',
            class: 'chip yc-hit',
            role: 'listitem',
            title: `${e.name} · ${e.group}`,
            onclick: () => {
              const now = metrics.value.split(',').map((x) => x.trim()).filter(Boolean);
              if (!now.includes(e.code)) metrics.value = [...now, e.code].join(', ');
            },
          },
          h('b', {}, e.name),
          h('span', { class: 'muted' }, ` ${e.code} · ${e.group}`),
        ),
      ),
      ...(find.value.trim() && !hits.length ? [h('p', { class: 'muted small' }, catalog.length ? 'No metric matches.' : 'Load your reference sheet first.')] : []),
    );
  });
  loadRef.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files?.[0];
    if (!file) return;
    catNote.textContent = 'Reading the workbook…';
    try {
      const n = await importCatalog(file);
      catalog = loadCatalog();
      catNote.textContent = `Loaded ${n.toLocaleString('en-US')} metrics.`;
      find.dispatchEvent(new Event('input'));
    } catch (err) {
      catNote.textContent = (err as Error).message;
    }
    fileIn.value = '';
  });
  calcGo.addEventListener('click', () => void calculate());
  let chart: ReturnType<typeof createLineChart> | null = null;

  const fillExamples = () => {
    const ex = EXAMPLES[kind.value as YKind];
    examples.replaceChildren(
      h('span', { class: 'muted small' }, 'Examples:'),
      ...ex.metrics.map((code) => h('button', { type: 'button', class: 'chip', onclick: () => ((metrics.value = code), void run()) }, code)),
      h('span', { class: 'muted small' }, ` · id like ${ex.id}`),
    );
  };

  function remember() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ kind: kind.value, ids: ids.value, metrics: metrics.value, start: start.value }));
    } catch {
      /* not remembered */
    }
  }

  /** The ids and codes to ask for, or null after saying why not. */
  async function ask(): Promise<{ k: YKind; idList: string[]; codes: string[] } | null> {
    if (!helper.isConnected) return void (status.textContent = HELPER_NOT_RUNNING), null;
    if ((helper.version ?? 0) < YCHARTS_HELPER_VERSION) return void (status.textContent = `YCharts needs helper ${YCHARTS_EXCEL_HELPER_VERSION} or newer (it installs by itself).`), null;
    const ready = await ychartsReady();
    if (!ready.ready) return void (status.textContent = 'YCharts works through the YCharts Excel add-in on Windows, or add a YCharts API key in Settings > Data connections.'), null;
    const k = kind.value as YKind;
    const idList = list(ids.value || EXAMPLES[k].id, true);
    const codes = list(metrics.value || EXAMPLES[k].metrics.slice(0, 2).join(','));
    if (!idList.length || !codes.length) return void (status.textContent = 'Type at least one id and one metric code.'), null;
    return { k, idList, codes };
  }

  async function calculate() {
    const a = await ask();
    if (!a) return;
    if ((helper.version ?? 0) < YCHARTS_EXCEL_HELPER_VERSION) return void (calcOut.textContent = `Calculations need helper ${YCHARTS_EXCEL_HELPER_VERSION} (it installs by itself).`);
    if (!start.value) return void (calcOut.textContent = 'Pick a start date above.');
    const label = CALCULATIONS.find(([v]) => v === calcSel.value)?.[1] ?? calcSel.value;
    calcOut.textContent = 'Asking YCharts (Excel)…';
    try {
      const r = await yCalc(a.k, a.idList, a.codes, start.value, end.value || undefined, calcSel.value);
      calcOut.replaceChildren(
        h(
          'table',
          { class: 'data-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Id'), h('th', {}, 'Metric'), h('th', { class: 'num' }, label), h('th', {}, 'Date'))),
          h('tbody', {}, ...a.idList.flatMap((id) => a.codes.map((c) => {
            const v = r.results[id]?.[c];
            const pctLike = calcSel.value === 'pct_change';
            return h('tr', {}, h('td', {}, id), h('td', {}, c), h('td', { class: 'num' }, v?.value != null ? yFormat(v.value, pctLike ? 'pct' : 'num') : h('span', { class: 'muted small' }, v?.error ?? 'no value')), h('td', { class: 'muted small' }, v?.date ?? ''));
          }))),
        ),
        h('p', { class: 'muted small' }, `${label} from ${start.value} to ${end.value || 'today'}, calculated by YCharts.`),
      );
    } catch (err) {
      calcOut.textContent = `YCharts: ${(err as Error).message}`;
    }
  }

  async function run() {
    const a = await ask();
    if (!a) return;
    const { k, idList, codes } = a;
    remember();
    location.hash = `#ycharts/${k}/${encodeURIComponent(idList.join(','))}`;
    status.textContent = 'Asking YCharts…';
    try {
      const [p, s] = await Promise.all([yPoints(k, idList, codes), ySeries(k, idList, codes, start.value || undefined, end.value || undefined, freq.value || undefined)]);
      // latest values
      latest.replaceChildren(
        h('div', { class: 'panel-head' }, h('h3', {}, 'Latest values')),
        h(
          'table',
          { class: 'data-table yc-latest-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Id'), h('th', {}, 'Metric'), h('th', { class: 'num' }, 'Value'), h('th', {}, 'As of'))),
          h(
            'tbody',
            {},
            ...idList.flatMap((id) =>
              codes.map((c) => {
                const v = p.results[id]?.[c];
                return h('tr', {}, h('td', {}, id), h('td', {}, c), h('td', { class: 'num' }, v?.value != null ? yFormat(v.value, 'num') : h('span', { class: 'muted small' }, v?.error ?? 'no value')), h('td', { class: 'muted small' }, v?.date ?? ''));
              }),
            ),
          ),
        ),
      );
      // history: each id x metric a line; several lines are rebased to 100 so different units compare
      const lines: { name: string; pts: [string, number][] }[] = [];
      for (const id of idList) for (const c of codes) {
        const r = s.results[id]?.[c];
        if (r?.points.length) lines.push({ name: `${id} ${c}`, pts: r.points });
      }
      const rebase = lines.length > 1;
      const specs: LineSpec[] = lines.map((l, i) => {
        const base = l.pts[0][1];
        return { name: l.name, color: colourOf(i), data: l.pts.map(([d, v]) => ({ time: d.slice(0, 10), value: rebase && base ? (v / base) * 100 : v })) };
      });
      chart ??= createLineChart(chartBox, { height: 320, title: 'YCharts history', expand: true });
      chart.set(specs);
      (chartPanel.querySelector('.yc-chart-note') as HTMLElement).textContent = !specs.length
        ? 'No history came back for these codes and dates.'
        : rebase
          ? 'Several lines: each starts at 100 so different units compare (the table below has the real values).'
          : `${specs[0].name}: real values.`;
      // all points as a table (filters, sort, CSV)
      const dates = [...new Set(lines.flatMap((l) => l.pts.map(([d]) => d.slice(0, 10))))].sort().reverse();
      const byLine = lines.map((l) => new Map(l.pts.map(([d, v]) => [d.slice(0, 10), v])));
      const table = h(
        'table',
        { class: 'data-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Date'), ...lines.map((l) => h('th', { class: 'num' }, l.name)))),
        h('tbody', {}, ...dates.map((d) => h('tr', {}, h('td', {}, d), ...byLine.map((m) => h('td', { class: 'num' }, m.has(d) ? yFormat(m.get(d)!, 'num') : '—'))))),
      ) as HTMLTableElement;
      tableBox.replaceChildren(h('div', { class: 'panel-head' }, h('h3', {}, `All points (${dates.length})`)), h('div', { class: 'table-scroll' }, table));
      if (dates.length) tableTools(table, { id: 'ycharts-points', minRowsForFilters: 5 });
      status.textContent = `YCharts · ${new Date(p.fetched).toLocaleString('en-US')}`;
    } catch (err) {
      status.textContent = `YCharts: ${(err as Error).message}`;
    }
  }

  kind.addEventListener('change', () => {
    ids.value = '';
    metrics.value = '';
    ids.placeholder = EXAMPLES[kind.value as YKind].id;
    fillExamples();
  });
  go.addEventListener('click', () => void run());
  for (const input of [ids, metrics]) input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && void run());
  test.addEventListener('click', async () => {
    status.textContent = 'Testing YCharts (through Excel this can take a minute the first time)…';
    const r = await yStatus().catch((err: Error) => ({ ok: false, message: err.message }));
    status.textContent = r.message;
  });

  return {
    el: frame.el,
    start() {
      // #ycharts/<kind>/<ids> from a security's YCharts panel; else what was used last
      const [, k, idPart] = location.hash.slice(1).split('/');
      let saved: { kind?: string; ids?: string; metrics?: string; start?: string } = {};
      try {
        saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      } catch {
        /* none */
      }
      kind.value = KINDS.includes(k as YKind) ? k : KINDS.includes(saved.kind as YKind) ? saved.kind! : 'companies';
      ids.value = idPart ? decodeURIComponent(idPart) : saved.ids ?? '';
      metrics.value = saved.metrics ?? '';
      if (saved.start) start.value = saved.start;
      fillExamples();
      if (idPart) void run();
    },
  };
}
