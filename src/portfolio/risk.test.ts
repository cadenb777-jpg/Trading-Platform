import { describe, expect, it } from 'vitest';
import { concentration, dividendsThisYear, drawdownCurve, fitLine, histogram, sectorBreakdown, varDollars, warnings, type RiskInput, type RiskReport, type SectorInfo } from './risk';

const rows: RiskInput[] = [
  { symbol: 'AAPL', value: 3000, kind: 'security' },
  { symbol: 'MSFT', value: 2000, kind: 'security' },
  { symbol: 'VTI', value: 4000, kind: 'security' },
  { symbol: 'CASH', value: 1000, kind: 'cash' },
];
const sectors: Record<string, SectorInfo> = {
  AAPL: { sector: 'Information Technology', source: 'SEC' },
  MSFT: { sector: 'Information Technology', source: 'SEC' },
  VTI: { sector: 'Fund', fundType: 'broad market', source: 'name' },
};

describe('account risk', () => {
  it('weights positions in the whole account; cash is in the total but not a holding', () => {
    const c = concentration(rows);
    expect(c.total).toBe(10000);
    expect(c.weights.map((x) => x.symbol)).toEqual(['VTI', 'AAPL', 'MSFT']);
    expect(c.largest).toEqual({ symbol: 'VTI', weight: 0.4 });
    expect(c.top5).toBeCloseTo(0.9);
    expect(c.effective).toBeCloseTo(1 / ((4 / 9) ** 2 + (3 / 9) ** 2 + (2 / 9) ** 2));
    expect(concentration([{ symbol: 'CASH', value: 5, kind: 'cash' }]).effective).toBeNull();
  });

  it('merges the same symbol from two accounts', () => {
    const c = concentration([...rows, { symbol: 'AAPL', value: 1000, kind: 'security' }]);
    expect(c.weights.find((x) => x.symbol === 'AAPL')?.weight).toBeCloseTo(4000 / 11000);
  });

  it('groups by sector, with funds, cash and unknowns apart', () => {
    const g = sectorBreakdown([...rows, { symbol: 'ZZZ', value: 500, kind: 'security' }], sectors);
    expect(g.map((x) => x.label)).toEqual(['Information Technology', 'Funds', 'Cash', 'Other']);
    expect(g[0].weight).toBeCloseTo(5000 / 10500);
    expect(g[0].symbols).toEqual(['AAPL', 'MSFT']);
  });

  it('warns about one big stock or sector, but not one big fund', () => {
    const w = warnings(rows, sectors);
    expect(w.some((x) => x.startsWith('AAPL is 30%'))).toBe(true);
    expect(w.some((x) => x.startsWith('Information Technology is 50%'))).toBe(true);
    expect(w.some((x) => x.startsWith('VTI'))).toBe(false);
    expect(warnings([{ symbol: 'A', value: 1, kind: 'security' }, ...Array.from({ length: 9 }, (_, i) => ({ symbol: `S${i}`, value: 1, kind: 'security' as const }))], {})).toEqual([]);
  });

  it('turns value-at-risk into live dollars on the measured part only', () => {
    const report = { stats: { var95: 0.02 }, assets: { AAPL: {}, VTI: {} } } as unknown as RiskReport;
    expect(varDollars(report, rows)).toBeCloseTo(0.02 * (3000 + 4000 + 1000)); // MSFT had no year of prices
    expect(varDollars({ ...report, stats: null }, rows)).toBeNull();
  });
});

describe('taxes', () => {
  it('estimates this year’s dividends on taxable shares', () => {
    const holdings = [
      {
        symbol: 'KO',
        history12: [{ month: '2025-12', amount: 0.5 }, { month: '2026-03', amount: 0.51 }, { month: '2026-06', amount: 0.51 }, { month: '2026-09', amount: 0.51 }],
        upcoming: [
          { exDate: '2026-09-14', payDate: '2026-10-05', perShare: 0.51, exPassed: true }, // already in history12
          { exDate: '2026-12-14', payDate: '2026-12-30', perShare: 0.51, exPassed: false },
          { exDate: '2027-03-14', payDate: '2027-04-04', perShare: 0.51, exPassed: false },
        ],
      },
      { symbol: 'O', history12: [{ month: '2026-01', amount: 1 }] },
    ];
    expect(dividendsThisYear(holdings, { KO: 10 }, new Date('2026-10-26T12:00:00Z'))).toBeCloseTo(0.51 * 4 * 10);
    expect(dividendsThisYear(holdings, {}, new Date('2026-10-26T12:00:00Z'))).toBe(0);
  });
});

describe('risk drill-downs', () => {
  it('bins daily returns on round steps and counts every day once', () => {
    const r = [-0.031, -0.012, -0.004, 0, 0.002, 0.003, 0.011, 0.019];
    const bins = histogram(r, 8);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(r.length);
    const step = bins[0].x1 - bins[0].x0;
    expect(step).toBeCloseTo(0.01, 10);
    expect(bins[0].x0).toBeCloseTo(-0.04, 10);
    for (const x of r) expect(bins.some((b) => x >= b.x0 - 1e-12 && x < b.x1 + 1e-12 && b.count > 0)).toBe(true);
    expect(histogram([])).toEqual([]);
  });

  it('splits the bins at the bad-day line, so the red bars hold exactly the days past it', () => {
    const r = Array.from({ length: 260 }, (_, i) => Math.sin(i * 1.7) * 0.02 + ((i * 7919) % 13) / 2000 - 0.003);
    const cut = -0.0137;
    const bins = histogram(r, 24, cut);
    expect(bins.some((b) => Math.abs(b.x0 - cut) < 1e-12 || Math.abs(b.x1 - cut) < 1e-12)).toBe(true);
    expect(bins.some((b) => b.x0 < cut - 1e-12 && b.x1 > cut + 1e-12)).toBe(false);
    const red = bins.filter((b) => b.x1 <= cut + 1e-12).reduce((a, b) => a + b.count, 0);
    expect(red).toBe(r.filter((x) => x < cut).length);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(r.length);
  });

  it('fits the beta line', () => {
    const spy = [0.01, -0.02, 0.005, 0.015, -0.01];
    const acct = spy.map((x) => 0.0002 + 1.4 * x);
    const f = fitLine(spy, acct)!;
    expect(f.slope).toBeCloseTo(1.4, 10);
    expect(f.intercept).toBeCloseTo(0.0002, 10);
    expect(f.r2).toBeCloseTo(1, 10);
    expect(fitLine([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('draws the drawdown from the running high', () => {
    const dd = drawdownCurve([0.1, -0.5, 0.2, 1]);
    expect(dd[0]).toBe(0);
    expect(dd[1]).toBeCloseTo(-0.5, 10);
    expect(dd[2]).toBeCloseTo(-0.4, 10);
    expect(dd[3]).toBe(0);
  });
});
