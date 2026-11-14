import { describe, expect, it } from 'vitest';
import type { Statements } from './debtDilution';
import { deferredRevenue, deferredStaleWords, deferredWords, goodwill, goodwillWords, slower, staleWords, type Deferred, type Goodwill, type GoodwillStale } from './balanceQuality';

// SEC company facts, checked live 2026-11-13/14 ($bn). Microsoft fiscal years end June 30, Coca-Cola December 31.
const B = 1e9;
const msft: Statements = {
  periods: ['2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30'],
  values: {
    revenue: [211.915, 245.122, 281.724, 331.839].map((x) => x * B),
    deferredRevenue: [50.901, 57.582, 64.555, 72.965].map((x) => x * B),
    goodwill: [67.886, 119.22, 119.509, 119.651].map((x) => x * B),
    goodwillImpairment: [null, null, 0, null],
    intangibleImpairment: [null, null, null, null],
    equity: [206.223, 268.477, 343.479, 442.387].map((x) => x * B),
    totalAssets: [411.976, 512.163, 619.003, 758.376].map((x) => x * B),
  },
};
const ko: Statements = {
  periods: ['2020-12-31', '2021-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'],
  values: {
    revenue: [33.014, 38.655, 43.004, 45.754, 47.061, 47.941].map((x) => x * B),
    deferredRevenue: Array(6).fill(null),
    goodwill: [17.506, 19.363, 18.782, 18.358, 18.139, 15.491].map((x) => x * B),
    goodwillImpairment: [0.014, 0.007, null, null, 0.006, null].map((x) => (x == null ? null : x * B)),
    intangibleImpairment: [0.055, 0.078, 0.057, 0, 0.886, 1.033].map((x) => x * B),
    equity: [19.299, 22.999, 24.105, 25.941, 24.856, 32.169].map((x) => x * B),
    totalAssets: [87.296, 94.354, 92.763, 97.703, 100.549, 104.816].map((x) => x * B),
  },
};

describe('Billed in advance', () => {
  it('compares deferred revenue growth with sales growth (Microsoft FY2026)', () => {
    const d = deferredRevenue(msft) as Deferred;
    // 72.965 / 64.555 - 1 = 13.03%; 331.839 / 281.724 - 1 = 17.79%; gap -4.76 points; months 72.965 / (331.839 / 12) = 2.64
    expect(d.latest.deferredGrowth).toBeCloseTo(0.1302765, 6);
    expect(d.latest.revenueGrowth).toBeCloseTo(0.1778869, 6);
    expect(d.gap).toBeCloseTo(-0.0476104, 6);
    expect(d.months).toBeCloseTo(2.638569, 5);
    expect(d.history[0].deferredGrowth).toBeNull();
    expect(deferredWords(d)).toBe(
      'At the end of FY2026 customers had already been billed $73.0 billion for work not yet delivered: 2.6 months of sales. It grew +13.0% while sales grew +17.8%: 4.8 points slower, so less of next year’s sales is already booked than a year ago.',
    );
    expect(deferredRevenue(ko)).toBeNull(); // Coca-Cola doesn't tag it
    // the table's red and the words' "in step" use the same 1-point line
    expect(slower(d.latest)).toBe(true);
    expect(slower({ ...d.latest, deferredGrowth: 0.1, revenueGrowth: 0.104 })).toBe(false);
    // never an old year as today's: the newest balance sheet stopped showing it
    const gone = { ...msft, values: { ...msft.values, deferredRevenue: [50.901 * B, 57.582 * B, null, null] } };
    const st = deferredRevenue(gone);
    expect(st).toEqual({ lastShown: '2024-06-30' });
    expect(deferredStaleWords(st as { lastShown: string })).toBe('The filings haven’t shown deferred revenue on a line of its own since FY2024, so today’s figure can’t be read from them.');
    const faster = { ...msft, values: { ...msft.values, deferredRevenue: [50.901, 57.582, 64.555, 80].map((x) => x * B) } };
    expect(deferredWords(deferredRevenue(faster) as Deferred)).toMatch(/points faster, so more of next year’s sales is already booked/);
  });
});

