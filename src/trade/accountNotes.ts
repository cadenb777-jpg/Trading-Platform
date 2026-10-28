/** Plain-words notes the Trade page shows about the account it is ordering in (pure, tested in accountNotes.test.ts). */

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Shown when the account asked for (e.g. from an Account card) can't be traded here and Trade picked another. */
export function fallbackNotice(asked: string | null | undefined, showing: string | null | undefined): string {
  return `${asked ? `${asked} can’t` : 'That account can’t'} be traded here; showing ${showing || 'your first stock account'}.`;
}

/**
 * Webull's own value for the account next to its value at live Schwab prices (positions × Schwab price + cash), which
 * is how the Account page values it. A note only when they differ by more than $1 and 0.1%; null otherwise.
 */
export function valueGapNote(name: string, webullValue: number | null | undefined, liveValue: number | null | undefined): string | null {
  if (webullValue == null || liveValue == null || !Number.isFinite(webullValue) || !Number.isFinite(liveValue)) return null;
  const gap = liveValue - webullValue;
  if (Math.abs(gap) <= 1 || Math.abs(gap) <= Math.abs(webullValue) * 0.001) return null;
  return `Webull values ${name} at ${usd(webullValue)}; at live Schwab prices (as the Account page shows it) it is ${usd(liveValue)}. The gap is price timing: Webull’s figure can lag the live quotes.`;
}
