"""Optimiser goals: each goal's maths on small known cases, the advanced limits, Black-Litterman and determinism."""
import asyncio
import datetime as dt
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np  # noqa: E402

from engine import quant  # noqa: E402

quant.USE_PROCESSES = False


def _returns(n=4, t=900, seed=3, mean=4e-4, rho=0.3):
    rng = np.random.default_rng(seed)
    vols = np.linspace(0.005, 0.02, n)
    corr = rho + (1 - rho) * np.eye(n)
    return rng.multivariate_normal(np.full(n, mean), corr * np.outer(vols, vols), t)


def _vol(w, cov):
    return float(np.sqrt(w @ cov @ w))


FREE = [(0.0, 1.0)] * 4


class GoalMathsTest(unittest.TestCase):
    def test_min_variance_two_asset_closed_form(self):
        s1, s2, rho = 0.2, 0.1, 0.3
        c12 = rho * s1 * s2
        cov = np.array([[s1 ** 2, c12], [c12, s2 ** 2]])
        w = quant.min_variance(cov, [(0, 1), (0, 1)])
        w1 = (s2 ** 2 - c12) / (s1 ** 2 + s2 ** 2 - 2 * c12)
        np.testing.assert_allclose(w, [w1, 1 - w1], atol=1e-5)

    def test_equal_risk_contributions(self):
        cov = quant.ledoit_wolf(_returns())[0] * 252
        w = quant.risk_parity(cov, FREE)
        rc = w * (cov @ w) / (w @ cov @ w)
        np.testing.assert_allclose(rc, 0.25, atol=1e-4)

    def test_hrp_orders_similar_holdings_together(self):
        # 0 and 2 move together, 1 and 3 move together; the two pairs barely relate.
        rng = np.random.default_rng(5)
        a, b = rng.normal(0, 0.01, (2, 1000))
        r = np.column_stack([a + rng.normal(0, 0.002, 1000), b + rng.normal(0, 0.002, 1000), a + rng.normal(0, 0.002, 1000), b + rng.normal(0, 0.002, 1000)])
        cov = np.cov(r.T)
        order = quant.hrp_order(cov)
        pos = {j: k for k, j in enumerate(order)}
        self.assertEqual(abs(pos[0] - pos[2]), 1)
        self.assertEqual(abs(pos[1] - pos[3]), 1)
        w = quant.hrp(cov)
        self.assertAlmostEqual(w.sum(), 1)
        self.assertTrue((w > 0).all())

    def test_hrp_inverse_variance_when_uncorrelated(self):
        cov = np.diag([0.04, 0.01, 0.09, 0.0225])
        w = quant.hrp(cov)
        iv = 1 / np.diag(cov)
        np.testing.assert_allclose(w, iv / iv.sum(), atol=1e-9)

    def test_max_diversification_is_inverse_volatility_when_uncorrelated(self):
        sd = np.array([0.1, 0.2, 0.3, 0.4])
        w = quant.max_diversification(np.diag(sd ** 2), FREE)
        np.testing.assert_allclose(w, (1 / sd) / (1 / sd).sum(), atol=1e-4)

    def test_min_cvar_feasible_and_below_equal_weight(self):
        scen = quant.scenarios(_returns(t=900, seed=8))
        bounds = [(0.0, 0.5)] * 4
        w = quant.min_cvar(scen, bounds)
        self.assertAlmostEqual(w.sum(), 1)
        self.assertTrue((w >= -1e-9).all() and (w <= 0.5 + 1e-9).all(), w)
        self.assertLess(quant.cvar(-scen @ w), quant.cvar(-scen @ np.full(4, 0.25)))

    def test_cvar_is_the_average_of_the_worst_tail(self):
        losses = np.arange(1, 101, dtype=float)  # worst 5 of 100: 96..100
        self.assertAlmostEqual(quant.cvar(losses), 98.0)

    def test_target_volatility_hits_the_target(self):
        cov = np.diag([0.05, 0.10, 0.15, 0.25]) ** 2
        mu = np.array([0.01, 0.03, 0.05, 0.08])
        base = quant.min_variance(cov, FREE)
        target = 0.10
        self.assertLess(_vol(base, cov), target)
        w = quant.max_at_volatility(mu, cov, target, FREE)
        self.assertAlmostEqual(_vol(w, cov), target, places=3)
        self.assertGreater(mu @ w, mu @ base)

    def test_target_volatility_below_the_lowest_gives_min_variance(self):
        cov = np.diag([0.05, 0.10, 0.15, 0.25]) ** 2
        w = quant.max_at_volatility(np.ones(4), cov, 0.001, FREE)
        np.testing.assert_allclose(w, quant.min_variance(cov, FREE), atol=1e-6)

    def test_income_stays_under_the_volatility_cap(self):
        r = _returns(seed=9)
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'yields': np.array([0.0, 0.01, 0.02, 0.06]), 'volCap': 0.15}
        w = quant.fit(r, 'income', o, np.random.default_rng(1))
        cov = quant.ledoit_wolf(r)[0] * 252
        self.assertLessEqual(_vol(w, cov), 0.15 * 1.005)
        eq = np.full(4, 0.25)
        self.assertGreater(o['yields'] @ w, o['yields'] @ eq)

    def test_tracking_error_near_zero_when_benchmark_is_investable(self):
        r = _returns(seed=10)
        bench = r @ np.array([0.5, 0.3, 0.2, 0.0])
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'bench': True, 'teBudget': 0}
        w = quant.fit(np.column_stack([r, bench]), 'track', o, np.random.default_rng(1))
        te = (r @ w - bench).std() * np.sqrt(252)
        self.assertLess(te, 1e-3)
        np.testing.assert_allclose(w, [0.5, 0.3, 0.2, 0.0], atol=0.01)

    def test_tracking_budget_is_kept(self):
        r = _returns(seed=10)
        bench = r @ np.array([0.5, 0.3, 0.2, 0.0])
        o = {'rf': 0.0, 'lo': 0, 'hi': 1, 'bench': True, 'teBudget': 0.03, 'estimate': 'equilibrium'}
        w = quant.fit(np.column_stack([r, bench]), 'track', o, np.random.default_rng(1))
        te = (r @ w - bench).std(ddof=1) * np.sqrt(252)
        self.assertLessEqual(te, 0.03 * 1.02)
        self.assertGreater(te, 0.005)  # it uses the budget to reach for return

    def test_every_goal_sums_to_one_within_bounds(self):
        r = _returns(seed=11)
        bench = r.mean(axis=1)
        o = {'rf': 0.04, 'lo': 0, 'hi': 0.4, 'bench': True, 'yields': np.array([0.01, 0.02, 0.0, 0.03]), 'runs': 5}
        for goal in quant.GOALS:
            w = quant.fit(np.column_stack([r, bench]), goal, o, np.random.default_rng(1))
            self.assertAlmostEqual(w.sum(), 1, msg=goal)
            self.assertTrue((w >= -1e-9).all() and (w <= 0.4 + 1e-6).all(), (goal, w))


