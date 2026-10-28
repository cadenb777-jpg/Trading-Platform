/**
 * The trade plan shown next to the order ticket (Trade page): entry, stop, target, reward:risk, size by risk % of
 * the real account, dollars at risk and the share of the account. Pure, so it can be tested (plan.test.ts). Long only:
 * the platform never sells short.
 */
import { maxBuyShares, riskShares } from './sizing';

export interface PlanInput {
  entry: number | null;
  stop: number | null;
  /** The setup's target; when missing the plan uses the 2R guide (twice the risk above the entry). */
  target?: number | null;
  /** Account value the risk % is taken from (the selected Webull account). */
  account: number | null;
  riskPct: number;
  /** Optional caps: shares are cut to stay inside both. */
  buyingPower?: number | null;
  maxOrder?: number | null;
}

export interface TradePlan {
  entry: number;
  stop: number;
  target: number;
  /** True when the target is the 2R guide, not the setup's own tested target. */
  guideTarget: boolean;
  /** Risk per share (entry - stop) and the stop's distance in %. */
  perShare: number;
  stopPct: number;
  /** Reward per share to the target and its distance in %. */
  rewardPerShare: number;
  targetPct: number;
  /** Reward divided by risk ("2.0R"). */
  rMultiple: number;
  shares: number;
  cost: number;
  /** Cost as a share of the account (0-1), null without an account value. */
  costPct: number | null;
  /** Dollars lost if the stop is hit with these shares, and that as a share of the account (0-1). */
  riskDollars: number;
  riskPctOfAccount: number | null;
  rewardDollars: number;
  /** Why the shares are fewer than the risk % alone would buy. */
  capped: 'buying power' | 'max order' | null;
  warnings: string[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Twice the risk above the entry: the take-profit guide used when a strategy has no fixed target. */
export const twoRTarget = (entry: number, stop: number) => round2(entry + 2 * (entry - stop));

/** The plan for a buy, or null when the entry and stop don't make a long trade (stop must be below the entry). */
export function tradePlan(i: PlanInput): TradePlan | null {
  const { entry, stop } = i;
  if (!(entry != null && entry > 0) || !(stop != null && stop > 0) || stop >= entry) return null;
  const guideTarget = !(i.target != null && i.target > entry);
  const target = guideTarget ? twoRTarget(entry, stop) : (i.target as number);
  const account = i.account != null && i.account > 0 ? i.account : null;
  const sized = riskShares(account ?? 0, i.riskPct, entry, stop);
  let shares = sized.shares;
  let capped: TradePlan['capped'] = null;
  if (i.buyingPower != null || i.maxOrder != null) {
    const byOrder = i.maxOrder != null && i.maxOrder > 0 ? maxBuyShares(entry, i.maxOrder, null) : Infinity;
    const byPower = i.buyingPower != null && i.buyingPower >= 0 ? maxBuyShares(entry, 0, i.buyingPower) : Infinity;
    if (shares > Math.min(byOrder, byPower)) {
      capped = byPower <= byOrder ? 'buying power' : 'max order';
      shares = Math.min(byOrder, byPower);
    }
  }
  const perShare = entry - stop;
  const rewardPerShare = target - entry;
  const cost = round2(shares * entry);
  const riskDollars = round2(shares * perShare);
  const warnings: string[] = [];
  if (!account) warnings.push('No account value yet, so the size by risk can’t be worked out.');
  else if (shares === 0) warnings.push(`At ${i.riskPct}% risk the stop is too wide for even one share.`);
  if (capped) warnings.push(`Cut to ${shares} share${shares === 1 ? '' : 's'} by your ${capped === 'buying power' ? 'buying power' : 'max order value (Settings)'}.`);
  const rMultiple = rewardPerShare / perShare;
  if (rMultiple < 1.5) warnings.push(`Reward:risk is ${rMultiple.toFixed(1)}R: winners must come often for this to pay.`);
  return {
    entry,
    stop,
    target,
    guideTarget,
    perShare: round2(perShare),
    stopPct: perShare / entry,
    rewardPerShare: round2(rewardPerShare),
    targetPct: rewardPerShare / entry,
    rMultiple: Math.round(rMultiple * 100) / 100,
    shares,
    cost,
    costPct: account ? cost / account : null,
    riskDollars,
    riskPctOfAccount: account ? riskDollars / account : null,
    rewardDollars: round2(shares * rewardPerShare),
    capped,
    warnings,
  };
}

/** The post-order checklist: which steps are done, from what the account shows. */
export interface ChecklistInput {
  /** This trade's entry order was placed (from this page). */
  entryPlaced: boolean;
  /** Shares of this trade's entry that have filled (0 until it fills). */
  entryFilled: number;
  /** Shares held that a stop sell could cover (position minus open sells), including any held before this trade. */
  canSell: number;
  /** A sell stop order is working for the symbol. */
  stopWorking: boolean;
  /** Price alerts were set at the stop and target. */
  alertsSet: boolean;
}
export type StepState = 'done' | 'ready' | 'waiting';

export interface Checklist {
  entry: StepState;
  stop: StepState;
  alerts: StepState;
  /** Shares the stop sell should cover: this trade's filled shares, never more than can be sold. */
  stopQty: number;
  /** Shares held besides this trade's (not covered by the plan's stop). */
  otherHeld: number;
}

/**
 * The post-order checklist. The entry is done only when this trade's entry has filled (shares held from before don't
 * count); the stop covers only this trade's shares.
 */
export function checklist(c: ChecklistInput): Checklist {
  const filled = Math.max(0, c.entryFilled);
  const stopQty = Math.max(0, Math.min(c.canSell, filled));
  return {
    entry: filled > 0 ? 'done' : c.entryPlaced ? 'waiting' : 'ready',
    stop: c.stopWorking && filled > 0 ? 'done' : stopQty > 0 ? 'ready' : 'waiting',
    alerts: c.alertsSet ? 'done' : 'ready',
    stopQty,
    otherHeld: Math.max(0, c.canSell - stopQty),
  };
}
