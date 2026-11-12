"""Factor exposures (OLS + Newey-West) and hidden bets (PCA, effective number of bets)."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
try:
    import numpy as np
    from engine import factors as fx  # noqa: E402
except ImportError:
    fx = None

FF5 = """This file was created using the 202509 CRSP database.
The 1-month TBill rate data until 202405 are from Ibbotson Associates.

,Mkt-RF,SMB,HML,RMW,CMA,RF
19630701,   -0.67,    0.00,   -0.32,   -0.01,    0.15,    0.012
19630702,    0.79,   -0.27,    0.27,   -0.07,   -0.19,    0.012

Copyright 2025 Eugene F. Fama and Kenneth R. French
"""
MOM = """This file was created by CMPT_ME_PRIOR_RETS_DAILY.

,Mom   
19261103,   0.56
19261104,  -0.50
"""


@unittest.skipIf(fx is None, 'numpy not installed')
class Factors(unittest.TestCase):
    def test_parse_french(self):
        cols, rows = fx.parse_french_csv(FF5)
        self.assertEqual(cols, ['Mkt-RF', 'SMB', 'HML', 'RMW', 'CMA', 'RF'])
        self.assertAlmostEqual(rows[dt.date(1963, 7, 2)][0], 0.0079)
        cols, rows = fx.parse_french_csv(MOM)
        self.assertEqual(cols, ['Mom'])
        self.assertAlmostEqual(rows[dt.date(1926, 11, 4)][0], -0.005)

    def test_ols_recovers_known_betas(self):
        rng = np.random.default_rng(1)
        X = rng.normal(0, 0.01, (3000, 6))
        true = np.array([1.1, 0.4, -0.3, 0.2, 0.0, -0.15])
        y = 0.0002 + X @ true + rng.normal(0, 0.003, 3000)
        beta, se, r2 = fx.ols_newey_west(y, X)
        np.testing.assert_allclose(beta[1:], true, atol=0.03)
        self.assertAlmostEqual(beta[0], 0.0002, delta=0.0002)
        self.assertGreater(r2, 0.85)
        self.assertTrue((se > 0).all())

    def test_hidden_bets_one_driver(self):
        rng = np.random.default_rng(2)
        common = rng.normal(0, 0.02, 1000)
        rets = np.column_stack([common + rng.normal(0, 0.001, 1000) for _ in range(5)])
        res = fx.hidden_bets(rets, [0.2] * 5, list('ABCDE'))
        self.assertGreater(res['components'][0]['share'], 0.99)
        self.assertLess(res['effectiveBets'], 1.1)

    def test_hidden_bets_independent_known_shares(self):
        # independent holdings with different volatilities: components are the holdings themselves, so each one's risk
        # share is w^2 sigma^2 / sum, and the bets are exp(entropy) of those shares
        rng = np.random.default_rng(3)
        sig = np.array([0.01, 0.02, 0.03, 0.04])
        rets = rng.normal(0, 1, (200000, 4)) * sig
        res = fx.hidden_bets(rets, [0.25] * 4, list('ABCD'))
        shares = sig ** 2 / (sig ** 2).sum()
        expected = float(np.exp(-(shares * np.log(shares)).sum()))
        self.assertAlmostEqual(res['effectiveBets'], expected, delta=0.05)
        self.assertEqual(res['components'][0]['drivers'][0]['symbol'], 'D')
        self.assertAlmostEqual(res['components'][0]['share'], shares[3], delta=0.02)

if __name__ == '__main__':
    unittest.main()
