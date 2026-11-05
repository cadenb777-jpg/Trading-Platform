/**
 * Leveraged buyout model: buy the company with mostly borrowed money, repay debt from its cash flow, sell it after a
 * few years. Interest is charged on each year's opening debt (no circular reference), mandatory repayments come
 * first, then a share of the remaining cash sweeps the sweep tranches in order (senior first); unswept cash stays on
 * the balance sheet and counts against debt at exit. An estimate for learning, not advice.
 */

export interface Tranche {
  name: string;
  /** Size as a multiple of entry EBITDA, e.g. 4 = 4x. */
  multiple: number;
  /** Yearly interest rate on the opening balance. */
  rate: number;
  /** Mandatory repayment each year as a share of the original amount (0.05 = 5%). */
  amortization: number;
  /** Repaid early from spare cash (term loans: yes; bonds: usually no). */
  sweep: boolean;
}

export interface LboInputs {
  ebitda: number;
  entryMultiple: number;
  exitMultiple: number;
  years: number;
  /** Yearly EBITDA growth. */
  growth: number;
  /** Depreciation & amortisation, capex as shares of EBITDA. */
  daPct: number;
  capexPct: number;
  /** Extra working capital as a share of each year's EBITDA increase. */
  nwcPct: number;
  taxRate: number;
  /** Deal fees as a share of the entry enterprise value (paid with equity). */
  feesPct: number;
  /** Share of spare cash used to repay sweep tranches (1 = all of it). */
  sweepPct: number;
  tranches: Tranche[];
}

export interface LboYear {
  year: number;
  ebitda: number;
  da: number;
  interest: number;
  taxes: number;
  netIncome: number;
  capex: number;
  nwc: number;
  freeCashFlow: number;
  mandatory: number;
  sweep: number;
  debt: number;
  cash: number;
}

export interface LboResult {
  entryEv: number;
  fees: number;
  debt: number;
  equity: number;
  years: LboYear[];
  exitEv: number;
  netDebtAtExit: number;
  exitEquity: number;
  moic: number;
  irr: number | null;
  /** Debt / EBITDA at entry and at exit. */
  leverageIn: number;
  leverageOut: number;
}

/** Internal rate of return of yearly cash flows (year 0 first), by bisection; null when there's no sign change. */
export function irr(flows: number[]): number | null {
  const npv = (r: number) => flows.reduce((s, cf, t) => s + cf / (1 + r) ** t, 0);
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (Math.abs(f) < 1e-12) return mid;
    if (f * fLo > 0) {
      lo = mid;
      fLo = f;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

export function lbo(i: LboInputs): LboResult {
  const entryEv = i.ebitda * i.entryMultiple;
  const fees = entryEv * i.feesPct;
  const original = i.tranches.map((t) => t.multiple * i.ebitda);
  const balance = [...original];
  const debt = original.reduce((a, b) => a + b, 0);
  const equity = entryEv + fees - debt;
  const years: LboYear[] = [];
  let cash = 0;
  let prev = i.ebitda;
  for (let y = 1; y <= Math.max(1, Math.round(i.years)); y++) {
    const ebitda = prev * (1 + i.growth);
    const da = ebitda * i.daPct;
    const interest = i.tranches.reduce((s, t, k) => s + balance[k] * t.rate, 0);
    const pretax = ebitda - da - interest;
    const taxes = Math.max(0, pretax) * i.taxRate;
    const netIncome = pretax - taxes;
    const capex = ebitda * i.capexPct;
    const nwc = (ebitda - prev) * i.nwcPct;
    const freeCashFlow = netIncome + da - capex - nwc;
    let mandatory = 0;
    i.tranches.forEach((t, k) => {
      const pay = Math.min(balance[k], t.amortization * original[k]);
      balance[k] -= pay;
      mandatory += pay;
    });
    cash += freeCashFlow - mandatory;
    let sweep = 0;
    let spare = Math.max(0, cash) * i.sweepPct;
    i.tranches.forEach((t, k) => {
      if (!t.sweep || spare <= 0) return;
      const pay = Math.min(balance[k], spare);
      balance[k] -= pay;
      spare -= pay;
      sweep += pay;
    });
    cash -= sweep;
    years.push({ year: y, ebitda, da, interest, taxes, netIncome, capex, nwc, freeCashFlow, mandatory, sweep, debt: balance.reduce((a, b) => a + b, 0), cash });
    prev = ebitda;
  }
  const last = years[years.length - 1];
  const exitEv = last.ebitda * i.exitMultiple;
  const netDebtAtExit = last.debt - last.cash;
  const exitEquity = exitEv - netDebtAtExit;
  const moic = equity > 0 ? exitEquity / equity : NaN;
  const flows = [-equity, ...years.map((_, k) => (k === years.length - 1 ? exitEquity : 0))];
  return {
    entryEv,
    fees,
    debt,
    equity,
    years,
    exitEv,
    netDebtAtExit,
    exitEquity,
    moic,
    irr: equity > 0 ? irr(flows) : null,
    leverageIn: i.ebitda ? debt / i.ebitda : NaN,
    leverageOut: last.ebitda ? last.debt / last.ebitda : NaN,
  };
}

/** IRR for each entry multiple (rows) and exit multiple (columns), everything else unchanged. */
export function lboSensitivity(i: LboInputs, entries: number[], exits: number[]): (number | null)[][] {
  return entries.map((entryMultiple) => exits.map((exitMultiple) => lbo({ ...i, entryMultiple, exitMultiple }).irr));
}

export const DEFAULT_TRANCHES: Tranche[] = [
  { name: 'Senior term loan', multiple: 3, rate: 0.08, amortization: 0.05, sweep: true },
  { name: 'Senior notes', multiple: 1.5, rate: 0.095, amortization: 0, sweep: false },
];
