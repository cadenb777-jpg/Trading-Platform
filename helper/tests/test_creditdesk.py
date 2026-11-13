"""Reserves vs GDP, the commercial paper spread and lending standards, on hand-worked values."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import creditdesk as c  # noqa: E402


class Reserves(unittest.TestCase):
    # FRED: WRESBAL 1,394,122 ($m) on 2019-09-18, GDP 21,717.171 ($bn) for Q3 2019; 2,960,603 on 2026-11-11 (Q4 2026 not
    # out yet: the last published quarter is Q3 2026 at 33,010.036)
    RES = [('2019-09-18', 1394122.0), ('2025-11-11', 3000000.0), ('2026-08-12', 3100000.0), ('2026-11-11', 2960603.0)]
    GDP = [('2019-07-01', 21717.171), ('2025-07-01', 31200.0), ('2025-10-01', 31600.0), ('2026-01-01', 32000.0),
           ('2026-04-01', 32500.0), ('2026-07-01', 33010.036)]

    def test_each_week_uses_its_own_quarter(self):
        g, est = c.gdp_for(self.GDP, '2025-11-11')
        self.assertEqual((g, est), (31600.0, False))           # Q4 2025 is published
        # Q4 2026 estimated: 33,010.036 x (33,010.036 / 31,200)^(1/4), one quarter ahead
        g, est = c.gdp_for(self.GDP, '2026-11-11')
        self.assertTrue(est)
        self.assertAlmostEqual(g, 33010.036 * (33010.036 / 31200.0) ** 0.25)
        self.assertEqual(c.gdp_for(self.GDP, '2010-01-06'), (None, False))  # before the data
        # with fewer than 5 quarters, no growth is assumed
        self.assertEqual(c.gdp_for([('2026-07-01', 100.0)], '2026-11-11'), (100.0, True))

    def test_reading(self):
        x = c.reserves_reading(self.RES, self.GDP)
        g = 33010.036 * (33010.036 / 31200.0) ** 0.25
        now, stress = 100 * 2960.603 / g, 100 * 1394.122 / 21717.171
        self.assertAlmostEqual(x['ratio'], now)
        self.assertTrue(x['gdpEstimated'])
        self.assertAlmostEqual(x['stressRatio'], stress)          # 6.4195%
        self.assertAlmostEqual(x['aboveStress'], (now - stress) / 100 * g)
        self.assertAlmostEqual(x['ratio3m'], 100 * 3100.0 / 33010.036)
        self.assertAlmostEqual(x['ratio12m'], 100 * 3000.0 / 31600.0)  # its own quarter, Q4 2025
        self.assertEqual(x['reserves'], 2960603.0e6)
        self.assertIsNone(c.reserves_reading([], self.GDP))


class Paper(unittest.TestCase):
    def test_spread(self):
        cp = [('2026-10-09', 4.20), ('2026-11-06', 4.10), ('2026-11-09', 4.03)]
        bill = [('2026-10-09', 4.00), ('2026-11-06', 4.12), ('2026-11-09', 4.06)]
        p = c.paper_reading(cp, bill)
        # FRED Nov 9, 2026: commercial paper 4.03, 3-month bill 4.06 -> -3 bp
        self.assertAlmostEqual(p['spreadBp'], -3.0)
        self.assertAlmostEqual(p['cp'], 4.03)
        self.assertAlmostEqual(p['monthAgoBp'], 20.0)
        self.assertAlmostEqual(p['high1yBp'], 20.0)
        self.assertAlmostEqual(p['percentile'], 100 * 0.5 / 3)
        self.assertFalse(p['stressed'])
        self.assertIsNone(c.paper_reading([('2026-01-02', 1.0)], [('2026-01-03', 1.0)]))

    def test_stressed_at_95th(self):
        cp = [(f'2026-01-{d:02d}', 4.0) for d in range(1, 21)] + [('2026-01-21', 4.6)]
        bill = [(d, 3.9) for d, _ in cp]
        self.assertTrue(c.paper_reading(cp, bill)['stressed'])


class Lending(unittest.TestCase):
    def test_reading(self):
        rows = [('2026-04-01', 5.0), ('2026-07-01', -3.2), ('2026-10-01', 1.7)]
        x = c.lending_reading(rows)
        self.assertEqual((x['netTightening'], x['previous'], x['reading']), (1.7, -3.2, 'about steady'))
        self.assertEqual(c.lending_reading([('2026-10-01', 10.0)])['reading'], 'tightening')
        self.assertEqual(c.lending_reading([('2026-10-01', -10.0)])['reading'], 'easing')
        self.assertEqual(c.lending_reading([('2026-10-01', -5.0)])['reading'], 'about steady')   # symmetric
        self.assertIsNone(c.lending_reading([]))


if __name__ == '__main__':
    unittest.main()
