"""Tests for the statistics every grade depends on (helper v21; docs/research/setups-v21-results.md).

Standard library only. Run from the repository root:  python -m unittest discover helper/tests
"""
import datetime as dt
import math
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

import test_engine  # noqa: E402,F401  (sets the scanner up for tests: temporary files, no worker processes)
from engine import lab, ruletests, scanner  # noqa: E402
from engine import strategies as st  # noqa: E402
import synthetic as sy  # noqa: E402

UTC = dt.timezone.utc


def _weekdays(n, start=dt.date(2015, 1, 5)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(dt.datetime(d.year, d.month, d.day, 5, tzinfo=UTC).timestamp()))
        d += dt.timedelta(days=1)
    return out


def clustered_world(seed, stocks=15, n=500, hold=5, edge=0.0):
    """Stocks sharing one market random walk; a rule that buys every stock after the MARKET fell 3 days in a row (so
    trades cluster on the same dates). With edge > 0 the next `hold` days really do rise by `edge` a day."""
    r = random.Random(seed)
    times = _weekdays(n)
    mkt = [r.gauss(0.0003, 0.011) for _ in range(n)]
    sig = [i >= 3 and mkt[i] < 0 and mkt[i - 1] < 0 and mkt[i - 2] < 0 for i in range(n)]
    boost = [0.0] * n
    if edge:
        for i in range(n):
            if sig[i]:
                for k in range(i + 1, min(n, i + 1 + hold)):
                    boost[k] = edge
    series, trades = {}, {}
    for s in range(stocks):
        p, opens, closes = 100.0, [], []
        for i in range(n):
            o = p * math.exp(r.gauss(0, 0.002))
            p = o * math.exp(mkt[i] + boost[i] + r.gauss(0, 0.015))
            opens.append(o)
            closes.append(p)
        series[s] = (times, opens, closes)
        ts, i, free = [], 30, 0
        while i < n - hold - 1:
            if i >= free and sig[i]:
                ts.append({'time': times[i], 'signal': i, 'bars': hold, 'dir': 1, 'ret': closes[i + hold] / opens[i + 1] - 1 - st.COSTS})
                free = i + hold + 1
            i += 1
        trades[s] = ts
    return series, trades


cot_world = sy.cot_world




class ClusteredRandomEntry(unittest.TestCase):
    """backtest-statistics.md R1: trades that cluster in time must be compared with random trades that cluster too."""

    def test_false_alarm_rate_on_no_edge_data(self):
        hits = 0
        for seed in range(200):
            series, trades = clustered_world(seed)
            re = st.random_entry_test(trades, series, runs=99, seed=seed)
            hits += re['p'] <= 0.10
        self.assertLessEqual(hits / 200, 0.14)  # 0.10 plus two binomial standard errors

    def test_planted_edge_is_still_found(self):
        found = sum(st.random_entry_test(*reversed(clustered_world(100 + seed, edge=0.004)), runs=99, seed=seed)['p'] <= 0.10 for seed in range(20))
        self.assertGreaterEqual(found, 16)

    def test_random_dates_come_from_the_trades_own_period(self):
        series, trades = clustered_world(1, stocks=5)
        late = {s: [t for t in ts if t['signal'] > 300] for s, ts in trades.items()}
        re = st.random_entry_test(late, series, runs=20)
        self.assertEqual(re['trades'], sum(len(v) for v in late.values()))
        self.assertLess(re['clusters'], re['trades'])  # same-date trades count as one cluster