class LimitsTest(unittest.TestCase):
    def setUp(self):
        self.r = _returns(n=5, seed=12)

    def test_per_holding_min_and_max(self):
        o = {'rf': 0.04, 'loEach': np.array([0.3, 0, 0, 0, 0]), 'hiEach': np.array([1, 0.1, 1, 1, 1])}
        for goal in ('min_var', 'risk_parity', 'hrp', 'min_cvar', 'growth'):
            w = quant.fit(self.r, goal, {**o, 'runs': 5}, np.random.default_rng(1))
            self.assertGreaterEqual(w[0], 0.3 - 1e-6, goal)
            self.assertLessEqual(w[1], 0.1 + 1e-6, goal)

    def test_sector_cap(self):
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'sectors': ['Tech', 'Tech', 'Tech', 'Energy', 'Fund'], 'sectorCap': 0.4, 'runs': 5}
        for goal in ('min_var', 'risk_parity', 'hrp', 'max_div', 'min_cvar', 'growth'):
            w = quant.fit(self.r, goal, o, np.random.default_rng(1))
            self.assertLessEqual(w[:3].sum(), 0.4 + 1e-4, (goal, w))
            self.assertAlmostEqual(w.sum(), 1)

    def test_impossible_sector_cap_is_loosened(self):
        o = {'sectors': ['A', 'A', 'B', 'B', 'B'], 'sectorCap': 0.3}
        self.assertAlmostEqual(quant.sector_cap(o), 0.5)
        self.assertAlmostEqual(quant.sector_cap({**o, 'sectorCap': 0.7}), 0.7)

    def test_minimum_cash_as_a_floor(self):
        o = {'rf': 0.04, 'loEach': np.array([0, 0, 0, 0, 0.15]), 'hiEach': np.ones(5)}
        w = quant.fit(self.r, 'growth', {**o, 'runs': 5}, np.random.default_rng(1))
        self.assertGreaterEqual(w[4], 0.15 - 1e-6)

    def test_max_holdings_drops_the_smallest_and_refits(self):
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'maxHoldings': 2}
        w = quant.fit(self.r, 'risk_parity', o, np.random.default_rng(1))
        self.assertEqual(int((w > 1e-4).sum()), 2)
        self.assertAlmostEqual(w.sum(), 1)

    def test_max_holdings_keeps_fixed_cash(self):
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'maxHoldings': 2, 'fixed': {4: 0.1}}
        w = quant.fit(self.r, 'risk_parity', o, np.random.default_rng(1))
        self.assertAlmostEqual(w[4], 0.1)
        self.assertEqual(int((w[:4] > 1e-4).sum()), 2)

    def test_total_turnover_limit(self):
        cur = np.array([0.6, 0.1, 0.1, 0.1, 0.1])
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'cur': cur, 'maxTurnover': 0.15}
        free = quant.fit(self.r, 'min_var', {**o, 'maxTurnover': None}, np.random.default_rng(1))
        self.assertGreater(quant.turnover(free, cur), 0.15)
        w = quant.fit(self.r, 'min_var', o, np.random.default_rng(1))
        self.assertLessEqual(quant.turnover(w, cur), 0.15 + 1e-4)
        self.assertAlmostEqual(w.sum(), 1)

    def test_turnover_with_sector_cap(self):
        cur = np.array([0.2, 0.2, 0.0, 0.3, 0.3])
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'cur': cur, 'maxTurnover': 0.1, 'sectors': ['T', 'T', 'T', 'E', 'F'], 'sectorCap': 0.45}
        w = quant.fit(self.r, 'min_var', o, np.random.default_rng(1))
        self.assertLessEqual(quant.turnover(w, cur), 0.1 + 1e-4)
        self.assertLessEqual(w[:3].sum(), 0.45 + 1e-4)


