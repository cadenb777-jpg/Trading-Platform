/**
 * Ideas → Screener (Bloomberg EQS layout, owner's spec 7.10): left, the universe (Nasdaq-100, narrowed by sector) and
 * the criteria rows (field, operator, value), each with a running count of how many stocks still pass; right, the
 * matches with one column per criterion, sortable, and the median of the matches at the bottom. Ready-made screens
 * fill the criteria in one click; your criteria are remembered. Free data: Schwab quotes and daily closes.
 */
import { engineRequest, helper, HELPER_NOT_RUNNING } from '../data/schwab';
import type { BoardRow } from '../invest/shared';
import { FIELDS, PRESETS, fieldOf, median, runScreen, type Criterion, type FieldKey, type Op, type ScreenRow } from '../screener/screen';
import { SECTOR_LISTS } from '../security/related';
import { openSecurity } from '../security/open';
import { formatPrice, h } from '../ui/dom';
import { fnTile, numberRow } from '../ui/fnTile';

const KEY = 'tp-screener';
const SECTOR_OF = Object.fromEntries(Object.entries(SECTOR_LISTS).flatMap(([s, syms]) => syms.split(' ').map((x) => [x, s])));
const UNIVERSE = Object.keys(SECTOR_OF);

const load = (): { criteria: Criterion[]; sectors: string[] } => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && Array.isArray(v.criteria)) return { criteria: v.criteria, sectors: Array.isArray(v.sectors) ? v.sectors : [] };
  } catch {
    /* fall through */
  }
  return { criteria: PRESETS[0].criteria, sectors: [] };
};

const show = (k: FieldKey, v: number | null) => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (k === 'price') return formatPrice(v);
  if (k === 'pe') return v > 0 ? `${v.toFixed(1)}×` : 'n/m';
  const p = v * 100;
  return `${p > 0 && k !== 'divYield' ? '+' : ''}${p.toFixed(1)}%`;
};
const tone = (k: FieldKey, v: number | null) => (v == null || k === 'pe' || k === 'price' || k === 'divYield' || Math.abs(v) < 5e-5 ? '' : v > 0 ? 'up' : 'down');

