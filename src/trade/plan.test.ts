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
  const base = { entryPlaced: false, entryFilled: 0, canSell: 0, stopWorking: false, alertsSet: false };
  it('starts with the entry to do and the stop waiting for a fill', () => {
    expect(checklist(base)).toMatchObject({ entry: 'ready', stop: 'waiting', alerts: 'ready', stopQty: 0 });
  });
  it('a placed entry waits for its fill; shares held from before never tick it', () => {
    expect(checklist({ ...base, entryPlaced: true })).toMatchObject({ entry: 'waiting', stop: 'waiting' });
    const before = checklist({ ...base, canSell: 50 });
    expect(before).toMatchObject({ entry: 'ready', stop: 'waiting', stopQty: 0, otherHeld: 50 });
  });
  it('the stop covers only this trade’s filled shares, and says what else is held', () => {
    const c = checklist({ ...base, entryPlaced: true, entryFilled: 20, canSell: 70 });
    expect(c).toMatchObject({ entry: 'done', stop: 'ready', stopQty: 20, otherHeld: 50 });
    expect(checklist({ ...base, entryPlaced: true, entryFilled: 20, canSell: 5 }).stopQty).toBe(5); // open sells already cover the rest
    expect(checklist({ ...base, entryPlaced: true, entryFilled: 20, canSell: 20, stopWorking: true, alertsSet: true })).toMatchObject({ entry: 'done', stop: 'done', alerts: 'done' });
  });
});
