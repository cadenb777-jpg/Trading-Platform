import { describe, expect, it } from 'vitest';
import scannerPy from '../../helper/engine/scanner.py?raw';
import { DEFAULT_TAB, SEC_TABS, cleanSymbol, createSecHistory, parseSecRoute, secHash, tabForCode } from './codes';
import { DASH, fmtChange, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, fmtX, tone } from './format';
import { SECTOR_LISTS, relatedFor } from './related';
import {
  annualVol,
  beta,
  cagr,
  correlation,
  dividendSummary,
  keyLevels,
  maxDrawdown,
  pairedReturns,
  portfolioReturns,
  returnsOf,
  riskWindow,
  sharpe,
  sortino,
  type Close,
} from './stats';

/** The same deterministic pair as the numpy reference (scratch ref.py): asset ≈ 1.5 × market + noise. */
function pair(n = 400) {
  const m = [100];
  const a = [50];
  for (let i = 1; i < n; i++) {
    const rm = 0.01 * Math.sin(i * 0.7) + 0.002 * Math.cos(i * 1.3);
    const ra = 1.5 * rm + 0.004 * Math.sin(i * 2.1);
    m.push(m[i - 1] * (1 + rm));
    a.push(a[i - 1] * (1 + ra));
  }
  return { m, a };
}
const DAY = 86400;
const T0 = Date.UTC(2023, 0, 2) / 1000;
const series = (xs: number[]): Close[] => xs.map((c, i) => [T0 + i * DAY, c]);

describe('risk statistics (numpy reference values)', () => {
  const { m, a } = pair();
  const ra = returnsOf(a);
  const rm = returnsOf(m);
  it('beta, correlation, volatility', () => {
    expect(beta(ra, rm)).toBeCloseTo(1.4999769641285317, 10);
    expect(correlation(ra, rm)).toBeCloseTo(0.9674555761668321, 10);
    expect(annualVol(ra)).toBeCloseTo(0.17773765697606456, 10);
  });
  it('Sharpe and Sortino with a 4% risk-free rate', () => {
    expect(sharpe(ra, 0.04)).toBeCloseTo(-0.07490494670687953, 10);
    expect(sortino(ra, 0.04)).toBeCloseTo(-0.10510851069097908, 10);
  });
  it('max drawdown', () => {
    expect(maxDrawdown(a)!.depth).toBeCloseTo(-0.06948128293251932, 10);
    expect(maxDrawdown([100, 120, 90, 130, 80, 100])).toEqual({ depth: 80 / 130 - 1, peak: 3, trough: 4, recovered: null });
    expect(maxDrawdown([100, 50, 100, 101])!.recovered).toBe(2);
    expect(maxDrawdown([1, 2, 3])!.depth).toBe(0);
  });
  it('too little data gives null, never NaN', () => {
    expect(beta([0.01, 0.02], [0.01, 0.03])).toBeNull();
    expect(annualVol([])).toBeNull();
    expect(sharpe(new Array(100).fill(0.001))).toBeNull(); // zero spread
    expect(maxDrawdown([5])).toBeNull();
    expect(cagr(0, 10, 1)).toBeNull();
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1, 12);
  });
  it('pairs returns on shared dates only', () => {
    const x = series([10, 11, 12, 13]);
    const y: Close[] = [x[0], x[2], x[3]].map(([t], i) => [t, [100, 110, 99][i]]);
    const p = pairedReturns(x, y);
    expect(p.a).toEqual([12 / 10 - 1, 13 / 12 - 1]);
    expect(p.b.map((v) => +v.toFixed(10))).toEqual([0.1, -0.1]);
  });
  it('risk windows need the history to cover them', () => {
    const w1 = riskWindow(series(a), series(m), 365, 0.04, '1Y');
    expect(w1.beta).not.toBeNull();
    expect(w1.n).toBe(365);
    expect(riskWindow(series(a), series(m), 3 * 365, 0.04, '3Y').beta).toBeNull(); // 400 days aren't 3 years
  });
  it('portfolio returns weight the holdings that traded that day', () => {
    const x = series([100, 110, 121]);
    const y = series([50, 50, 55]);
    const p = portfolioReturns([{ weight: 3, closes: x }, { weight: 1, closes: y }]);
    expect(returnsOf(p.map(([, c]) => c)).map((v) => +v.toFixed(10))).toEqual([0.075, 0.1]);
    // a holding listed later doesn't count before it existed
    const late = portfolioReturns([{ weight: 1, closes: x }, { weight: 1, closes: series([0, 0, 10]) }]);
    expect(returnsOf(late.map(([, c]) => c)).map((v) => +v.toFixed(10))).toEqual([0.1, 0.1]);
  });
});

