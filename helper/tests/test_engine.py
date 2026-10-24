"""Tests for the helper's trading maths (standard library only).

Run from the repository root:  python -m unittest discover helper/tests
"""
import asyncio
import datetime as dt
import json
import math
import time
import os
import random
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import alts, core, flow, invest, quant, scanner  # noqa: E402
from engine import strategies as st  # noqa: E402
import tempfile  # noqa: E402

# Tests never touch ~/.trading-platform and run the scanner's heavy maths in this process.
_TMP = tempfile.mkdtemp(prefix='tp-tests-')
scanner.USE_PROCESSES = False
scanner.LAB_STATE_PATH = scanner.Path(_TMP) / 'lab_survivors.json'
scanner.GRAVEYARD_PATH = scanner.Path(_TMP) / 'lab_graveyard.json'
scanner.RULES_PATH = scanner.Path(_TMP) / 'rule_tests.json'


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
        r = st.rsi(closes)
        self.assertIsNone(r[13])
        self.assertAlmostEqual(r[14], 100 - 100 / (1 + 3.34 / 1.40), places=6)

    def test_ema_and_sma(self):
        self.assertEqual(st.ema([10, 11, 12], 3), [10, 10.5, 11.25])  # k = 0.5
        self.assertEqual(st.sma([1, 2, 3, 4], 2), [None, 1.5, 2.5, 3.5])

    def test_zscore_uses_sample_standard_deviation(self):
        closes = [1, 2, 3, 4, 10]
        z = st.zscore(closes, 5)
        mean = 4.0
        sd = math.sqrt(sum((c - mean) ** 2 for c in closes) / 4)
        self.assertAlmostEqual(z[4], (10 - mean) / sd)
        self.assertIsNone(z[3])

    def test_williams_r(self):
        bars = [bar(i, 10, 12, 8, 11) for i in range(13)] + [bar(13, 10, 12, 8, 8)]
        self.assertAlmostEqual(st.williams_r(bars)[13], -100.0)  # close at the 14-day low
        bars[-1]['close'] = 12
        self.assertAlmostEqual(st.williams_r(bars)[13], 0.0)

    def test_williams_ad(self):
        bars = [bar(0, 10, 10, 10, 10), bar(1, 10, 12, 9.5, 11), bar(2, 11, 11.5, 10, 10.5)]
        # Up close: 11 - min(9.5, 10) = 1.5. Down close: 10.5 - max(11.5, 11) = -1.0.
        self.assertEqual(st.williams_ad(bars), [0.0, 1.5, 0.5])

    def test_atr_uses_true_range_with_gaps(self):
        bars = [bar(i, 10, 11, 9, 10) for i in range(14)] + [bar(14, 15, 16, 14.5, 15)]
        a = st.atr(bars)
        self.assertAlmostEqual(a[13], 2.0)
        self.assertAlmostEqual(a[14], (2.0 * 13 + 6.0) / 14)  # true range 16 - 10 = 6

    def test_breakout_levels_exclude_today(self):
        self.assertEqual(st.rolling_max([1, 5, 3, 9], 2, skip_current=True), [None, None, 5, 5])


def day_bars(closes, start=dt.date(2024, 1, 1)):
    """Daily bars on weekdays, stamped at US midnight (05:00 UTC) like Schwab's."""
    out, d = [], start
    for c in closes:
        while d.weekday() >= 5:
            d += dt.timedelta(days=1)
        t = int(dt.datetime(d.year, d.month, d.day, 5, tzinfo=dt.timezone.utc).timestamp())
        out.append(bar(t, c, c * 1.01, c * 0.99, c))
        d += dt.timedelta(days=1)
    return out


class WeeklyAndCot(unittest.TestCase):
    def test_weekly_trend_uses_only_finished_weeks(self):
        bars = day_bars([100 + i for i in range(80)])  # steady rise
        wk = st.weekly_trend(bars, n=10)
        self.assertIsNone(wk[20])  # not 10 finished weeks yet
        self.assertEqual(wk[-1], 1)
        # Changing the current (unfinished) week can't change today's reading.
        bars2 = [dict(b) for b in bars]
        bars2[-1]['close'] = 1
        self.assertEqual(st.weekly_trend(bars2, n=10)[-1], wk[-1])

    def test_cot_index_range(self):
        rows = [{'date': f'2024-{1 + k // 4:02d}-{1 + (k % 4) * 7:02d}', 'commNet': float(k)} for k in range(30)]
        idx = st.cot_index(rows, weeks=26)
        self.assertEqual(len(idx), 5)
        self.assertAlmostEqual(idx[-1][1], 100.0)  # the latest net is the 26-week high

    def test_cot_is_used_only_after_its_friday_release(self):
        cot = [('2024-01-02', 80.0), ('2024-01-09', 20.0)]  # Tuesday data dates
        bars = day_bars([100] * 10, start=dt.date(2024, 1, 2))
        aligned = st.align_cot(bars, cot)
        days = [st._day(b['time']) for b in bars]
        self.assertIsNone(aligned[days.index(dt.date(2024, 1, 4))])  # Thursday: not published yet
        self.assertEqual(aligned[days.index(dt.date(2024, 1, 5))], 80.0)  # Friday release
        self.assertEqual(aligned[days.index(dt.date(2024, 1, 11))], 80.0)
        self.assertEqual(aligned[days.index(dt.date(2024, 1, 12))], 20.0)

    def test_cot_view(self):
        self.assertEqual(st.cot_view(75, 1), 'agree')
        self.assertEqual(st.cot_view(75, -1), 'against')
        self.assertEqual(st.cot_view(50, 1), 'neutral')
        self.assertIsNone(st.cot_view(None, 1))


