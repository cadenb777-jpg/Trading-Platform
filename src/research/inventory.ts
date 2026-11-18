/**
 * Inventory against sales (Research → Cash health, no helper change: statements carry inventory since helper 74).
 * Pure and tested (inventory.test.ts, hand-worked on Apple's FY2024-FY2026 10-K figures); drawn in cashHealthView.ts.
 *
 * Stock piling up faster than sales has come before weaker results and returns: Bernard and Noel, "Do Inventory
 * Disclosures Predict Sales and Earnings?", Journal of Accounting, Auditing and Finance 6 (1991), and Thomas and Zhang,
 * "Inventory Changes and Future Returns", Review of Accounting Studies 7 (2002). A reading, not a signal: it has not
 * been tested on the owner's universe with the platform's statistics.
 */
import { fy, pc, usd, type Statements } from './debtDilution';
import { at } from './quality';
import { lastRun, newestYear, yearsBefore } from './years';

export interface InventoryYear {
  end: string;
  /** column index in the statements */
  i: number;
  inventory: number;
  inventoryGrowth: number;
  salesGrowth: number;
  /** inventory growth - sales growth */
  gap: number;
  /** inventory / sales that year */
  share: number;
}
export interface InventorySales {
  /** consecutive fiscal years, oldest first (at most 5) */
  history: InventoryYear[];
  latest: InventoryYear;
}
export type InventoryStale = { lastShown: string };

/** Inventory growth this many points above sales growth is flagged (amber in the table, said in the words). */
export const PILING_UP = 0.1;
/** Below this share of sales the inventory is too small to matter (Microsoft's ~0.3%; Apple's ~2% counts): never flagged. */
export const MATERIAL = 0.01;

export const pilingUp = (y: InventoryYear) => y.gap > PILING_UP && y.share >= MATERIAL;


/** Null when the filings show no inventory for two year-ends a fiscal year apart, with sales for both years. */
export function inventorySales(a: Statements, span = 5): InventorySales | InventoryStale | null {
  const n = newestYear(a);
  const rows: InventoryYear[] = [];
  for (let i = 1; i <= n; i++) {
    const inv = at(a, 'inventory', i);
    const inv0 = at(a, 'inventory', i - 1);
    const s = at(a, 'revenue', i);
    const s0 = at(a, 'revenue', i - 1);
    if (inv == null || inv0 == null || inv0 <= 0 || s == null || s <= 0 || s0 == null || s0 <= 0 || !yearsBefore(a, i, i - 1, 1)) continue;
    const inventoryGrowth = inv / inv0 - 1;
    const salesGrowth = s / s0 - 1;
    rows.push({ end: a.periods[i], i, inventory: inv, inventoryGrowth, salesGrowth, gap: inventoryGrowth - salesGrowth, share: inv / s });
  }
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  if (latest.i < n) return { lastShown: latest.end };
  return { history: lastRun(a, rows, span), latest };
}

const grew = (g: number) => `${g >= 0 ? 'grew' : 'fell'} ${pc(Math.abs(g), 1)}`;

export function inventoryWords(x: InventorySales): string {
  const y = x.latest;
  const pts = (Math.abs(y.gap) * 100).toFixed(1);
  let t = `Inventory ${grew(y.inventoryGrowth)} in ${fy(y.end)} to ${usd(y.inventory)} while sales ${grew(y.salesGrowth)}`;
  if (y.share < MATERIAL) return `${t}. Inventory is only ${pc(y.share, 1)} of a year’s sales, too small for the gap to matter.`;
  t += pilingUp(y)
    ? `: inventory growth was ${pts} points above sales growth, so goods are piling up. Bernard and Noel (1991) and Thomas and Zhang (2002) found that companies whose inventory jumped ahead of sales went on to weaker profits and returns. A planned build-up (for a launch, or against a supply shortage) can explain it too.`
    : y.gap < -PILING_UP
      ? `: inventory growth was ${pts} points below sales growth, so goods are selling faster than they are being stocked.`
      : ': about in step (within 10 points).';
  return t;
}

export const inventoryStaleWords = (s: InventoryStale) => `The newest filings don’t show inventory with sales for two year-ends in a row; it was last worked out for ${fy(s.lastShown)}.`;
