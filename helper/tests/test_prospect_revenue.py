"""Estimated adviser revenue from Form ADV (assumptions stated in engine/prospect_revenue.py)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import prospect_revenue as pr  # noqa: E402


class Revenue(unittest.TestCase):
    def test_tiered_rate(self):
        self.assertAlmostEqual(pr.tiered_rate(500_000), 0.01)
        # $2M: 1% on $1M + 0.8% on $1M = $18,000 -> 0.9%
        self.assertAlmostEqual(pr.tiered_rate(2_000_000), 0.009)
        self.assertLess(pr.tiered_rate(50_000_000), 0.005)

    def test_hnw_firm(self):
        # $500M from 250 HNW clients ($2M average) -> 0.9% -> $4.5M likely
        est = pr.estimate(500e6, {'hnw': {'count': 250, 'aum': 500e6}}, ['Percentage of assets'], employees=10)
        self.assertAlmostEqual(est['likely'], 4.5e6)
        self.assertAlmostEqual(est['low'], 4.5e6 * 0.75)
        self.assertAlmostEqual(est['effectiveRate'], 0.009)
        self.assertEqual(est['perEmployee']['likely'], 4.5e6)
        self.assertEqual(est['notes'], [])

    def test_institutional_and_performance_fees(self):
        mix = {'pensions': {'count': 5, 'aum': 1e9}, 'pooled': {'count': 3, 'aum': 1e9}}
        est = pr.estimate(2e9, mix, ['Percentage of assets', 'Performance-based'])
        self.assertAlmostEqual(est['performance']['likely'], 1e9 * 0.07 * 0.2)
        self.assertAlmostEqual(est['likely'], 1e9 * 0.003 + 1e9 * 0.0125 + 1e9 * 0.07 * 0.2)
        known = pr.estimate(2e9, mix, ['Performance-based', 'Percentage of assets'], portfolio_return=0.10)
        self.assertAlmostEqual(known['performance']['likely'], 1e9 * 0.10 * 0.2)
        losing = pr.estimate(2e9, mix, ['Performance-based', 'Percentage of assets'], portfolio_return=-0.10)
        self.assertEqual(losing['performance']['likely'], 0)

    def test_no_breakdown_and_odd_fees(self):
        est = pr.estimate(1e9, {}, ['Hourly'])
        self.assertAlmostEqual(est['likely'], 1e9 * 0.006)
        self.assertEqual(len(est['notes']), 2)
        self.assertIsNone(pr.estimate(None, {}, []))

    def test_portfolio_return(self):
        self.assertAlmostEqual(pr.portfolio_return([[(0.5, 0.10), (0.5, -0.02)], [(1.0, 0.05)]]), 1.04 * 1.05 - 1)
        self.assertIsNone(pr.portfolio_return([[(1.0, None)]]))


if __name__ == '__main__':
    unittest.main()