def plan(**kw):
    base = {'entry': 'stop', 'trigger': 101.0, 'validDays': 2, 'stop': 98.0, 'target': 105.0, 'maxHold': 5, 'breakEvenAtR': None, 'exit': None}
    return {**base, **kw}


def ind_for(bars):
    return {'bars': bars, 'sma5': [None] * len(bars), 'lo10': [None] * len(bars), 'hi10': [None] * len(bars)}


class Simulation(unittest.TestCase):
    def test_no_fill_without_a_break_of_the_trigger(self):
        bars = [bar(0, 100, 100.5, 99, 100)] + [bar(i, 100, 100.9, 99.5, 100) for i in range(1, 6)]
        self.assertIsNone(st.simulate(ind_for(bars), 0, plan(), 1))

    def test_target(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 100.5, 102, 100, 101.5), bar(2, 102, 105.5, 101.5, 105)]
        t = st.simulate(ind_for(bars), 0, plan(), 1)
        self.assertEqual((t['reason'], t['entry'], t['exitPrice']), ('target', 101.0, 105.0))
        self.assertAlmostEqual(t['ret'], 105 / 101 - 1 - st.COSTS)
        self.assertAlmostEqual(t['r'], 4 / 3 - st.COSTS * 101 / 3)  # R is after costs

    def test_r_is_net_of_costs(self):
        bars = [bar(0, 100, 100.5, 99, 100)] + [bar(i, 101, 101.5, 100.5, 101) for i in range(1, 7)]
        t = st.simulate(ind_for(bars), 0, plan(maxHold=3), 1)  # exits at its entry price after 3 bars
        self.assertEqual(t['exitPrice'], t['entry'])
        self.assertAlmostEqual(t['r'], -st.COSTS * 101 / 3)

    def test_gap_through_the_stop_fills_at_the_open(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 100.5, 101.5, 100, 101), bar(2, 96, 96.5, 95, 95.5)]
        t = st.simulate(ind_for(bars), 0, plan(), 1)
        self.assertEqual((t['reason'], t['exitPrice']), ('stop', 96))

    def test_stop_first_when_both_in_one_bar(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 100.5, 106, 97, 103)]
        self.assertEqual(st.simulate(ind_for(bars), 0, plan(), 1)['reason'], 'stop')

    def test_time_exit_after_max_hold(self):
        bars = [bar(0, 100, 100.5, 99, 100)] + [bar(i, 101, 101.5, 100.5, 101.2) for i in range(1, 10)]
        t = st.simulate(ind_for(bars), 0, plan(), 1)
        self.assertEqual((t['reason'], t['fill'], t['exit'], t['bars']), ('time', 1, 5, 5))  # 5 sessions incl. the fill day

    def test_break_even_after_one_r(self):
        # Fill 101, risk 3: a close at 104+ moves the stop to 101; then a drop exits at break-even.
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 101, 104.5, 100.8, 104.2), bar(2, 103, 103.5, 100, 100.5)]
        t = st.simulate(ind_for(bars), 0, plan(breakEvenAtR=1.0, target=110.0), 1)
        self.assertEqual((t['reason'], t['exitPrice']), ('break-even', 101.0))

    def test_short_side(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 99.5, 99.8, 98.5, 98.8), bar(2, 98.5, 98.6, 95.5, 96)]
        t = st.simulate(ind_for(bars), 0, plan(trigger=99.0, stop=102.0, target=96.0), -1)
        self.assertEqual((t['reason'], t['entry'], t['exitPrice']), ('target', 99.0, 96.0))
        self.assertGreater(t['ret'], 0)

    def test_market_on_open_entry_and_close_rule(self):
        bars = [bar(0, 100, 100.5, 99, 100), bar(1, 99, 100, 98, 99.5), bar(2, 100, 102, 99.5, 101.5)]
        ind = ind_for(bars)
        ind['sma5'] = [None, 100.0, 100.5]
        t = st.simulate(ind, 0, plan(entry='open', validDays=1, stop=90.0, target=None, exit='sma5', maxHold=7), 1)
        self.assertEqual((t['entry'], t['exitPrice'], t['reason']), (99, 101.5, 'exit rule'))


class Backtests(unittest.TestCase):
    def test_trades_never_use_future_bars(self):
        bars = random_walk(n=900)
        cut = 650
        changed = bars[:cut] + [dict(b, close=b['close'] * 3, high=b['high'] * 3, low=b['low'] * 3, open=b['open'] * 3) for b in bars[cut:]]
        for key in st.STRATEGIES:
            early = lambda bs: [t for t in st.trades_for(st.prepare(bs), key) if t['exit'] < cut]  # noqa: E731
            self.assertEqual(early(bars), early(changed), key)

    def test_some_strategy_trades_on_a_random_walk(self):
        bars = random_walk(n=900, seed=5)
        ind = st.prepare(bars)
        self.assertTrue(any(st.trades_for(ind, k) for k in st.STRATEGIES))

    def test_grades_from_known_trades(self):
        t = lambda ret: {'ret': ret, 'r': ret * 10, 'reason': 'x', 'bars': 3}  # noqa: E731
        g = lambda rets: st.summarise([t(x) for x in rets])['grade']  # noqa: E731
        self.assertEqual(g([0.03] * 5 + [-0.01] * 3), 'mixed')  # 8 trades are not enough to call it proven
        self.assertEqual(g([0.03] * 14 + [-0.01] * 6), 'proven')  # 20 trades, t well above 1.5
        self.assertEqual(g([0.03, -0.028] * 10), 'mixed')  # 20 trades but t below 1.5
        self.assertEqual(g([0.012] * 3 + [-0.01] * 3), 'mixed')
        self.assertEqual(g([0.01, -0.02, 0.01, -0.02]), 'failed')
        self.assertEqual(g([0.05] * 3), 'unproven')
        s = st.summarise([t(x) for x in (0.02, -0.01, -0.01, 0.04)])
        self.assertAlmostEqual(s['profitFactor'], 3.0)
        self.assertAlmostEqual(s['maxDrawdown'], -0.02)
        self.assertEqual(s['maxLosingStreak'], 2)

    def test_random_tests_are_repeatable_and_bounded(self):
        bars = random_walk(n=600, seed=9)
        a = st.random_walk_test(bars, None, 'mean_reversion', runs=20)
        b = st.random_walk_test(bars, None, 'mean_reversion', runs=20)
        self.assertEqual(a, b)
        self.assertTrue(0 < a['p'] <= 1)
        shuffled = st.shuffled_bars(bars, random.Random(1))
        self.assertEqual(len(shuffled), len(bars))
        self.assertTrue(all(x['low'] <= x['close'] <= x['high'] for x in shuffled))


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


