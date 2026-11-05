import { describe, expect, it } from 'vitest';
import { nyTime } from './importers';
import {
  adherence,
  afterLoss,
  applyFilters,
  atrAt,
  BREAKDOWNS,
  breakdown,
  calendarMonth,
  computeStats,
  dailyPnl,
  equityCurve,
  excursions,
  realizedLots,
  rHistogram,
  rOf,
  tradePnl,
  tradesCsv,
  type Trade,
} from './stats';

const T = (y: number, mo: number, d: number, hh = 10, mm = 0) => nyTime(y, mo, d, hh, mm);
let n = 0;
/** A closed long trade: buy qty at entry, sell at exit (fees $1 each side unless given). */
function trade(entry: number, exit: number, opts: Partial<Trade> & { day?: number; hour?: number; qty?: number; fees?: number } = {}): Trade {
  const qty = opts.qty ?? 10;
  const open = T(2026, 3, opts.day ?? 2, opts.hour ?? 10);
  const fees = opts.fees ?? 1;
  return {
    id: `t${++n}`,
    symbol: 'AAPL',
    account: 'A',
    side: 'long',
    assetClass: 'stock',
    multiplier: 1,
    entries: [{ time: open, price: entry, qty, fees }],
    exits: [{ time: open + 3600, price: exit, qty, fees }],
    status: 'closed',
    openedAt: open,
    closedAt: open + 3600,
    source: 'manual',
    ...opts,
  };
}

describe('P&L and R', () => {
  it('nets fees and matches lots first in, first out', () => {
    const t = trade(100, 0, { qty: 0 });
    t.entries = [{ time: 1, price: 100, qty: 10, fees: 1 }, { time: 2, price: 110, qty: 10, fees: 1 }];
    t.exits = [{ time: 3, price: 120, qty: 5, fees: 1 }, { time: 4, price: 90, qty: 15, fees: 1 }];
    expect(tradePnl(t)).toEqual({ gross: -150, fees: 4, net: -154 });
  });
  it('shorts and futures multipliers', () => {
    const t = trade(6800, 6790, { side: 'short', multiplier: 5, qty: 2, fees: 0 });
    expect(tradePnl(t)!.net).toBe(100);
  });
  it('R from the planned stop, else an ATR estimate (marked)', () => {
    expect(rOf(trade(100, 106, { fees: 0, plan: { stop: 97 } }))).toEqual({ r: 2, estimated: false });
    expect(rOf(trade(100, 106, { fees: 0, atr: 2 }))).toEqual({ r: 3, estimated: true });
    expect(rOf(trade(100, 106))).toBeNull();
    expect(tradePnl({ ...trade(1, 2), costUnknown: true })).toBeNull();
  });
});

describe('statistics', () => {
  // reference: +$100, -$50, +$30, -$20, -$10 (fees 0) on days 2,2,3,4,5
  const list = [trade(100, 110, { fees: 0, day: 2 }), trade(100, 95, { fees: 0, day: 2, hour: 14 }), trade(100, 103, { fees: 0, day: 3 }),
    trade(100, 98, { fees: 0, day: 4 }), trade(100, 99, { fees: 0, day: 5 })];
  const s = computeStats(list);
  it('matches hand-worked figures', () => {
    expect([s.n, s.wins, s.losses, s.net]).toEqual([5, 2, 3, 50]);
    expect(s.winRate).toBeCloseTo(0.4);
    expect(s.avgWin).toBe(65);
    expect(s.avgLoss).toBeCloseTo(-26.6667, 3);
    expect(s.profitFactor).toBeCloseTo(130 / 80);
    expect(s.payoff).toBeCloseTo(65 / 26.6667, 3);
    expect(s.expectancy).toBe(10);
    expect([s.maxConsecWins, s.maxConsecLosses, s.currentStreak]).toEqual([1, 2, -2]);
    expect(s.maxDrawdown).toBe(-50); // 100 -> 50 -> 80 -> 60 -> 50: peak 100, low 50
    expect(s.largestWin).toBe(100);
    expect(s.largestLoss).toBe(-50);
    expect(s.enough).toBe(false);
  });
  it('Sharpe and Sortino on daily P&L (annualised by the square root of 252)', () => {
    // daily: 50, 30, -20, -10 -> mean 12.5, sample sd 33.0404, downside RMS sqrt((400+100)/4)=11.180
    expect(s.sharpe).toBeCloseTo((12.5 / 33.0404) * Math.sqrt(252), 2);
    expect(s.sortino).toBeCloseTo((12.5 / 11.1803) * Math.sqrt(252), 2);
  });
  it('leaves out open trades and trades from before the journal', () => {
    const more = [...list, { ...trade(1, 2), status: 'open' as const, exits: [] }, { ...trade(1, 50), openedBefore: true }];
    const s2 = computeStats(more);
    expect([s2.n, s2.open, s2.excluded]).toEqual([5, 1, 1]);
  });
  it('equity curve and drawdown', () => {
    expect(equityCurve(list).map((p) => [p.equity, p.drawdown])).toEqual([[100, 0], [50, -50], [80, -20], [60, -40], [50, -50]]);
  });
  it('breakdowns by hour, side and tag (a trade can be in two tags)', () => {
    const hours = breakdown(list, BREAKDOWNS.hour.keys);
    expect(hours.find((r) => r.key === '14:00')).toMatchObject({ n: 1, net: -50 });
    const tagged = [trade(1, 2, { fees: 0, tags: ['a', 'b'] }), trade(2, 1, { fees: 0, tags: ['a'] })];
    expect(breakdown(tagged, BREAKDOWNS.tag.keys)).toEqual([
      { key: 'b', n: 1, net: 10, winRate: 1, profitFactor: null, expectancy: 10, avgR: null },
      { key: 'a', n: 2, net: 0, winRate: 0.5, profitFactor: 1, expectancy: 0, avgR: null },
    ]);
  });
  it('revenge check: trades opened within an hour of a loss', () => {
    const loss = trade(100, 90, { day: 9, hour: 10 });
    const soon = trade(100, 95, { day: 9, hour: 11, entries: [{ time: T(2026, 3, 9, 11, 30), price: 100, qty: 10, fees: 1 }], openedAt: T(2026, 3, 9, 11, 30) });
    const r = afterLoss([loss, soon]);
    expect(r.after.map((t) => t.id)).toEqual([soon.id]);
  });
  it('R histogram bins', () => {
    const bins = rHistogram([trade(100, 106, { fees: 0, plan: { stop: 97 } }), trade(100, 80, { fees: 0, plan: { stop: 97 } })]);
    expect(bins.find((b) => b.lo === 2)!.count).toBe(1);
    expect(bins[0].count).toBe(1); // -6.7R goes in the lowest bin
  });
});

