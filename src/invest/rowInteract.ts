/**
 * One interaction model for every row and tile on the Investments page (docs/research/investments-interaction.md):
 *
 * - Hover (or keyboard focus) for ~150 ms: a mini chart popover anchored to the row, with a range switch
 *   (1M/3M/YTD/1Y/5Y; it starts on the board's sorted period column), the change over the range, the 52-week range and
 *   the source. One at a time; Esc closes it; it flips above the row near the bottom of the screen.
 * - Click / Enter: the full view (security view, fund detail, FRED window). Touch: the first tap shows the popover,
 *   a second tap opens.
 * - Space or the chevron (table rows): the row expands in place with a larger chart, key facts and "Open full view".
 *   One expanded row at a time.
 * - Shift+click or Shift+Enter: add to Compare (up to 4), an overlaid % chart in a side panel.
 * - ↑/↓ move between rows, ←/→ change the range.
 *
 * Pages call `interactive(container, [[element, item], ...], { boardId })`; all state here is shared by the page, so
 * a board rebuilt by the minute refresh keeps its expanded row, compare marks and keyboard focus.
 */
import { pct, rangeBar } from '../ui/charts';
import { formatPrice, h, toast } from '../ui/dom';
import { lineChart, valueAt } from './miniChart';
import { seriesCache, seriesKey, type MiniItem, type Series } from './miniData';
import { RANGES, createIntent, lowHigh, range52, rangeChange, rebase, sliceRange, stepRange, type ChangeMode, type Range } from './miniMath';

export type { MiniItem } from './miniData';

const INTENT_MS = 150;
const HIDE_MS = 220;
const MAX_COMPARE = 4;
const RANGE_WORDS: Record<Range, string> = { '1M': '1 month', '3M': '3 months', YTD: 'year to date', '1Y': '1 year', '5Y': '5 years' };

interface Board {
  id: string;
  expandable: boolean;
  range(): Range;
  setRange(r: Range): void;
}
const meta = new WeakMap<HTMLElement, { item: MiniItem; board: Board; uid: string }>();
const boardRanges = new Map<string, Range>();
let uidSeq = 0;
let drawSeq = 0;

// ---------- formatting (never NaN: missing values are "—") ----------

const fmtValue = (item: MiniItem, v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : item.format ? item.format(v) : item.mode === 'level' ? `${v.toFixed(2)}%` : formatPrice(v));
function fmtChange(mode: ChangeMode, c: number | null) {
  if (c == null || !Number.isFinite(c)) return '—';
  if (mode === 'price') return pct(c);
  const bp = Math.round(c * 100);
  return bp === 0 ? '0 bp' : `${bp > 0 ? '+' : '−'}${Math.abs(bp)} bp`;
}
const toneFor = (c: number | null) => (c == null || !Number.isFinite(c) || Math.abs(c) < 1e-9 ? '' : c > 0 ? 'up' : 'down');
const day = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// ---------- the view (shared by the popover and the expanded row) ----------

/**
 * Draws an item's chart for one range into `box` (a skeleton of the same size first, so nothing jumps). Returns the
 * series key it asked for (null when there is no history).
 */
