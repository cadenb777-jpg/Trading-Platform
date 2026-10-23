"""Tests for the helper's trading maths (standard library only).

Run from the repository root:  python -m unittest discover helper/tests
"""
import asyncio
import datetime as dt
import math
import time
import os
import random
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import core, flow, invest, scanner  # noqa: E402


def bar(t, o, h, l, c, v=1_000_000):
    return {'time': t, 'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}


def random_walk(n=800, seed=1, drift=0.0004):
    rnd = random.Random(seed)
    p, out, t = 100.0, [], 1_600_000_000
    for i in range(n):
        o = p
        p *= math.exp(rnd.gauss(drift, 0.015))
        out.append(bar(t + i * 86400, o, max(o, p) * 1.004, min(o, p) * 0.996, p, rnd.randint(500_000, 2_000_000)))
    return out


class Indicators(unittest.TestCase):
    def test_rsi_matches_wilder_reference(self):
        # The classic StockCharts RSI(14) example. Average gain 3.34/14 and loss 1.40/14 give RSI 70.46; StockCharts
        # prints 70.53 because it rounds the averages (0.2385 / 0.0996) before dividing.
        closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]
        r = scanner.rsi(closes)
        self.assertIsNone(r[13])
        self.assertAlmostEqual(r[14], 100 - 100 / (1 + 3.34 / 1.40), places=6)
        self.assertAlmostEqual(r[14], 70.46, places=2)

    def test_ema_follows_its_formula(self):
        e = scanner.ema([10, 11, 12], 3)  # k = 0.5
        self.assertEqual(e, [10, 10.5, 11.25])

    def test_atr_uses_true_range_with_gaps(self):
        bars = [bar(i, 10, 11, 9, 10) for i in range(14)] + [bar(14, 15, 16, 14.5, 15)]  # gap up from 10 to 15
        a = scanner.atr(bars)
        self.assertIsNone(a[12])
        self.assertAlmostEqual(a[13], 2.0)
        self.assertAlmostEqual(a[14], (2.0 * 13 + 6.0) / 14)  # true range 16 - 10 = 6


class Plans(unittest.TestCase):
    today = bar(0, 100, 101, 99, 100.5)
    levels = [{'price': 97.0, 'label': 'Support'}, {'price': 104.0, 'label': 'Resistance'}, {'price': 104.1, 'label': 'R2'},
              {'price': 107.0, 'label': '52-week high'}]

    def test_long_plan_is_ordered_and_measured_from_the_entry(self):
        p = scanner.trade_plan(self.levels, 100.5, 2.0, 1, self.today)
        self.assertEqual(p['entry'], 101)  # today's high: the breakout trigger
        self.assertLess(p['stop'], p['entry'])
        self.assertLess(p['entry'], p['target1'])
        self.assertLess(p['target1'], p['target2'])
        self.assertAlmostEqual(p['riskReward'], (p['target1'] - p['entry']) / (p['entry'] - p['stop']))

    def test_close_levels_are_merged_and_targets_are_distinct(self):
        p = scanner.trade_plan(self.levels, 100.5, 2.0, 1, self.today)
        self.assertIn('Resistance + R2', p['target1Note'])
        self.assertGreaterEqual(p['target2'] - p['target1'], 0.5 * 2.0)

    def test_short_plan_mirrors_the_long_one(self):
        p = scanner.trade_plan(self.levels, 100.5, 2.0, -1, self.today)
        self.assertEqual(p['entry'], 99)
        self.assertGreater(p['stop'], p['entry'])
        self.assertGreater(p['entry'], p['target1'])
        self.assertGreater(p['target1'], p['target2'])


