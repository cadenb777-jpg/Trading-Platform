/**
 * Pop a panel out into a floating glass window and dock it back (T5, owner: "page pop-outs", Launchpad-style).
 * The panel itself moves (the same element, not a copy), so its live prices, link group and timers keep running
 * without a re-fetch. Its place on the page keeps a slim placeholder with "Bring back".
 *   - drag the title bar to move; drag the corner to resize;
 *   - drop it against the left or right edge of the window to snap it to that half, the top edge to fill the screen;
 *   - double-click the title bar to fill the screen / restore; Escape or × brings it back.
 * Several can float at once; the one you touch comes to the front. Leaving the page brings every panel back.
 */
import { h } from './dom';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const floating = new Set<{ dock: () => void }>();
let top = 900;

/** Where a window dropped at pointer (px, py) snaps to in a viewport of vw x vh (pure, tested). */
export function snapRect(px: number, py: number, vw: number, vh: number, edge = 24): Rect | null {
  if (py <= edge) return { x: 8, y: 8, w: vw - 16, h: vh - 16 };
  if (px <= edge) return { x: 8, y: 8, w: Math.round(vw / 2) - 12, h: vh - 16 };
  if (px >= vw - edge) return { x: Math.round(vw / 2) + 4, y: 8, w: Math.round(vw / 2) - 12, h: vh - 16 };
  return null;
}

/** Keeps a window on screen (at least its title bar). */
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = Math.max(280, Math.min(r.w, vw - 16));
  const hh = Math.max(160, Math.min(r.h, vh - 16));
  return { w, h: hh, x: Math.max(8, Math.min(r.x, vw - 120)), y: Math.max(8, Math.min(r.y, vh - 40)) };
}

export function floatPanel(panel: HTMLElement, title: string): () => void {
  if (panel.closest('.float-win')) return () => {};
  const from = panel.getBoundingClientRect();
  const holder = h('div', { class: 'float-holder', style: `height:${Math.min(64, Math.round(from.height))}px` });
  const back = h('button', { type: 'button', class: 'btn small' }, 'Bring back');
  holder.append(h('span', { class: 'muted small' }, `${title} is popped out`), back);
  panel.replaceWith(holder);

  const close = h('button', { type: 'button', class: 'icon-btn float-close', title: 'Bring back (Esc)', 'aria-label': `Bring ${title} back` }, '×');
  const bar = h('div', { class: 'float-bar' }, h('span', { class: 'float-title' }, title), close);
  const win = h('div', { class: 'float-win', role: 'dialog', 'aria-label': title }, bar, h('div', { class: 'float-body' }, panel));
  let rect = clampRect({ x: from.x + 24, y: Math.max(60, from.y), w: Math.max(420, from.width), h: Math.min(Math.max(260, from.height + 30), innerHeight - 80) }, innerWidth, innerHeight);
  let restore: Rect | null = null;
  const place = () => Object.assign(win.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  const front = () => (win.style.zIndex = String(++top));
  place();
  front();
  document.body.append(win);
  panel.classList.add('is-floating');

  // move: pointer drag on the bar; snap at the edges
  bar.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    front();
    const sx = e.clientX - rect.x, sy = e.clientY - rect.y;
    bar.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      rect = clampRect({ ...rect, x: ev.clientX - sx, y: ev.clientY - sy }, innerWidth, innerHeight);
      place();
      win.classList.toggle('snap-hint', !!snapRect(ev.clientX, ev.clientY, innerWidth, innerHeight));
    };
    const up = (ev: PointerEvent) => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      win.classList.remove('snap-hint');
      const snap = snapRect(ev.clientX, ev.clientY, innerWidth, innerHeight);
      if (snap) {
        restore = restore ?? { ...rect, x: Math.min(rect.x, innerWidth / 3), y: Math.max(rect.y, 60) };
        rect = snap;
        place();
      }
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', () => {
    if (restore) {
      rect = restore;
      restore = null;
    } else {
      restore = { ...rect };
      rect = { x: 8, y: 8, w: innerWidth - 16, h: innerHeight - 16 };
    }
    place();
  });
  win.addEventListener('pointerdown', front);
  // resize: CSS resize handle; keep the size we see
  const ro = new ResizeObserver(() => {
    const r = win.getBoundingClientRect();
    rect = { ...rect, w: Math.round(r.width), h: Math.round(r.height) };
  });
  ro.observe(win);

  const entry = { dock };
  function dock() {
    if (!win.isConnected) return;
    ro.disconnect();
    panel.classList.remove('is-floating');
    holder.replaceWith(panel);
    win.remove();
    floating.delete(entry);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', dockAll);
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && Number(win.style.zIndex) === top && !document.querySelector('.modal') && dock();
  close.addEventListener('click', dock);
  back.addEventListener('click', dock);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', dockAll);
  floating.add(entry);
  return dock;
}

/** Brings every floating panel back (leaving the page). */
export function dockAll() {
  for (const f of [...floating]) f.dock();
}
