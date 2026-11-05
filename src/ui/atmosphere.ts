/**
 * The page's flowing background: five soft shapes of colour (dark blue, blue, sky, orange, amber) on one fixed layer
 * behind everything, each drifting and brightening/dimming on its own slow CSS loop (style.css, "atmos"), so the
 * motion is smooth, calm and costs no script. Still for reduced motion; hidden on the Chart page.
 */

/** The shapes, back to front. */
export const SPOTS = ['a-deep', 'a-blue', 'a-sky', 'a-copper', 'a-amber'] as const;

/** Adds the layer once. */
export function initAtmosphere() {
  if (document.querySelector('.atmos')) return;
  const layer = document.createElement('div');
  layer.className = 'atmos';
  layer.setAttribute('aria-hidden', 'true');
  for (const cls of SPOTS) {
    const el = document.createElement('i');
    el.className = cls;
    layer.append(el);
  }
  document.body.prepend(layer);
}

/** Marks the body with the current page, so styles can treat a page differently (the Chart page has no background). */
export function markRoute(route: string) {
  document.body.dataset.route = route;
}
