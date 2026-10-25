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
        with mock.patch.object(quant, 'risk_free', rf), mock.patch.object(quant, 'RW_RUNS', 5):
            out = asyncio.run(quant.optimize(Ctx(), msg))
        self.assertEqual(out['symbols'], ['AAA', 'BBB', 'BIL'])
        self.assertEqual(out['cash'], ['BIL'])
        self.assertAlmostEqual(out['weights'][2], 0.2, places=3)
        self.assertAlmostEqual(sum(out['weights']), 1, places=3)
        self.assertEqual([x['key'] for x in out['walkForward']['rows']], ['current', 'equal', 'min_var', 'risk_parity', 'growth'])
        self.assertTrue(0 < out['randomWalk']['p'] <= 1)
        self.assertIn(out['randomWalk']['runs'], (0, 5))  # 0 = no edge, so no shuffles needed


if __name__ == '__main__':
    unittest.main()