describe('Goodwill and write-downs', () => {
  it('sets goodwill against equity and assets (Microsoft FY2026)', () => {
    const g = goodwill(msft) as Goodwill;
    // 119.651 / 442.387 = 27.0%; / 758.376 = 15.8%; a reported 0 write-down is not a write-down
    expect(g.ofEquity).toBeCloseTo(0.2704668, 6);
    expect(g.ofAssets).toBeCloseTo(0.1577727, 6);
    expect(g.writeDowns).toEqual([]);
    expect(goodwillWords(g)).toBe(
      'Goodwill (what acquisitions cost above the value of what was bought) was $120 billion at the end of FY2026: 27% of shareholders’ equity and 16% of total assets. The filings report no write-downs in FY2023–FY2026.',
    );
  });

  it('lists Coca-Cola’s write-downs and what share of the goodwill they took', () => {
    const g = goodwill(ko) as Goodwill;
    // 15.491 / 32.169 = 48.2%; goodwill written down FY2021 0.007 + FY2024 0.006 = 0.013 against 17.506 at the start
    // (end of FY2020) = 0.074%; trademarks and other intangibles reported apart (never mixed into the goodwill share)
    expect(g.ofEquity).toBeCloseTo(0.4815506, 6);
    expect(g.writeDowns.map((w) => w.end)).toEqual(['2021-12-31', '2022-12-31', '2024-12-31', '2025-12-31']);
    expect(g.goodwillWrittenOff).toBeCloseTo(0.013 / 17.506, 9);
    expect(goodwillWords(g)).toBe(
      'Goodwill (what acquisitions cost above the value of what was bought) was $15.5 billion at the end of FY2025: 48% of shareholders’ equity and 15% of total assets. Goodwill written down in FY2021–FY2025: FY2021 $7 million and FY2024 $6 million (0.1% of the goodwill at the start). Other intangibles (such as brands and trademarks) written down: FY2021 $78 million, FY2022 $57 million, FY2024 $886 million and FY2025 $1.0 billion.',
    );
  });

  it('never shows an old goodwill figure as today’s, and handles negative equity', () => {
    // Apple last tagged goodwill on its own line in FY2017
    const aapl: Statements = { periods: ['2017-09-30', '2018-09-29', '2026-09-26'], values: { goodwill: [5.717 * B, null, null], totalAssets: [375 * B, 365 * B, 404.548 * B] } };
    const s = goodwill(aapl) as GoodwillStale;
    expect(s).toEqual({ lastShown: '2017-09-30', writeDowns: [] });
    expect(staleWords(s)).toBe('The filings haven’t shown goodwill on a line of its own since FY2017, so today’s figure can’t be read from them.');
    // a company that wrote off its goodwill and dropped the line: the write-down is shown, not hidden
    const wiped: Statements = { periods: ['2024-12-31', '2025-12-31'], values: { goodwill: [3 * B, null], goodwillImpairment: [null, 3 * B], totalAssets: [20 * B, 17 * B] } };
    const w = goodwill(wiped) as GoodwillStale;
    expect(w.writeDowns).toEqual([{ end: '2025-12-31', goodwill: 3 * B, intangibles: null }]);
    expect(staleWords(w)).toMatch(/since FY2024, .* Goodwill written down since then: FY2025 \$3\.0 billion, which may be why the line is gone\.$/);
    expect(goodwill({ periods: ['2025'], values: {} })).toBeNull();
    const neg = { ...msft, values: { ...msft.values, equity: [1, 1, 1, -5 * B] } };
    expect(goodwillWords(goodwill(neg) as Goodwill)).toMatch(/: 16% of total assets\. Shareholders’ equity is below zero/);
  });
});