class ClusteredStatistics(unittest.TestCase):
    def trades(self, rets_by_week):
        out = []
        for w, rets in enumerate(rets_by_week):
            t = int(dt.datetime(2026, 1, 5, 5, tzinfo=UTC).timestamp()) + w * 7 * 86400
            out += [{'time': t, 'ret': r, 'r': r * 10, 'reason': 'x', 'bars': 3} for r in rets]
        return out

    def test_same_week_trades_count_once(self):
        rnd = random.Random(4)
        weeks = [[rnd.gauss(0.002, 0.02)] * 10 for _ in range(30)]  # 10 identical trades per week: really 30 bets
        s = st.summarise(self.trades(weeks))
        self.assertEqual((s['trades'], s['effectiveTrades']), (300, 30))
        naive = s['expectancy'] / (st.stdev([t['ret'] for t in self.trades(weeks)], 300)[-1] / math.sqrt(300))
        self.assertLess(abs(s['tStat']), abs(naive) / 2)  # about sqrt(10) smaller

    def test_trades_needed_basis(self):
        s = st.summarise(self.trades([[0.01, -0.005]] * 40))
        self.assertEqual(s['tradesNeeded'], math.ceil(s['effectiveTrades'] * (st.Z_NEEDED / s['tStat']) ** 2))
        self.assertAlmostEqual(st.Z_NEEDED, 1.282 + 0.842)

    def test_holm_family_counts_untested_records(self):
        stats = {'weekly_swing': {'sides': {'long': {'randomEntry': {'p': 0.01}}, 'short': {'randomEntry': {'p': 0.5}}}}}
        fam = scanner.holm_family({}, stats, 'swing')
        rec = stats['weekly_swing']['sides']['long']['randomEntry']
        self.assertEqual(rec['family'], len(fam))
        self.assertGreaterEqual(len(fam), 15)  # 3 time frames x (2 + 2 + 1 sides)
        self.assertAlmostEqual(rec['pAdjusted'], min(1.0, 0.01 * len(fam)))

    def test_bh_family_size(self):
        self.assertAlmostEqual(st.bh_qvalues([0.01], family=50)[0], 0.5)

    def test_monte_carlo_in_r(self):
        trades = [{'ret': r, 'r': r * 20, 'time': i} for i, r in enumerate((0.03, -0.01, 0.02, -0.015, 0.025, -0.01, 0.01))]
        a, b = st.monte_carlo(trades), st.monte_carlo(trades, key='r')
        self.assertAlmostEqual(b['median'], a['median'] * 20, places=6)


class EdgeStudyByWeek(unittest.TestCase):
    """COT is one reading per week: the edge study shuffles whole weeks."""

    def test_false_alarm_rate(self):
        hits = sum(st.edge_summary(*reversed(cot_world(seed, 0.0)), 60, 40, runs=150, seed=seed)['test']['p'] <= 0.10 for seed in range(200))
        self.assertLessEqual(hits / 200, 0.14)

    def test_planted_edge_found_both_ways(self):
        cot, ev = cot_world(7, 0.012)
        self.assertEqual(st.edge_summary(ev, cot, 60, 40, runs=300)['test']['verdict'], 'COT adds an edge')
        cot, ev = cot_world(8, -0.012)
        self.assertEqual(st.edge_summary(ev, cot, 60, 40, runs=300)['test']['verdict'], 'COT works the opposite way')

    def test_cot_study_needs_holm_pass(self):
        cot, ev = cot_world(9, 0.0)
        rows = [{'date': d, 'commNet': v} for d, v in cot]
        res = st.cot_study(ev, rows, runs=100)
        self.assertEqual(len(res['variants']), 6)
        self.assertTrue(all(v['pAdjusted'] >= (v['test'] or {}).get('p', 1) for v in res['variants']))
        self.assertEqual(res['passed'], res['chosen'] is not None)


