/**
 * Merger model: does buying the target raise (accretion) or lower (dilution) the buyer's earnings per share in the
 * first full year? Cash is assumed borrowed at `debtRate` (or taken from cash earning the same), stock is issued at
 * the buyer's share price, synergies are pre-tax and fully achieved. An estimate for learning, not advice.
 */

export interface MergerInputs {
  acquirerPrice: number;
  acquirerShares: number;
  acquirerNetIncome: number;
  targetPrice: number;
  targetShares: number;
  targetNetIncome: number;
  /** Premium over the target's share price (0.3 = 30%). */
  premium: number;
  /** Share of the price paid in cash (0..1); the rest in new acquirer shares. */
  cashShare: number;
  /** Pre-tax cost of the cash part (interest on new debt or interest given up). */
  debtRate: number;
  taxRate: number;
  /** Yearly pre-tax cost savings / extra profit from combining. */
  synergies: number;
}

export interface MergerResult {
  offerPerShare: number;
  purchasePrice: number;
  cashPaid: number;
  stockPaid: number;
  newShares: number;
  financingCost: number;
  proFormaNetIncome: number;
  proFormaShares: number;
  standaloneEps: number;
  proFormaEps: number;
  accretion: number;
  /** Pre-tax synergies needed for no dilution (0 or less = accretive without any). */
  breakevenSynergies: number;
  /** The target's owners' share of the combined company. */
  targetOwnership: number;
  /** Price paid / target earnings, and the buyer's own P/E. */
  offerPe: number;
  acquirerPe: number;
}

export function merger(i: MergerInputs): MergerResult {
  const offerPerShare = i.targetPrice * (1 + i.premium);
  const purchasePrice = offerPerShare * i.targetShares;
  const cashShare = Math.min(1, Math.max(0, i.cashShare));
  const cashPaid = purchasePrice * cashShare;
  const stockPaid = purchasePrice - cashPaid;
  const newShares = i.acquirerPrice > 0 ? stockPaid / i.acquirerPrice : NaN;
  const financingCost = cashPaid * i.debtRate * (1 - i.taxRate);
  const proFormaNetIncome = i.acquirerNetIncome + i.targetNetIncome + i.synergies * (1 - i.taxRate) - financingCost;
  const proFormaShares = i.acquirerShares + newShares;
  const standaloneEps = i.acquirerNetIncome / i.acquirerShares;
  const proFormaEps = proFormaNetIncome / proFormaShares;
  const breakevenSynergies = (standaloneEps * proFormaShares - i.acquirerNetIncome - i.targetNetIncome + financingCost) / (1 - i.taxRate);
  return {
    offerPerShare,
    purchasePrice,
    cashPaid,
    stockPaid,
    newShares,
    financingCost,
    proFormaNetIncome,
    proFormaShares,
    standaloneEps,
    proFormaEps,
    accretion: proFormaEps / standaloneEps - 1,
    breakevenSynergies,
    targetOwnership: newShares / proFormaShares,
    offerPe: i.targetNetIncome > 0 ? purchasePrice / i.targetNetIncome : NaN,
    acquirerPe: i.acquirerNetIncome > 0 ? (i.acquirerPrice * i.acquirerShares) / i.acquirerNetIncome : NaN,
  };
}

/** Accretion for each premium (rows) and cash share (columns). */
export function mergerSensitivity(i: MergerInputs, premiums: number[], cashShares: number[]): number[][] {
  return premiums.map((premium) => cashShares.map((cashShare) => merger({ ...i, premium, cashShare }).accretion));
}