function drawView(box: HTMLElement, item: MiniItem, range: Range, size: 'pop' | 'big', onRange: (r: Range) => void, extra?: () => (Node | string)[]): string | null {
  const token = String(++drawSeq);
  box.dataset.tok = token;
  const W = size === 'pop' ? 280 : 560;
  const H = size === 'pop' ? 84 : 180;
  const key = seriesKey(item.source, range);
  const why = item.source.kind === 'none' ? item.source.reason : '';

  const paint = (s: Series | Error | null) => {
    if (box.dataset.tok !== token) return;
    const all = s && !(s instanceof Error) ? s.points : [];
    const { points, partial } = sliceRange(all, range);
    const change = rangeChange(points, item.mode);
    // Yields and spreads going up are neither good nor bad: no green/red for them (design: colour only for meaning).
    const toneOf = (c: number | null) => (item.mode === 'level' ? '' : toneFor(c));
    const last = all.length ? all[all.length - 1] : null;
    const readout = h('span', { class: 'mc-readout muted small', 'aria-hidden': 'true' });

    const head = h(
      'div',
      { class: 'mc-head' },
      h('div', { class: 'mc-title' }, h('b', {}, item.label), item.sub ? h('span', { class: 'muted small' }, item.sub) : null),
      h('div', { class: 'mc-now' }, h('b', { class: 'mc-last' }, s === null && key ? '…' : fmtValue(item, last?.[1])), h('span', { class: `small ${toneOf(change)}` }, change == null ? '' : `${fmtChange(item.mode, change)} ${range}`)),
    );
    const seg = h(
      'div',
      { class: 'segmented mc-ranges', role: 'group', 'aria-label': 'Chart range' },
      ...RANGES.map((r) =>
        h('button', { type: 'button', class: r === range ? 'active' : '', 'aria-pressed': String(r === range), 'aria-label': RANGE_WORDS[r], tabindex: size === 'pop' ? '-1' : undefined, onclick: (e: Event) => (e.stopPropagation(), onRange(r)) }, r),
      ),
    );
    let chart: Node;
    if (!key) chart = h('div', { class: 'mc-missing', style: `height:${H}px` }, `— ${why}`);
    else if (s === null) chart = h('div', { class: 'skeleton', style: `height:${H}px` });
    else if (s instanceof Error) chart = h('div', { class: 'mc-missing', style: `height:${H}px` }, s.name === 'NoHistory' ? `— ${s.message}` : `— Couldn't load the history: ${s.message}`);
    else if (points.length < 2) chart = h('div', { class: 'mc-missing', style: `height:${H}px` }, '— Not enough history for this range yet.');
    else
      chart = h(
        'div',
        { class: 'mc-chart', style: `height:${H}px` },
        lineChart([{ points, cls: item.mode === 'level' ? 'mc-s1' : (change ?? 0) >= 0 ? 'mc-up' : 'mc-down' }], {
          width: W,
          height: H,
          area: true,
          label: `${item.label}, ${RANGE_WORDS[range]}: ${fmtChange(item.mode, change)}`,
          onHover:
            size === 'big'
              ? (t) => {
                  const p = t == null ? null : valueAt(points, t);
                  readout.textContent = p ? `${day(p[0])} · ${fmtValue(item, p[1])}` : '';
                }
              : undefined,
        }),
      );

    const yr = range52(all);
    const lines: Node[] = [];
    // The head already shows the change; say so only when the history is shorter than the range (and for the hover readout).
    if (key && s && !(s instanceof Error) && points.length >= 2 && (partial || size === 'big'))
      lines.push(h('div', { class: 'mc-line-text small' }, h('span', { class: toneOf(change) }, fmtChange(item.mode, change)), partial ? ` since ${day(points[0][0])}: the history starts there` : ` over ${RANGE_WORDS[range]}`, readout));
    if (yr && yr.high > yr.low)
      lines.push(h('div', { class: 'mc-52' }, h('span', { class: 'muted small' }, '52-week range'), rangeBar(yr.low, yr.high, yr.last, (v) => fmtValue(item, v))));
    else if (key && s && !(s instanceof Error)) lines.push(h('div', { class: 'muted small' }, '52-week range: — not enough history'));
    if (size === 'big' && points.length >= 2) {
      const hl = lowHigh(points);
      if (hl) lines.push(h('div', { class: 'mc-hl small' }, h('span', {}, h('span', { class: 'muted' }, 'Range high '), fmtValue(item, hl.high)), h('span', {}, h('span', { class: 'muted' }, 'Range low '), fmtValue(item, hl.low))));
    }
    const source = s && !(s instanceof Error) && last ? `${s.source} · as of ${day(last[0])}` : s === null && key ? 'Loading…' : '';
    const foot = h('div', { class: 'mc-foot muted tiny' }, source, size === 'pop' ? h('span', { class: 'mc-hint' }, lastPointer === 'touch' ? 'Tap again to open' : 'Click to open · Shift+click to compare') : null);

    if (size === 'pop')
      box.replaceChildren(head, key && !(s instanceof Error) ? seg : '', chart, ...lines, foot, h('span', { class: 'sr-only' }, `${shownEl && meta.get(shownEl)?.board.expandable ? 'Space expands the row, ' : ''}Shift+Enter adds it to Compare, Left and Right arrows change the range.`));
    // Expanded: the row above already names it, so the range switch takes the title's place.
    else box.replaceChildren(h('div', { class: 'mc-big-chart' }, h('div', { class: 'mc-head' }, key && !(s instanceof Error) ? seg : h('span'), head.lastChild!), chart), h('div', { class: 'mc-big-side' }, ...lines, ...(extra?.() ?? []), foot));
    if (size === 'pop' && shownEl) place(shownEl);
  };

  if (!key) {
    paint(null);
    return null;
  }
  const hit = seriesCache.peek(key);
  paint(hit ?? null);
  if (!hit)
    seriesCache.get(key).then(
      (s) => paint(s),
      (err: Error) => err?.name !== 'AbortError' && paint(err instanceof Error ? err : new Error(String(err))),
    );
  return key;
}

