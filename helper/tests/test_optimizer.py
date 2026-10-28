"""Portfolio optimiser: shrinkage, risk parity, resampling, walk-forward and the cash/no-new-symbols rules."""
import asyncio
import datetime as dt
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np  # noqa: E402

from engine import quant  # noqa: E402

quant.USE_PROCESSES = False  # goals run in threads here, so the patched constants apply


def _returns(n=4, t=900, seed=3):
    rng = np.random.default_rng(seed)
    vols = np.linspace(0.005, 0.02, n)
    corr = 0.3 + 0.7 * np.eye(n)
    cov = corr * np.outer(vols, vols)
    return rng.multivariate_normal(np.full(n, 4e-4), cov, t)


class LedoitWolfTest(unittest.TestCase):
    def test_hand_case(self):
        x = np.array([[0.01, 0.02], [-0.01, 0.00], [0.03, 0.01], [-0.03, -0.03]])
        # By hand: demean, S = X'X/t, target = mean variance x I, d2 = ||S-F||^2, b2 = mean ||x x' - S||^2 / t.
        d = x - x.mean(axis=0)
        s = d.T @ d / 4
        f = np.trace(s) / 2 * np.eye(2)
        d2 = ((s - f) ** 2).sum()
        b2 = sum(((np.outer(r, r) - s) ** 2).sum() for r in d) / 16
        delta = min(b2, d2) / d2
        cov, shrink = quant.ledoit_wolf(x)
        self.assertAlmostEqual(shrink, delta)
        np.testing.assert_allclose(cov, delta * f + (1 - delta) * s)
        self.assertTrue(0 < shrink < 1)


class MethodsTest(unittest.TestCase):
    def test_risk_parity_equalises_risk(self):
        cov = quant.ledoit_wolf(_returns())[0] * 252
        w = quant.risk_parity(cov, [(0, 1)] * 4)
        rc = w * (cov @ w) / (w @ cov @ w)
        np.testing.assert_allclose(rc, 0.25, atol=1e-4)
        self.assertAlmostEqual(w.sum(), 1)

    def test_resampled_weights_in_bounds_and_sum_to_one(self):
        o = {'rf': 0.04, 'lo': 0.0, 'hi': 0.3, 'runs': 20}
        w = quant.fit(_returns(), 'growth', o, np.random.default_rng(1))
        self.assertAlmostEqual(w.sum(), 1)
        self.assertTrue((w >= -1e-9).all() and (w <= 0.3 + 1e-6).all(), w)

    def test_max_change_limits_each_move(self):
        cur = np.array([0.7, 0.1, 0.1, 0.1])
        w = quant.fit(_returns(), 'min_var', {'rf': 0.04, 'lo': 0, 'hi': 1, 'cur': cur, 'maxChange': 0.1}, np.random.default_rng(1))
        self.assertTrue((np.abs(w - cur) <= 0.1 + 1e-6).all(), w)

    def test_cash_stays_fixed(self):
        o = {'rf': 0.04, 'lo': 0, 'hi': 0.5, 'fixed': {3: 0.2}}
        for method in ('min_var', 'risk_parity', 'equal'):
            w = quant.fit(_returns(), method, o, np.random.default_rng(1))
            self.assertAlmostEqual(w[3], 0.2)
            self.assertAlmostEqual(w.sum(), 1)


class WalkForwardTest(unittest.TestCase):
    def test_uses_only_past_data(self):
        r = _returns(t=800)
        fit = lambda past: quant.fit(past, 'min_var', {'rf': 0.04, 'lo': 0, 'hi': 1}, np.random.default_rng(1))
        _, ws, _ = quant.walk_forward(r, fit, window=400, step=100)
        changed = r.copy()
        changed[600:] *= -5  # rewrite the future after day 600
        _, ws2, _ = quant.walk_forward(changed, fit, window=400, step=100)
        for a, b in zip(ws[:3], ws2[:3]):  # fits at days 400, 500, 600 never saw day 600 onward
            np.testing.assert_allclose(a, b)
        self.assertFalse(np.allclose(ws[3], ws2[3]))

    def test_constant_weights_match_buy_and_hold_per_quarter(self):
        r = _returns(t=500)
        port, _, turnover = quant.walk_forward(r, lambda past: np.full(4, 0.25), window=300, step=100)
        self.assertEqual(len(port), 200)
        seg = np.cumprod(1 + r[300:400], axis=0) @ np.full(4, 0.25)
        self.assertAlmostEqual(np.prod(1 + port[:100]), seg[-1])
        self.assertGreater(turnover, 0)  # drift back to equal weights