class Simulation(unittest.TestCase):
    plan = {'trigger': 101.0, 'stop': 98.0, 'target1': 104.0, 'target2': 107.0}

    def test_no_fill_without_a_break_of_the_trigger(self):
        bars = [bar(0, 100, 100.5, 99, 100)] + [bar(i, 100, 100.9, 99.5, 100) for i in range(1, 6)]
        self.assertIsNone(scanner.simulate_plan(bars, 0, self.plan, 1))

    def test_half_at_target_one_then_target_two(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 100.5, 102, 100, 101.5), bar(2, 102, 104.5, 101.5, 104), bar(3, 104, 107.5, 103.5, 107)]
        t = scanner.simulate_plan(bars, 0, self.plan, 1)
        self.assertEqual(t['reason'], 'target')
        self.assertAlmostEqual(t['r'], (0.5 * 3 + 0.5 * 6) / 3)  # entry 101, risk 3

    def test_gap_through_the_stop_fills_at_the_open(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 100.5, 101.5, 100, 101), bar(2, 96, 96.5, 95, 95.5)]
        t = scanner.simulate_plan(bars, 0, self.plan, 1)
        self.assertEqual(t['reason'], 'stop')
        self.assertAlmostEqual(t['r'], (96 - 101) / 3)

    def test_costs_are_charged(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 100.5, 102, 100, 101.5), bar(2, 102, 104.5, 101.5, 104), bar(3, 104, 107.5, 103.5, 107)]
        t = scanner.simulate_plan(bars, 0, self.plan, 1)
        self.assertAlmostEqual(t['ret'], (0.5 * 3 + 0.5 * 6) / 101 - scanner.COSTS)

    def test_same_bar_target_and_return_to_entry_is_break_even(self):
        # Fills at 101, then one bar reaches both targets but also falls back to 100.5: the stop is assumed first.
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 100.5, 101.5, 100.8, 101.2), bar(2, 101.5, 107.5, 100.5, 106)]
        t = scanner.simulate_plan(bars, 0, self.plan, 1)
        self.assertEqual(t['reason'], 'break-even')
        self.assertAlmostEqual(t['r'], 0.5 * 3 / 3)

    def test_gap_past_target_one_fills_at_the_open(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 100.5, 101.5, 100.8, 101.2), bar(2, 105, 105.5, 104.5, 105), bar(3, 105, 107.2, 104.8, 107)]
        t = scanner.simulate_plan(bars, 0, self.plan, 1)
        self.assertEqual(t['reason'], 'target')
        self.assertAlmostEqual(t['r'], (0.5 * (105 - 101) + 0.5 * 6) / 3)

    def test_break_even_after_target_one(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 101, 104.2, 100.8, 104), bar(2, 103, 103.5, 100.5, 100.8)]
        t = scanner.simulate_plan(bars, 0, self.plan, 1)
        self.assertEqual(t['reason'], 'break-even')
        self.assertAlmostEqual(t['r'], 0.5 * 3 / 3)


class Backtest(unittest.TestCase):
    def test_trades_never_use_future_bars(self):
        bars = random_walk()
        cut = 600
        changed = bars[:cut] + [dict(b, close=b['close'] * 3, high=b['high'] * 3, low=b['low'] * 3, open=b['open'] * 3) for b in bars[cut:]]
        early = lambda bs: [t for t in scanner.signal_trades(scanner.prepare(bs), 1, scanner.atr(bs)) if t['exit'] < cut]  # noqa: E731
        before = early(bars)
        self.assertTrue(before, 'the random walk should produce some trades before the cut')
        self.assertEqual(before, early(changed))

    def test_grade_and_dates_are_reported(self):
        bars = random_walk(seed=3)
        r = scanner.backtest_signal(scanner.prepare(bars), 1, scanner.atr(bars))
        self.assertEqual(r['grade'], scanner.summarise_trades(scanner.signal_trades(scanner.prepare(bars), 1, scanner.atr(bars)))['grade'])
        self.assertEqual(r['from'], bars[211]['time'])
        self.assertEqual(r['to'], bars[-1]['time'])