// ---------- popover ----------

let pop: HTMLElement | null = null;
let shownEl: HTMLElement | null = null;
let hoverKey: string | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let lastPointer = 'mouse';
let focusedEl: HTMLElement | null = null;
const intent = createIntent(INTENT_MS);

function popEl() {
  if (pop) return pop;
  pop = h('div', { class: 'inv-pop', id: 'inv-pop', role: 'tooltip', hidden: true });
  pop.addEventListener('pointerenter', cancelHide);
  pop.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && scheduleHide());
  document.body.append(pop);
  // one set of document listeners for the whole page
  document.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType || 'mouse';
    const t = e.target as Element | null;
    if (shownEl && !pop!.contains(t) && !t?.closest?.('[data-mini]')) hide();
  }, true);
  window.addEventListener('scroll', (e) => shownEl && !(e.target instanceof Node && pop!.contains(e.target)) && hide(true), true);
  window.addEventListener('resize', () => hide());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && shownEl && (hide(), e.stopPropagation()));
  return pop;
}

function cancelHide() {
  clearTimeout(hideTimer);
  hideTimer = undefined;
}
function scheduleHide() {
  cancelHide();
  hideTimer = setTimeout(hide, HIDE_MS);
}

/** Keys the expanded row and the compare panel still need (never cancelled when the popover moves on). */
function busyKeys(): Set<string> {
  const keys = new Set<string>();
  if (expanded) keys.add(seriesKey(expanded.item.source, expanded.board.range()) ?? '');
  for (const c of compare) keys.add(seriesKey(c.source, cmpRange) ?? '');
  return keys;
}

function show(el: HTMLElement) {
  const m = meta.get(el);
  if (!m || !el.isConnected) return;
  cancelHide();
  const box = popEl();
  if (shownEl && shownEl !== el) shownEl.removeAttribute('aria-describedby');
  shownEl = el;
  const before = hoverKey;
  hoverKey = drawView(box, m.item, m.board.range(), 'pop', (r) => {
    m.board.setRange(r);
    show(el);
  });
  // The pointer moved on before the last row's history arrived: nobody needs that request any more.
  if (before && before !== hoverKey && seriesCache.inFlight(before) && !busyKeys().has(before)) seriesCache.cancel(before);
  box.hidden = false;
  box.setAttribute('aria-label', `${m.item.label} chart`);
  el.setAttribute('aria-describedby', 'inv-pop');
  place(el);
}

/** Below the row (above it near the bottom of the screen), right-aligned on table rows, kept on screen. */
function place(el: HTMLElement) {
  if (!pop || pop.hidden) return;
  const r = el.getBoundingClientRect();
  const w = pop.offsetWidth;
  const ht = pop.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const row = el.tagName === 'TR';
  let left = row ? Math.min(r.right, vw) - w - 12 : r.left;
  left = Math.max(8, Math.min(left, vw - w - 8));
  let top = r.bottom + 4;
  let side = 'below';
  if (top + ht > vh - 8 && r.top - ht - 4 >= 8) {
    top = r.top - ht - 4;
    side = 'above';
  }
  top = Math.max(8, Math.min(top, vh - ht - 8));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.dataset.side = side;
}

/** Closes the popover. `keepIntent`: a scroll closes what's open but not a popover about to open (↓ scrolls the row in). */
function hide(keepIntent = false) {
  if (!keepIntent) intent.leave();
  cancelHide();
  if (!shownEl) return;
  shownEl.removeAttribute('aria-describedby');
  shownEl = null;
  if (hoverKey && seriesCache.inFlight(hoverKey) && !busyKeys().has(hoverKey)) seriesCache.cancel(hoverKey);
  hoverKey = null;
  if (pop) {
    pop.hidden = true;
    pop.replaceChildren();
  }
}

// ---------- expanded row ----------

let expanded: { el: HTMLElement; tr: HTMLTableRowElement; item: MiniItem; board: Board; box: HTMLElement } | null = null;

function toggleExpand(el: HTMLElement) {
  if (expanded?.el === el) collapse();
  else expand(el);
}