def _series(returns, start, value=100.0):
    """{date: value} from daily returns, one entry per calendar day from `start`."""
    v = value * np.concatenate([[1.0], np.cumprod(1 + returns)])
    return {start + dt.timedelta(days=i): float(x) for i, x in enumerate(v)}


class StandInTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(5)
        self.start = dt.date(2016, 1, 1)
        self.market = rng.normal(4e-4, 0.01, 3000)
        self.noise = rng.normal(0, 0.008, 3000)
        self.spy = _series(self.market, self.start)
        self.gld = _series(rng.normal(2e-4, 0.01, 3000), self.start)  # unrelated
        young = 1.3 * self.market[2500:] + self.noise[2500:]  # starts on day 2500 (~1.4 years of data)
        self.young_start = self.start + dt.timedelta(days=2500)
        self.young = _series(young, self.young_start, 50.0)

    def test_picks_most_correlated_above_threshold(self):
        symbol, corr, beta = quant.pick_stand_in(self.young, {'SPY': self.spy, 'GLD': self.gld})
        self.assertEqual(symbol, 'SPY')
        self.assertGreater(corr, 0.8)
        self.assertAlmostEqual(beta, 1.3, delta=0.1)

    def test_no_stand_in_below_correlation_or_overlap(self):
        self.assertIsNone(quant.pick_stand_in(self.young, {'GLD': self.gld}))
        short = {d: v for d, v in self.young.items() if d < self.young_start + dt.timedelta(days=200)}
        self.assertIsNone(quant.pick_stand_in(short, {'SPY': self.spy}))  # under a year of overlap

    def test_backfill_keeps_real_data_volatility_and_correlation(self):
        _, corr, beta = quant.pick_stand_in(self.young, {'SPY': self.spy})
        out = quant.backfill(self.young, self.spy, beta, self.start, seed=1)
        for d, v in self.young.items():
            self.assertEqual(out[d], v)  # real data untouched
        self.assertEqual(out, quant.backfill(self.young, self.spy, beta, self.start, seed=1))  # seeded
        days = sorted(out)
        self.assertEqual(days[0], self.start)
        est = [d for d in days if d <= self.young_start]
        real = [d for d in days if d >= self.young_start]
        est_r, real_r = quant._daily_returns(out, est), quant._daily_returns(out, real)
        self.assertLess(abs(est_r.std() / real_r.std() - 1), 0.15)  # residuals restore the real volatility
        est_corr = np.corrcoef(est_r, quant._daily_returns(self.spy, est))[0, 1]
        self.assertLess(abs(est_corr - corr), 0.1)  # like the overlap's correlation...
        self.assertLess(est_corr, 0.99)  # ...not a lockstep copy of the stand-in
        # No alpha: the estimate's average return is beta x the stand-in's (residuals are centred).
        self.assertLess(abs(est_r.mean() - beta * quant._daily_returns(self.spy, est).mean()), 0.0006)

    def test_extend_history_lists_stand_ins_and_left_out(self):
        rng = np.random.default_rng(9)
        odd = _series(rng.normal(0, 0.01, 500), self.start + dt.timedelta(days=2500))  # young, like nothing
        old = _series(1.3 * self.market + self.noise, self.start)  # owned, and moves even more like NEW than SPY does
        series = {'OLD': old, 'NEW': self.young, 'ODD': odd}
        ext, used, left = quant.extend_history(series, ['OLD', 'NEW', 'ODD'], {'GLD': self.gld, 'SPY': self.spy, **series})
        self.assertEqual([(u['symbol'], u['standIn']) for u in used], [('NEW', 'SPY')])  # never an owned holding
        self.assertEqual(used[0]['realStart'], self.young_start.isoformat())
        self.assertEqual([x['symbol'] for x in left], ['ODD'])
        self.assertEqual(min(ext['NEW']), self.start)
        self.assertIs(ext['ODD'], odd)

    def test_core_funds_tried_first(self):
        qqq = _series(self.market + np.random.default_rng(2).normal(0, 0.006, 3000), self.start)  # fits, less well than SPY
        series = {'OLD': self.gld, 'NEW': self.young}
        _, used, _ = quant.extend_history(series, ['OLD', 'NEW'], {'SPY': self.spy, 'QQQ': qqq}, core=('QQQ',))
        self.assertEqual(used[0]['standIn'], 'QQQ')
        _, used, _ = quant.extend_history(series, ['OLD', 'NEW'], {'SPY': self.spy, 'QQQ': qqq})
        self.assertEqual(used[0]['standIn'], 'SPY')