class Grades(unittest.TestCase):
    t = staticmethod(lambda ret: {'ret': ret, 'r': ret * 10, 'reason': 'x', 'bars': 3, 'exit': 0})

    def test_grades_from_known_trades(self):
        g = lambda rets: scanner.summarise_trades([self.t(x) for x in rets])['grade']  # noqa: E731
        self.assertEqual(g([0.03, 0.03, 0.03, -0.01, -0.01, -0.01]), 'proven')  # profit factor 3
        self.assertEqual(g([0.012, 0.012, 0.012, -0.01, -0.01, -0.01]), 'mixed')  # positive, profit factor 1.2
        self.assertEqual(g([0.01, -0.02, 0.01, -0.02]), 'failed')
        self.assertEqual(g([0.05, 0.05, 0.05]), 'unproven')  # too few trades to judge
        self.assertEqual(g([]), 'unproven')

    def test_stats(self):
        s = scanner.summarise_trades([self.t(x) for x in (0.02, -0.01, -0.01, 0.04)])
        self.assertEqual(s['trades'], 4)
        self.assertAlmostEqual(s['winRate'], 0.5)
        self.assertAlmostEqual(s['profitFactor'], 3.0)
        self.assertAlmostEqual(s['expectancy'], 0.01)
        self.assertEqual(s['maxLosingStreak'], 2)


class SessionChange(unittest.TestCase):
    closes = [[1, 100.0], [2, 104.0], [3, 102.0]]

    def run_change(self, row, session='closed'):
        with mock.patch.object(invest, 'market_session', return_value=session):
            invest.session_change(row, self.closes)
        return row

    def test_latest_session_move_when_unchanged_after_hours(self):
        r = self.run_change({'price': 102.0, 'change': 0.0})
        self.assertAlmostEqual(r['change'], 102 / 104 - 1)
        self.assertEqual(r['atClose'], 3)

    def test_real_changes_and_market_hours_are_left_alone(self):
        self.assertEqual(self.run_change({'price': 103.0, 'change': 0.01})['change'], 0.01)
        self.assertEqual(self.run_change({'price': 102.0, 'change': 0.0}, 'open')['change'], 0.0)

    def test_mismatched_bars_are_rejected(self):
        self.assertEqual(self.run_change({'price': 6650.0, 'change': 0.0})['change'], 0.0)


class Resp:
    def __init__(self, code, data=None):
        self.status_code, self._data = code, data or {}

    def json(self):
        return self._data


class FakeSchwab:
    """Answers price history like Schwab: random-walk candles, or the error code set for a symbol."""

    def __init__(self, errors=None):
        self.errors, self.calls = errors or {}, []

    def _history(self, symbol, step):
        self.calls.append(symbol)
        if symbol in self.errors:
            return Resp(self.errors[symbol])
        bars = random_walk(n=900 if step == 86400 else 400, seed=hash(symbol) % 1000)
        return Resp(200, {'candles': [{'datetime': (1_600_000_000 + i * step) * 1000, **{k: b[k] for k in ('open', 'high', 'low', 'close', 'volume')}} for i, b in enumerate(bars)]})

    async def get_price_history_every_day(self, symbol, **kw):
        return self._history(symbol, 86400)

    async def get_price_history_every_thirty_minutes(self, symbol, **kw):
        return self._history(symbol, 1800)

    async def get_price_history_every_five_minutes(self, symbol, **kw):
        return self._history(symbol, 300)

    async def get_quotes(self, symbols, **kw):
        return Resp(200, {})

    async def get_option_chain(self, symbol, **kw):
        return Resp(500)


class FakeCtx:
    def __init__(self, schwab):
        self.schwab, self.news, self._cache = schwab, None, {}

    async def cached(self, key, max_age, load, persist=False, stale_ok=False):
        if key not in self._cache:
            self._cache[key] = await load()
        return self._cache[key]