class FundFacts(unittest.TestCase):
    def test_picks_the_tag_with_the_newest_data(self):
        fact = lambda end, val: {'end': end, 'val': val, 'form': '10-Q', 'filed': end}  # noqa: E731
        cf = {'facts': {'us-gaap': {
            'AssetsNet': {'units': {'USD': [fact('2022-12-31', 1)]}},  # the old tag stopped in 2022
            'StockholdersEquity': {'units': {'USD': [fact('2025-12-31', 5), fact('2026-06-30', 6)]}},
        }}}
        self.assertEqual(alts.fund_facts_from(cf)['netAssets'][-1]['end'], '2026-06-30')

    def test_ignores_non_report_forms(self):
        cf = {'facts': {'us-gaap': {'NetAssetValuePerShare': {'units': {'USD/shares': [
            {'end': '2026-01-31', 'val': 25.0, 'form': '8-K', 'filed': '2026-02-20'},
            {'end': '2025-12-31', 'val': 24.9, 'form': '10-K', 'filed': '2026-03-01'},
        ]}}}}}
        self.assertEqual([r['end'] for r in alts.fund_facts_from(cf)['navPerShare']], ['2025-12-31'])


class AdvisoryFees(unittest.TestCase):
    tiers = [{'upTo': 1_000_000, 'rate': 0.01}, {'upTo': None, 'rate': 0.0075}]

    def test_tiers_work_like_brackets(self):
        self.assertAlmostEqual(quant.blended_rate(500_000, self.tiers), 5_000)
        self.assertAlmostEqual(quant.blended_rate(1_500_000, self.tiers), 10_000 + 3_750)

    def days(self, start, n):
        out, d = [], start
        while len(out) < n:
            if d.weekday() < 5:
                out.append(d)
            d += dt.timedelta(days=1)
        return out

    def test_quarterly_arrears_with_prorated_first_quarter(self):
        import numpy as np
        dates = self.days(dt.date(2025, 1, 2), 400)
        flat = {'tiers': [{'upTo': None, 'rate': 0.01}], 'billing': 'quarterly', 'timing': 'arrears'}
        net, events = quant.apply_fees(dates, np.zeros(len(dates) - 1), flat, 100_000)
        self.assertAlmostEqual(events[0][1], 100_000 * 0.01 / 4 * 88 / 90)  # Jan 3 - Mar 31 of a 90-day quarter
        self.assertEqual(events[0][0], dt.date(2025, 3, 31))
        self.assertTrue(all(d.month in (3, 6, 9, 12) for d, _ in events))
        self.assertAlmostEqual(float(np.prod(1 + net)), (100_000 - sum(f for _, f in events)) / 100_000)

    def test_advance_bills_at_period_start(self):
        import numpy as np
        dates = self.days(dt.date(2025, 3, 31), 70)
        sched = {'tiers': [{'upTo': None, 'rate': 0.012}], 'billing': 'monthly', 'timing': 'advance'}
        _, events = quant.apply_fees(dates, np.zeros(len(dates) - 1), sched, 120_000)
        self.assertEqual(events[0][0], dt.date(2025, 4, 1))
        self.assertAlmostEqual(events[0][1], 120_000 * 0.012 / 12)  # account opened Mar 31: April is a full month
        self.assertEqual(events[1][0], dt.date(2025, 5, 1))

    def test_zero_rate_tier_is_a_real_band(self):
        import numpy as np
        tiers = [{'upTo': 1_000_000, 'rate': 0}, {'upTo': None, 'rate': 0.01}]
        dates = self.days(dt.date(2025, 1, 2), 300)
        _, events = quant.apply_fees(dates, np.zeros(len(dates) - 1), {'tiers': tiers, 'billing': 'quarterly'}, 1_000_000)
        self.assertEqual(sum(f for _, f in events), 0)
        self.assertAlmostEqual(quant.blended_rate(1_500_000, tiers), 5_000)

    def test_ytd_excludes_last_years_december_fee(self):
        import numpy as np
        dates = self.days(dt.date(2024, 1, 2), 470)  # past Dec 31 2024 (a Tuesday) into 2025
        flat = {'tiers': [{'upTo': None, 'rate': 0.01}], 'billing': 'quarterly', 'timing': 'arrears'}
        net, events = quant.apply_fees(dates, np.zeros(len(dates) - 1), flat, 100_000)
        ytd = quant.trailing(net, dates, 0)
        fees_2025 = sum(f for d, f in events if d.year == 2025)
        self.assertAlmostEqual(ytd, -fees_2025 / (100_000 - sum(f for d, f in events if d.year == 2024)), places=6)


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

    async def get_price_history_every_week(self, symbol, **kw):
        return self._history(symbol, 7 * 86400)

    async def get_quotes(self, symbols, **kw):
        return Resp(200, {})

    async def get_option_chain(self, symbol, **kw):
        return Resp(500)


