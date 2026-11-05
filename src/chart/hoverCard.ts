/**
 * The floating crosshair card (OHLC, change, volume, indicator values, signals explained) and the soft glow on the
 * crosshair point. Plain DOM over the chart canvas: moving them never makes the chart redraw. The card eases after
 * the cursor and flips to the other side near the edges; with "reduce motion" it jumps.
 */
import { approach, reducedMotion } from './frame';

export interface CardRow {
  label: string;
  value: string;
  color?: string;
}

export interface CardNote {
  title: string;
  text: string;
  color: string;
}

export interface CardContent {
  title: string;
  rows: CardRow[];
  notes?: CardNote[];
}

const GAP = 18;
const FOLLOW_MS = 55;

export class HoverCard {
  readonly el: HTMLElement;
  private readonly glow: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly notesEl: HTMLElement;
  private rowLayout = '';
  private valueEls: HTMLElement[] = [];
  private noteLayout = '';
  private pos: { x: number; y: number } | null = null;
  private target = { x: 0, y: 0 };
  private frame = 0;
  private last = 0;
  /** Sizes kept by ResizeObservers, so following the mouse never forces a layout. */
  private box = { w: 0, h: 0, W: 0, H: 0 };

  constructor(overlay: HTMLElement) {
    this.glow = document.createElement('div');
    this.glow.className = 'crosshair-glow';
    this.el = document.createElement('div');
    this.el.className = 'hover-card';
    this.el.setAttribute('aria-hidden', 'true');
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'hc-title';
    this.rowsEl = document.createElement('div');
    this.rowsEl.className = 'hc-rows';
    this.notesEl = document.createElement('div');
    this.notesEl.className = 'hc-notes';
    this.el.append(this.titleEl, this.rowsEl, this.notesEl);
    overlay.append(this.glow, this.el);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        this.box = { w: this.el.offsetWidth, h: this.el.offsetHeight, W: overlay.clientWidth, H: overlay.clientHeight };
      }).observe(this.el);
      new ResizeObserver(() => {
        this.box.W = overlay.clientWidth;
        this.box.H = overlay.clientHeight;
      }).observe(overlay);
    }
  }

  /** True on phone-width charts: show the short version (prices only). */
  get narrow() {
    return this.box.W > 0 && this.box.W < 600;
  }

  /** Shows the card next to (x, y); the glow sits on the crosshair's snapped point (null = no glow). */
  show(x: number, y: number, glowY: number | null, content: CardContent) {
    this.render(content);
    if (glowY === null) this.glow.classList.remove('on');
    else {
      this.glow.style.transform = `translate(${x}px, ${glowY}px)`;
      this.glow.classList.add('on');
    }
    const { w, h, W, H } = this.box;
    // Right of and below the cursor; flip to the other side near the edges, and stay inside the chart.
    let tx = x + GAP + w > W - 60 ? x - GAP - w : x + GAP;
    let ty = y + GAP + h > H - 30 ? y - GAP - h : y + GAP;
    tx = Math.max(4, Math.min(tx, W - w - 4));
    ty = Math.max(4, Math.min(ty, H - h - 4));
    this.target = { x: tx, y: ty };
    const wasHidden = !this.el.classList.contains('on');
    this.el.classList.add('on');
    if (!this.pos || wasHidden || reducedMotion()) {
      this.pos = { ...this.target };
      this.place();
      return;
    }
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.step);
    }
  }

  hide() {
    this.el.classList.remove('on');
    this.glow.classList.remove('on');
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private step = () => {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    const p = this.pos!;
    p.x = approach(p.x, this.target.x, dt, FOLLOW_MS, 0.002);
    p.y = approach(p.y, this.target.y, dt, FOLLOW_MS, 0.002);
    this.place();
    this.frame = p.x === this.target.x && p.y === this.target.y ? 0 : requestAnimationFrame(this.step);
  };

  private place() {
    this.el.style.transform = `translate(${Math.round(this.pos!.x)}px, ${Math.round(this.pos!.y)}px)`;
  }

  /** Rebuilds rows only when their labels change; otherwise just the numbers update. */
  private render(content: CardContent) {
    this.titleEl.textContent = content.title;
    const layout = content.rows.map((r) => r.label).join('\u0001');
    if (layout !== this.rowLayout) {
      this.rowLayout = layout;
      this.valueEls = [];
      this.rowsEl.replaceChildren(
        ...content.rows.map((r) => {
          const label = document.createElement('span');
          label.className = 'hc-label';
          label.textContent = r.label;
          const value = document.createElement('span');
          value.className = 'hc-value';
          this.valueEls.push(value);
          return [label, value];
        }).flat(),
      );
    }
    content.rows.forEach((r, i) => {
      const v = this.valueEls[i];
      if (v.textContent !== r.value) v.textContent = r.value;
      v.style.color = r.color ?? '';
    });
    const notes = content.notes ?? [];
    const noteLayout = notes.map((n) => n.title + n.text).join('\u0001');
    if (noteLayout !== this.noteLayout) {
      this.noteLayout = noteLayout;
      this.notesEl.replaceChildren(
        ...notes.map((n) => {
          const div = document.createElement('div');
          div.className = 'hc-note';
          div.style.setProperty('--c', n.color);
          const b = document.createElement('b');
          b.textContent = n.title;
          div.append(b, document.createTextNode(n.text));
          return div;
        }),
      );
    }
  }
}
