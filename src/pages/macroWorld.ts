/**
 * Macro > World: a compact multi-country table grouped by region (Americas / Europe / Asia-Pacific, like
 * Bloomberg's WEI/ECO) from the World Bank, IMF and OECD, plus US and euro-area detail panels (BLS, BEA, Census,
 * Treasury, ECB, EIA). Every figure shows its period and source; clicking one opens a pop-out chart.
 */
import { insightButton } from '../ai/insight';
import { HELPER_NOT_RUNNING, HELPER_UPDATE_FOR_FEATURE, clearEngineCache, engineRequest, helper, worldAvailable } from '../data/schwab';
import { changeText, fmtPeriod, fmtWorld, groupByRegion, pickCountries, sparkPath, type PanelSeries, type WorldCell, type WorldPanel, type WorldTable } from '../macro/world';
import { openChartWindow } from '../ui/chartWindow';
import { asOfStamp } from '../ui/dataHealth';
import { activatable, h } from '../ui/dom';
import { THEME } from '../ui/theme';

const SAVED = 'tp-world-countries';
const PANELS: { id: string; title: string }[] = [
  { id: 'bls', title: 'US prices, wages and jobs (BLS)' },
  { id: 'bea', title: 'US GDP by component and PCE prices (BEA)' },
  { id: 'census', title: 'US retail sales (Census)' },
  { id: 'fiscal', title: 'US debt, cash and auctions (Treasury)' },
  { id: 'ecb', title: 'Euro area (ECB)' },
  { id: 'eia', title: 'US oil and gasoline (EIA)' },
];

const readSaved = (): string[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) || 'null');
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
};
const writeSaved = (codes: string[]) => {
  try {
    localStorage.setItem(SAVED, JSON.stringify(codes));
  } catch {
    /* private window: the choice lasts this visit only */
  }
};

const SVG = 'http://www.w3.org/2000/svg';
/** A tiny sparkline (inline SVG coloured by CSS tokens). The forecast part of IMF data is drawn dashed. */
export function sparkline(data: { time: string; value: number }[], forecastFrom?: string, w = 72, hgt = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(hgt));
  svg.setAttribute('class', 'wm-spark');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', sparkPath(data.map((p) => p.value), w, hgt));
  svg.append(path);
  if (forecastFrom) {
    const i = data.findIndex((p) => p.time >= forecastFrom);
    if (i > 0) {
      const all = sparkPath(data.map((p) => p.value), w, hgt).split(' L');
      // Same scale as the full line: the tail from the last actual year is dashed.
      const tail = document.createElementNS(SVG, 'path');
      tail.setAttribute('d', `M${all.slice(i - 1).join(' L').replace(/^M/, '')}`);
      tail.setAttribute('class', 'wm-forecast');
      svg.append(tail);
      path.setAttribute('d', all.slice(0, i).join(' L'));
    }
  }
  return svg;
}