class FakeDisk:
    def __init__(self):
        self.data = {}

    def get(self, key):
        return self.data.get(key)

    def put(self, key, saved, value):
        self.data[key] = (saved, value)


class FakeCtx:
    def __init__(self, schwab):
        self.schwab, self.news, self._cache, self.disk = schwab, None, {}, FakeDisk()

    async def cached(self, key, max_age, load, persist=False, stale_ok=False):
        if key not in self._cache:
            self._cache[key] = await load()
        return self._cache[key]


class ScanErrors(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(scanner, 'UNIVERSE', ['SPY', 'AAA']), mock.patch.object(scanner, 'REQUEST_GAP', 0),
                        mock.patch.object(scanner, 'market_session', return_value='closed'),
                        mock.patch.object(scanner, '_run_rule_tests', new=mock.AsyncMock()),
                        mock.patch.object(scanner, '_run_lab', new=mock.AsyncMock())]  # the lab has its own tests
        for p in self.patches:
            p.start()
        scanner._state.update({'result': None, 'running': None, 'extra': set(), 'bad': {}})

    def tearDown(self):
        for p in self.patches:
            p.stop()
        scanner._state.update({'result': None, 'running': None, 'extra': set(), 'bad': {}})

    def scan(self, schwab):
        return asyncio.run(scanner.scan(FakeCtx(schwab)))

    def test_unknown_symbol_is_skipped_and_remembered(self):
        scanner.UNIVERSE.append('BADX')
        r = self.scan(FakeSchwab({'BADX': 400}))
        self.assertEqual(r['scanned'], 2)
        self.assertEqual(set(r['horizons']), {'short', 'swing', 'position'})
        self.assertIn({'symbol': 'BADX', 'reason': 'unknown'}, r['skipped'])
        schwab = FakeSchwab({'BADX': 400})
        r2 = self.scan(schwab)
        self.assertNotIn('BADX', schwab.calls)  # not asked again for a day...
        self.assertIn({'symbol': 'BADX', 'reason': 'unknown'}, r2['skipped'])  # ...but still listed

    def test_temporary_error_only_skips_one_scan(self):
        scanner.UNIVERSE.append('TMP')
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



class CalendarActuals(unittest.TestCase):
    """US actuals read from FRED only when FRED already has the period the release covers."""

    def setUp(self):
        from engine import actuals
        self.a = actuals
        self.tz = dt.timezone.utc

    def ev(self, title, day, forecast='', previous=''):
        t = int(dt.datetime.fromisoformat(day + 'T12:30:00+00:00').timestamp())
        return {'title': title, 'country': 'USD', 'time': t, 'forecast': forecast, 'previous': previous, 'actual': ''}

    def test_periods(self):
        p = self.a.period_for
        self.assertEqual(p(dt.date(2026, 10, 15), 'm1'), dt.date(2026, 9, 1))
        self.assertEqual(p(dt.date(2026, 1, 9), 'm2'), dt.date(2025, 11, 1))
        self.assertEqual(p(dt.date(2026, 10, 29), 'q'), dt.date(2026, 7, 1))
        self.assertEqual(p(dt.date(2026, 3, 26), 'q'), dt.date(2025, 10, 1))
        self.assertEqual(p(dt.date(2026, 10, 22), 'w1'), dt.date(2026, 10, 17))  # Thursday -> last Saturday

    def test_cpi_filled_and_formatted(self):
        e = self.ev('CPI m/m', '2026-10-15', '0.3%', '0.4%')
        rows = [('2026-08-01', 320.0), ('2026-09-01', 321.0)]
        self.a.fill([e], {'CPIAUCSL': rows}, self.tz)
        self.assertEqual(e['actual'], '0.3%')
        self.assertEqual(e['actualSource'], 'FRED')

    def test_waits_for_fred_to_update(self):
        e = self.ev('CPI m/m', '2026-10-15', '0.3%', '0.4%')
        self.a.fill([e], {'CPIAUCSL': [('2026-07-01', 319.0), ('2026-08-01', 320.0)]}, self.tz)
        self.assertEqual(e['actual'], '')

    def test_payrolls_claims_and_units(self):
        nfp = self.ev('Non-Farm Employment Change', '2026-10-02', '120K', '22K')
        claims = self.ev('Unemployment Claims', '2026-10-22', '225K', '231K')
        jolts = self.ev('JOLTS Job Openings', '2026-10-06', '7.20M', '7.18M')
        self.a.fill([nfp, claims, jolts], {
            'PAYEMS': [('2026-08-01', 159500.0), ('2026-09-01', 159640.0)],
            'ICSA': [('2026-10-10', 231000.0), ('2026-10-17', 219000.0)],
            'JTSJOL': [('2026-08-01', 7227.0)],
        }, self.tz)
        self.assertEqual(nfp['actual'], '140K')
        self.assertEqual(claims['actual'], '219K')
        self.assertEqual(jolts['actual'], '7.23M')

    def test_missing_month_gives_no_actual_rather_than_a_wrong_one(self):
        rows = [(f'2025-{m:02d}-01', 300 + m) for m in range(1, 13) if m != 10] + [('2026-09-01', 320.0)]
        self.assertIsNone(self.a.value_for(rows, dt.date(2025, 11, 1), 'mom'))  # October missing
        rows += [('2025-09-01', 309.0)]
        self.assertAlmostEqual(self.a.value_for(sorted(rows), dt.date(2026, 9, 1), 'yoy'), (320 / 309 - 1) * 100)
        self.assertIsNone(self.a.release_for({'country': 'USD', 'title': 'Prelim GDP q/q'}))

    def test_only_released_us_events(self):
        future = self.ev('CPI m/m', '2099-01-13')
        other = dict(self.ev('CPI m/m', '2026-10-15'), country='EUR')
        self.assertEqual(self.a.series_needed([future, other], time.time()), [])


