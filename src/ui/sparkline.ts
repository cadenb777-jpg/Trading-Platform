/** A tiny line chart for the index cards on the home page. */
const SVG_NS = 'http://www.w3.org/2000/svg';
let gradientId = 0;

export function sparkline(values: number[], baseline: number | null, color: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('aria-hidden', 'true');
  if (values.length < 2) return svg;

  // Fit the line to today's range; only stretch to include the previous close if it's nearby,
  // so a big gap doesn't flatten the whole line.
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.001 || 1;
  if (baseline != null && baseline > min - span * 0.6 && baseline < max + span * 0.6) {
    min = Math.min(min, baseline);
    max = Math.max(max, baseline);
  }
  const pad = (max - min || 1) * 0.08;
  min -= pad;
  max += pad;
  const range = max - min;
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => 37 - ((v - min) / range) * 34;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');

  const id = `spark-${gradientId++}`;
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  if (baseline != null && baseline >= min && baseline <= max) {
    add('line', { x1: '0', x2: '100', y1: y(baseline).toFixed(2), y2: y(baseline).toFixed(2), stroke: '#787b86', 'stroke-width': '1', 'stroke-dasharray': '2 3', 'vector-effect': 'non-scaling-stroke' });
  }
  add('path', { d: `${line}L100,40L0,40Z`, fill: `url(#${id})` });
  add('path', { d: line, fill: 'none', stroke: color, 'stroke-width': '1.8', 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' });
  return svg;
}