export function createWorldTab() {
  let table: WorldTable | null = null;
  let selected: string[] = [];
  const picker = h('div', { class: 'wm-picker', role: 'group', 'aria-label': 'Countries' });
  const tableBox = h('div', { class: 'panel wm-table-panel' }, h('div', { class: 'skeleton', style: 'height:320px' }));
  const errorsBox = h('div', { class: 'wm-errors' });
  const stamp = asOfStamp(null, { source: 'World Bank · IMF · OECD', refreshMs: 0 });
  const panelGrid = h('div', { class: 'wm-panels' });
  const panelData = new Map<string, WorldPanel>();
  const ai = insightButton(() => {
    if (!table) return null;
    const rows = table.rows.filter((r) => selected.includes(r.code)).map((r) => ({
      country: r.name, region: r.region,
      ...Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, c ? { value: c.value, period: c.period, source: c.source, next: c.next, phase: c.phase } : null])),
    }));
    const detail = Object.fromEntries([...panelData].map(([k, p]) => [k, p.needsKey ? p.note : p.series.map((s) => ({ name: s.name, unit: s.unit, date: s.date, value: s.value, previous: s.previous }))]));
    return { topic: 'world', symbol: '', title: 'AI read: the world economy', data: { countries: rows, detail } };
  });

  const el = h(
    'div',
    { class: 'wm' },
    h(
      'div',
      { class: 'wm-head' },
      h('div', {}, h('h2', { class: 'group-title' }, 'World economy'), h('p', { class: 'muted small' }, 'Latest yearly figures (World Bank), IMF forecasts for this year and next, and OECD leading indicators (100 = long-run trend). Click a figure for its history, a column name to compare countries.')),
      h('div', { class: 'wm-tools' }, stamp.el, ai.button, h('button', { class: 'btn', onclick: () => (clearEngineCache('world.'), load(true)) }, 'Refresh')),
    ),
    ai.panel,
    picker,
    errorsBox,
    tableBox,
    h('h2', { class: 'group-title' }, 'US and euro-area detail'),
    panelGrid,
    h('p', { class: 'ap-note' }, 'Sources: World Bank, IMF World Economic Outlook (DataMapper), OECD, BLS, BEA, US Census, US Treasury Fiscal Data, ECB and EIA. All free; some need a free key (Settings > Data connections).'),
  );

  function renderPicker() {
    if (!table) return;
    const all = table.countries.map((c) => c.code);
    const set = (codes: string[]) => {
      selected = pickCountries(codes, all);
      writeSaved(selected);
      renderPicker();
      renderTable();
    };
    picker.replaceChildren(
      h('button', { class: `chip${selected.length === all.length ? ' on' : ''}`, 'aria-pressed': selected.length === all.length, onclick: () => set(all) }, 'All'),
      ...groupByRegion(table.countries).map((g) =>
        h(
          'span',
          { class: 'wm-pick-group' },
          h('span', { class: 'muted small wm-pick-region' }, g.region),
          ...g.rows.map((c) => {
            const on = selected.includes(c.code);
            return h(
              'button',
              {
                class: `chip${on ? ' on' : ''}`, 'aria-pressed': on, title: c.name,
                onclick: () => set(on ? selected.filter((x) => x !== c.code) : [...selected, c.code]),
              },
              c.code,
            );
          }),
        ),
      ),
    );
  }

  function openCell(country: string, indicator: string, unit: string, cell: WorldCell) {
    openChartWindow({
      title: `${country}: ${indicator}`,
      subtitle: `${cell.source} · latest ${fmtPeriod(cell.period)}${cell.forecastFrom ? ` · IMF forecast from ${cell.forecastFrom.slice(0, 4)}` : ''}${cell.asOf ? ` · updated ${cell.asOf}` : ''}`,
      lines: [{ name: country, color: THEME.viz1, data: cell.data }],
      format: (v) => fmtWorld(v, unit),
      changeAs: unit ? 'points' : 'percent',
    });
  }

  function compare(key: string) {
    if (!table) return;
    const ind = table.indicators.find((i) => i.key === key)!;
    const colors = [THEME.viz1, THEME.viz2, THEME.viz3, THEME.accent, THEME.up, THEME.down];
    const lines = table.rows
      .filter((r) => selected.includes(r.code) && r.cells[key])
      .slice(0, colors.length)
      .map((r, i) => ({ name: r.name, color: colors[i], data: r.cells[key]!.data }));
    if (!lines.length) return;
    openChartWindow({ title: `${ind.name} by country`, subtitle: `${ind.source} · ${ind.freq}${lines.length < selected.length ? ` · first ${lines.length} countries picked` : ''}`, lines, format: (v) => fmtWorld(v, ind.unit), changeAs: 'points' });
  }

  function cellNode(r: WorldTable['rows'][number], key: string, unit: string, indName: string) {
    const c = r.cells[key];
    if (!c) return h('td', { class: 'wm-cell wm-empty', title: `No ${indName.toLowerCase()} figure for ${r.name} from this source` }, '—');
    const sub = [c.phase ?? '', fmtPeriod(c.period), c.next != null ? `${c.nextPeriod}: ${fmtWorld(c.next, unit)}` : ''].filter(Boolean).join(' · ');
    const title = `${r.name} · ${indName}: ${fmtWorld(c.value, unit)} (${fmtPeriod(c.period)}). Source: ${c.source}${c.asOf ? `, updated ${c.asOf}` : ''}. Click for the history.`;
    const td = h(
      'td',
      { class: `wm-cell${c.phase ? ` wm-phase-${c.phase.toLowerCase()}` : ''}`, title },
      h('div', { class: 'wm-fig' }, h('b', {}, fmtWorld(c.value, unit)), sparkline(c.data, c.forecastFrom)),
      h('div', { class: 'muted tiny wm-sub' }, sub),
    );
    td.addEventListener('click', () => openCell(r.name, indName, unit, c));
    return activatable(td);
  }

  function renderTable() {
    if (!table) return;
    const inds = table.indicators;
    const groups = groupByRegion(table.rows, selected, table.regions);
    tableBox.replaceChildren(
      h(
        'div',
        { class: 'table-wrap wm-wrap' },
        h(
          'table',
          { class: 'data-table wm-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, 'Country'),
              ...inds.map((i) => h('th', {}, h('button', { class: 'link-btn wm-col', title: `${i.name} (${i.source}, ${i.freq}). Click to compare the picked countries.`, onclick: () => compare(i.key) }, i.name, h('span', { class: 'muted tiny wm-src' }, i.source)))),
            ),
          ),
          ...groups.map((g) =>
            h(
              'tbody',
              {},
              h('tr', { class: 'wm-region' }, h('th', { colspan: inds.length + 1, scope: 'rowgroup' }, g.region)),
              ...g.rows.map((r) => h('tr', {}, h('th', { scope: 'row', class: 'wm-country' }, h('b', {}, r.code), h('span', { class: 'muted small' }, ` ${r.name}`)), ...inds.map((i) => cellNode(r, i.key, i.unit, i.name)))),
            ),
          ),
        ),
      ),
    );
    if (!groups.length) tableBox.append(h('p', { class: 'muted pad' }, 'Pick at least one country.'));
  }

  function seriesRow(p: WorldPanel, s: PanelSeries) {
    const ch = changeText(s.value, s.previous, s.unit);
    const quarterly = p.source === 'BEA' && s.group === 'GDP';
    const row = h(
      'div',
      { class: 'wm-row', title: `${s.name}: ${s.source}${s.date ? `, ${fmtPeriod(s.date, quarterly)}` : ''}. Click for the history.` },
      h('span', { class: 'wm-name' }, s.name),
      h('b', { class: 'wm-val' }, fmtWorld(s.value, s.unit)),
      h('span', { class: 'small muted wm-chg', title: 'Change from the previous reading' }, ch ? (ch === 'unchanged' ? ch : `${ch} vs prior`) : ''),
      s.data.length > 1 ? sparkline(s.data.slice(-24)) : h('span'),
      h('span', { class: 'muted tiny wm-when' }, s.date ? `${fmtPeriod(s.date, quarterly)} · ${s.source}` : s.note ?? ''),
    );
    if (s.data.length > 1) {
      row.addEventListener('click', () =>
        openChartWindow({ title: s.name, subtitle: `${s.source} · latest ${fmtPeriod(s.date, quarterly)}`, lines: [{ name: s.name, color: THEME.viz1, data: s.data }], format: (v) => fmtWorld(v, s.unit), changeAs: s.unit === '%' || s.unit === 'pts' || s.unit === 'K' ? 'points' : 'percent' }),
      );
      activatable(row);
    }
    return row;
  }

  function renderPanel(box: HTMLElement, title: string, p: WorldPanel | null, err?: string, retry?: () => void) {
    const head = h('div', { class: 'panel-head' }, h('h3', {}, p?.title ?? title));
    if (err) {
      box.replaceChildren(head, h('div', { class: 'macro-error' }, err, retry ? h('button', { class: 'btn small', onclick: retry }, 'Retry') : null));
      return;
    }
    if (!p) return;
    if (p.needsKey) {
      box.replaceChildren(
        head,
        h(
          'div',
          { class: 'wm-key' },
          h('p', {}, p.note ?? 'Needs a free key.'),
          h('div', { class: 'ap-controls' },
            p.signup ? h('a', { class: 'btn', href: p.signup, target: '_blank', rel: 'noopener' }, 'Get a free key ↗') : null,
            h('button', { class: 'btn primary', onclick: () => void import('../ui/settings').then((m) => m.openSettings('data')) }, 'Add it in Settings')),
        ),
      );
      return;
    }
    const groups = [...new Set(p.series.map((s) => s.group))];
    const errs = Object.entries(p.errors ?? {});
    box.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', {}, p.title), asOfStamp(null, { source: p.source, refreshMs: 0 }).set(p.fetched ?? null).el, h('a', { class: 'small', href: p.link, target: '_blank', rel: 'noopener' }, 'Source ↗')),
      ...groups.map((g) => h('div', { class: 'wm-group' }, groups.length > 1 ? h('div', { class: 'muted tiny wm-group-name' }, g) : null, ...p.series.filter((s) => s.group === g).map((s) => seriesRow(p, s)))),
      p.auctions?.length
        ? h('div', { class: 'wm-group' }, h('div', { class: 'muted tiny wm-group-name' }, 'Recent note and bond auctions'),
            ...p.auctions.map((a) => h('div', { class: 'wm-row wm-auction' }, h('span', { class: 'wm-name' }, `${a.term} ${a.type}`), h('b', { class: 'wm-val' }, a.yield != null ? `${a.yield.toFixed(3)}%` : '—'), h('span', { class: 'small muted' }, a.bidToCover != null ? `bid-to-cover ${a.bidToCover.toFixed(2)}` : ''), h('span'), h('span', { class: 'muted tiny wm-when' }, `${a.auctionDate} · Treasury`))))
        : '',
      p.tip ? h('p', { class: 'muted small' }, p.tip, ' ', p.signup ? h('a', { href: p.signup, target: '_blank', rel: 'noopener' }, 'Get a free key ↗') : null) : '',
      errs.length ? h('p', { class: 'small wm-err' }, ...errs.map(([k, v]) => h('span', {}, `${k}: ${v} `))) : '',
    );
  }

  async function loadPanel(id: string, title: string, box: HTMLElement) {
    try {
      const p = await engineRequest<WorldPanel>('world.panel', { panel: id }, 60000);
      panelData.set(id, p);
      renderPanel(box, title, p);
    } catch (err) {
      renderPanel(box, title, null, (err as Error).message, () => void loadPanel(id, title, box));
    }
  }

  let loading = false;
  async function load(force = false) {
    if (loading) return;
    loading = true;
    try {
      if (!(await worldAvailable())) {
        tableBox.replaceChildren(h('div', { class: 'macro-error' }, helper.isConnected ? HELPER_UPDATE_FOR_FEATURE : HELPER_NOT_RUNNING));
        return;
      }
      const boxes = PANELS.map((p) => {
        const box = h('section', { class: 'panel wm-panel', 'data-panel': p.id }, h('div', { class: 'panel-head' }, h('h3', {}, p.title)), h('div', { class: 'skeleton', style: 'height:140px' }));
        return { ...p, box };
      });
      if (force || !panelGrid.childElementCount) panelGrid.replaceChildren(...boxes.map((b) => b.box));
      const panelsDone = Promise.all(boxes.map((b) => loadPanel(b.id, b.title, panelGrid.querySelector<HTMLElement>(`[data-panel=${b.id}]`) ?? b.box)));
      try {
        table = await engineRequest<WorldTable>('world.table', {}, 90000);
        selected = pickCountries(readSaved(), table.countries.map((c) => c.code));
        stamp.set(table.fetched);
        errorsBox.replaceChildren(...Object.entries(table.errors).map(([src, msg]) => h('p', { class: 'macro-error small' }, `${src}: ${msg}`)));
        renderPicker();
        renderTable();
      } catch (err) {
        tableBox.replaceChildren(h('div', { class: 'macro-error' }, (err as Error).message, h('button', { class: 'btn small', onclick: () => load(true) }, 'Retry')));
      }
      await panelsDone;
    } finally {
      loading = false;
    }
  }

  let started = false;
  // A key saved in Settings switches its panel on straight away.
  window.addEventListener('tp:data-connection', () => started && void load(true));
  return {
    el,
    start() {
      if (!started) {
        started = true;
        void load();
      }
    },
    refresh: () => load(true),
  };
}