class Grading(unittest.TestCase):
    """A B-grade never has a failed check of its own, and every non-A card says why."""

    def setup(self, rr=2.0, z=-1.5, cot=70):
        return {'direction': 1, 'symbol': 'TEST', 'signalDate': '2026-10-22', 'strategy': 'weekly_swing', 'status': 'ready',
                'score': 0, 'plan': {'exitBy': '2026-10-30', 'riskReward': rr},
                'indicators': {'cotView': st_cot_view(cot), 'cot': cot, 'z': z}}

    def strat(self, exp=0.004, pf=1.5, p=0.05, robust=True):
        return {'stats': {'trades': 200, 'winRate': 0.55, 'profitFactor': pf, 'expectancy': exp}, 'randomEntry': {'p': p},
                'robust': {'costs': robust, 'halves': robust}}

    def test_tiers(self):
        stock = {'grade': 'proven', 'trades': 10, 'winRate': 0.6}
        a = self.setup()
        scanner.grade(a, stock, self.strat(), {})
        self.assertEqual(a['tier'], 'A')
        self.assertEqual(a['why'], [])
        b = self.setup()
        scanner.grade(b, stock, self.strat(p=0.3), {})
        self.assertEqual(b['tier'], 'B')
        c = self.setup(rr=0.4)
        scanner.grade(c, stock, self.strat(p=0.3), {})
        self.assertEqual(c['tier'], 'C')
        self.assertTrue(any('risk' in w for w in c['why']))
        self.assertIn('rr', c['whyCodes'])
        self.assertEqual(len(c['why']), len(c['whyCodes']))
        # Buys and sells are judged on their own records: good longs don't excuse losing shorts.
        both = {**self.strat(), 'sides': {'long': self.strat(), 'short': self.strat(exp=-0.003, pf=0.7)}}
        long_s, short_s = self.setup(), {**self.setup(cot=30), 'direction': -1}
        short_s['indicators'] = {**short_s['indicators'], 'cotView': 'agree', 'z': 1.5}
        scanner.grade(long_s, stock, both, {})
        scanner.grade(short_s, stock, both, {})
        self.assertEqual(long_s['tier'], 'A')
        self.assertEqual(short_s['tier'], 'C')
        self.assertIn("sells lost money", short_s['why'][0])
        losing = self.setup()
        scanner.grade(losing, stock, self.strat(exp=-0.001, pf=0.9), {})
        self.assertEqual(losing['tier'], 'C')
        self.assertIn('lost money', losing['why'][0])


def st_cot_view(v):
    from engine import strategies
    return strategies.cot_view(v, 1)


class MonteCarlo(unittest.TestCase):
    def test_summary_is_repeatable_and_sensible(self):
        from engine import strategies
        trades = [{'ret': r} for r in (0.03, -0.01, 0.02, -0.015, 0.025, -0.01, 0.01)]
        a = strategies.monte_carlo(trades)
        self.assertEqual(a, strategies.monte_carlo(trades))
        self.assertEqual(a['runs'], 1000)
        self.assertTrue(a['bad'] <= a['median'] <= a['good'])
        self.assertTrue(0.5 < a['profitable'] <= 1)  # every trade averages +0.86%
        self.assertLessEqual(a['worstDrop'], 0)
        self.assertIsNone(strategies.monte_carlo(trades[:3]))

    def test_random_walk_runs_in_background(self):
        async def go():
            bars = [{'time': 1_600_000_000 + i * 86400, 'open': 100 + i % 7, 'high': 102 + i % 7, 'low': 98 + i % 7, 'close': 101 + i % 5, 'volume': 1}
                    for i in range(300)]
            old = scanner.RW_RUNS
            scanner.RW_RUNS = 5
            try:
                first = scanner.random_walk_for('TEST', 'mean_reversion', bars, None)
                self.assertTrue(first['pending'])
                await scanner._rw_worker
                done = scanner.random_walk_for('TEST', 'mean_reversion', bars, None)
                self.assertEqual(done['runs'], 5)
            finally:
                scanner.RW_RUNS = old
        asyncio.run(go())


class NavHistory(unittest.TestCase):
    """Monthly NAV announcements read into a NAV line."""

    TABLE = ('<p>Net Asset Value per Share as of September 30, 2026</p><table><tr><td>Class S Shares</td><td>$</td><td>14.5012</td></tr>'
             '<tr><td>Class I Shares</td><td>$</td><td>14.6488</td></tr><tr><td>Class D Shares</td><td>$</td><td>14.5500</td></tr></table>')
    SENTENCE = '<p>The net asset value ("NAV") per share for each class of shares as of August 31, 2026 was $23.60.</p>'

    def test_table_and_sentence(self):
        pts = alts.nav_points(self.TABLE)
        self.assertIn(('2026-09-30', 'Class I', 14.6488), pts)
        self.assertIn(('2026-09-30', 'Class S', 14.5012), pts)
        self.assertEqual(alts.nav_points(self.SENTENCE), [('2026-08-31', 'All classes', 23.6)])

    def test_does_not_mix_in_an_older_table(self):
        page = self.TABLE + '<p>As of December 31, 2024 the Class I Shares were $13.10 under the prior offering.</p>'
        self.assertNotIn(('2026-09-30', 'Class I', 13.1), alts.nav_points(page))

    def test_series_prefers_class_i_and_drops_outliers(self):
        pts = [('2026-07-31', 'Class I', 14.65), ('2026-08-31', 'Class I', 14.69), ('2026-09-30', 'Class I', 14.65),
               ('2026-09-30', 'Class S', 14.50), ('2026-08-31', 'Class I', 14.69), ('2026-06-30', 'Class I', 1.47),
               ('2019-01-31', 'Class I', 11.0)]
        s = alts.nav_series(pts, today=dt.date(2026, 10, 23))
        self.assertEqual(s['cls'], 'Class I')
        self.assertEqual([p['date'] for p in s['points']], ['2026-07-31', '2026-08-31', '2026-09-30'])
        self.assertEqual({c['cls'] for c in s['latestByClass']}, {'Class I', 'Class S'})
        self.assertIsNone(alts.nav_series([], today=dt.date(2026, 10, 23)))



