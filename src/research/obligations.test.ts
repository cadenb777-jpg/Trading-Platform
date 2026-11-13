import { describe, expect, it } from 'vitest';
import { ladder, type Maturities, type Statements } from './debtDilution';
import { leases, leaseWords, purchaseWords, refinancing, refinancingWords, taxWords, vsCash, type CorpYields, type Filed, type Obligations } from './obligations';

// Apple FY2026 10-K (filed 2026-11-03), SEC company facts checked live 2026-11-13; FRED ICE BofA effective yields
// on 2026-11-11: investment grade (BAMLC0A0CMEY) 5.84%, high yield (BAMLH0A0HYM2EY) 8.11%.
const aaplLadder: Maturities = {
  asOf: '2026-09-26', filed: '2026-11-03', accession: '0000320193-26-000026', form: '10-K',
  buckets: { next12: 9.991e9, year2: 9.3e9, year3: 5.175e9, year4: 4.956e9, year5: 3.75e9, after5: 45.506e9 },
};
const aapl: Statements = {
  periods: ['2023-09-30', '2024-09-28', '2025-09-27', '2026-09-26'],
  values: { operatingIncome: [114.301e9, 123.216e9, 133.05e9, 158.063e9], interestExpense: [3.933e9, null, null, null] },
};
const yields: CorpYields = { ig: { value: 5.84, date: '2026-11-11', series: 'BAMLC0A0CMEY' }, hy: { value: 8.11, date: '2026-11-11', series: 'BAMLH0A0HYM2EY' } };
const filed = (value: number, tag: string): Filed => ({ value, asOf: '2026-09-26', filed: '2026-11-03', accession: '0000320193-26-000026', form: '10-K', tag });
const aaplObl: Obligations = {
  leases: {
    asOf: '2026-09-26', filed: '2026-11-03', accession: '0000320193-26-000026', form: '10-K',
    buckets: { next12: 1.98e9, year2: 2.053e9, year3: 1.921e9, year4: 1.617e9, year5: 1.41e9, after5: 6.362e9, total: 15.343e9, presentValue: 12.912e9 },
  },
  financeLease: filed(1.456e9, 'FinanceLeaseLiability'),
  purchase: filed(24.844e9, 'UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount'),
  uncertainTax: filed(22.487e9, 'UnrecognizedTaxBenefits'),
};
const cash = 56.722e9; // cash + short-term investments, latest quarter

describe('Refinancing wall', () => {
  it('prices the debt due within 2 years at today’s averages (Apple FY2026)', () => {
    const r = refinancing(ladder(aaplLadder), aapl, yields)!;
    // 19.291e9 x 5.84% = 1.1265944e9; / 158.063e9 = 0.7128%; x 8.11% = 1.5645001e9
    expect(r.igCost).toBeCloseTo(1.1265944e9, 0);
    expect(r.igShareOfProfit).toBeCloseTo(0.0071275, 7);
    expect(r.hyCost).toBeCloseTo(1.5645001e9, 0);
    expect(refinancingWords(r)).toBe(
      "Borrowing the $19.3 billion due within 2 years again at today's investment-grade average yield (5.84% on Nov 11, 2026) would cost $1.1 billion a year in interest, 0.7% of FY2026 operating profit; at the high-yield average (8.11%), $1.6 billion. These are market averages, not the company’s own rate, which depends on its credit rating.",
    );
  });

  it('works with one yield, says nothing about profit after a loss, and needs a yield and debt due', () => {
    const hyOnly = refinancing(ladder(aaplLadder), aapl, { ig: null, hy: yields.hy })!;
    expect(refinancingWords(hyOnly)).toBe(
      "Borrowing the $19.3 billion due within 2 years again at today's high-yield average (8.11% on Nov 11, 2026) would cost $1.6 billion a year in interest. These are market averages, not the company’s own rate, which depends on its credit rating.",
    );
    const loss = refinancing(ladder(aaplLadder), { periods: ['2026-09-26'], values: { operatingIncome: [-1e9] } }, yields)!;
    expect(loss.igShareOfProfit).toBeNull();
    expect(refinancingWords(loss)).not.toMatch(/operating profit/);
    expect(refinancing(ladder(aaplLadder), aapl, { ig: null, hy: null })).toBeNull();
    expect(refinancing(ladder(aaplLadder), aapl, null)).toBeNull();
    expect(refinancing(null, aapl, yields)).toBeNull();
    const nothingSoon: Maturities = { ...aaplLadder, buckets: { ...aaplLadder.buckets, next12: 0, year2: 0 } };
    expect(refinancing(ladder(nothingSoon), aapl, yields)).toBeNull();
  });
});