describe('calendar and filters', () => {
  const list = [trade(100, 110, { fees: 0, day: 2 }), trade(100, 95, { fees: 0, day: 2 }), trade(100, 103, { fees: 0, day: 31 })];
  it('daily P&L on the closing day and the month grid', () => {
    const daily = dailyPnl(list);
    expect(daily.get('2026-03-02')).toMatchObject({ net: 50, trades: 2, wins: 1 });
    const m = calendarMonth(2026, 3, daily);
    expect(m.weeks[0].cells[0]).toMatchObject({ day: '2026-03-01', date: 1 }); // March 2026 starts on a Sunday
    expect(m.weeks.every((w) => w.cells.length === 7)).toBe(true);
    expect([m.net, m.trades, m.greenDays, m.redDays]).toEqual([80, 3, 2, 0]);
    expect(m.weeks[0].net).toBe(50);
  });
  it('filters by date, symbol, result, tag and text', () => {
    const tagged = [...list, trade(1, 2, { symbol: 'MSFT', tags: ['fomo'], notes: 'Chased the open', day: 3 })];
    expect(applyFilters(tagged, { from: '2026-03-03' }).length).toBe(2);
    expect(applyFilters(tagged, { symbol: 'msft' }).length).toBe(1);
    expect(applyFilters(tagged, { result: 'loss' }).length).toBe(1);
    expect(applyFilters(tagged, { tag: 'fomo' })[0].symbol).toBe('MSFT');
    expect(applyFilters(tagged, { text: 'chased' }).length).toBe(1);
  });
});

describe('excursions, plan adherence and realized lots', () => {
  it('MAE/MFE from bars while the trade was on', () => {
    const t = trade(100, 104, { fees: 0 });
    const bars = [-1, 0, 1, 2].map((k) => ({ time: t.openedAt + k * 1800, open: 100, high: 100 + 2 * (k + 2), low: 100 - (k + 2), close: 100, volume: 0 }));
    // the bar ending at the entry is left out; 0, +30m and +60m (the exit bar) count
    expect(excursions(t, bars, 1800)).toEqual({ mae: -40, mfe: 80, maePrice: 96, mfePrice: 108, bars: 3 });
  });
  it('ATR at entry', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ time: i * 86400, open: 10, high: 11, low: 9, close: 10, volume: 0 }));
    expect(atrAt(bars, 20 * 86400)).toBe(2);
    expect(atrAt(bars.slice(0, 5), 20 * 86400)).toBeNull();
  });
  it('followed the stop and sized like usual', () => {
    expect(adherence(trade(100, 96.8, { plan: { stop: 97 } })).followedStop).toBe(true);
    expect(adherence(trade(100, 95, { plan: { stop: 97 } })).followedStop).toBe(false);
    const usual = Array.from({ length: 6 }, () => trade(100, 101, { plan: { stop: 99 } })); // $10 risk
    const big = trade(100, 101, { plan: { stop: 97 } }); // $30 risk
    expect(adherence(big, [...usual, big]).oversized).toBe(true);
  });
  it('realized gains lot by lot with long-term after a year', () => {
    const t = trade(0, 0, { qty: 0 });
    t.entries = [{ time: T(2024, 1, 2), price: 10, qty: 5, fees: 0 }, { time: T(2025, 6, 2), price: 20, qty: 5, fees: 0 }];
    t.exits = [{ time: T(2025, 7, 1), price: 30, qty: 10, fees: 2 }];
    const lots = realizedLots([t]);
    expect(lots.map((l) => [l.acquired, l.sold, l.qty, l.proceeds, l.cost, l.gain, l.term])).toEqual([
      ['2024-01-02', '2025-07-01', 5, 149, 50, 99, 'Long'],
      ['2025-06-02', '2025-07-01', 5, 149, 100, 49, 'Short'],
    ]);
  });
  it('CSV export quotes text', () => {
    const csv = tradesCsv([trade(1, 2, { notes: 'a, "b"' })]);
    expect(csv.split('\n')[1]).toContain('"a, ""b"""');
  });
});
