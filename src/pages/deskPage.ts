/**
 * Today → Desk (Bloomberg Launchpad, owner's spec 7.19): your own screens made of tiles (charts, quote monitors,
 * news, world markets, sectors, movers, events, Fed odds, the curve, notes), saved as named views you switch between
 * with the tabs. Like windows on a computer: drag a tile's title bar to move it (the others slide over and everything
 * packs flush), drag its right edge, bottom edge or corner to resize (snaps to the 12-column grid and to whole rows),
 * pop it out with the window button. The buttons do the same from the keyboard. Layout state: src/desk/desk.ts.
 */
import { addTile, addView, cleanSymbols, currentView, deleteView, DESK_KEY, moveTile, moveTileTo, nextSpan, parseDesk, removeTile, renameView, rowsOf, snapRows, snapSpan, TILE_TYPES, tileType, updateTile, type Desk, type Tile, type TileType } from '../desk/desk';
import { mountTile } from '../desk/tiles';
import { h, openModal } from '../ui/dom';
import { fnTile } from '../ui/fnTile';

const read = (): Desk => {
  try {
    return parseDesk(localStorage.getItem(DESK_KEY));
  } catch {
    return parseDesk(null);
  }
};

export function createDeskPage() {
  let desk = read();
  let stops: (() => void)[] = [];
  let active = false;
  const save = () => {
    try {
      localStorage.setItem(DESK_KEY, JSON.stringify(desk));
    } catch {
      /* storage blocked: the layout lasts until the page closes */
    }
  };
  const set = (d: Desk, redraw = true) => {
    desk = d;
    save();
    if (redraw) draw();
  };

  const tabs = h('div', { class: 'desk-tabs', role: 'tablist', 'aria-label': 'Desk views' });
  const grid = h('div', { class: 'desk-grid' });
  const el = h(
    'div',
    { class: 'analysis-page desk-page' },
    h(
      'header',
      { class: 'ap-header' },
      h('div', {}, h('h1', {}, 'Desk'), h('p', { class: 'muted' }, 'Drag a tile by its title bar to move it; drag its right or bottom edge (or the corner) to resize, like a window. Tiles snap into the grid and pack flush. Saved on this computer.')),
      h('div', { class: 'ap-controls' }, h('button', { type: 'button', class: 'btn primary', onclick: () => openAdd() }, '+ Add tile')),
    ),
    tabs,
    grid,
  );

  const ask = (title: string, label: string, value: string, done: (v: string) => void) => {
    const input = h('input', { class: 'input', value, 'aria-label': label }) as HTMLInputElement;
    const ok = () => {
      close();
      done(input.value);
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
    const close = openModal(title, h('div', { class: 'desk-ask' }, h('label', { class: 'muted small' }, label), input, h('div', { class: 'ap-controls' }, h('button', { type: 'button', class: 'btn primary', onclick: ok }, 'Save'))));
    setTimeout(() => input.select(), 30);
  };

  function openAdd() {
    const syms = h('input', { class: 'input', placeholder: 'e.g. AAPL, MSFT, NVDA', 'aria-label': 'Tickers' }) as HTMLInputElement;
    const add = (type: TileType) => {
      const def = tileType(type);
      const list = cleanSymbols(syms.value);
      if (def.needs && !list.length) {
        syms.focus();
        syms.classList.add('invalid');
        hint.textContent = `${def.title} needs ${def.needs === 'one' ? 'a ticker' : 'at least one ticker'}: type it above, then pick the tile again.`;
        return;
      }
      close();
      set(addTile(desk, type, def.needs === 'one' ? list.slice(0, 1) : list));
      grid.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    const hint = h('p', { class: 'muted small' }, 'Charts and quote monitors use the tickers typed here; news uses them if you type any.');
    const close = openModal(
      `Add a tile to “${currentView(desk).name}”`,
      h(
        'div',
        { class: 'desk-add' },
        h('label', { class: 'muted small' }, 'Tickers (for charts, quote monitors and news)'),
        syms,
        hint,
        h('div', { class: 'desk-add-grid' }, ...TILE_TYPES.map((t) => h('button', { type: 'button', class: 'desk-add-btn', onclick: () => add(t.type) }, h('b', {}, t.title), h('span', { class: 'muted small' }, t.about)))),
      ),
      { wide: true },
    );
  }

  const titleOf = (t: Tile) => {
    const base = tileType(t.type).title;
    if (t.type === 'chart') return `${base} · ${(t.symbols?.[0] ?? 'SPY').replace(/^\$/, '')}`;
    if (t.type === 'news' && t.symbols?.length) return `News · ${t.symbols.join(', ')}`;
    return base;
  };

  function tileEl(t: Tile, i: number, count: number) {
    const btn = (label: string, title: string, onclick: () => void, disabled = false) => h('button', { type: 'button', class: 'icon-btn desk-act', title, 'aria-label': `${title}: ${titleOf(t)}`, disabled, onclick }, label);
    const actions = [
      tileType(t.type).needs || t.type === 'news'
        ? btn('✎', 'Edit tickers', () => ask('Tickers', t.type === 'chart' ? 'Ticker' : 'Tickers, separated by commas', (t.symbols ?? []).join(', '), (v) => set(updateTile(desk, t.id, { symbols: t.type === 'chart' ? cleanSymbols(v).slice(0, 1) : cleanSymbols(v) }))))
        : '',
      btn('←', 'Move earlier', () => set(moveTile(desk, t.id, -1)), i === 0),
      btn('→', 'Move later', () => set(moveTile(desk, t.id, 1)), i === count - 1),
      btn('⇔', `Width: ${t.span} of 12 (click to change)`, () => set(updateTile(desk, t.id, { span: nextSpan(t.span) }))),
      btn('×', 'Remove this tile', () => set(removeTile(desk, t.id))),
    ].filter((x): x is HTMLButtonElement => typeof x !== 'string');
    const tile = fnTile({ title: titleOf(t), cls: `desk-tile desk-t-${t.type}`, actions: [h('span', { class: 'desk-actions' }, ...actions)] });
    tile.el.dataset.id = t.id;
    tile.el.style.setProperty('--span', String(t.span));
    tile.el.style.setProperty('--rows', String(rowsOf(t)));
    enableMove(tile.el, t);
    enableResize(tile.el, t);
    stops.push(mountTile(t, tile.body, (text) => set(updateTile(desk, t.id, { text }), false)));
    return tile.el;
  }

  /** Drag the title bar: the tile follows the pointer through the grid, the others slide over, the order is saved. */
  function enableMove(el: HTMLElement, t: Tile) {
    const head = el.querySelector<HTMLElement>('.fn-tile-head');
    if (!head) return;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('button, a, input, select, textarea')) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      // listened on the document: moving the tile in the page would drop a pointer capture on its title bar
      const move = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!dragging) {
          dragging = true;
          el.classList.add('dragging');
        }
        const over = document.elementsFromPoint(ev.clientX, ev.clientY).map((x) => x.closest<HTMLElement>('.desk-tile')).find((x) => x && x !== el);
        if (!over) return;
        const r = over.getBoundingClientRect();
        const after = ev.clientX > r.left + r.width / 2;
        if (after ? over.nextElementSibling !== el : over.previousElementSibling !== el) over[after ? 'after' : 'before'](el);
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        if (!dragging) return;
        const ids = [...grid.querySelectorAll<HTMLElement>('.desk-tile')].map((x) => x.dataset.id);
        set(moveTileTo(desk, t.id, ids.indexOf(t.id)), false);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  }

  /** Drag the right edge, bottom edge or corner: width snaps to the 12 columns, height to whole rows, then saved. */
  function enableResize(el: HTMLElement, t: Tile) {
    for (const dir of ['e', 's', 'se'] as const) {
      const grip = h('div', { class: `desk-rz desk-rz-${dir}`, 'aria-hidden': 'true', title: dir === 'e' ? 'Drag to change the width' : dir === 's' ? 'Drag to change the height' : 'Drag to resize' });
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        const r0 = el.getBoundingClientRect();
        const gridW = grid.getBoundingClientRect().width;
        const sx = e.clientX;
        const sy = e.clientY;
        let span = t.span;
        let rows = rowsOf(t);
        el.classList.add('resizing');
        const move = (ev: PointerEvent) => {
          if (dir !== 's') span = snapSpan(r0.width + ev.clientX - sx, gridW);
          if (dir !== 'e') rows = snapRows(r0.height + ev.clientY - sy);
          el.style.setProperty('--span', String(span));
          el.style.setProperty('--rows', String(rows));
        };
        const up = () => {
          grip.removeEventListener('pointermove', move);
          grip.removeEventListener('pointerup', up);
          grip.removeEventListener('pointercancel', up);
          el.classList.remove('resizing');
          t.span = span;
          t.rows = rows;
          set(updateTile(desk, t.id, { span, rows }), false);
          window.dispatchEvent(new Event('resize')); // charts inside fit their new size
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
      });
      el.append(grip);
    }
  }

  function draw() {
    stops.forEach((s) => s());
    stops = [];
    const view = currentView(desk);
    tabs.replaceChildren(
      ...desk.views.map((v) =>
        h('button', { type: 'button', role: 'tab', class: `desk-tab ${v.id === view.id ? 'active' : ''}`, 'aria-selected': String(v.id === view.id), title: v.id === view.id ? 'Double-click to rename' : `Open ${v.name}`, onclick: () => v.id !== view.id && set({ ...desk, current: v.id }), ondblclick: () => ask('Rename view', 'Name', v.name, (n) => set(renameView(desk, v.id, n))) }, v.name),
      ),
      h('button', { type: 'button', class: 'desk-tab desk-tab-new', title: 'Add a view', onclick: () => ask('New view', 'Name', '', (n) => set(addView(desk, n))) }, '+ View'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'link-btn small', onclick: () => ask('Rename view', 'Name', view.name, (n) => set(renameView(desk, view.id, n))) }, 'Rename'),
      desk.views.length > 1 ? h('button', { type: 'button', class: 'link-btn small', onclick: () => confirm(`Delete the view “${view.name}” and its tiles?`) && set(deleteView(desk, view.id)) }, 'Delete view') : '',
    );
    if (!active) return grid.replaceChildren();
    grid.replaceChildren(
      ...(view.tiles.length
        ? view.tiles.map((t, i) => tileEl(t, i, view.tiles.length))
        : [h('div', { class: 'desk-empty' }, h('p', {}, `“${view.name}” has no tiles yet.`), h('button', { type: 'button', class: 'btn primary', onclick: () => openAdd() }, '+ Add your first tile'))]),
    );
  }

  draw();
  return {
    el,
    start() {
      active = true;
      draw();
    },
    stop() {
      active = false;
      stops.forEach((s) => s());
      stops = [];
    },
  };
}