describe('Beyond the debt line', () => {
  it('splits lease payments into the liability and its interest, and adds leases to debt', () => {
    const l = leases(aaplObl, ladder(aaplLadder), aaplLadder)!;
    // 15.343 - 12.912 = 2.431; 12.912 / 78.678 = 16.41%; 78.678 + 12.912 = 91.59 ($bn)
    expect(l.interestPart).toBeCloseTo(2.431e9, 0);
    expect(l.addsToDebt).toBeCloseTo(0.164112, 6);
    expect(l.debt! + l.presentValue!).toBeCloseTo(91.59e9, 0);
    expect(leaseWords(l)).toBe(
      '$15.3 billion of operating lease payments are scheduled ($2.0 billion in the next 12 months). $12.9 billion is on the balance sheet as a lease liability; the other $2.4 billion is interest. Counting them as debt, as rating agencies do, adds 16% to the $78.7 billion of debt. Finance leases add another $1.5 billion of liability.',
    );
    // no debt ladder: no lease-adjusted debt
    expect(leases(aaplObl, null, null)!.addsToDebt).toBeNull();
    // a debt ladder from another year-end is never mixed in
    const oldLadder: Maturities = { ...aaplLadder, asOf: '2022-09-24' };
    expect(leases(aaplObl, ladder(oldLadder), oldLadder)!.addsToDebt).toBeNull();
    // payments and liability that can't be on the same basis (interest would be 50%): no split shown
    const odd = { ...aaplObl, leases: { ...aaplObl.leases!, buckets: { ...aaplObl.leases!.buckets, presentValue: 7e9 } } };
    expect(leases(odd, null, null)!.interestPart).toBeNull();
    // the total is summed only when every year is given
    const noTotal = { ...aaplObl, leases: { ...aaplObl.leases!, buckets: { ...aaplObl.leases!.buckets, total: null } } };
    expect(leases(noTotal, null, null)!.total).toBeCloseTo(15.343e9, 0);
    const gap = { ...aaplObl, leases: { ...aaplObl.leases!, buckets: { ...aaplObl.leases!.buckets, total: null, year3: null } } };
    expect(leases(gap, null, null)!.total).toBeNull();
    expect(leases({ leases: null, purchase: null, uncertainTax: null }, null, null)).toBeNull();
  });

  it('sets commitments and tax positions against cash', () => {
    // 24.844 / 56.722 = 43.8%; 22.487 / 56.722 = 39.6%
    expect(vsCash(aaplObl.purchase, cash)).toBeCloseTo(0.437996, 6);
    expect(purchaseWords(aaplObl.purchase!, cash)).toBe('Purchase commitments not on the balance sheet (goods and services it has agreed to buy): $24.8 billion, 44% of cash and short-term investments.');
    expect(taxWords(aaplObl.uncertainTax!, cash)).toBe(
      'Tax positions the company itself thinks a tax authority could overturn (unrecognized tax benefits): $22.5 billion, 40% of cash and short-term investments. Not all of it would ever be paid, and none of it is due on a date.',
    );
    expect(purchaseWords(aaplObl.purchase!, null)).toBe('Purchase commitments not on the balance sheet (goods and services it has agreed to buy): $24.8 billion.');
  });
});
