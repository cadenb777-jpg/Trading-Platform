import { describe, expect, it } from 'vitest';
import type { Statements } from './debtDilution';
import { altman, altmanWords, beneish, beneishWords, isManufacturer, type Beneish, type BeneishMissing } from './health';

// Apple FY2025 and FY2026 10-K figures (SEC company facts, checked live 2026-11-13), $bn.
const B = 1e9;
const aapl: Statements = {
  periods: ['2025-09-27', '2026-09-26'],
  values: {
    revenue: [416.161 * B, 478.834 * B], grossProfit: [195.201 * B, 233.602 * B], receivables: [39.777 * B, 43.817 * B],
    currentAssets: [147.957 * B, 173.857 * B], ppe: [49.834 * B, 52.084 * B], totalAssets: [359.241 * B, 404.548 * B],
    dna: [11.698 * B, 13.423 * B], sga: [27.601 * B, 29.774 * B], currentLiabilities: [165.631 * B, 169.915 * B],
    longTermDebt: [78.328 * B, 68.208 * B], netIncome: [112.01 * B, 132.175 * B], operatingCashFlow: [111.482 * B, 145.097 * B],
    totalLiabilities: [285.508 * B, 292.455 * B], retainedEarnings: [-14.264 * B, 13.7 * B], operatingIncome: [133.05 * B, 158.063 * B],
    equity: [73.733 * B, 112.093 * B],
  },
};

describe('Beneish M-score', () => {
  it('works out the 8 ratios and M for Apple FY2026', () => {
    const b = beneish(aapl) as Beneish;
    // DSRI (43.817/478.834)/(39.777/416.161) = 0.957386; GMI (195.201/416.161)/(233.602/478.834) = 0.961455
    // AQI (1-(173.857+52.084)/404.548)/(1-(147.957+49.834)/359.241) = 0.982373; SGI 478.834/416.161 = 1.150598
    // DEPI (11.698/61.532)/(13.423/65.507) = 0.927788; SGAI (29.774/478.834)/(27.601/416.161) = 0.937538
    // LVGI ((169.915+68.208)/404.548)/((165.631+78.328)/359.241) = 0.866763; TATA (132.175-145.097)/404.548 = -0.031942
    expect(b.ratios.DSRI).toBeCloseTo(0.9573859, 6);
    expect(b.ratios.GMI).toBeCloseTo(0.9614553, 6);
    expect(b.ratios.AQI).toBeCloseTo(0.9823727, 6);
    expect(b.ratios.SGI).toBeCloseTo(1.150598, 6);
    expect(b.ratios.DEPI).toBeCloseTo(0.9277879, 6);
    expect(b.ratios.SGAI).toBeCloseTo(0.9375378, 6);
    expect(b.ratios.LVGI).toBeCloseTo(0.866763, 6);
    expect(b.ratios.TATA).toBeCloseTo(-0.0319418, 6);
    // M = -4.84 + .92 DSRI + .528 GMI + .404 AQI + .892 SGI + .115 DEPI - .172 SGAI + 4.679 TATA - .327 LVGI = -2.51579
    expect(b.m).toBeCloseTo(-2.515793, 5);
    expect(b.flagged).toBe(false);
    expect(beneishWords(b)).toBe('M-score −2.52 (FY2026 vs FY2025) is below Beneish’s −1.78 line: nothing in these eight ratios looks like the companies later found to have inflated profits.');
  });

  it('flags a manipulator-like profile and names what drove it', () => {
    // receivables doubled while sales rose 10%, and profit far above cash
    const bad: Statements = { ...aapl, values: { ...aapl.values, receivables: [39.777 * B, 87.5 * B], netIncome: [112.01 * B, 190 * B] } };
    const b = beneish(bad) as Beneish;
    expect(b.m).toBeCloseTo(-0.968, 2);
    expect(b.flagged).toBe(true);
    // pushes: TATA 4.679 x (190 - 145.097)/404.548 = 0.519 and DSRI 0.92 x (1.82 - 1) = 0.75, over SGI 0.892 x 0.151 = 0.134
    expect(b.drivers).toEqual(['DSRI', 'TATA']);
    expect(beneishWords(b)).toMatch(/^M-score −0\.97 \(FY2026 vs FY2025\) is above Beneish’s −1\.78 line: .*mainly because money owed by customers grew faster than sales and profit well above the cash it brought in\. A flag/);
  });

  it('never scores with a ratio missing', () => {
    const noRec = { ...aapl, values: { ...aapl.values, receivables: [null, null] } };
    expect(beneish(noRec)).toEqual({ missing: ['receivables'] });
    // every line there but a ratio divides by zero (no sales the year before): said as such, never "missing"
    const zero = { ...aapl, values: { ...aapl.values, revenue: [0, 478.834 * B] } };
    expect((beneish(zero) as BeneishMissing).undefinedRatio).toBe('Days’ sales in receivables');
  });

  it('falls back to an earlier year pair when the newest one can’t be worked out', () => {
    const three: Statements = {
      periods: ['2024-09-28', ...aapl.periods],
      values: Object.fromEntries(Object.entries(aapl.values).map(([k, v]) => [k, [v[0], ...v]])),
    };
    three.values.revenue = [416.161 * B, 416.161 * B, 0]; // the newest year can't be scored
    const b = beneish(three) as Beneish;
    expect([b.end, b.previousEnd]).toEqual(['2025-09-27', '2024-09-28']);
  });

  it('never names a falling overheads or debt ratio as a reason', () => {
    // overheads and debt fell sharply (they raise M through negative weights) plus a big receivables jump
    const odd: Statements = { ...aapl, values: { ...aapl.values, sga: [27.601 * B, 5 * B], longTermDebt: [78.328 * B, 0], receivables: [39.777 * B, 120 * B] } };
    const b = beneish(odd) as Beneish;
    expect(b.flagged).toBe(true);
    expect(b.drivers).not.toContain('SGAI');
    expect(b.drivers).not.toContain('LVGI');
  });
});