class OpenTradesStayListed(unittest.TestCase):
    """A trade that triggered days ago stays on the list until it ends (the scanner used to look back 3 days only)."""

    def fake_strategy(self, signal_at):
        def signal(ind, i):
            return {'dir': 1, 'reasons': ['test']} if i == signal_at else None

        def plan(ind, i, d):
            c = ind['bars'][i]['close']
            return {'entry': 'open', 'trigger': c, 'validDays': 1, 'stop': c * 0.5, 'target': c * 2, 'maxHold': 15,
                    'breakEvenAtR': None, 'exit': None, 'targetNote': 'test', 'exitRule': 'test'}
        return {'name': 'Test', 'short': 'Test', 'signal': signal, 'plan': plan, 'horizon': 'test'}

    def test_trade_from_eight_sessions_ago_is_still_shown(self):
        from engine import strategies
        bars = random_walk(400, seed=3)
        n = len(bars)
        strategies.STRATEGIES['test'] = self.fake_strategy(n - 9)
        try:
            out = scanner.analyse_symbol('TEST', bars, None, None, ['test'])
        finally:
            del strategies.STRATEGIES['test']
        self.assertEqual(len(out['setups']), 1)
        self.assertEqual(out['setups'][0]['status'], 'in trade')
        self.assertFalse(out['setups'][0]['new'])

    def test_lookback_covers_every_strategy(self):
        from engine import strategies
        for h in strategies.HORIZONS:
            ind = strategies.prepare(random_walk(400, seed=5), None, h)
            for key, strat in strategies.STRATEGIES.items():
                p = strat['plan'](ind, 300, 1) or strat['plan'](ind, 300, -1)
                if p:
                    self.assertLessEqual(p['validDays'] + p['maxHold'], scanner._lookback(key, strat, h), (h, key))


    def test_opposite_signals_on_one_stock_are_flagged(self):
        from engine import strategies
        bars = random_walk(400, seed=3)
        n = len(bars)
        up, down = self.fake_strategy(n - 1), self.fake_strategy(n - 1)
        down['signal'] = lambda ind, i: {'dir': -1, 'reasons': ['test']} if i == n - 1 else None
        down['plan'] = lambda ind, i, d: {**up['plan'](ind, i, d), 'stop': ind['bars'][i]['close'] * 1.5, 'target': ind['bars'][i]['close'] * 0.5}
        strategies.STRATEGIES['up'], strategies.STRATEGIES['down'] = up, down
        try:
            _, _, setups, filtered = scanner.compute([('TEST', bars, None, None)], ['up', 'down'], {})
        finally:
            del strategies.STRATEGIES['up'], strategies.STRATEGIES['down']
        both = setups + filtered
        self.assertEqual(len(both), 2)
        for s in both:
            self.assertEqual(s['conflict']['direction'], -s['direction'])
            self.assertTrue(any(c['label'] == 'Other strategies' for c in s['checks']))



class StatisticsDesign(unittest.TestCase):
    """The statistics behind the grades (docs/research/setups-statistics.md)."""

    def test_rolling_quantile_uses_only_earlier_bars(self):
        from engine import strategies
        vals = list(range(10))
        q = strategies.rolling_quantile(vals, 4, 0.0)
        self.assertEqual(q[:4], [None] * 4)
        self.assertEqual(q[4], 0)  # min of bars 0..3
        self.assertEqual(q[9], 5)  # min of bars 5..8: bar 9 itself is not included
        changed = vals[:9] + [-100]
        self.assertEqual(strategies.rolling_quantile(changed, 4, 0.0)[9], 5)

    def test_benjamini_hochberg(self):
        from engine import strategies
        q = strategies.bh_qvalues([0.01, 0.04, None, 0.03, 0.5])
        self.assertAlmostEqual(q[0], 0.04)  # 0.01 * 4 / 1
        self.assertAlmostEqual(q[3], 0.04 * 4 / 3 if 0.04 * 4 / 3 < 0.03 * 4 / 2 else 0.03 * 4 / 2)
        self.assertIsNone(q[2])
        self.assertAlmostEqual(q[4], 0.5)

    def test_edge_study_finds_a_planted_edge_and_not_a_fake_one(self):
        from synthetic import cot_world
        cot, events = cot_world(seed=2, edge=0.01)
        self.assertEqual(st.edge_summary(events, cot, 60, 40, runs=300)['test']['verdict'], 'COT adds an edge')
        cot, events = cot_world(seed=3, edge=0.0)
        self.assertGreater(st.edge_summary(events, cot, 60, 40, runs=300)['test']['p'], 0.05)

    def test_bounds_fit_each_stock(self):
        from engine import strategies
        calm = strategies.prepare(random_walk(600, seed=1), None)
        wild = strategies.prepare([{**b, 'close': b['close']} for b in random_walk(600, seed=9)], None)
        for ind in (calm, wild):
            self.assertTrue(all(-2.5 <= v <= -0.75 for v in ind['zlo'] if v is not None))
            self.assertTrue(all(2 <= v <= 15 for v in ind['rlo'] if v is not None))

    def test_cot_z_events_respect_the_holding_period(self):
        from engine import strategies
        ind = strategies.prepare(random_walk(800, seed=4), None)
        ev = strategies.cot_z_events(ind, 5)
        self.assertTrue(ev)
        self.assertTrue(all(e['dir'] in (1, -1) and 'time' in e for e in ev))
        days = sorted(e['time'] for e in ev)
        self.assertTrue(all(b - a >= 5 * 86400 for a, b in zip(days, days[1:])))  # one event per stretch



