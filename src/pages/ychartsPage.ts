/**
 * Markets → YCharts (#ycharts, code YC): any figure YCharts has, for any company or ETF, mutual fund (M:TICKER), index
 * (^SPX) or economic indicator (I:...), with the owner's own YCharts API key (Settings > Data connections > YCharts).
 *   - the latest value of every metric typed (one row each; a metric the plan doesn't include says so);
 *   - their history over the chosen dates as lines (one chart, each metric scaled to start at 100 when several are
 *     compared, so different units fit), and the table of points with filters and CSV;
 *   - several ids at once (comma-separated) to compare one metric across companies or funds.
 * Codes are YCharts' own (its API documentation lists them all); examples per kind fill the boxes.
 */
import { helper, HELPER_NOT_RUNNING } from '../data/schwab';
import { EXAMPLES, KIND_LABELS, YCHARTS_HELPER_VERSION, yFormat, yPoints, ySeries, yStatus, ychartsKeySet, type YKind } from '../data/ycharts';
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
  const go = h('button', { type: 'button', class: 'btn primary' }, 'Show');
  const test = h('button', { type: 'button', class: 'btn' }, 'Test my key');
  const examples = h('div', { class: 'chip-row yc-examples' });
  const frame = pageFrame('YCharts', 'Any YCharts figure for companies, ETFs, mutual funds, indexes and economic indicators, with your YCharts API key.', [test]);
  const latest = h('div', { class: 'panel yc-latest' });
  const chartBox = h('div', { class: 'yc-chart' });
  const chartPanel = h('div', { class: 'panel yc-chart-panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'History')), chartBox, h('p', { class: 'muted small yc-chart-note' }));
  const tableBox = h('div', { class: 'panel yc-table' });
  const status = h('p', { class: 'muted small yc-status', role: 'status' });
  frame.body.append(
    h('div', { class: 'panel yc-form' }, h('div', { class: 'yc-row' }, kind, ids, metrics, start, end, go), examples, status),
    h('div', { class: 'yc-grid' }, latest, chartPanel),
    tableBox,
  );
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

  async function run() {
    if (!helper.isConnected) return void (status.textContent = HELPER_NOT_RUNNING);
    if ((helper.version ?? 0) < YCHARTS_HELPER_VERSION) return void (status.textContent = `YCharts needs helper ${YCHARTS_HELPER_VERSION} or newer (it installs by itself).`);
    if (!(await ychartsKeySet())) return void (status.textContent = 'Add your YCharts API key in Settings > Data connections > YCharts first.');
    const k = kind.value as YKind;
    const idList = list(ids.value || EXAMPLES[k].id, true);
    const codes = list(metrics.value || EXAMPLES[k].metrics.slice(0, 2).join(','));
    if (!idList.length || !codes.length) return void (status.textContent = 'Type at least one id and one metric code.');
    remember();
    location.hash = `#ycharts/${k}/${encodeURIComponent(idList.join(','))}`;
    status.textContent = 'Asking YCharts…';
    try {
      const [p, s] = await Promise.all([yPoints(k, idList, codes), ySeries(k, idList, codes, start.value || undefined, end.value || undefined)]);
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
    status.textContent = 'Testing your YCharts key…';
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