describe('key levels and dividends', () => {
  it('key levels from daily bars', () => {
    const bars = Array.from({ length: 260 }, (_, i) => ({ time: T0 + i * DAY, high: i + 2, low: i, close: i + 1 }));
    const k = keyLevels(bars);
    expect(k.sma50).toBeCloseTo(235.5, 10); // mean of 211..260
    expect(k.sma200).toBeCloseTo(160.5, 10);
    expect(k.prevClose).toBe(259);
    expect(k.atr14).toBe(2);
    expect(k.high52).toBe(261);
    expect(k.low52).toBe(259 - 365 < 0 ? 0 : 259 - 365);
    expect(keyLevels([]).sma50).toBeNull();
  });
  it('yield, frequency, growth and next ex-date', () => {
    const divs: [string, number][] = [];
    for (let y = 2019; y <= 2026; y++) for (const mo of ['02', '05', '08', '11']) if (`${y}-${mo}-10` <= '2026-08-10') divs.push([`${y}-${mo}-10`, 0.2 * 1.1 ** (y - 2019)]);
    const s = dividendSummary(divs, 100, '2026-10-01');
    expect(s.perYear).toBe(4);
    expect(s.ttm).toBeCloseTo(0.2 * (1.1 ** 6 + 3 * 1.1 ** 7), 10); // Nov 2025 + Feb/May/Aug 2026
    expect(s.yield).toBeCloseTo(s.ttm / 100, 12);
    expect(s.growth5y).toBeCloseTo(0.1, 10); // 2020 -> 2025
    expect(s.nextEx).toBe('2026-11-10'); // the median gap (92 days) after 10 Aug
    expect(dividendSummary([], 100, '2026-10-01')).toMatchObject({ ttm: 0, yield: null, nextEx: null, growth5y: null });
    // stopped paying: no next date
    expect(dividendSummary([['2020-01-01', 1], ['2020-04-01', 1], ['2020-07-01', 1]], 10, '2026-01-01').nextEx).toBeNull();
  });
});

describe('number formatting', () => {
  it('units, signs and the dash', () => {
    expect(fmtCompact(2.345e12, { money: true })).toBe('$2.35T');
    expect(fmtCompact(-4.5e9)).toBe('−4.50B');
    expect(fmtCompact(12_300)).toBe('12.30K');
    expect(fmtCompact(950)).toBe('950');
    expect(fmtNum(1234567.891)).toBe('1,234,567.89');
    expect(fmtNum(-0.001)).toBe('0.00');
    expect(fmtPct(0.01234, 2, true)).toBe('+1.23%');
    expect(fmtPct(-0.5, 1)).toBe('−50.0%');
    expect(fmtPct(0.00001, 2, true)).toBe('0.00%');
    expect(fmtPrice(0.5)).toBe('0.5000');
    expect(fmtPrice(1234.5)).toBe('1,234.50');
    expect(fmtChange(1.256)).toBe('+1.26');
    expect(fmtChange(-0.4)).toBe('−0.40');
    expect(fmtX(24.33)).toBe('24.3×');
    expect(fmtX(-3)).toBe(DASH);
    expect(tone(-1)).toBe('down');
    expect(tone(0)).toBe('');
    expect(fmtDate('2026-11-05')).toBe('5 Nov 2026');
    for (const bad of [null, undefined, NaN, Infinity, -Infinity])
      for (const f of [fmtNum, fmtCompact, fmtPct, fmtPrice, fmtChange, fmtX]) expect(f(bad as number)).toBe(DASH);
  });
});

