import { describe, expect, it } from 'vitest';
import { inventorySales, inventoryWords, pilingUp, type InventorySales } from './inventory';
import type { Statements } from './debtDilution';

// Apple's 10-K figures (SEC company facts, checked 2026-11-18): InventoryNet and
// RevenueFromContractWithCustomerExcludingAssessedTax at each fiscal year-end
const apple: Statements = {
  periods: ['2023-09-30', '2024-09-28', '2025-09-27', '2026-09-26'],
  values: {
    inventory: [6_331e6, 7_286e6, 5_718e6, 14_541e6],
    revenue: [383_285e6, 391_035e6, 416_161e6, 478_834e6],
    totalAssets: [1, 1, 1, 1],
  },
};

describe('Inventory against sales', () => {
  it('Apple FY2026: inventory up 154.3% while sales grew 15.1%', () => {
    const x = inventorySales(apple) as InventorySales;
    expect(x.history.map((y) => y.end)).toEqual(['2024-09-28', '2025-09-27', '2026-09-26']);
    const [y24, y25, y26] = x.history;
    // 14,541 / 5,718 - 1 = 1.54302; 478,834 / 416,161 - 1 = 62,673 / 416,161 = 0.150598
    expect(y26.inventoryGrowth).toBeCloseTo(1.54302, 5);
    expect(y26.salesGrowth).toBeCloseTo(0.150598, 6);
    expect(y26.gap).toBeCloseTo(1.392422, 5);
    // 14,541 / 478,834 = 3.04% of sales: big enough to matter (1% is the line)
    expect(y26.share).toBeCloseTo(0.030368, 6);
    expect(pilingUp(y26)).toBe(true);
    // FY2025: 5,718 / 7,286 - 1 = -0.215207 against +0.064255
    expect(y25.gap).toBeCloseTo(-0.279462, 6);
    expect(pilingUp(y25)).toBe(false);
    // FY2024: 955 / 6,331 = +15.1% against 7,750 / 383,285 = +2.0%: 13.1 points ahead
    expect(y24.gap).toBeCloseTo(0.130625, 6);
    expect(pilingUp(y24)).toBe(true);
    expect(inventoryWords(x)).toMatch(/^Inventory grew 154\.3% in FY2026 to \$14\.5 billion while sales grew 15\.1%: inventory growth was 139\.2 points above sales growth, so goods are piling up\./);
  });

  it('in step, slower, too small to matter', () => {
    const step = inventorySales({ periods: ['2024-12-31', '2025-12-31'], values: { inventory: [100, 108], revenue: [1000, 1050] } }) as InventorySales;
    expect(inventoryWords(step)).toMatch(/about in step \(within 10 points\)\.$/);
    const slow = inventorySales({ periods: ['2024-12-31', '2025-12-31'], values: { inventory: [100, 80], revenue: [1000, 1100] } }) as InventorySales;
    expect(inventoryWords(slow)).toMatch(/: inventory growth was 30\.0 points below sales growth/);
    // Microsoft-sized inventory (0.3% of sales) is never flagged
    const tiny = inventorySales({ periods: ['2024-06-30', '2025-06-30'], values: { inventory: [1, 3], revenue: [1000, 1000] } }) as InventorySales;
    expect(pilingUp(tiny.latest)).toBe(false);
    expect(inventoryWords(tiny)).toMatch(/too small for the gap to matter\.$/);
  });

  it('both falling: words say above or below, never "grew faster" for stock that fell', () => {
    const fall = inventorySales({ periods: ['2024-12-31', '2025-12-31'], values: { inventory: [100, 95], revenue: [1000, 800] } }) as InventorySales;
    // -5% against -20%: 15 points above
    expect(inventoryWords(fall)).toMatch(/^Inventory fell 5\.0% in FY2025 to \$95 while sales fell 20\.0%: inventory growth was 15\.0 points above sales growth/);
  });

  it('no inventory, a gap year, a stale newest year', () => {
    expect(inventorySales({ periods: ['2024-12-31', '2025-12-31'], values: { inventory: [null, null], revenue: [1, 2] } })).toBeNull();
    // two year-ends two years apart are not one year's growth
    expect(inventorySales({ periods: ['2023-12-31', '2025-12-31'], values: { inventory: [1, 2], revenue: [1, 2] } })).toBeNull();
    expect(inventorySales({ periods: ['2023-12-31', '2024-12-31', '2025-12-31'], values: { inventory: [1, 2, null], revenue: [1, 2, 3] } })).toEqual({ lastShown: '2024-12-31' });
  });
});