export function createScreenerPage() {
  let st = load();
  let rows: ScreenRow[] = [];
  let sortKey: FieldKey | 'symbol' = 'change';
  let sortDir = -1;
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch {
      /* not remembered */
    }
  };

  const builder = fnTile({ title: 'Screen', cls: 'scr-builder', tip: 'Every row narrows the list; the number on the right is how many stocks still pass' });
  const results = fnTile({ title: 'Matches', cls: 'scr-results' });
  const el = h(
    'div',
    { class: 'analysis-page screener-page' },
    h('header', { class: 'ap-header' }, h('div', {}, h('h1', {}, 'Screener'), h('p', { class: 'muted' }, 'Find Nasdaq-100 stocks by performance, valuation and dividends. Each criterion narrows the list.'))),
    h('div', { class: 'scr-grid' }, builder.el, results.el),
  );

  const drawBuilder = (counts: number[], universe: number) => {
    const opSel = (c: Criterion, i: number) =>
      h(
        'select',
        { class: 'input', 'aria-label': 'Operator', onchange: (e: Event) => ((st.criteria[i] = { ...c, op: (e.target as HTMLSelectElement).value as Op }), save(), draw()) },
        ...(['>', '<', 'between'] as Op[]).map((o) => h('option', { value: o, selected: o === c.op }, o === '>' ? 'above' : o === '<' ? 'below' : 'between')),
      );
    const num = (v: number | undefined, set: (n: number) => void, label: string) =>
      h('input', { class: 'input scr-num', type: 'number', step: 'any', value: v == null ? '' : String(v), 'aria-label': label, onchange: (e: Event) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) { set(n); save(); draw(); } } });
    const crit = st.criteria.map((c, i) =>
      h(
        'div',
        { class: 'scr-row' },
        h(
          'select',
          { class: 'input', 'aria-label': 'Field', onchange: (e: Event) => ((st.criteria[i] = { ...c, field: (e.target as HTMLSelectElement).value as FieldKey }), save(), draw()) },
          ...FIELDS.map((f) => h('option', { value: f.key, selected: f.key === c.field, title: f.tip }, f.label)),
        ),
        opSel(c, i),
        num(c.a, (n) => (st.criteria[i] = { ...st.criteria[i], a: n }), 'Value'),
        c.op === 'between' ? h('span', { class: 'muted small' }, 'and') : '',
        c.op === 'between' ? num(c.b, (n) => (st.criteria[i] = { ...st.criteria[i], b: n }), 'Second value') : '',
        h('span', { class: 'scr-unit muted small' }, fieldOf(c.field).pct ? '%' : c.field === 'pe' ? '×' : '$'),
        h('b', { class: 'scr-count num', title: 'Stocks that still pass after this row' }, rows.length ? String(counts[i] ?? '—') : '…'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Remove this criterion', 'aria-label': 'Remove this criterion', onclick: () => (st.criteria.splice(i, 1), save(), draw()) }, '×'),
      ),
    );
    const sectorChips = h(
      'div',
      { class: 'scr-chips', role: 'group', 'aria-label': 'Sectors' },
      ...Object.keys(SECTOR_LISTS).map((s) =>
        h('button', { type: 'button', class: `scr-chip ${st.sectors.includes(s) ? 'on' : ''}`, 'aria-pressed': String(st.sectors.includes(s)), onclick: () => ((st.sectors = st.sectors.includes(s) ? st.sectors.filter((x) => x !== s) : [...st.sectors, s]), save(), draw()) }, s),
      ),
    );
    builder.body.replaceChildren(
      h('div', { class: 'scr-sec' }, h('h4', {}, 'Universe'), h('p', { class: 'scr-universe' }, h('b', { class: 'num' }, rows.length ? String(universe) : '…'), ` Nasdaq-100 stocks${st.sectors.length ? ' in the sectors picked' : ' (all sectors)'}`), sectorChips),
      h('div', { class: 'scr-sec' }, h('h4', {}, 'Criteria'), ...crit, h('button', { type: 'button', class: 'btn small', onclick: () => (st.criteria.push({ field: 'ytd', op: '>', a: 0 }), save(), draw()) }, '+ Add criterion')),
      h('div', { class: 'scr-sec' }, h('h4', {}, 'Ready-made screens'), h('div', { class: 'scr-presets' }, ...PRESETS.map((p) => h('button', { type: 'button', class: 'btn small', onclick: () => ((st = { ...st, criteria: p.criteria.map((c) => ({ ...c })) }), save(), draw()) }, p.name)))),
    );
  };

  const drawResults = (matches: ScreenRow[]) => {
    const cols: FieldKey[] = [...new Set<FieldKey>(['price', 'change', ...st.criteria.map((c) => c.field), 'ytd'])];
    const sorted = [...matches].sort((a, b) => {
      if (sortKey === 'symbol') return sortDir * a.symbol.localeCompare(b.symbol);
      const x = a[sortKey] ?? -Infinity;
      const y = b[sortKey] ?? -Infinity;
      return sortDir * ((x as number) - (y as number));
    });
    const th = (k: FieldKey | 'symbol', label: string, cls = 'num') =>
      h('th', { class: `${cls} scr-sort ${sortKey === k ? 'on' : ''}`, 'aria-sort': sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none', onclick: () => ((sortDir = sortKey === k ? -sortDir : -1), (sortKey = k), draw()) }, label, sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
    let n = 1;
    results.body.replaceChildren(
      matches.length
        ? h(
            'div',
            { class: 'sv-table-wrap' },
            h(
              'table',
              { class: 'mon-table scr-table' },
              h('thead', {}, h('tr', {}, h('th', { class: 'num-col' }, '#'), th('symbol', 'Stock', ''), ...cols.map((k) => th(k, fieldOf(k).label)))),
              h(
                'tbody',
                {},
                ...sorted.map((r) => {
                  const tr = h(
                    'tr',
                    { class: 'mon-row', tabindex: 0, title: `${r.name}: open it`, onclick: () => void openSecurity(r.symbol), onkeydown: (e: Event) => void ((e as KeyboardEvent).key === 'Enter' && openSecurity(r.symbol)) },
                    h('td', { class: 'num-col' }, String(n)),
                    h('td', {}, h('span', { class: 'mon-name' }, r.symbol), h('span', { class: 'mon-sym' }, r.sector)),
                    ...cols.map((k) => h('td', { class: `num ${tone(k, r[k])}` }, show(k, r[k]))),
                  );
                  return numberRow(tr, n++, r.symbol);
                }),
              ),
              h('tfoot', {}, h('tr', { class: 'rv-stat' }, h('td', {}), h('th', { scope: 'row' }, 'Median'), ...cols.map((k) => h('td', { class: 'num' }, show(k, median(matches, k)))))),
            ),
          )
        : h('p', { class: 'muted' }, rows.length ? 'No stock passes every criterion. Loosen one (the counts on the left show which row removes the most).' : 'Loading prices…'),
    );
    results.foot(`${matches.length} match${matches.length === 1 ? '' : 'es'} · Schwab quotes and daily closes · equal treatment, no paid data`);
  };

  const draw = () => {
    const r = runScreen(rows, st.criteria, st.sectors);
    drawBuilder(r.counts, r.universe);
    drawResults(r.matches);
  };

  async function loadRows() {
    try {
      const parts = [UNIVERSE.slice(0, 60), UNIVERSE.slice(60)];
      const replies = await Promise.all(parts.map((symbols) => engineRequest<{ rows: BoardRow[] }>('invest.board', { symbols }, 120000)));
      rows = replies.flatMap((x) => x.rows).map((b) => ({
        symbol: b.symbol,
        name: b.name || b.symbol,
        sector: SECTOR_OF[b.symbol] ?? 'Other',
        price: b.price,
        change: b.change,
        m1: b.m1 ?? null,
        m3: b.m3 ?? null,
        ytd: b.ytd ?? null,
        y1: b.y1 ?? null,
        pe: b.peRatio ?? null,
        divYield: b.divYield ?? null,
        offHigh: b.price != null && b.high52 ? b.price / b.high52 - 1 : null,
      }));
      draw();
    } catch (err) {
      results.body.replaceChildren(h('p', { class: 'ap-error' }, helper.status.status === 'live' ? (err as Error).message : HELPER_NOT_RUNNING));
    }
  }

  draw();
  let started = false;
  return {
    el,
    start() {
      if (!started) {
        started = true;
        void loadRows();
      }
    },
  };
}
