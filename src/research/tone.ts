/**
 * Green or red only where a trader would read a number as better or worse: growth (revenue, profit, EPS, cash flow),
 * margins and returns improving, debt and share count (dilution) shrinking, and against peers, cheaper multiples and
 * better margins. Plain facts (dates, assets, spending lines, prices) stay white. Pure and tested (tone.test.ts).
 */
export type Tone = 'up' | 'down' | '';

/** +1: higher is better; -1: lower is better. Keys not listed are just numbers (no colour). */
export const BETTER: Record<string, 1 | -1> = {
  // income statement
  revenue: 1, grossProfit: 1, operatingIncome: 1, pretaxIncome: 1, netIncome: 1, epsDiluted: 1, dilutedShares: -1,
  // balance sheet
  cash: 1, longTermDebt: -1, equity: 1,
  // cash flow
  operatingCashFlow: 1, freeCashFlow: 1,
  // ratios
  grossMargin: 1, operatingMargin: 1, netMargin: 1, fcfMargin: 1, roe: 1, roa: 1, currentRatio: 1, debtToEquity: -1,
  // against peers: multiples (lower = cheaper)
  pe: -1, ps: -1, pb: -1, evSales: -1, evEbitda: -1, revenueGrowth: 1,
};

/** Profit lines that are red whenever they are a loss. */
const LOSS_RED = new Set(['operatingIncome', 'pretaxIncome', 'netIncome', 'epsDiluted', 'freeCashFlow', 'operatingCashFlow']);

/** The tone of a value against the period before (a change of under 0.5% counts as flat). */
export function toneVsPrev(key: string, value: number | null | undefined, prev: number | null | undefined): Tone {
  if (value == null || !Number.isFinite(value)) return '';
  if (LOSS_RED.has(key) && value < 0) return 'down';
  const dir = BETTER[key];
  if (!dir || prev == null || !Number.isFinite(prev) || prev === 0) return '';
  const change = (value - prev) / Math.abs(prev);
  if (Math.abs(change) < 0.005) return '';
  return change * dir > 0 ? 'up' : 'down';
}

/** The tone of this company's value against the peers' median (within 5% counts as in line). */
export function toneVsPeers(key: string, own: number | null | undefined, median: number | null | undefined): Tone {
  const dir = BETTER[key];
  if (!dir || own == null || median == null || !Number.isFinite(own) || !Number.isFinite(median) || median === 0) return '';
  if (dir === -1 && own <= 0) return ''; // a negative multiple (losses) isn't "cheap"
  const diff = (own - median) / Math.abs(median);
  if (Math.abs(diff) < 0.05) return '';
  return diff * dir > 0 ? 'up' : 'down';
}