class ReturnEstimateTest(unittest.TestCase):
    def test_black_litterman_without_views_is_the_prior(self):
        cov = quant.ledoit_wolf(_returns())[0] * 252
        prior = np.full(4, 0.25)
        np.testing.assert_allclose(quant.black_litterman(cov, prior, [], list('ABCD')), 2.5 * cov @ prior)
        r = _returns()
        np.testing.assert_allclose(quant.expected_excess(r, cov, 0.04, [], list('ABCD'), 'views'), 2.5 * cov @ prior)
        np.testing.assert_allclose(quant.expected_excess(r, cov, 0.04, [], list('ABCD'), 'equilibrium'), 2.5 * cov @ prior)

    def test_a_confident_view_moves_toward_it(self):
        cov = quant.ledoit_wolf(_returns())[0] * 252
        prior = quant.black_litterman(cov, np.full(4, 0.25), [], list('ABCD'))
        post = quant.black_litterman(cov, np.full(4, 0.25), [{'symbol': 'A', 'return': 0.2, 'confidence': 0.9}], list('ABCD'))
        self.assertGreater(post[0], prior[0])
        self.assertLess(post[0], 0.2)


class EvidenceTest(unittest.TestCase):
    def test_costs_lower_walk_forward_returns(self):
        r = _returns(t=1300)
        rng = np.random.default_rng(1)
        o = {'rf': 0.04, 'lo': 0, 'hi': 1}
        free, _, turn = quant.walk_forward(r, lambda p: quant.fit(p, 'min_var', o, rng), 252, 63)
        paid, _, _ = quant.walk_forward(r, lambda p: quant.fit(p, 'min_var', o, rng), 252, 63, cost=0.01)
        self.assertGreater(turn, 0)
        self.assertLess(np.prod(1 + paid), np.prod(1 + free))

    def test_lookback_sets_the_test_window(self):
        self.assertEqual(quant.test_window(10 * 252, 252, 21), (252, 21, False))
        self.assertEqual(quant.test_window(10 * 252, 10 * 252, 63), (quant.WINDOW, 63, False))  # nothing left to test: 3 years

    def test_every_goal_has_evidence_and_repeats_with_the_seed(self):
        r = _returns(n=3, t=1300, seed=6)
        bench = r.mean(axis=1)
        R = np.column_stack([r, bench])
        cur = np.array([0.5, 0.3, 0.2])
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'bench': True, 'yields': np.array([0.02, 0.0, 0.01]), 'cost': 0.001, 'lookback': 756}
        with mock.patch.object(quant, 'RW_RUNS', 3), mock.patch.object(quant, 'RESAMPLES', 10):
            a = quant.run_optimizer(R, cur, 'hrp', o, stability_runs=5)
            b = quant.run_optimizer(R, cur, 'hrp', o, stability_runs=5)
        self.assertEqual([g['key'] for g in a['goals']], list(quant.GOALS))
        self.assertEqual([x['key'] for x in a['walkForward']['rows']], ['current', 'equal', *quant.GOALS])
        for g in a['goals']:
            self.assertIsNotNone(g['randomWalk'], g['key'])
            self.assertEqual(len(g['stability']['low']), 3)
            self.assertAlmostEqual(sum(g['riskContributions']), 1, places=3)
            for k in ('expectedReturn', 'volatility', 'yield', 'maxDrawdown', 'cvar', 'trackingError'):
                self.assertIsNotNone(g[k], (g['key'], k))
        np.testing.assert_allclose(a['weights'], b['weights'])
        self.assertEqual(a['walkForward'], b['walkForward'])
        self.assertEqual([g['randomWalk'] for g in a['goals']], [g['randomWalk'] for g in b['goals']])
        hrp = next(g for g in a['goals'] if g['key'] == 'hrp')
        np.testing.assert_allclose(a['weights'], hrp['weights'], atol=1e-4)
        vols = [p['volatility'] for p in a['frontier']]
        self.assertEqual(vols, sorted(vols))
        self.assertGreaterEqual(len(a['frontier']), 3)

    def test_goal_job_order_does_not_change_results(self):
        r = _returns(n=3, t=1300, seed=6)
        cur = np.array([0.5, 0.3, 0.2])
        o = {'rf': 0.04, 'lo': 0, 'hi': 1}
        with mock.patch.object(quant, 'RW_RUNS', 2):
            one = quant.goal_job(r, cur, 'min_cvar', o, 7, None, 5)
            quant.goal_job(r, cur, 'growth', o, 7, None, 5)
            two = quant.goal_job(r, cur, 'min_cvar', o, 7, None, 5)
        np.testing.assert_allclose(one['weights'], two['weights'])
        self.assertEqual(one['randomWalk'], two['randomWalk'])


