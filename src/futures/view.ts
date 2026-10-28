/** Small pure helpers for the Futures page (formatting and plain-language readings), tested in view.test.ts. */

/** Decimals that show a market's smallest price step (tick 0.25 → 2, 0.0001 → 4, 1/64 → 4, 5 → 0). */
export function tickDecimals(tick: number): number {
  if (!(tick > 0)) return 2;
  for (let d = 0; d <= 7; d++) if (Math.abs(Math.round(tick * 10 ** d) - tick * 10 ** d) < 1e-9) return Math.min(d, 7);
  return 4;
}

/** A futures price with as many decimals as its tick (Treasuries and yen need more than 2). */
export function futuresPrice(price: number | null | undefined, tick: number): string {
  if (price == null || !Number.isFinite(price)) return 'unavailable';
  // Treasury ticks are fractions (1/64 = 0.015625): 4 decimals are plenty there.
  const d = tick >= 0.001 ? Math.min(tickDecimals(tick), 4) : tickDecimals(tick);
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** How strongly to tint a heat tile: 0 (flat) to 1 (a 2% average move or more). */
export function heatStrength(change: number | null | undefined): number {
  if (change == null || !Number.isFinite(change)) return 0;
  return Math.min(1, Math.abs(change) / 0.02);
}

/** A move measured in standard deviations of the market's usual daily moves: "+2.3σ". */
export function sigmaText(sigma: number | null | undefined): string {
  if (sigma == null || !Number.isFinite(sigma)) return '—';
  const t = sigma.toFixed(1);
  return Number(t) === 0 ? '0.0σ' : `${sigma > 0 ? '+' : ''}${t}σ`;
}

/** Plain words for the shape of a futures curve (shown after the shape's name). SOFR is priced as 100 minus the rate, so its prices run backwards. */
export function curveReading(shape: 'contango' | 'backwardation' | 'flat' | null, root: string): string {
  if (!shape) return '';
  if (root === 'SR3') {
    return shape === 'contango'
      ? 'Later SOFR contracts are priced higher, which means the market expects lower interest rates ahead (price = 100 minus the rate).'
      : shape === 'backwardation'
        ? 'Later SOFR contracts are priced lower, which means the market expects higher interest rates ahead (price = 100 minus the rate).'
        : 'SOFR contracts are priced about the same: the market expects rates to stay roughly where they are.';
  }
  if (shape === 'contango') return 'Later contracts cost more than the front one. Normal when storing or financing the asset costs money; holders who roll lose a little each time.';
  if (shape === 'backwardation') return 'Later contracts cost less than the front one. Usually a sign of tight supply right now (buyers pay up to have it today); holders who roll gain a little.';
  return 'Later contracts cost about the same as the front one.';
}

/** Tone for a COT index: commercials (the hedgers Larry Williams follows) at their extremes. */
export function cotTone(index: number | null | undefined): 'up' | 'down' | '' {
  if (index == null) return '';
  return index >= 80 ? 'up' : index <= 20 ? 'down' : '';
}

/** Days from today to an ISO date (negative if past). */
export function daysUntil(iso: string, now = new Date()): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - today) / 86_400_000);
}

const cotIdx = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(0)} / 100`);

/** The words of the one-line summary (pure, tested). */
export function cotSummaryText(d: { market: string; rows: { date: string; specIndex: number | null; commIndex: number | null }[] }): string {
  const last = d.rows[d.rows.length - 1];
  if (!last) return `No COT report for ${d.market} yet.`;
  const crowd = (v: number | null) => (v == null ? '' : v >= 80 ? ' (crowded long)' : v <= 20 ? ' (crowded short)' : '');
  return `${d.market} futures: hedgers ${cotIdx(last.commIndex)}${crowd(last.commIndex)}, speculators ${cotIdx(last.specIndex)}${crowd(last.specIndex)} · CFTC ${last.date}`;
}