class ShortHistoryTest(unittest.TestCase):
    def test_adaptive_window(self):
        self.assertEqual(quant.test_window(5 * 252), (quant.WINDOW, quant.STEP, False))
        self.assertEqual(quant.test_window(3 * 252), (252, 21, True))
        self.assertIsNone(quant.test_window(int(2.4 * 252)))

    def test_walk_forward_runs_on_extended_history(self):
        real = _returns(t=380)  # ~1.5 years: too short alone
        o = {'rf': 0.04, 'lo': 0, 'hi': 1}
        cur = np.full(4, 0.25)
        with mock.patch.object(quant, 'RW_RUNS', 3):
            alone = quant.run_optimizer(real, cur, 'min_var', o, stability_runs=20)
            ext = quant.run_optimizer(real, cur, 'min_var', o, test=(_returns(t=1500), cur, o), stability_runs=20)
        self.assertIsNone(alone['walkForward'])
        self.assertFalse(ext['walkForward']['short'])
        np.testing.assert_allclose(alone['weights'], ext['weights'])  # weights come from the real history only

    def test_stability_ranges_seeded_and_sensible(self):
        r = _returns(t=400)
        o = {'rf': 0.04, 'lo': 0, 'hi': 1}
        a = quant.weight_stability(r, 'min_var', o, seed=3, runs=40)
        b = quant.weight_stability(r, 'min_var', o, seed=3, runs=40)
        self.assertEqual(a, b)
        low, high = np.array(a['low']), np.array(a['high'])
        self.assertTrue((low <= high).all() and (low >= 0).all() and (high <= 1).all())
        self.assertGreater((high - low).max(), 0.01)  # 1.5 years can't pin weights exactly
        eq = quant.weight_stability(r, 'equal', o, runs=10)
        self.assertEqual(eq['low'], eq['high'])
        self.assertFalse(any(a['pinned']))
        capped = quant.weight_stability(r, 'min_var', {**o, 'hi': 0.25}, runs=10)  # 4 holdings at max 25%: all held by the limit
        self.assertTrue(all(capped['pinned']))

    def test_real_only_table_when_real_history_is_long_enough(self):
        o = {'rf': 0.04, 'lo': 0, 'hi': 1}
        cur = np.full(4, 0.25)
        with mock.patch.object(quant, 'RW_RUNS', 2):
            r = quant.run_optimizer(_returns(t=700), cur, 'min_var', o, test=(_returns(t=1500, seed=4), cur, o), stability_runs=5)
        self.assertTrue(r['realOnly']['short'])
        self.assertFalse(r['walkForward']['short'])