class HandlerGoalsTest(unittest.TestCase):
    def test_advanced_settings_reach_the_goals(self):
        r = _returns(n=3, t=1300, seed=2)
        start = dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc)
        spy = r.mean(axis=1)
        series = {'AAA': r[:, 0], 'BBB': r[:, 1], 'BIL': r[:, 2] * 0.05, 'SPY': spy, 'AGG': r[:, 2] * 0.3}
        divs = {'AAA': {dt.date.today() - dt.timedelta(days=30 + 91 * k): 0.5 for k in range(8)}}

        class Ctx:
            async def daily_bars(self, s, years):
                closes = 100 * np.cumprod(1 + series[s])
                return [{'time': int((start + dt.timedelta(days=i)).timestamp()), 'close': float(c)} for i, c in enumerate(closes)]

            async def dividends(self, s):
                return divs.get(s, {})

        async def rf(ctx):
            return 0.04

        async def sectors(ctx, symbols, cash):
            return [None if s in cash else 'Tech' for s in symbols], []

        events = []

        async def emit(e):
            events.append(e['text'])

        msg = {'holdings': [{'symbol': 'AAA', 'weight': 50}, {'symbol': 'BBB', 'weight': 40}, {'symbol': 'BIL', 'weight': 10, 'cash': True}],
               'method': 'track', 'trackBenchmark': {'kind': '6040'}, 'teBudget': 0, 'minCash': 0.2, 'maxWeight': 1, 'lookback': 1,
               'testRebalance': 'monthly', 'cost': 0.002, 'sectorCap': 0.3, '_emit': emit}
        with mock.patch.object(quant, 'risk_free', rf), mock.patch.object(quant, 'holding_sectors', sectors), \
                mock.patch.object(quant, 'RW_RUNS', 2), mock.patch.object(quant, 'STABILITY_RUNS', 5), mock.patch.object(quant, 'RESAMPLES', 5):
            out = asyncio.run(quant.optimize(Ctx(), msg))
        self.assertEqual(out['goal'], 'track')
        self.assertEqual(out['symbols'], ['AAA', 'BBB', 'BIL'])  # benchmark parts never become holdings
        self.assertAlmostEqual(out['weights'][2], 0.2, places=3)  # cash raised to the minimum and held
        self.assertEqual(out['settings']['benchmark'], '60/40 (SPY + AGG)')
        self.assertEqual(out['settings']['lookbackYears'], 1)
        self.assertEqual(out['walkForward']['stepDays'], 21)
        self.assertAlmostEqual(out['walkForward']['windowYears'], 1)
        self.assertGreater(out['yields'][0], 0)
        self.assertEqual(out['yields'][1], 0.0)  # no dividends: a 0% yield
        self.assertTrue(any('Cash raised' in n for n in out['notes']))
        self.assertTrue(any('loosened' in n for n in out['notes']))  # one sector can't be capped at 30%
        self.assertIn('Tested 9 of 9 goals on data they hadn’t seen', events)
        self.assertIn('Testing 9 goals on 1 processor core (about 3 minutes)', events)
        self.assertTrue(out['walkForward']['oosStart'] < out['walkForward']['oosEnd'])
        self.assertTrue(all(g['trackingError'] is not None for g in out['goals']))
        self.assertGreater(len(out['frontier']), 2)

    def test_old_views_method_is_growth_with_views(self):
        r = _returns(n=2, t=400, seed=2)
        start = dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc)

        class Ctx:
            async def daily_bars(self, s, years):
                col = {'AAA': 0, 'BBB': 1}.get(s)
                if col is None:
                    raise KeyError(s)
                closes = 100 * np.cumprod(1 + r[:, col])
                return [{'time': int((start + dt.timedelta(days=i)).timestamp()), 'close': float(c)} for i, c in enumerate(closes)]

            async def dividends(self, s):
                return {}

        async def rf(ctx):
            return 0.04

        msg = {'holdings': [{'symbol': 'AAA', 'weight': 50}, {'symbol': 'BBB', 'weight': 50}], 'method': 'black_litterman',
               'views': [{'symbol': 'AAA', 'return': 0.3, 'confidence': 0.9}], 'maxWeight': 1}
        with mock.patch.object(quant, 'risk_free', rf), mock.patch.object(quant, 'STABILITY_RUNS', 5), mock.patch.object(quant, 'RESAMPLES', 5):
            out = asyncio.run(quant.optimize(Ctx(), msg))
        self.assertEqual(out['goal'], 'growth')
        self.assertEqual(out['settings']['estimate'], 'views')
        self.assertGreater(out['weights'][0], 0.5)
        self.assertIsNone(out['walkForward'])  # ~1.6 years: too short to test


