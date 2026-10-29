/**
 * Compare 2-5 prospects side by side: size, clients and mix, people count, private funds, 13F overlap (shared
 * holdings, overlap %, biggest weight differences), sector mix and turnover. Export to CSV and a printable report
 * (the client reports' print styles, src/reports/report.css).
 */
import '../reports/report.css';
import { prospectCompare, type ClientType, type CompareResult } from '../data/prospect';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { tickerAttr } from '../ui/tickerCard';
import { shareBar } from './charts';
import { CLIENT_LABELS, compareCsv, compareTable, overlapLookup, sectorRows, weightText } from './logic';

export function saveText(name: string, text: string, type = 'text/csv') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Puts report pages in the hidden print container and opens the print dialog ("Save as PDF"), like client reports. */
export function printPages(pages: HTMLElement[], title: string) {
  const root = h('div', { class: 'print-root' }, h('div', { class: 'rpt-doc' }, ...pages));
  document.body.append(root);
  document.body.classList.add('printing');
  const oldTitle = document.title;
  document.title = title;
  const done = () => {
    root.remove();
    document.body.classList.remove('printing');
    document.title = oldTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 300);
}

/** A side-by-side table: first column labels, one column per firm (names open the profile). */
function sideTable(r: CompareResult, rows: { label: string | Node; cells: (Node | string)[] }[], openFirm: (id: string) => void, caption: string) {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'data-table pr-side' },
      h('caption', { class: 'sr-only' }, caption),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), ...r.firms.map((f) => h('th', { scope: 'col' }, h('button', { type: 'button', class: 'link-btn', onclick: () => openFirm(f.id) }, f.name))))),
      h('tbody', {}, ...rows.map((row) => h('tr', {}, h('th', { scope: 'row', class: 'label' }, row.label), ...row.cells.map((c) => h('td', {}, c))))),
    ),
  );
}

export async function renderCompare(box: HTMLElement, ids: string[], openFirm: (id: string) => void) {
  box.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
  let r: CompareResult;
  try {
    r = await prospectCompare(ids);
  } catch (err) {
    box.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    return;
  }
  const names = r.firms.map((f) => f.name);
  const measures = compareTable(r);
  const overview = sideTable(r, measures.map((m) => ({ label: m.label === '13F turnover (quarter)' ? h('span', {}, m.label, infoTip('prTurnover')) : m.label, cells: m.values })), openFirm, 'Side-by-side measures');

  // client mix: share of clients per type
  const types = [...new Set(r.firms.flatMap((f) => Object.keys(f.clientMix ?? {})))] as ClientType[];
  const mix = types.length
    ? sideTable(
        r,
        types.map((t) => ({ label: CLIENT_LABELS[t] ?? t, cells: r.firms.map((f) => (f.clientMix?.[t] ? shareBar(f.clientMix[t]!.share, weightText(f.clientMix[t]!.share, 0), `${f.name}: ${CLIENT_LABELS[t]} share of clients`) : h('span', { class: 'muted' }, Object.keys(f.clientMix ?? {}).length ? '0%' : 'Not reported'))) })),
        openFirm,
        'Client mix (share of clients)',
      )
    : h('p', { class: 'pr-missing' }, 'None of these firms reports a client mix (only registered advisers do, in Form ADV Item 5.D).');

  // 13F overlap matrix
  const lookup = overlapLookup(r);
  const with13f = r.firms.filter((f) => f.positions > 0);
  const overlap =
    with13f.length >= 2
      ? sideTable(
          r,
          r.firms.map((a) => ({
            label: a.name,
            cells: r.firms.map((b) => {
              if (a.id === b.id) return h('span', { class: 'muted' }, '—');
              const o = lookup(a.id, b.id);
              return o ? shareBar(o.overlap, `${weightText(o.overlap, 0)} · ${o.shared} shared`, `${a.name} and ${b.name}: ${weightText(o.overlap)} overlap, ${o.shared} shared holdings`) : h('span', { class: 'muted' }, 'No 13F');
            }),
          })),
          openFirm,
          '13F overlap',
        )
      : h('p', { class: 'pr-missing' }, `Overlap needs at least two firms with 13F holdings (${with13f.length} here).`);

  // biggest differences for one pair
  const pairs = r.pairs.filter((p) => lookup(p.a, p.b));
  const nameOf = (id: string) => r.firms.find((f) => f.id === id)?.name ?? id;
  const diffBox = h('div', {});
  const pairSelect = h('select', { class: 'input', 'aria-label': 'Pair to compare' }, ...pairs.map((p, i) => h('option', { value: String(i) }, `${nameOf(p.a)} vs ${nameOf(p.b)}`)));
  const drawDiffs = () => {
    const p = pairs[+pairSelect.value || 0];
    if (!p) return diffBox.replaceChildren();
    diffBox.replaceChildren(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'data-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Holding'), h('th', {}, nameOf(p.a)), h('th', {}, nameOf(p.b)), h('th', {}, 'Difference'))),
          h('tbody', {}, ...p.differences.map((d) => h('tr', {}, h('td', {}, d.ticker ? h('b', { ...tickerAttr(d.ticker) }, d.ticker) : d.cusip, ' ', h('span', { class: 'muted small' }, d.issuer ?? '')), h('td', { class: 'num' }, weightText(d.a)), h('td', { class: 'num' }, weightText(d.b)), h('td', { class: `num ${d.diff > 0 ? 'up' : d.diff < 0 ? 'down' : ''}` }, `${d.diff > 0 ? '+' : d.diff < 0 ? '−' : ''}${weightText(Math.abs(d.diff))}`)))),
        ),
      ),
    );
  };
  pairSelect.onchange = drawDiffs;
  drawDiffs();

  const shared = r.sharedHoldings.length
    ? sideTable(r, r.sharedHoldings.map((s) => ({ label: h('span', {}, s.ticker ? h('b', { ...tickerAttr(s.ticker) }, s.ticker) : s.cusip, ' ', h('span', { class: 'muted small' }, s.issuer ?? ''), h('span', { class: 'badge' }, `${s.heldBy} firms`)), cells: s.weights.map((w, i) => (r.firms[i].positions ? shareBar(w / Math.max(...r.sharedHoldings.flatMap((x) => x.weights), 0.0001), weightText(w), `${names[i]}: ${weightText(w)} of 13F value`) : h('span', { class: 'muted' }, 'No 13F'))) })), openFirm, 'Shared holdings')
    : h('p', { class: 'pr-missing' }, 'No holding is held by two or more of these firms in their latest 13F.');

  const sectors = sectorRows(r.firms);
  const sectorTable = sectors.length
    ? sideTable(r, sectors.map((s) => ({ label: s.sector, cells: s.weights.map((w) => (w == null ? h('span', { class: 'muted' }, 'No 13F') : shareBar(w, weightText(w, 0), `${s.sector}: ${weightText(w)}`))) })), openFirm, 'Sector mix')
    : h('p', { class: 'pr-missing' }, 'No 13F sector data for these firms.');

  const csvBtn = h('button', { class: 'btn small', onclick: () => saveText(`prospect-compare-${new Date().toISOString().slice(0, 10)}.csv`, compareCsv(r)) }, 'Export CSV');
  const printBtn = h('button', { class: 'btn small', onclick: () => printPages(reportPages(r), `Prospect comparison ${new Date().toISOString().slice(0, 10)}`) }, 'Printable report');
  box.replaceChildren(
    h('div', { class: 'pr-inline pr-cmp-actions' }, csvBtn, printBtn, h('span', { class: 'muted small' }, 'From SEC Form ADV, 13F and Form D data in your prospect database.')),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Side by side')), overview),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Client mix'), h('span', { class: 'muted small' }, 'Share of clients by type, Form ADV Item 5.D')), mix),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '13F overlap ', infoTip('prOverlap'))), overlap),
    pairs.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Biggest weight differences'), pairSelect), diffBox) : '',
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Shared holdings'), h('span', { class: 'muted small' }, 'Held by 2+ of these firms, weight in each 13F')), shared),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Sector mix'), h('span', { class: 'muted small' }, 'Long stock value by SEC industry code')), sectorTable),
  );
}