function expand(el: HTMLElement) {
  const m = meta.get(el);
  if (!m || !(el instanceof HTMLTableRowElement)) return;
  collapse();
  hide();
  const box = h('div', { class: 'inv-exp' });
  const id = `inv-exp-${m.uid}`;
  const tr = h('tr', { class: 'tt-follow inv-exp-row', id }, h('td', { colspan: el.cells.length }, box));
  el.after(tr);
  el.setAttribute('aria-expanded', 'true');
  const chev = el.querySelector('.inv-chev');
  chev?.setAttribute('aria-expanded', 'true');
  chev?.setAttribute('aria-controls', id);
  expanded = { el, tr, item: m.item, board: m.board, box };
  drawBig();
}

function drawBig() {
  if (!expanded) return;
  const { item, board, box } = expanded;
  drawView(box, item, board.range(), 'big', (r) => (board.setRange(r), drawBig()), () => {
    const facts = item.facts?.() ?? [];
    const inCompare = compare.some((c) => c.key === item.key);
    return [
      facts.length ? h('dl', { class: 'mc-facts' }, ...facts.flatMap((f) => [h('dt', { class: 'muted small' }, f.label), h('dd', {}, f.value)])) : '',
      h(
        'div',
        { class: 'mc-actions' },
        h('button', { type: 'button', class: 'btn primary small', onclick: () => item.open() }, 'Open full view'),
        h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(inCompare), onclick: () => (toggleCompare(item), drawBig()) }, inCompare ? 'Remove from compare' : 'Add to compare'),
      ),
    ];
  });
}

function collapse() {
  if (!expanded) return;
  const { el, tr } = expanded;
  tr.remove();
  el.setAttribute('aria-expanded', 'false');
  el.querySelector('.inv-chev')?.setAttribute('aria-expanded', 'false');
  expanded = null;
}

// ---------- compare ----------

const compare: MiniItem[] = [];
let cmpRange: Range = '3M';
let panel: HTMLElement | null = null;
const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });

function toggleCompare(item: MiniItem) {
  const at = compare.findIndex((c) => c.key === item.key);
  if (at >= 0) {
    compare.splice(at, 1);
    live.textContent = `Removed ${item.label} from Compare.`;
  } else if (item.source.kind === 'none') {
    toast(`${item.label} has no history to compare.`);
    return;
  } else if (compare.length >= MAX_COMPARE) {
    toast(`Compare holds ${MAX_COMPARE} at a time. Remove one first.`);
    return;
  } else if (compare.length && compare[0].mode !== item.mode) {
    toast(item.mode === 'level' ? 'Yields compare with yields: clear the prices first.' : 'Prices compare with prices: clear the yields first.');
    return;
  } else {
    if (!compare.length) cmpRange = boardOf(item)?.range() ?? '3M';
    compare.push(item);
    live.textContent = `Added ${item.label} to Compare (${compare.length} of ${MAX_COMPARE}).`;
  }
  markCompared();
  drawCompare();
}

function boardOf(item: MiniItem): Board | null {
  const el = document.querySelector<HTMLElement>(`[data-mini-key="${CSS.escape(item.key)}"]`);
  return (el && meta.get(el)?.board) || null;
}

function markCompared() {
  document.querySelectorAll<HTMLElement>('[data-mini-key]').forEach((el) => {
    const i = compare.findIndex((c) => c.key === el.dataset.miniKey);
    el.classList.toggle('inv-cmp-on', i >= 0);
    if (i >= 0) el.dataset.cmp = String(i + 1);
    else delete el.dataset.cmp;
  });
}

