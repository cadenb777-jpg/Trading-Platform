/**
 * Live redraws without losing your place: `keepScroll(root, draw)` notes how far every scrolled box inside `root` (and
 * the page around it) is scrolled, runs `draw()` (which may replace everything inside root), then scrolls the new
 * boxes back to the same place. Boxes are matched by their position among same-class boxes inside root, so a table
 * rebuilt with the same layout lands where it was. Used by pages that redraw on live prices (Account, Home's accounts).
 */

interface Spot {
  key: string;
  top: number;
  left: number;
}

const scrolled = (el: Element) => el.scrollTop > 0 || el.scrollLeft > 0;

/** A key that survives a rebuild: the element's class list plus its index among elements with the same classes. */
function keyOf(el: Element, root: Element): string {
  const cls = el.getAttribute('class') ?? '';
  const same = [...root.querySelectorAll(cls ? `.${cls.trim().split(/\s+/).map((c) => CSS.escape(c)).join('.')}` : el.tagName)];
  return `${el.tagName}|${cls}|${same.indexOf(el)}`;
}

/** The nearest ancestor of `el` that scrolls (the page's own scroller when none does). */
function scrollParent(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

export function keepScroll(root: Element, draw: () => void): void {
  const spots: Spot[] = [];
  for (const el of root.querySelectorAll('*')) if (scrolled(el)) spots.push({ key: keyOf(el, root), top: el.scrollTop, left: el.scrollLeft });
  const outer = scrollParent(root);
  const outerTop = outer?.scrollTop ?? 0;
  draw();
  if (spots.length) {
    const byKey = new Map<string, Element>();
    for (const el of root.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) byKey.set(keyOf(el, root), el);
    for (const s of spots) {
      const el = byKey.get(s.key);
      if (el) {
        el.scrollTop = s.top;
        el.scrollLeft = s.left;
      }
    }
  }
  // the page itself: a redraw that briefly changed heights mustn't move what you were reading
  if (outer && outer.scrollTop !== outerTop) outer.scrollTop = outerTop;
}
