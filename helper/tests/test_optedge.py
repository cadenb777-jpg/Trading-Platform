"""Gamma flip, implied vs realized volatility and earnings reactions (engine/optedge.py)."""
import datetime as dt
import math
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
try:
    from engine import optedge as oe  # noqa: E402
    from engine import options_math  # noqa: E402
except ImportError as err:  # numpy/scipy missing
    oe = None
    SKIP = str(err)


def c(kind, strike, oi, iv=20.0, dte=30):
    return {'type': kind, 'strike': strike, 'oi': oi, 'iv': iv, 'dte': dte}


@unittest.skipIf(oe is None, 'numpy/scipy not installed')
class Gamma(unittest.TestCase):
    def test_curve_matches_black_scholes_gamma(self):
        prices, totals = oe.gex_curve([c('call', 100, 1000)], 100, 0.04, grid=(1.0, 1.0, 1))
        g = options_math.greeks(100, 100, 30 / 365, 0.04, 0.20, 0, 'call')['gamma']
        self.assertAlmostEqual(totals[0], g * 1000 * 100 * 100 ** 2 * 0.01, places=6)

    def test_flip_between_put_wall_and_call_wall(self):
        # heavy puts at 90, heavy calls at 110: exposure is negative near 90, positive near 110, flip in between
        chain = [c('put', 90, 5000), c('call', 110, 5000)]
        prices, totals = oe.gex_curve(chain, 100, 0.0)
        flip = oe.flip_level(prices, totals, 100)
        self.assertTrue(90 < flip < 110)
        self.assertAlmostEqual(flip, 100, delta=1.0)  # symmetric walls: about the middle
        i = min(range(len(prices)), key=lambda k: abs(prices[k] - flip))
        self.assertLess(abs(totals[i]), max(abs(t) for t in totals) * 0.05)

    def test_no_flip_when_all_calls(self):
        prices, totals = oe.gex_curve([c('call', 100, 100)], 100, 0.0)
        self.assertIsNone(oe.flip_level(prices, totals, 100))
        self.assertEqual(oe.flip_level([1, 2, 3], [-1, 0, 1], 2), 2)


@unittest.skipIf(oe is None, 'numpy/scipy not installed')
class Volatility(unittest.TestCase):
    def test_realized_vol_recovers_known_sigma(self):
        rnd = random.Random(7)
        closes = [100.0]
        for _ in range(5000):
            closes.append(closes[-1] * math.exp(rnd.gauss(0, 0.02)))
        rv = oe.realized_vol(closes, 4999)
        self.assertAlmostEqual(rv, 0.02 * math.sqrt(252), delta=0.01)
        self.assertIsNone(oe.realized_vol(closes[:10], 20))

    def test_iv30_variance_interpolation(self):
        # 20% at 20 days, 30% at 40 days: variance 0.04*20=0.8 and 0.09*40=3.6 -> at 30 days 2.2 -> sqrt(2.2/30)
        self.assertAlmostEqual(oe.iv_30([(20, 0.2), (40, 0.3)]), math.sqrt(2.2 / 30), places=9)
        self.assertEqual(oe.iv_30([(45, 0.25), (60, 0.3)]), 0.25)
        self.assertIsNone(oe.iv_30([(10, None)]))

    def test_percentile_and_vix_premium(self):
        self.assertEqual(oe.percentile(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 0.5)
        rnd = random.Random(3)
        spx = [100.0]
        for _ in range(400):
            spx.append(spx[-1] * math.exp(rnd.gauss(0, 0.01)))  # ~15.9% realized
        res = oe.vix_premium([20.0] * len(spx), spx)
        self.assertGreater(res['shareHigher'], 0.9)
        self.assertAlmostEqual(res['medianGap'], 20 - 15.9, delta=2.5)


@unittest.skipIf(oe is None, 'numpy/scipy not installed')
class Earnings(unittest.TestCase):
    BARS = [(dt.date(2025, 1, d), p) for d, p in ((27, 100.0), (28, 102.0), (29, 101.0), (30, 95.0), (31, 96.0))]

    def test_sessions_from_acceptance_time(self):
        s = oe.report_sessions([{'accepted': '2025-01-29T16:30:12.000Z'}, {'accepted': '2025-01-29T21:05:00.000Z'}, {'accepted': '2025-01-29T11:00:00.000Z'}])
        self.assertEqual([w for _, w in s], ['during', 'after', 'before'])

    def test_reaction_after_close_uses_next_session(self):
        r = oe.reactions([(dt.date(2025, 1, 29), 'after')], self.BARS)
        self.assertEqual(r[0]['session'], '2025-01-30')
        self.assertAlmostEqual(r[0]['move'], 95 / 101 - 1)

    def test_reaction_before_open_uses_same_day(self):
        r = oe.reactions([(dt.date(2025, 1, 28), 'before')], self.BARS)
        self.assertAlmostEqual(r[0]['move'], 102 / 100 - 1)

    def test_weekend_report_after_close(self):
        bars = [(dt.date(2025, 1, 31), 100.0), (dt.date(2025, 2, 3), 110.0)]
        r = oe.reactions([(dt.date(2025, 2, 1), 'after')], bars)
        self.assertAlmostEqual(r[0]['move'], 0.10)

    def test_filings_with_item_202_only(self):
        subs = {'filings': {'recent': {'form': ['8-K', '8-K', '10-Q'], 'items': ['2.02,9.01', '5.02', ''], 'filingDate': ['2025-01-29', '2025-01-10', '2025-01-30'],
                                       'acceptanceDateTime': ['2025-01-29T21:05:00.000Z', 'x', 'y']}}}
        self.assertEqual(oe.earnings_filings(subs), [{'filed': '2025-01-29', 'accepted': '2025-01-29T21:05:00.000Z'}])

    def test_move_stats(self):
        s = oe.move_stats([0.05, -0.02, 0.10, -0.04])
        self.assertEqual(s['count'], 4)
        self.assertEqual(s['max'], 0.10)
        self.assertIsNone(oe.move_stats([]))


if __name__ == '__main__':
    unittest.main()