function drawCompare() {
  if (!compare.length) {
    panel?.remove();
    panel = null;
    return;
  }
  if (!panel || !panel.isConnected) {
    panel = h('aside', { class: 'inv-cmp', role: 'region', 'aria-label': 'Compare' });
    document.body.append(panel, live);
  }
  const box = panel;
  const token = String(++drawSeq);
  box.dataset.tok = token;
  const mode = compare[0].mode;
  const readout = h('div', { class: 'mc-readout muted small', 'aria-hidden': 'true' });
  const chartBox = h('div', { class: 'mc-chart', style: 'height:200px' }, h('div', { class: 'skeleton', style: 'height:200px' }));
  const legend = h('ul', { class: 'cmp-legend' });
  box.replaceChildren(
    h(
      'div',
      { class: 'cmp-head' },
      h('h3', {}, 'Compare'),
      h('div', { class: 'segmented mc-ranges', role: 'group', 'aria-label': 'Compare range' }, ...RANGES.map((r) => h('button', { type: 'button', class: r === cmpRange ? 'active' : '', 'aria-pressed': String(r === cmpRange), 'aria-label': RANGE_WORDS[r], onclick: () => ((cmpRange = r), drawCompare()) }, r))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close Compare and clear it', onclick: () => (compare.splice(0), markCompared(), drawCompare(), expanded && drawBig()) }, '✕'),
    ),
    chartBox,
    readout,
    legend,
    h('p', { class: 'muted tiny' }, `${mode === 'level' ? 'Change in percentage points' : '% change'} over ${RANGE_WORDS[cmpRange]}. Shift+click (or Shift+Enter) a row to add or remove; up to ${MAX_COMPARE}.`),
  );
  const items = [...compare];
  Promise.all(items.map((it) => seriesCache.get(seriesKey(it.source, cmpRange)!).then((s) => s, (e: Error) => e))).then((results) => {
    if (box.dataset.tok !== token) return;
    const lines = results.map((s, i) => ({ item: items[i], s, cls: `mc-s${i + 1}`, pts: s instanceof Error ? [] : rebase(sliceRange(s.points, cmpRange).points, mode) }));
    const fmt = (v: number) => (mode === 'level' ? fmtChange('level', v) : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`);
    chartBox.replaceChildren(
      lineChart(
        lines.map((l) => ({ points: l.pts, cls: l.cls })),
        {
          width: 360,
          height: 200,
          zero: true,
          label: `Compare over ${RANGE_WORDS[cmpRange]}: ${lines.map((l) => `${l.item.label} ${l.pts.length ? fmt(l.pts[l.pts.length - 1][1]) : 'no data'}`).join(', ')}`,
          onHover: (t) => {
            readout.textContent = t == null ? '' : `${day(t)} · ${lines.map((l) => `${l.item.sub || l.item.label} ${l.pts.length ? fmt(valueAt(l.pts, t)![1]) : '—'}`).join(' · ')}`;
          },
        },
      ),
    );
    legend.replaceChildren(
      ...lines.map((l) => {
        const end = l.pts.length ? l.pts[l.pts.length - 1][1] : null;
        return h(
          'li',
          {},
          h('span', { class: `cmp-swatch ${l.cls}`, 'aria-hidden': 'true' }),
          h('span', { class: 'cmp-name' }, h('b', {}, l.item.label), l.item.sub ? h('span', { class: 'muted small' }, ` ${l.item.sub}`) : null),
          h('span', { class: `cmp-change ${mode === 'level' ? '' : toneFor(end)}` }, l.s instanceof Error ? `— ${l.s.message}` : end == null ? '— no data for this range' : fmt(end)),
          h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Remove ${l.item.label} from Compare`, onclick: () => toggleCompare(l.item) }, '✕'),
        );
      }),
    );
  });
}

// ---------- wiring ----------

const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-mini]') : null);

function navigable(from: HTMLElement): HTMLElement[] {
  const scope = from.closest('.inv-view') ?? from.closest('[data-mini-scope]') ?? document;
  return [...scope.querySelectorAll<HTMLElement>('[data-mini]')].filter((el) => !el.classList.contains('tt-hide') && el.offsetParent !== null);
}

const chevron = (label: string) => h('button', { type: 'button', class: 'inv-chev', tabindex: '-1', 'aria-label': `Expand ${label}`, 'aria-expanded': 'false' });

/**
 * Gives rows or tiles the page's interaction model. `entries` pairs each element with what it shows; `boardId`
 * keeps the board's range (and the expanded row) across rebuilds; `expandable` adds the chevron to table rows.
 */
