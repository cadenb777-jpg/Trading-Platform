/**
 * The Home hero's bridge: one glowing sky arch, a thinner copper arch just above it and evenly spaced hangers that
 * fade towards the baseline. Pure decoration (aria-hidden). Colours come from CSS (--bridge-sky / --bridge-copper);
 * the drawing stretches to the hero's width and keeps its 1px lines (non-scaling strokes).
 */

const W = 1200; // drawing units; the SVG stretches to the hero's width
const H = 160; // baseline at the bottom (the drawing keeps this 7.5:1 shape, see .home-hero > .bridge)
const SKY = { half: 540, apex: 40 }; // half-span (centre to foot) and apex height from the top
const COPPER = { half: 600, apex: 24 };
const HANGER_GAP = 60;

/** A circle arc from (600 - half, H) over the apex to (600 + half, H): its radius and centre height. */
function circle(a: { half: number; apex: number }) {
  const sag = H - a.apex;
  const r = (a.half ** 2 + sag ** 2) / (2 * sag);
  return { r, cy: a.apex + r };
}

/** Height of an arch at x (drawing units). */
export function archY(a: { half: number; apex: number }, x: number) {
  const { r, cy } = circle(a);
  return cy - Math.sqrt(Math.max(0, r * r - (x - W / 2) ** 2));
}

function arcPath(a: { half: number; apex: number }) {
  const { r } = circle(a);
  const n = (v: number) => Math.round(v * 10) / 10;
  return `M${n(W / 2 - a.half)} ${H}A${n(r)} ${n(r)} 0 0 1 ${n(W / 2 + a.half)} ${H}`;
}

/** Hanger x positions: symmetric around the centre, inside the drawing. */
export function hangerXs() {
  const xs: number[] = [];
  const n = Math.floor((SKY.half - HANGER_GAP / 2) / HANGER_GAP);
  for (let k = -n; k <= n; k++) xs.push(W / 2 + k * HANGER_GAP);
  return xs;
}

export function bridgeMarkup() {
  const sky = arcPath(SKY);
  const copper = arcPath(COPPER);
  const hangers = hangerXs()
    .map((x) => {
      const fade = 1 - Math.abs(x - W / 2) / SKY.half; // outer hangers are fainter
      return `<line x1="${x}" y1="${Math.round(archY(SKY, x) * 10) / 10}" x2="${x}" y2="${H}" opacity="${(0.35 + 0.65 * fade).toFixed(2)}" vector-effect="non-scaling-stroke"/>`;
    })
    .join('');
  const ns = 'vector-effect="non-scaling-stroke"';
  return (
    `<svg class="bridge" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">` +
    `<defs><linearGradient id="tp-bridge-fade" x1="0" y1="0" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="currentColor" stop-opacity="0.9"/><stop offset="1" stop-color="currentColor" stop-opacity="0.05"/></linearGradient>` +
    `<linearGradient id="tp-bridge-base" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="0.5" stop-color="currentColor" stop-opacity="0.5"/>` +
    `<stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>` +
    `<g class="bridge-hangers" stroke="url(#tp-bridge-fade)" stroke-width="1">${hangers}</g>` +
    `<line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" stroke="url(#tp-bridge-base)" stroke-width="1" ${ns}/>` +
    `<g fill="none" stroke-linecap="round">` +
    `<path class="bridge-copper" d="${copper}" stroke-width="1" ${ns}/>` +
    `<path class="bridge-glow" d="${sky}" stroke-width="14" opacity="0.07" ${ns}/>` +
    `<path class="bridge-glow" d="${sky}" stroke-width="5" opacity="0.18" ${ns}/>` +
    `<path class="bridge-sky" d="${sky}" stroke-width="1.6" ${ns}/>` +
    `</g></svg>`
  );
}

/** The bridge as an element, for the Home hero. */
export function createBridge(): Element {
  const t = document.createElement('template');
  t.innerHTML = bridgeMarkup();
  return t.content.firstElementChild!;
}