class ReviewFixesTest(unittest.TestCase):
    def test_holm_adjustment(self):
        self.assertEqual(quant.holm([0.01, 0.04, 0.03, 0.5]), [0.04, 0.09, 0.09, 0.5])
        self.assertEqual(quant.holm([1.0]), [1.0])

    def test_sharpe_difference_paired_and_seeded(self):
        r = _returns(n=2, t=800, seed=4)
        d, se = quant.sharpe_difference(r[:, 0], r[:, 0], 0.04, np.random.default_rng(1), runs=50)
        self.assertEqual((d, se), (0.0, 0.0))  # the same series: no difference at all
        a = quant.sharpe_difference(r[:, 0], r[:, 1], 0.04, np.random.default_rng(1), runs=50)
        b = quant.sharpe_difference(r[:, 0], r[:, 1], 0.04, np.random.default_rng(1), runs=50)
        self.assertEqual(a, b)
        self.assertGreater(a[1], 0)

    def test_default_max_weight(self):
        self.assertEqual(quant.default_max_weight(2), 0.5)
        self.assertEqual(quant.default_max_weight(5), 0.4)
        self.assertEqual(quant.default_max_weight(20), 0.25)

    def test_same_weights_merge_into_the_first_goal(self):
        w = np.array([0.5, 0.5])
        res = [{'key': 'min_var', 'weights': w}, {'key': 'target_vol', 'weights': w + 0.001}, {'key': 'income', 'weights': np.array([0.2, 0.8])}]
        self.assertEqual(quant.same_as(res), {'target_vol': 'min_var'})

    def test_unreachable_target_volatility_is_noted(self):
        r = _returns(seed=9)
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'targetVol': 0.01}
        with mock.patch.object(quant, 'RW_RUNS', 1):
            job = quant.goal_job(r, np.full(4, 0.25), 'target_vol', o, 7, None, 3)
        self.assertTrue(any('lowest-volatility mix is used' in n for n in job['notes']), job['notes'])
        mv = quant.goal_job(r, np.full(4, 0.25), 'min_var', o, 7, None, 3)
        self.assertEqual(mv['notes'], [])

    def test_scaled_limits_are_noted(self):
        r = _returns(seed=9)
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'loEach': np.array([0.5, 0.5, 0.5, 0.0]), 'maxHoldings': 1}
        with mock.patch.object(quant, 'RW_RUNS', 1):
            job = quant.goal_job(r, np.full(4, 0.25), 'min_var', o, 7, None, 3)
        self.assertTrue(any('minimum weights add up' in n for n in job['notes']), job['notes'])

    def test_compare_evidence_vs_even_risk_and_holm(self):
        r = _returns(n=3, t=1300, seed=6)
        o = {'rf': 0.04, 'lo': 0, 'hi': 1, 'yields': np.array([0.02, 0.0, 0.01])}
        with mock.patch.object(quant, 'RW_RUNS', 3), mock.patch.object(quant, 'RESAMPLES', 5), mock.patch.object(quant, 'SE_RUNS', 20):
            out = quant.run_optimizer(r, np.array([0.5, 0.3, 0.2]), 'risk_parity', o, stability_runs=3)
        by = {g['key']: g for g in out['goals']}
        self.assertIsNone(by['risk_parity']['vsEvenRisk'])
        self.assertGreater(by['min_var']['vsEvenRisk']['se'], 0)
        family = by['risk_parity']['randomWalk']['family']
        self.assertEqual(family, sum(1 for g in out['goals'] if not g['sameAs']))
        for g in out['goals']:
            self.assertGreaterEqual(g['randomWalk']['pAdjusted'], g['randomWalk']['p'] - 1e-12)
            if g['sameAs']:
                self.assertEqual(g['randomWalk']['pAdjusted'], by[g['sameAs']]['randomWalk']['pAdjusted'])


if __name__ == '__main__':
    unittest.main()
