import { describe, expect, it } from 'vitest';
import { checklist, tradePlan, twoRTarget } from './plan';

describe('trade plan', () => {
  it('sizes by risk % of the account and reports $ and % at risk', () => {
    const p = tradePlan({ entry: 100, stop: 95, target: 112, account: 20000, riskPct: 0.5 })!;
    // risk budget 100, 5 a share -> 20 shares
    expect(p.shares).toBe(20);
    expect(p.riskDollars).toBe(100);
    expect(p.riskPctOfAccount).toBeCloseTo(0.005);
    expect(p.cost).toBe(2000);
    expect(p.costPct).toBeCloseTo(0.1);
    expect(p.rMultiple).toBeCloseTo(2.4);
    expect(p.rewardDollars).toBe(240);
    expect(p.guideTarget).toBe(false);
    expect(p.stopPct).toBeCloseTo(0.05);
    expect(p.warnings).toEqual([]);
  });

  it('uses the 2R guide when there is no target (or a target below the entry)', () => {
    expect(twoRTarget(50, 48)).toBe(54);
    const p = tradePlan({ entry: 50, stop: 48, target: null, account: 10000, riskPct: 1 })!;
    expect(p.target).toBe(54);
    expect(p.guideTarget).toBe(true);
    expect(p.rMultiple).toBe(2);
    expect(tradePlan({ entry: 50, stop: 48, target: 49, account: 10000, riskPct: 1 })!.guideTarget).toBe(true);
  });

  it('is null for a stop at or above the entry (long only)', () => {
    expect(tradePlan({ entry: 100, stop: 100, account: 1e4, riskPct: 1 })).toBeNull();
    expect(tradePlan({ entry: 100, stop: 101, account: 1e4, riskPct: 1 })).toBeNull();
    expect(tradePlan({ entry: null, stop: 90, account: 1e4, riskPct: 1 })).toBeNull();
  });

  it('caps the shares by buying power and max order value, and says which', () => {
    const big = { entry: 10, stop: 9.9, account: 100000, riskPct: 1 }; // risk budget 1000 / 0.10 = 10,000 shares
    const byPower = tradePlan({ ...big, buyingPower: 5000, maxOrder: 50000 })!;
    expect(byPower.shares).toBe(500);
    expect(byPower.capped).toBe('buying power');
    const byOrder = tradePlan({ ...big, buyingPower: 1e6, maxOrder: 2000 })!;
    expect(byOrder.shares).toBe(200);
    expect(byOrder.capped).toBe('max order');
    expect(byOrder.riskDollars).toBe(20);
    expect(byOrder.warnings.join(' ')).toMatch(/max order/);
  });

  it('warns when there is no account value, the stop is too wide, or the reward is thin', () => {
    expect(tradePlan({ entry: 100, stop: 90, account: null, riskPct: 1 })!.warnings[0]).toMatch(/No account value/);
    expect(tradePlan({ entry: 1000, stop: 500, account: 1000, riskPct: 0.5 })!.warnings[0]).toMatch(/too wide/);
    expect(tradePlan({ entry: 100, stop: 90, target: 110, account: 1e5, riskPct: 1 })!.warnings.join(' ')).toMatch(/1\.0R/);
  });
});

describe('post-order checklist', () => {
  it('starts with the entry ready and the stop waiting for a fill', () => {
    expect(checklist({ entryPlaced: false, canSell: 0, stopWorking: false, alertsSet: false })).toEqual({ entry: 'ready', stop: 'waiting', alerts: 'ready' });
  });
  it('offers the stop once shares are held, and ticks it when a stop sell is working', () => {
    expect(checklist({ entryPlaced: true, canSell: 10, stopWorking: false, alertsSet: true })).toEqual({ entry: 'done', stop: 'ready', alerts: 'done' });
    expect(checklist({ entryPlaced: false, canSell: 0, stopWorking: true, alertsSet: false })).toEqual({ entry: 'done', stop: 'done', alerts: 'ready' });
  });
});