export function interactive(container: HTMLElement, entries: [HTMLElement, MiniItem][], opts: { boardId: string; expandable?: boolean; defaultRange?: () => Range }) {
  const board: Board = {
    id: opts.boardId,
    expandable: !!opts.expandable,
    range: () => boardRanges.get(opts.boardId) ?? opts.defaultRange?.() ?? '3M',
    setRange: (r) => boardRanges.set(opts.boardId, r),
  };
  for (const [el, item] of entries) {
    meta.set(el, { item, board, uid: String(++uidSeq) });
    el.dataset.mini = '';
    el.dataset.miniKey = item.key;
    if (board.expandable && el instanceof HTMLTableRowElement && el.cells[0]) {
      el.setAttribute('aria-expanded', 'false');
      el.cells[0].classList.add('inv-has-chev');
      el.cells[0].prepend(chevron(item.label));
    }
  }
  if (!container.dataset.miniWired) {
    container.dataset.miniWired = '1';
    wire(container);
  }
  // A rebuilt board (minute refresh) takes over the expanded row, the popover and the keyboard focus.
  for (const [el, item] of entries) {
    if (expanded && !expanded.tr.isConnected && expanded.board.id === board.id && expanded.item.key === item.key) {
      expanded = null;
      expand(el);
    }
    if (shownEl && !shownEl.isConnected && meta.get(shownEl)?.board.id === board.id && meta.get(shownEl)?.item.key === item.key) {
      shownEl = el;
      el.setAttribute('aria-describedby', 'inv-pop');
      requestAnimationFrame(() => place(el));
    }
    if (focusedEl && !focusedEl.isConnected && meta.get(focusedEl)?.board.id === board.id && meta.get(focusedEl)?.item.key === item.key) {
      focusedEl = el;
      requestAnimationFrame(() => el.isConnected && (document.activeElement === document.body || !document.activeElement) && el.focus({ preventScroll: true }));
    }
  }
  if (compare.length) markCompared();
}

function wire(container: HTMLElement) {
  popEl();
  // Shift+click picks rows for Compare; without this the browser would also select the text between clicks.
  container.addEventListener('mousedown', (e) => e.shiftKey && rowOf(e.target) && e.preventDefault());
  container.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = rowOf(e.target);
    if (!el || !meta.has(el)) return;
    cancelHide();
    if (el === shownEl) return intent.leave();
    intent.enter(meta.get(el)!.uid, () => show(el));
  });
  container.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const el = rowOf(e.target);
    if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
    intent.leave();
    if (shownEl) scheduleHide();
  });
  container.addEventListener('focusin', (e) => {
    const el = rowOf(e.target);
    if (!el || !meta.has(el)) return;
    focusedEl = el;
    if (e.target === el && el.matches(':focus-visible')) intent.enter(meta.get(el)!.uid, () => show(el));
  });
  container.addEventListener('focusout', (e) => {
    const next = e.relatedTarget;
    if (next instanceof Node && (pop?.contains(next) || rowOf(next))) return;
    intent.leave();
    if (shownEl === rowOf(e.target)) hide();
  });
  container.addEventListener(
    'keydown',
    (e) => {
      const el = rowOf(e.target);
      const m = el && meta.get(el);
      if (!el || !m || e.target !== el || e.altKey || e.ctrlKey || e.metaKey) return;
      const stop = () => (e.preventDefault(), e.stopPropagation());
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = navigable(el);
        const next = list[list.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) {
          next.focus();
          next.scrollIntoView({ block: 'nearest' });
        }
        stop();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (shownEl === el || expanded?.el === el)) {
        m.board.setRange(stepRange(m.board.range(), e.key === 'ArrowRight' ? 1 : -1));
        if (shownEl === el) show(el);
        if (expanded?.el === el) drawBig();
        stop();
      } else if (e.key === ' ' && m.board.expandable && el instanceof HTMLTableRowElement) {
        toggleExpand(el);
        stop();
      } else if (e.key === 'Enter' && e.shiftKey) {
        toggleCompare(m.item);
        stop();
      } else if (e.key === 'Escape' && !shownEl && expanded?.el === el) {
        collapse();
        stop();
      }
    },
    true,
  );
  container.addEventListener(
    'click',
    (e) => {
      const el = rowOf(e.target);
      const m = el && meta.get(el);
      if (!el || !m) return;
      const t = e.target as Element;
      const stop = () => (e.preventDefault(), e.stopPropagation());
      if (t.closest('.inv-chev')) return (stop(), el instanceof HTMLTableRowElement && toggleExpand(el));
      if (t !== el && t.closest('a, input, select, textarea, button:not([data-mini])')) return; // a control inside the row
      stop();
      if (e.shiftKey) return toggleCompare(m.item);
      if (lastPointer === 'touch' && shownEl !== el) return (intent.leave(), show(el));
      hide();
      m.item.open();
    },
    true,
  );
}

/** Forgets the popover, expanded row and compare panel (the page closed). */
export function resetInteractions() {
  hide();
  collapse();
  compare.splice(0);
  drawCompare();
}

/** Closes the popover and the expanded row but keeps Compare (it works across sections). */
export function closeFloating() {
  hide();
  collapse();
}