class TimeFrames(unittest.TestCase):
    """Hourly and weekly bars, and the bar still forming, for the short-swing and position time frames."""
    E = scanner.EASTERN

    def ts(self, *a):
        return int(dt.datetime(*a, tzinfo=self.E).timestamp())

    def test_hourly_bars_cover_the_regular_session_only(self):
        b30 = [bar(self.ts(2026, 10, 21, h, m), 10, 11, 9, 10 + i) for i, (h, m) in enumerate(
            [(8, 0), (9, 30), (10, 0), (10, 30), (11, 0), (15, 30), (16, 0)])]
        hb = scanner.hourly_bars(b30)
        self.assertEqual([dt.datetime.fromtimestamp(b['time'], self.E).strftime('%H:%M') for b in hb], ['09:30', '10:30', '15:30'])
        self.assertEqual(hb[0]['close'], 12)  # the 10:00 half-hour closes the 9:30 hour

    def test_forming_hour_uses_the_live_price(self):
        hb = [bar(self.ts(2026, 10, 21, 9, 30), 10, 11, 9, 10.5), bar(self.ts(2026, 10, 21, 10, 30), 10.5, 10.8, 10.4, 10.6)]
        now = dt.datetime(2026, 10, 21, 10, 50, tzinfo=self.E)
        quote = {'quote': {'lastPrice': 11.2, 'tradeTime': now.timestamp() * 1000}}
        done, live = scanner.split_hourly(hb, quote, now)
        self.assertEqual(len(done), 1)
        self.assertEqual(live[-1]['close'], 11.2)
        self.assertEqual(live[-1]['high'], 11.2)
        done2, live2 = scanner.split_hourly(hb, quote, dt.datetime(2026, 10, 21, 17, 0, tzinfo=self.E))
        self.assertEqual((len(done2), live2), (2, None))  # after the close every hour is finished

    def test_this_week_is_forming_until_friday_close(self):
        weeks = [bar(self.ts(2026, 10, 12, 0, 0), 10, 11, 9, 10), bar(self.ts(2026, 10, 19, 0, 0), 10, 12, 9, 11)]
        wed = dt.datetime(2026, 10, 21, 12, 0, tzinfo=self.E)
        done, live = scanner.split_weekly(weeks, None, wed)
        self.assertEqual((len(done), len(live)), (1, 2))
        done, live = scanner.split_weekly(weeks, None, dt.datetime(2026, 10, 23, 16, 30, tzinfo=self.E))
        self.assertEqual((len(done), live), (2, None))

    def test_every_time_frame_has_its_own_lengths(self):
        from engine import strategies
        for h, cfg in strategies.HORIZONS.items():
            ind = strategies.prepare(random_walk(600, seed=7), None, h)
            self.assertEqual(ind['horizon'], h)
            for key in strategies.STRATEGIES:
                # analyse_symbol looks back entry window + hold + 1 bars, so an open trade is never dropped.
                bars = random_walk(400, seed=3)
                n = len(bars)
                fake = OpenTradesStayListed().fake_strategy(n - cfg['maxHold'][key])  # filled next bar, one bar of the hold left
                fake['plan'] = (lambda real: lambda ind, i, d: {**real(ind, i, d), 'validDays': cfg['valid'][key], 'maxHold': cfg['maxHold'][key]})(fake['plan'])
                strategies.STRATEGIES[key + '_t'] = fake
                cfg['valid'][key + '_t'], cfg['maxHold'][key + '_t'] = cfg['valid'][key], cfg['maxHold'][key]
                try:
                    out = scanner.analyse_symbol('TEST', bars, None, None, [key + '_t'], h)
                finally:
                    del strategies.STRATEGIES[key + '_t'], cfg['valid'][key + '_t'], cfg['maxHold'][key + '_t']
                self.assertEqual(len(out['setups']), 1, (h, key))



def _lab_series(n, seed, revert):
    r = random.Random(seed)
    p, out, prev = 100.0, [], 0.0
    for i in range(n):
        ret = r.gauss(0.0004, 0.015) - (0.3 * prev if revert else 0)
        prev = ret
        o = p * (1 + r.gauss(0, 0.002))
        p = o * math.exp(ret)
        out.append(bar(1_500_000_000 + i * 86400, o, max(o, p) * (1 + abs(r.gauss(0, 0.004))), min(o, p) * (1 - abs(r.gauss(0, 0.004))), p, r.randint(800_000, 1_500_000)))
    return out


