import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../data/schwab';
import { filterMarkets, fmtVolume, isFomc, matchOdds, oddsSummary, pct, type FedGroup, type PredictionMarket } from './odds';

const t = (iso: string) => Date.parse(iso) / 1000;
const ev = (title: string, iso: string, country = 'USD'): CalendarEvent => ({ title, country, time: t(iso), impact: 'high', forecast: '', previous: '', actual: '' });

const fedDec: FedGroup = {
  source: 'Polymarket', title: 'Fed decision in December?', url: 'https://polymarket.com/event/fed-decision-in-december', meeting: '2026-12-09',
  outcomes: [], odds: { cut: 0.65, hold: 0.34, hike: 0.01 }, volume: 45e6, updated: '2026-11-05T14:00:00Z',
};
const fedDecKalshi: FedGroup = { ...fedDec, source: 'Kalshi', url: 'https://kalshi.com/markets/kxfeddecision', odds: { cut: 0.6, hold: 0.38, hike: 0.02 }, volume: 279000 };
const fedJan: FedGroup = { ...fedDec, title: 'Fed decision in January?', meeting: '2027-01-27', volume: 9e6 };

const m = (over: Partial<PredictionMarket>): PredictionMarket => ({
  source: 'Kalshi', id: Math.random().toString(), question: '', event: '', outcome: '', category: 'macro', yes: 0.5, volume: 100, updated: '', closes: '', url: 'https://kalshi.com/', ...over,
});
const cpiAbove = m({ question: 'CPI year-over-year in October 2026?: Above 3.0%', outcome: 'Above 3.0%', yes: 0.42, volume: 50000, closes: '2026-11-12T13:30:00Z' });
const cpiAbove31 = m({ question: 'CPI year-over-year in October 2026?: Above 3.1%', outcome: 'Above 3.1%', yes: 0.2, volume: 9000, closes: '2026-11-12T13:30:00Z' });
const cpiLater = m({ question: 'CPI in December 2026?', yes: 0.5, volume: 1e6, closes: '2027-01-14T13:30:00Z' });
const jobs = m({ question: 'Nonfarm payrolls above 100K in November?', yes: 0.55, volume: 2000, closes: '2026-12-04T13:30:00Z' });
const senate = m({ question: 'Which party will win the Senate?: Republicans', category: 'politics', yes: 0.56, volume: 9e5, closes: '2026-11-04T23:00:00Z' });
const data = { fed: [fedDec, fedDecKalshi, fedJan], markets: [cpiLater, cpiAbove, cpiAbove31, jobs, senate] };

describe('matchOdds', () => {
  it('FOMC decision -> that meeting’s groups, biggest first', () => {
    const o = matchOdds(ev('FOMC Rate Decision (Federal Funds Rate)', '2026-12-09T19:00:00Z'), data);
    expect(o?.kind).toBe('fed');
    expect(o && o.kind === 'fed' && o.groups.map((g) => g.source)).toEqual(['Polymarket', 'Kalshi']);
    expect(oddsSummary(o)).toBe('Cut 65% · Hold 34% · Hike 1%');
  });
  it('a meeting with no market, minutes and speeches get nothing', () => {
    expect(matchOdds(ev('FOMC Rate Decision (Federal Funds Rate)', '2026-10-28T18:00:00Z'), data)).toBeNull();
    expect(matchOdds(ev('FOMC Meeting Minutes', '2026-12-09T19:00:00Z'), data)).toBeNull();
    expect(isFomc('FOMC Member Waller Speaks')).toBe(false);
  });
  it('CPI -> markets on that release that settle within 10 days, by volume', () => {
    const o = matchOdds(ev('CPI y/y', '2026-11-12T13:30:00Z'), data);
    expect(o?.kind).toBe('markets');
    expect(o && o.kind === 'markets' && o.markets).toEqual([cpiAbove, cpiAbove31]);
    expect(oddsSummary(o)).toBe('Above 3.0%: 42%');
  });
  it('payrolls match jobs markets; non-US events and politics never match', () => {
    expect(matchOdds(ev('Non-Farm Employment Change', '2026-12-04T13:30:00Z'), data)).toEqual({ kind: 'markets', markets: [jobs] });
    expect(matchOdds(ev('CPI y/y', '2026-11-12T13:30:00Z', 'EUR'), data)).toBeNull();
    expect(matchOdds(ev('Retail Sales m/m', '2026-11-14T13:30:00Z'), data)).toBeNull();
    expect(matchOdds(ev('CPI y/y', '2026-11-12T13:30:00Z'), null)).toBeNull();
  });
});

describe('helpers', () => {
  it('pct', () => {
    expect([pct(0.62), pct(0.001), pct(0.999), pct(0), pct(1)]).toEqual(['62%', '<1%', '>99%', '0%', '100%']);
  });
  it('volume units per source', () => {
    expect(fmtVolume(45e6)).toBe('$45.0M');
    expect(fmtVolume(279000, 'Kalshi')).toBe('279K contracts');
    expect(fmtVolume(0)).toBe('—');
  });
  it('filters by category, source and text', () => {
    expect(filterMarkets(data.markets, { category: 'politics' })).toEqual([senate]);
    expect(filterMarkets(data.markets, { category: 'all', query: 'payrolls' })).toEqual([jobs]);
    expect(filterMarkets(data.markets, { source: 'Polymarket' })).toEqual([]);
  });
});