class ScanErrors(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(scanner, 'UNIVERSE', ['SPY', 'AAA']), mock.patch.object(scanner, 'REQUEST_GAP', 0),
                        mock.patch.object(scanner, 'market_session', return_value='closed')]
        for p in self.patches:
            p.start()
        scanner._state.update({'result': None, 'running': None, 'extra': set(), 'bad': {}})

    def tearDown(self):
        for p in self.patches:
            p.stop()
        scanner._state.update({'result': None, 'running': None, 'extra': set(), 'bad': {}})

    def scan(self, schwab):
        return asyncio.run(scanner.scan(FakeCtx(schwab)))

    def test_unknown_watchlist_symbol_is_skipped_and_remembered(self):
        scanner._state['extra'] = {'BADX'}
        r = self.scan(FakeSchwab({'BADX': 400}))
        self.assertEqual(r['scanned'], 2)
        self.assertIn({'symbol': 'BADX', 'reason': 'unknown'}, r['skipped'])
        schwab = FakeSchwab({'BADX': 400})
        r2 = self.scan(schwab)
        self.assertNotIn('BADX', schwab.calls)  # not asked again for a day...
        self.assertIn({'symbol': 'BADX', 'reason': 'unknown'}, r2['skipped'])  # ...but still listed

    def test_temporary_error_only_skips_one_scan(self):
        scanner._state['extra'] = {'TMP'}
        r = self.scan(FakeSchwab({'TMP': 503}))
        self.assertIn({'symbol': 'TMP', 'reason': 'temporary'}, r['skipped'])
        self.assertEqual(scanner._state['bad'], {})
        schwab = FakeSchwab()
        self.scan(schwab)
        self.assertIn('TMP', schwab.calls)

    def test_bad_symbols_are_retried_after_a_day(self):
        scanner._state['bad'] = {'OLD': time.time() - scanner.BAD_SYMBOL_RETRY - 1, 'NEW': time.time()}
        self.assertEqual(scanner.bad_symbols(), {'NEW'})

    def test_expired_login_stops_the_scan(self):
        with self.assertRaises(core.EngineError):
            self.scan(FakeSchwab({'AAA': 401}))


class Pacing(unittest.TestCase):
    def test_requests_go_one_at_a_time_with_a_gap(self):
        starts, running, overlap = [], [0], [False]

        async def call():
            starts.append(time.monotonic())
            running[0] += 1
            overlap[0] |= running[0] > 1
            await asyncio.sleep(0.01)
            running[0] -= 1

        async def main():
            await asyncio.gather(*(scanner._paced(call) for _ in range(4)))

        with mock.patch.object(scanner, 'REQUEST_GAP', 0.05):
            scanner._last_request[0] = 0.0
            asyncio.run(main())
        self.assertFalse(overlap[0])
        gaps = [b - a for a, b in zip(starts, starts[1:])]
        self.assertTrue(all(g >= 0.055 for g in gaps), gaps)


class Sessions(unittest.TestCase):
    def test_market_session_boundaries(self):
        ny = lambda h, m, day=22: dt.datetime(2026, 10, day, h, m)  # noqa: E731  (Thursday Oct 22, 2026)
        self.assertEqual(core.market_session(ny(9, 29)), 'extended')
        self.assertEqual(core.market_session(ny(9, 30)), 'open')
        self.assertEqual(core.market_session(ny(16, 0)), 'extended')
        self.assertEqual(core.market_session(ny(20, 0)), 'closed')
        self.assertEqual(core.market_session(ny(12, 0, day=24)), 'closed')  # Saturday


class Flow(unittest.TestCase):
    def test_put_call_ratios(self):
        c = lambda kind, strike, vol, oi, last: {'type': kind, 'strike': strike, 'volume': vol, 'oi': oi, 'last': last, 'mark': last}  # noqa: E731
        s = flow.flow_stats([c('call', 110, 100, 1000, 2.0), c('call', 90, 100, 500, 12.0), c('put', 90, 150, 2000, 1.0)], 100)
        self.assertAlmostEqual(s['putCallVolume'], 150 / 200)
        self.assertAlmostEqual(s['putCallOi'], 2000 / 1500)
        self.assertAlmostEqual(s['putCallPremium'], (150 * 1.0) / (100 * 2.0 + 100 * 12.0))
        self.assertAlmostEqual(s['putCallOtm'], 150 / 100)  # only the 110 call is out of the money
        self.assertIsNone(flow.flow_stats([c('put', 90, 5, 5, 1.0)], 100)['putCallVolume'])


if __name__ == '__main__':
    unittest.main()
