/**
 * One number style for the security view (pure, tested in format.test.ts): units K/M/B/T, a real minus sign "−",
 * "+" on changes, fixed decimals per kind, and "—" (never NaN, undefined or Infinity) when a value is missing.
 */

export const DASH = '—';
const MINUS = '−';

export const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** -0.00 shows as 0.00. */
const fixed = (v: number, d: number) => {
  const t = Math.abs(v).toFixed(d);
  return Number(t) === 0 ? t : `${v < 0 ? MINUS : ''}${t}`;
};

const group = (t: string) => {
  const neg = t.startsWith(MINUS);
  const [i, f] = (neg ? t.slice(1) : t).split('.');
  return `${neg ? MINUS : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f != null ? `.${f}` : ''}`;
};

/** 1,234.56 */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  return ok(v) ? group(fixed(v, digits)) : DASH;
}

/** 1.23T / 456.7B / 12.3M / 4.5K / 950 (with "$" when money). */
export function fmtCompact(v: number | null | undefined, opts: { money?: boolean; digits?: number } = {}): string {
  if (!ok(v)) return DASH;
  const abs = Math.abs(v);
  const [div, unit] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
  const digits = opts.digits ?? (unit ? 2 : abs < 10 && !Number.isInteger(abs) ? 2 : 0);
  const body = (abs / div).toFixed(digits);
  if (Number(body) === 0) return `${opts.money ? '$' : ''}${body}`;
  return `${v < 0 ? MINUS : ''}${opts.money ? '$' : ''}${body}${unit}`;
}

/** A fraction as a percent: 0.0123 -> "+1.23%" (sign: true) or "1.23%". */
export function fmtPct(v: number | null | undefined, digits = 2, sign = false): string {
  if (!ok(v)) return DASH;
  const t = fixed(v * 100, digits);
  return `${sign && Number(t.replace(MINUS, '-')) > 0 ? '+' : ''}${t}%`;
}

/** A price: 2 decimals (4 under $1). */
export function fmtPrice(v: number | null | undefined): string {
  if (!ok(v)) return DASH;
  return fmtNum(v, Math.abs(v) < 1 && v !== 0 ? 4 : 2);
}

/** A signed money change: "+1.25" / "−0.40". */
export function fmtChange(v: number | null | undefined, digits = 2): string {
  if (!ok(v)) return DASH;
  const t = fmtNum(v, digits);
  return v > 0 && Number(Math.abs(v).toFixed(digits)) !== 0 ? `+${t}` : t;
}

/** A multiple: "24.3×". Negative multiples (a loss-making company's P/E) aren't meaningful: "—". */
export function fmtX(v: number | null | undefined, digits = 1): string {
  return ok(v) && v > 0 ? `${fmtNum(v, digits)}×` : DASH;
}

/** "up" / "down" / "" for colouring a change. */
export const tone = (v: number | null | undefined): 'up' | 'down' | '' => (!ok(v) || v === 0 ? '' : v > 0 ? 'up' : 'down');

/** "2026-11-05" -> "5 Nov 2026"; anything else as given, "—" when empty. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || DASH;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