class StrategyLab(unittest.TestCase):
    """The lab keeps only combinations that hold up on data they were not chosen on."""

    def setUp(self):
        from engine import lab, strategies
        self.lab, self.st = lab, strategies

    def test_finds_a_real_edge_on_unseen_data(self):
        inds = {f'S{k}': self.st.prepare(_lab_series(700, k, True), None) for k in range(25)}
        res = self.lab.run(inds)
        self.assertGreater(res['validated'], 0)
        self.assertLessEqual(res['pbo'], 0.5)
        self.assertGreater(res['embargo'], 0)
        best = next(r for r in res['results'] if r['validated'])
        self.assertEqual(self.lab.TRIGGERS[best['trigger']]['family'], 'reversal')  # the planted edge is a reversal
        self.assertGreater(best['test']['expectancy'], 0)

    def test_rejects_luck(self):
        inds = {f'S{k}': self.st.prepare(_lab_series(700, 500 + k, False), None) for k in range(25)}
        self.assertEqual(self.lab.run(inds)['validated'], 0)

    def test_removed_filters_are_gone(self):
        for f in ('reverting', 'trending', 'cot', 'flow'):
            self.assertNotIn(f, self.lab.FILTERS)
        self.assertFalse(hasattr(self.lab, 'variance_ratio'))
        self.assertIn('tom', self.lab.filters_for('swing'))
        self.assertNotIn('tom', self.lab.filters_for('position'))  # a weekly bar can't hold a 4-day window
        self.assertEqual(len(self.lab.candidates('swing')), 11 * (1 + 8 + 28) * 2)
        self.assertEqual(len(self.lab.candidates('position')), 11 * (1 + 7 + 21) * 2)

    def test_turn_of_month_counts_trading_days(self):
        bars = day_bars([100] * 30, start=dt.date(2026, 7, 27))  # Mon Jul 27 .. early September
        tom = dict(zip([st._day(b['time']) for b in bars], self.lab.turn_of_month(bars)))
        self.assertTrue(tom[dt.date(2026, 7, 31)])  # Friday, last trading day of July
        self.assertFalse(tom[dt.date(2026, 7, 30)])  # T-1: not in the window (calendar-day rules included it)
        self.assertTrue(all(tom[d] for d in (dt.date(2026, 8, 3), dt.date(2026, 8, 4), dt.date(2026, 8, 5))))
        self.assertFalse(tom[dt.date(2026, 8, 6)])  # the 4th trading day

    def test_divergence_uses_only_earlier_bars(self):
        bars = random_walk(300, seed=8)
        closes = [b['close'] for b in bars]
        full = self.lab.ad_divergence(bars, closes)
        cut = self.lab.ad_divergence(bars[:200], closes[:200])
        self.assertEqual(full[:200], cut)

    def test_market_trend_uses_only_the_previous_day(self):
        bars = [bar(1_600_000_000 + i * 86400, 100, 101, 99, 100 + (i if i < 260 else -i)) for i in range(280)]
        m = scanner.market_trend_by_date(bars)
        day260 = scanner.bar_day(bars[260]['time'])
        self.assertEqual(m[day260], 1)  # bar 260's own drop is not known yet

    def test_holm_and_candidate_count(self):
        self.assertEqual(len(self.lab.candidates()), len(self.lab.TRIGGERS) * (1 + len(self.lab.FILTERS) + len(self.lab.FILTERS) * (len(self.lab.FILTERS) - 1) // 2) * 2)
        adj = self.lab.holm([0.01, 0.04, 0.03])
        self.assertAlmostEqual(adj[0], 0.03)
        self.assertAlmostEqual(adj[2], 0.06)
        self.assertAlmostEqual(adj[1], 0.06)

    def test_survivors_keep_their_first_shown_time_across_restarts(self):
        path = os.path.join(_TMP, 'state-test.json')
        fake = {'results': [{'validated': True, 'id': 'rsi2|above200|1', 'trigger': 'rsi2', 'filters': ['above200'], 'direction': 1,
                             'name': 'Lab: RSI(2) + 200 (buys)', 'description': 'x', 'test': {}, 'pAdjusted': 0.01}]}
        state = {}
        self.assertEqual(self.lab.add_survivors(state, 'swing', fake, 1_700_000_000), ['rsi2|above200|1'])
        self.lab.save_json_atomic(path, state)
        again = self.lab.load_state(path)  # a restart
        self.assertEqual(self.lab.add_survivors(again, 'swing', fake, 1_800_000_000), [])  # already there: unchanged
        self.assertEqual(again['swing']['rsi2|above200|1']['firstShown'], 1_700_000_000)
        try:
            keys = self.lab.install(again)
            self.assertEqual(len(keys), 1)
            strat = self.st.STRATEGIES[keys[0]]
            self.assertEqual((strat['horizon_only'], strat['since'], strat['sides']), ('swing', 1_700_000_000, (1,)))
        finally:
            self.lab.install({})
        self.assertFalse(any(v.get('lab') for v in self.st.STRATEGIES.values()))

    def test_forward_failure_rule(self):
        ok = {'trades': 40, 'expectancy': 0.002, 'tStat': 0.5}
        self.assertFalse(self.lab.forward_failed(ok))
        self.assertTrue(self.lab.forward_failed({**ok, 'expectancy': -0.001}))
        self.assertTrue(self.lab.forward_failed({**ok, 'tStat': -1.2}))
        self.assertFalse(self.lab.forward_failed({'trades': 12, 'expectancy': -0.01, 'tStat': -2}))  # too early to judge

    def test_atomic_write_never_leaves_a_broken_file(self):
        path = os.path.join(_TMP, 'graveyard-test.json')
        self.lab.save_json_atomic(path, {'ok': 1})
        with self.assertRaises(TypeError):
            self.lab.save_json_atomic(path, {'bad': object()})  # fails while writing
        with open(path) as f:
            self.assertEqual(json.load(f), {'ok': 1})  # the old file is untouched
        self.assertEqual([n for n in os.listdir(_TMP) if n.startswith('graveyard-test.json.tmp')], [])  # no temporary file left


if __name__ == '__main__':
    unittest.main()