class Grades(unittest.TestCase):
    def setup(self, strategy='weekly_swing', cot=80):
        return {'direction': 1, 'symbol': 'TEST', 'signalDate': '2026-10-22', 'strategy': strategy, 'status': 'ready', 'score': 0,
                'plan': {'exitBy': '2026-10-30', 'riskReward': 2.0, 'target': 110}, 'indicators': {'cotView': st.cot_view(cot, 1), 'cot': cot, 'z': -1.5}}

    def strat(self, trades=200, **kw):
        return {'stats': {'trades': trades, 'winRate': 0.55, 'profitFactor': 1.5, 'expectancy': 0.004}, 'randomEntry': {'p': 0.01, 'pAdjusted': 0.05},
                'robust': {'costs': True, 'halves': True}, **kw}

    stock = {'grade': 'mixed', 'trades': 10, 'winRate': 0.6}

    def test_adjusted_p_decides_tier_a(self):
        s = self.setup()
        scanner.grade(s, self.stock, {**self.strat(), 'randomEntry': {'p': 0.01, 'pAdjusted': 0.18}}, {})
        self.assertEqual(s['tier'], 'B')
        self.assertIn('unproven', s['whyCodes'])

    def test_missing_cot_never_counts_as_a_pass(self):
        gate = {'weeks': 156, 'hi': 75, 'lo': 25, 'sign': 1, 'series': []}
        s = self.setup(cot=None)
        scanner.grade(s, self.stock, self.strat(), {}, {'cot': gate})
        self.assertNotEqual(s['tier'], 'A')
        self.assertIn('cot_missing', s['whyCodes'])
        ok = self.setup()
        scanner.grade(ok, self.stock, self.strat(), {}, {'cot': {**gate, 'series': [('2026-10-13', 90.0)]}})
        self.assertEqual(ok['tier'], 'A')
        reading_only = self.setup(cot=None)
        scanner.grade(reading_only, self.stock, self.strat(), {})  # COT failed the edge study: a reading only
        self.assertEqual(reading_only['tier'], 'A')

    def test_lab_strategy_needs_a_forward_record(self):
        s = self.setup('lab_swing_x')
        scanner.grade(s, self.stock, {**self.strat(trades=12), 'lab': True, 'forward': {'since': '2026-09-01'}}, {})
        self.assertEqual(s['tier'], 'B')
        self.assertIn('lab_forward', s['whyCodes'])
        s2 = self.setup('lab_swing_x')
        scanner.grade(s2, self.stock, {**self.strat(trades=0), 'stats': {'trades': 0, 'winRate': None, 'profitFactor': None, 'expectancy': None}, 'lab': True, 'forward': {'since': '2026-09-01'}}, {})
        self.assertEqual(s2['tier'], 'C')

    def test_hourly_cap_and_robustness(self):
        s = self.setup()
        scanner.grade(s, self.stock, self.strat(), {}, {'shortCap': {'days': 250}})
        self.assertEqual(s['tier'], 'B')
        self.assertIn('short_history', s['whyCodes'])
        r = self.setup()
        scanner.grade(r, self.stock, {**self.strat(), 'robust': {'costs': False, 'halves': True}}, {})
        self.assertEqual(r['tier'], 'B')
        self.assertIn('cost_sensitive', r['whyCodes'])

    def test_lab_trades_before_first_shown_are_not_counted(self):
        bars = test_engine.random_walk(700, seed=12)
        since = bars[500]['time']
        sig = lambda ind, i: {'dir': 1, 'reasons': ['x']} if i % 7 == 0 else None  # noqa: E731
        plan = lambda ind, i, d: {'entry': 'open', 'trigger': ind['closes'][i], 'validDays': 1, 'stop': ind['closes'][i] * 0.9, 'target': None,  # noqa: E731
                                  'maxHold': 3, 'breakEvenAtR': None, 'exit': None, 'targetNote': '', 'exitRule': ''}
        st.STRATEGIES['lab_swing_test'] = {'name': 'Lab: test', 'short': 'Lab: test', 'lab': True, 'horizon_only': 'swing', 'since': since,
                                           'sinceDate': '2025', 'sides': (1,), 'signal': sig, 'plan': plan}
        try:
            per = [scanner.analyse_symbol('T', bars, None, None, ['lab_swing_test'])]
            stats = scanner.strategy_stats(per, 'swing')
        finally:
            del st.STRATEGIES['lab_swing_test']
        all_trades = per[0]['trades']['lab_swing_test']
        forward = [t for t in all_trades if t['time'] > since]
        self.assertGreater(len(all_trades), len(forward))
        self.assertEqual(stats['lab_swing_test']['sides']['long']['stats']['trades'], len(forward))


class Robustness(unittest.TestCase):
    def test_edge_only_in_first_half_fails_the_halves_tick(self):
        t0 = int(dt.datetime(2020, 1, 6, 5, tzinfo=UTC).timestamp())
        per = [{'symbol': 'A', 'len': 1000, 'hard': {'k': []},
                'trades': {'k': [{'signal': i, 'time': t0 + i * 86400, 'dir': 1, 'ret': 0.01 if i < 500 else -0.004, 'r': 0, 'reason': 'x', 'bars': 3}
                                 for i in range(0, 1000, 10)]}}]
        rob = scanner._robust(per, 'k', 1, 'week')
        self.assertFalse(rob['halves'])
        self.assertFalse(rob['costs'])  # no trades at double costs given