/** The comparison as US Letter pages (client-report print styles). */
function reportPages(r: CompareResult): HTMLElement[] {
  const names = r.firms.map((f) => f.name);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const table = (head: string[], rows: (string | number)[][]) =>
    h('table', { class: 'rpt-table dense' }, h('thead', {}, h('tr', {}, ...head.map((x) => h('th', {}, x)))), h('tbody', {}, ...rows.map((row) => h('tr', {}, ...row.map((c) => h('td', {}, String(c)))))));
  const head = () => h('div', { class: 'rpt-head' }, h('div', { class: 'rpt-wordmark' }, 'Prospect comparison'), h('div', { class: 'rpt-head-meta' }, date));
  const foot = h('div', { class: 'rpt-foot' }, 'Source: SEC Form ADV, Form 13F and Form D public data. Family-office labels are educated guesses from public signals, not facts. For internal use.');
  const byId = new Map(r.firms.map((f) => [f.id, f.name]));
  const page1 = h(
    'section',
    { class: 'rpt-page' },
    head(),
    h('h1', { class: 'rpt-title', style: 'font-size:15pt' }, names.join(' · ')),
    h('div', { class: 'rpt-section' }, h('h3', {}, 'Side by side'), table(['', ...names], compareTable(r).map((m) => [m.label, ...m.values]))),
    h('div', { class: 'rpt-section' }, h('h3', {}, '13F overlap'), r.pairs.length ? table(['Firm A', 'Firm B', 'Overlap', 'Shared holdings'], r.pairs.map((p) => [byId.get(p.a) ?? p.a, byId.get(p.b) ?? p.b, weightText(p.overlap), p.shared])) : h('p', { class: 'rpt-note' }, 'No 13F overlap to show.')),
    foot.cloneNode(true) as HTMLElement,
  );
  const page2 = h(
    'section',
    { class: 'rpt-page' },
    head(),
    h('div', { class: 'rpt-section' }, h('h3', {}, 'Shared holdings (weight in each 13F)'), r.sharedHoldings.length ? table(['Holding', ...names], r.sharedHoldings.slice(0, 25).map((s) => [s.ticker || s.issuer || s.cusip, ...s.weights.map((w) => weightText(w))])) : h('p', { class: 'rpt-note' }, 'No shared holdings.')),
    h('div', { class: 'rpt-section' }, h('h3', {}, 'Sector mix'), table(['Sector', ...names], sectorRows(r.firms).map((s) => [s.sector, ...s.weights.map((w) => (w == null ? 'No 13F' : weightText(w, 0)))]))),
    foot,
  );
  return [page1, page2];
}
