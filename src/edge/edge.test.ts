import { describe, expect, it } from 'vitest';
import { meetingRead, type FedMeeting } from './fedOdds';
import { corrRead } from './netLiquidity';

const meeting = (over: Partial<FedMeeting>): FedMeeting => ({ date: '2026-12-09', before: 3.88, after: 3.75, steps: -0.5, ranges: [{ lower: 3.5, upper: 3.75, p: 0.51 }, { lower: 3.75, upper: 4, p: 0.49 }], pCut: 0.51, pHold: 0.49, pHike: 0, expectedChange: -0.127, tentative: false, ...over });

describe('fed odds', () => {
  it('names the most likely range and the cuts priced', () => {
    expect(meetingRead(meeting({}))).toEqual({ range: '3.50–3.75%', sentence: '13 bp of cuts priced in by then (from today).' });
    expect(meetingRead(meeting({ expectedChange: 0.01 })).sentence).toBe('No change priced in by then.');
  });
});

describe('net liquidity', () => {
  it('reads a correlation honestly', () => {
    expect(corrRead(null)).toBe('Not enough weeks to compare.');
    expect(corrRead({ r: 0.12, low: -0.15, high: 0.37, weeks: 52 })).toContain('not clearly different from none');
    expect(corrRead({ r: 0.55, low: 0.3, high: 0.72, weeks: 156 })).toBe('a strong link (r 0.55, 95% range 0.30 to 0.72, 156 weeks)');
  });
});

import { earningsRead, gammaRead, volRead, type OptEdge } from './optEdge';

const base: OptEdge = {
  symbol: 'XYZ', spot: 105, asOf: '2026-11-12T15:00:00Z',
  gamma: { flip: 100, atSpot: 5e8, curve: [], above: true },
  vol: { iv30: 0.3, rv20: 0.2, gap: 0.1, ivVsRvYear: 0.8, rvPercentile: 0.4 },
  earnings: { past: [], stats: { count: 8, median: 0.04, p75: 0.06, max: 0.11, mean: 0.045 }, upcoming: { date: '2026-11-20', hour: 'amc', expiration: '2026-11-21', implied: 0.07, straddle: 7 }, note: '' },
  market: null,
};

describe('options edge readings', () => {
  it('reads the flip', () => {
    expect(gammaRead(base)).toBe('Price is 5.0% above the flip: dealer hedging tends to slow moves down here.');
    expect(gammaRead({ ...base, spot: 95, gamma: { ...base.gamma, above: false } })).toContain('below the flip');
    expect(gammaRead({ ...base, gamma: { ...base.gamma, flip: null } })).toContain('doesn’t change sign');
  });
  it('reads implied vs realized', () => {
    expect(volRead(base.vol)).toContain('options look expensive');
    expect(volRead({ ...base.vol, iv30: 0.15 })).toContain('options look cheap');
    expect(volRead({ ...base.vol, iv30: null })).toBe('Not enough data to compare.');
  });
  it('compares the earnings move with history', () => {
    expect(earningsRead(base.earnings)).toBe('Options price ±7.0% for the 2026-11-20 report — more than the stock’s typical ±4.0% (median of the last 8).');
    expect(earningsRead({ ...base.earnings, upcoming: null })).toContain('Typical reaction');
  });
});

import { betsRead, factorRead, type FactorRow } from './factors';

const f = (code: string, beta: number, low: number, high: number): FactorRow => ({ code, label: code, beta, se: 0.1, t: beta / 0.1, low, high });

describe('factor readings', () => {
  it('only calls a tilt when the range excludes zero', () => {
    expect(factorRead(f('Mkt-RF', 1.12, 1.05, 1.19))).toBe('Moves 1.12× the stock market');
    expect(factorRead(f('HML', -0.3, -0.45, -0.15))).toBe('Leans toward expensive (growth) stocks');
    expect(factorRead(f('SMB', 0.1, -0.05, 0.25))).toBe('No clear tilt');
  });
  it('reads the hidden bets', () => {
    expect(betsRead({ components: [{ share: 0.82, varianceShare: 0.6, drivers: [{ symbol: 'NVDA', loading: 0.6 }, { symbol: 'AMD', loading: 0.5 }, { symbol: 'AVGO', loading: 0.4 }] }], effectiveBets: 1.6, holdings: 10 })).toBe(
      '10 holdings behave like about 1.6 independent bets. 82% of the risk comes from one common driver (led by NVDA, AMD, AVGO).',
    );
  });
});

import { dailyRead, offRead, premiumRead, type OffExchange } from './offExchange';
import { cagr } from './segmentHistory';

describe('off-exchange and fund value', () => {
  const w = { week: '2026-10-19', ats: 150, otc: 250, total: 1000, atsShare: 0.15, offShare: 0.4 };
  it('compares the latest week with its average', () => {
    const d: OffExchange = { symbol: 'X', weeks: [w, w], days: [], latest: w, avgAtsShare: 0.12, avgOffShare: 0.4, source: '' };
    expect(offRead(d)).toContain('3.0 points above its 2-week average');
    expect(offRead({ ...d, avgAtsShare: 0.149 })).toContain('about its usual level');
    expect(offRead({ ...d, latest: undefined, weeklyError: 'FINRA asked for an API login for this data.' })).toContain('unavailable');
  });
  it('reads the latest day', () => {
    const days = [{ date: '2026-11-11', offExchange: 1, volume: 2, share: 0.4 }, { date: '2026-11-12', offExchange: 1, volume: 2, share: 0.47 }];
    const d: OffExchange = { symbol: 'X', weeks: [], days, dailyAvg: 0.435, source: '' };
    expect(dailyRead(d)).toBe('2026-11-12: 47.0% of the day’s shares traded off-exchange, 3.5 points above its 2-day average.');
    expect(dailyRead({ ...d, days: [] })).toBe('');
  });
  it('reads a premium or discount', () => {
    expect(premiumRead({ symbol: 'SPY', assetType: 'ETF', nav: 500, premium: 0.0005, note: '' })).toContain('in line with its holdings');
    expect(premiumRead({ symbol: 'CEF', assetType: 'ETF', nav: 10, premium: -0.08, note: '' })).toBe('Closed at 8.00% below its NAV: a wide discount — check why before trading on it.');
    expect(premiumRead({ symbol: 'X', assetType: '', nav: null, note: 'No NAV' })).toBe('No NAV');
  });
});

describe('segment growth', () => {
  it('works out yearly growth across gaps', () => {
    expect(cagr([100, null, 121])).toBeCloseTo(0.1, 9);
    expect(cagr([null, 50])).toBeNull();
  });
});