class LookAhead(unittest.TestCase):
    """Every rule version (production and the ones the rule tests compare) uses only bars up to the signal."""

    def test_variants_never_use_future_bars(self):
        bars = test_engine.random_walk(900, seed=21)
        cut = 650
        changed = bars[:cut] + [dict(b, close=b['close'] * 3, high=b['high'] * 3, low=b['low'] * 3, open=b['open'] * 3) for b in bars[cut:]]
        variants = [('weekly_swing', {'turn': t, 'trend': tr, 'exit': e}) for t in ('buystop', 'zturn', 'willr', 'current')
                    for tr in ('none', 'ma200', 'htf10', 'htf10band') for e in ('target', 'trail')][::3]
        variants += [('mean_reversion', {'stretch': x, 'trend': 'ma200'}) for x in ('z', 'both')] + [('breakout', {'kind': k, 'trend': 'ma200'}) for k in ('high250', 'high50', 'old')]
        for key, spec in variants:
            strat = st.make_strategy(key, spec)
            early = lambda bs: [t for t in st.trades_for(st.prepare(bs), strat) if t['exit'] < cut]  # noqa: E731
            self.assertEqual(early(bars), early(changed), (key, spec))

    def test_hourly_trend_uses_the_previous_day(self):
        hours = sy.market(2, 7 * 300, 3, hourly=True)['S000']
        ind = st.prepare(hours, None, 'short')
        a = st.trend_array(ind, 'ma200')
        cut = 7 * 250 + 3  # mid-day
        changed = hours[:cut] + [dict(b, close=b['close'] * 2) for b in hours[cut:]]
        b = st.trend_array(st.prepare(changed, None, 'short'), 'ma200')
        day_start = 7 * 250
        self.assertEqual(a[:day_start + 7], b[:day_start + 7])  # the rest of that day still uses yesterday's close


class RuleTests(unittest.TestCase):
    def test_report_shape_and_simplest_winner(self):
        m = sy.market(8, 900, 5, reversal=0.06)
        inds = {k: st.prepare(v) for k, v in m.items() if k != 'QQQ'}
        rep = ruletests.run(inds, 'swing', st.market_regimes(m['QQQ']), None, runs=20)
        self.assertIn('turn', rep['questions'])
        self.assertIn('weekly_swing:long', rep['robustness'])
        self.assertIn('chosen', rep)
        rows = [{'id': 'simple', 'trades': 50, 'expectancy': 0.001, 'excess': 0.001, 'tStat': 1.0, 'survives': False},
                {'id': 'complex', 'trades': 50, 'expectancy': 0.0015, 'excess': 0.0015, 'tStat': 1.5, 'survives': False}]
        self.assertEqual(ruletests._as_good(rows)['id'], 'simple')  # within one standard error: the simpler one


class ReviewFixes(unittest.TestCase):
    def test_pullback_z_check_never_fails_a_valid_signal(self):
        for z in (-1.3, -1.1, -0.7):
            s = Grades().setup()
            s['indicators']['z'] = z
            scanner.grade(s, Grades.stock, Grades().strat(), {})
            self.assertEqual(s['tier'], 'A', z)
            self.assertIsNone(next(c for c in s['checks'] if c['label'] == 'Z-score')['ok'])

    def test_lab_forward_record_halves_split_by_time(self):
        t0 = int(dt.datetime(2026, 1, 5, 5, tzinfo=UTC).timestamp())
        trades = [{'signal': 3900 + i, 'time': t0 + i * 7 * 86400, 'dir': 1, 'ret': 0.01, 'r': 0.3, 'reason': 'x', 'bars': 3} for i in range(40)]
        per = [{'symbol': 'A', 'len': 4000, 'hard': {'k': trades}, 'trades': {'k': trades}}]
        rob = scanner._robust(per, 'k', 1, 'week', since=t0 - 1)
        self.assertTrue(rob['halves'])
        self.assertEqual((rob['firstHalf']['trades'], rob['secondHalf']['trades']), (20, 20))

    def test_dated_history_rows_are_pruned(self):
        from engine import core
        disk = core.DiskCache(scanner.Path(test_engine._TMP) / 'prune.db')
        for key in ("(('scan-daily-15y', '2026-10-20'), 'AAPL')", "(('scan-weekly', '2026-10-20'), 'AAPL')", "('scan-daily-15y', 'AAPL')", "('cot-long', '209742')"):
            disk.put(key, 1.0, [1])
        self.assertEqual(scanner.prune_old_cache(disk), 2)
        self.assertIsNotNone(disk.get("('scan-daily-15y', 'AAPL')"))
        self.assertIsNotNone(disk.get("('cot-long', '209742')"))
        self.assertLessEqual(scanner._until_tomorrow(), 20 * 3600)

    def test_worker_process_runs_a_job(self):
        import asyncio
        old = scanner.USE_PROCESSES
        scanner.USE_PROCESSES = True
        try:
            t = int(dt.datetime(2026, 10, 21, 5, tzinfo=UTC).timestamp())
            self.assertEqual(asyncio.run(scanner._offload('scan', 'week_of', t)), '2026-W43')
            self.assertEqual(set(scanner._pools), {'scan'})
        finally:
            scanner.shutdown()
            scanner.USE_PROCESSES = old


if __name__ == '__main__':
    unittest.main()