describe('Altman Z-score', () => {
  it('uses the original Z for a manufacturer with a price', () => {
    // X1 (173.857-169.915)/404.548 = 0.0097442; X2 13.7/404.548 = 0.033865; X3 158.063/404.548 = 0.390715;
    // X4 = 4,000/292.455 (illustrative $4 trillion market value); X5 478.834/404.548 = 1.183627; Z = 10.73848
    const z = altman(aapl, '3571', 4e12)!;
    expect(z.model).toBe('Z');
    expect(z.x.workingCapital).toBeCloseTo(0.0097442, 6);
    expect(z.x.retained).toBeCloseTo(0.033865, 6);
    expect(z.z).toBeCloseTo(10.738482, 5);
    expect(altmanWords(z)).toBe('Z-score 10.74 for FY2026 is in the safe zone (below 1.81 = distress, above 2.99 = safe).');
  });

  it('uses Z-prime on book values for a manufacturer without a price, Z-double-prime for others', () => {
    // Z' = 0.717 X1 + 0.847 X2 + 3.107 X3 + 0.420 (112.093/292.455) + 0.998 X5 = 2.591861 (grey: 1.23-2.90)
    const book = altman(aapl, '3571', null)!;
    expect([book.model, book.bookReason, book.zone]).toEqual(["Z'", 'no-price', 'grey']);
    expect(book.z).toBeCloseTo(2.591861, 5);
    expect(altmanWords(book)).toBe('Z′-score 2.59 for FY2026 is in the grey zone in between (below 1.23 = distress, above 2.9 = safe). Without a live price this uses book equity (Altman’s manufacturer version for book values).');
    // Z'' = 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 (112.093/292.455) = 3.202374
    const svc = altman(aapl, '7372', 4e12)!;
    expect([svc.model, svc.bookReason, svc.x.sales]).toEqual(["Z''", null, null]);
    expect(svc.z).toBeCloseTo(3.202374, 5);
    // today's market value is never set against an older year's accounts
    const stale: Statements = { periods: [...aapl.periods, '2027-09-25'], values: Object.fromEntries(Object.entries(aapl.values).map(([k, v]) => [k, [...v, null]])) };
    const old = altman(stale, '3571', 4e12)!;
    expect([old.model, old.bookReason, old.end]).toEqual(["Z'", 'old-year', '2026-09-26']);
    expect(altmanWords(old)).toMatch(/scores an older year on book equity/);
    // Coca-Cola tags no total liabilities: assets 104.816 - equity 32.169 = 72.647
    const noTl = { ...aapl, values: { ...aapl.values, totalLiabilities: [null, null] } };
    const d = altman(noTl, '2080', 4e12)!;
    expect(d.liabilitiesDerived).toBe(true);
    expect(d.x.equity).toBeCloseTo(4000 / (404.548 - 112.093), 6);
    expect(altmanWords(d)).toMatch(/total assets minus shareholders’ equity \(any minority interests count as equity\)\.$/);
  });

  it('reads the zones and leaves banks out', () => {
    const weak = { ...aapl, values: { ...aapl.values, operatingIncome: [0, -20 * B], retainedEarnings: [0, -150 * B], currentAssets: [0, 120 * B] } };
    expect(altman(weak, '3571', 50e9)!.zone).toBe('distress');
    expect(altman(aapl, '6021', 4e12)).toBeNull();
    expect([isManufacturer('3571'), isManufacturer('7372'), isManufacturer('')]).toEqual([true, false, false]);
  });
});
