/** Heat-map shading for tables (monthly returns, correlations): a token colour mixed in by how big the value is. */

/** Tone and strength (0-70% colour mix) for a value against a scale where |value| >= scale is full strength. */
export function heat(value: number | null | undefined, scale: number): { tone: 'up' | 'down' | ''; strength: number } {
  if (value == null || !Number.isFinite(value) || !scale) return { tone: '', strength: 0 };
  const strength = Math.round(Math.min(1, Math.abs(value) / scale) * 70);
  return { tone: value > 0 ? 'up' : value < 0 ? 'down' : '', strength };
}

/** Inline style for a heat cell (colours from the theme tokens only). */
export function heatStyle(value: number | null | undefined, scale: number, invert = false): string {
  const { tone, strength } = heat(value, scale);
  if (!tone) return '';
  const token = (tone === 'up') !== invert ? '--up' : '--down';
  return `background:color-mix(in srgb, var(${token}) ${strength}%, transparent)`;
}

/** A scale for a heat map: the 90th percentile of the absolute values (so one outlier doesn't wash out the rest). */
export function heatScale(values: (number | null | undefined)[]): number {
  const xs = values.filter((x): x is number => x != null && Number.isFinite(x)).map(Math.abs).sort((a, b) => a - b);
  if (!xs.length) return 1;
  return xs[Math.min(xs.length - 1, Math.floor(0.9 * (xs.length - 1)))] || xs[xs.length - 1] || 1;
}