describe('routes, codes and history', () => {
  it('maps mnemonics to tabs', () => {
    expect(tabForCode('FA')).toBe('fa');
    expect(tabForCode('hp')).toBe('beta');
    expect(tabForCode('omst')).toBe('omon');
    expect(tabForCode('GIP')).toBe('gp');
    expect(tabForCode('XYZ')).toBeNull();
    expect(new Set(SEC_TABS.map((t) => t.code)).size).toBe(SEC_TABS.length);
  });
  it('hash round trip', () => {
    expect(secHash('AAPL')).toBe('#sec/AAPL');
    expect(secHash('BRK.B', 'fa')).toBe('#sec/BRK.B/FA');
    expect(secHash('$SPX', 'gp')).toBe('#sec/%24SPX/GP');
    expect(parseSecRoute('%24SPX/GP')).toEqual({ symbol: '$SPX', tab: 'gp' });
    expect(parseSecRoute('aapl')).toEqual({ symbol: 'AAPL', tab: DEFAULT_TAB });
    expect(parseSecRoute('msft/nope')).toEqual({ symbol: 'MSFT', tab: DEFAULT_TAB });
    expect(parseSecRoute('')).toBeNull();
    expect(parseSecRoute('%E0%A4%A')).toBeNull();
    expect(cleanSymbol('cash')).toBeNull();
  });
  it('back and forward like a browser', () => {
    const h = createSecHistory();
    expect(h.back()).toBeNull();
    h.visit({ symbol: 'AAPL', tab: 'des' });
    h.visit({ symbol: 'AAPL', tab: 'fa' }); // same security: only the tab changes
    h.visit({ symbol: 'MSFT', tab: 'des' });
    h.visit({ symbol: 'NVDA', tab: 'gp' });
    expect(h.back()).toEqual({ symbol: 'MSFT', tab: 'des' });
    expect(h.back()).toEqual({ symbol: 'AAPL', tab: 'fa' });
    expect(h.canBack).toBe(false);
    expect(h.forward()).toEqual({ symbol: 'MSFT', tab: 'des' });
    h.visit({ symbol: 'TSLA', tab: 'des' }); // drops NVDA ahead
    expect(h.canForward).toBe(false);
    expect(h.recents()).toEqual(['TSLA', 'MSFT', 'AAPL']);
    h.setTab('beta');
    expect(h.current).toEqual({ symbol: 'TSLA', tab: 'beta' });
    const small = createSecHistory(3);
    for (const s of ['A', 'B', 'C', 'D']) small.visit({ symbol: s, tab: 'des' });
    expect(small.back()?.symbol).toBe('C');
    expect(small.back()?.symbol).toBe('B');
    expect(small.back()).toBeNull();
  });
});

describe('related securities', () => {
  it('match the helper scanner sector lists', () => {
    const py = /_SECTOR_LISTS = \{([\s\S]*?)\n\}/.exec(scannerPy)![1];
    const parsed = Object.fromEntries([...py.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => [m[1], m[2]]));
    expect(parsed).toEqual(SECTOR_LISTS);
  });
  it('peers, ETFs and futures', () => {
    const r = relatedFor('NVDA');
    expect(r.sector).toBe('Semiconductors');
    expect(r.peers).not.toContain('NVDA');
    expect(r.peers).toHaveLength(8);
    expect(r.etfs.map(([e]) => e)).toEqual(['SMH', 'QQQ']);
    expect(r.futures[0]).toBe('/NQ');
    expect(relatedFor('KO')).toMatchObject({ sector: null, peers: [], futures: ['/ES', 'E-mini S&P 500'] });
  });
});