class HandlerTest(unittest.TestCase):
    def test_no_new_symbols_and_cash_fixed(self):
        r = _returns(n=3, t=900)
        start = dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc)
        series = {s: np.concatenate([[100.0], 100 * np.cumprod(1 + r[:, j])]) for j, s in enumerate(['AAA', 'BBB', 'BIL'])}

        class Ctx:
            async def daily_bars(self, s, years):
                return [{'time': int((start + dt.timedelta(days=i)).timestamp()), 'close': float(c)} for i, c in enumerate(series[s])]

            async def dividends(self, s):
                return {}

        async def rf(ctx):
            return 0.04

        msg = {'holdings': [{'symbol': 'AAA', 'weight': 50}, {'symbol': 'BBB', 'weight': 30}, {'symbol': 'BIL', 'weight': 20, 'cash': True}], 'method': 'risk_parity', 'maxWeight': 1}
        with mock.patch.object(quant, 'risk_free', rf), mock.patch.object(quant, 'RW_RUNS', 5), mock.patch.object(quant, 'STABILITY_RUNS', 10):
            out = asyncio.run(quant.optimize(Ctx(), msg))
        self.assertEqual(out['symbols'], ['AAA', 'BBB', 'BIL'])
        self.assertEqual(out['cash'], ['BIL'])
        self.assertAlmostEqual(out['weights'][2], 0.2, places=3)
        self.assertAlmostEqual(sum(out['weights']), 1, places=3)
        self.assertEqual([x['key'] for x in out['walkForward']['rows']], ['current', 'equal', *quant.GOALS])
        self.assertEqual([g['key'] for g in out['goals']], list(quant.GOALS))
        self.assertTrue(0 < out['randomWalk']['p'] <= 1)
        self.assertIn(out['randomWalk']['runs'], (0, 5))  # 0 = no edge, so no shuffles needed

    def test_young_holding_gets_a_stand_in(self):
        rng = np.random.default_rng(4)
        market = rng.normal(4e-4, 0.01, 1600)
        start = dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc)
        series = {'OLD': (0, rng.normal(3e-4, 0.008, 1600)), 'SPY': (0, market), 'NEW': (1200, 1.2 * market + rng.normal(0, 0.003, 1600))}

        class Ctx:
            async def daily_bars(self, s, years):
                first, r = series[s]  # KeyError for the other stand-in ETFs: they're skipped
                closes = 100 * np.cumprod(1 + r[first:])
                return [{'time': int((start + dt.timedelta(days=first + i)).timestamp()), 'close': float(c)} for i, c in enumerate(closes)]

            async def dividends(self, s):
                return {}

            async def cached(self, key, max_age, load, persist=False, stale_ok=False):
                cached_keys.append((key, persist, stale_ok))
                return await load()

        async def rf(ctx):
            return 0.04

        events, cached_keys = [], []

        async def emit(e):
            events.append(e['text'])

        msg = {'holdings': [{'symbol': 'OLD', 'weight': 60}, {'symbol': 'NEW', 'weight': 40}], 'method': 'min_var', 'maxWeight': 1}
        with mock.patch.object(quant, 'risk_free', rf), mock.patch.object(quant, 'RW_RUNS', 3), mock.patch.object(quant, 'STABILITY_RUNS', 20):
            out = asyncio.run(quant.optimize(Ctx(), {**msg, '_emit': emit}))
            off = asyncio.run(quant.optimize(Ctx(), {**msg, 'standIns': False}))
        # SPY (a core fund) fits, so the wider list is never loaded; stand-ins are kept on disk.
        self.assertEqual(len(cached_keys), len(quant.CORE_STAND_INS))
        self.assertTrue(all(p and s for _, p, s in cached_keys))
        self.assertIn(f'Finding stand-ins 7/{len(quant.CORE_STAND_INS)}', events)
        self.assertTrue(0 < out['estimatedShare'] <= 1)
        self.assertIsNone(out['realOnly'])  # real shared history alone is too short to test
        self.assertEqual(out['symbols'], ['OLD', 'NEW'])  # SPY only stands in: never added
        self.assertEqual([(x['symbol'], x['standIn']) for x in out['standIns']], [('NEW', 'SPY')])
        self.assertGreater(out['standIns'][0]['correlation'], 0.9)
        self.assertEqual(out['start'], (start + dt.timedelta(days=1200)).date().isoformat())
        self.assertEqual(out['testStart'], start.date().isoformat())
        self.assertIsNotNone(out['walkForward'])
        self.assertEqual(len(out['stability']['low']), 2)
        self.assertIsNone(off['walkForward'])  # ~1 year of real shared history alone
        self.assertEqual(off['standIns'], [])
        self.assertEqual(out['weights'], off['weights'])  # suggestions use real data only


if __name__ == '__main__':
    unittest.main()
