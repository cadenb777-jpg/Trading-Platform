/**
 * The page's living colour spots (copper, sky, deep blue): three soft glows on the fixed background layer that drift
 * and brighten or dim slowly on a random timer. CSS does the easing (long transitions on transform and opacity, so
 * the browser animates them off the main thread); this only picks the next resting place now and then. Still when the
 * system asks for reduced motion, paused while the tab is hidden, and hidden on the Chart page (style.css).
 */

interface Spot {
  el: HTMLElement;
  /** Home position (vw, vh) the spot wanders around, so the composition keeps its balance. */
  home: [number, number];
}

const SPOTS: [string, [number, number]][] = [
  ['a-copper', [8, 88]],
  ['a-sky', [90, 10]],
  ['a-deep', [56, 50]],
];

/** The next resting place for a spot: within `reach` of its home, a gentle size change and a brightness. */
export function nextPose(home: [number, number], rand: () => number = Math.random, reach = 16) {
  const jitter = () => (rand() * 2 - 1) * reach;
  return {
    x: Math.round(home[0] + jitter()),
    y: Math.round(home[1] + jitter()),
    scale: +(0.85 + rand() * 0.35).toFixed(2),
    opacity: +(0.5 + rand() * 0.5).toFixed(2),
  };
}

function place(spot: Spot) {
  const p = nextPose(spot.home);
  spot.el.style.setProperty('--x', `${p.x}vw`);
  spot.el.style.setProperty('--y', `${p.y}vh`);
  spot.el.style.setProperty('--s', String(p.scale));
  spot.el.style.setProperty('--o', String(p.opacity));
}

/** Adds the spot layer once and starts its slow random drift. */
export function initAtmosphere() {
  if (document.querySelector('.atmos')) return;
  const layer = document.createElement('div');
  layer.className = 'atmos';
  layer.setAttribute('aria-hidden', 'true');
  const spots: Spot[] = SPOTS.map(([cls, home]) => {
    const el = document.createElement('i');
    el.className = cls;
    layer.append(el);
    return { el, home };
  });
  document.body.prepend(layer);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Each spot moves on its own random timer (14-26 s), longer than the CSS transition is short, so motion never stops
  // abruptly and the three never move in step.
  for (const spot of spots) {
    const tick = () => {
      if (!document.hidden) place(spot);
      window.setTimeout(tick, 14_000 + Math.random() * 12_000);
    };
    window.setTimeout(tick, Math.random() * 3000);
  }
}

/** Marks the body with the current page, so styles can treat a page differently (the Chart page has no spots). */
export function markRoute(route: string) {
  document.body.dataset.route = route;
}
