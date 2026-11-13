"""Funding stress, mortgage spread and Treasury supply pace, on hand-worked values."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import moneydesk as m  # noqa: E402


class Funding(unittest.TestCase):
    def test_spreads_and_reading(self):
        days = [f'2026-10-{d:02d}' for d in range(1, 21)]
        # SOFR 3.80 then 3.95 on the last day; IORB 3.90 throughout -> spreads -10 bp ... +5 bp
        sofr = [(d, 3.80) for d in days[:-1]] + [(days[-1], 3.95)]
        iorb = [(d, 3.90) for d in days]
        s1 = [(d, 3.75) for d in days]
        s99 = [(d, 3.85) for d in days[:-1]] + [(days[-1], 4.10)]
        f = m.funding(sofr, s1, s99, iorb)
        self.assertAlmostEqual(f['spreadBp'], 5.0)
        self.assertAlmostEqual(f['dispersionBp'], 35.0)       # 4.10 - 3.75
        self.assertAlmostEqual(f['spreadPct'], 100 * 19.5 / 20)
        self.assertEqual(f['reading'], 'tight')
        self.assertAlmostEqual(f['high30Bp'], 5.0)
        # the same day below IORB is calm however high its rank
        f2 = m.funding(sofr[:-1] + [(days[-1], 3.85)], s1, s99, iorb)
        self.assertAlmostEqual(f2['spreadBp'], -5.0)
        self.assertEqual(f2['reading'], 'calm')

    def test_month_end_is_not_a_warning(self):
        days = [f'2026-10-{d:02d}' for d in range(1, 31)]  # last day Oct 30: inside the month-end window (31 - 3 = 28)
        sofr = [(d, 3.80) for d in days[:-1]] + [(days[-1], 3.95)]
        iorb = [(d, 3.90) for d in days]
        s1 = [(d, 3.75) for d in days]
        s99 = [(d, 3.85) for d in days]
        f = m.funding(sofr, s1, s99, iorb)
        self.assertEqual(f['reading'], 'month-end')
        self.assertTrue(m.near_month_end('2026-11-01'))
        self.assertTrue(m.near_month_end('2026-02-26'))      # Feb 2026 has 28 days: the 26th-28th count
        self.assertFalse(m.near_month_end('2026-02-25'))
        self.assertFalse(m.near_month_end('2026-11-03'))

    def test_high_over_thirty_calendar_days(self):
        # a +9 bp spike 35 days earlier is outside "highest in 30 days"
        sofr = [('2026-09-30', 3.99), ('2026-10-20', 3.85), ('2026-11-04', 3.92), ('2026-11-10', 3.86)]
        iorb = [(d, 3.90) for d, _ in sofr]
        s1 = [(d, 3.80) for d, _ in sofr]
        s99 = [(d, 4.00) for d, _ in sofr]
        self.assertAlmostEqual(m.funding(sofr, s1, s99, iorb)['high30Bp'], 2.0)

    def test_only_days_with_all_four(self):
        f = m.funding([('2026-01-02', 4.0), ('2026-01-03', 4.1)], [('2026-01-03', 4.0)], [('2026-01-03', 4.2)],
                      [('2026-01-02', 4.0), ('2026-01-03', 4.0)])
        self.assertEqual(f['days'], 1)
        self.assertIsNone(m.funding([], [], [], []))


class Mortgage(unittest.TestCase):
    def test_spread_uses_the_ten_year_on_or_before(self):
        # Freddie Mac Nov 12, 2026: 7.11%; latest 10-year before it (FRED): 4.98% on Nov 10 -> 213 bp
        mort = [('2025-11-12', 6.50), ('2026-11-12', 7.11)]
        ten = [('2025-11-12', 4.40), ('2026-11-10', 4.98), ('2026-11-13', 5.20)]
        r = m.mortgage_spread(mort, ten)
        self.assertAlmostEqual(r['spreadBp'], 213.0)
        self.assertAlmostEqual(r['yearAgoBp'], 210.0)          # 6.50 - 4.40
        self.assertAlmostEqual(r['medianBp'], 211.5)
        self.assertAlmostEqual(r['percentile'], 75.0)
        self.assertIsNone(m.mortgage_spread([('1960-01-01', 5.0)], [('1970-01-01', 4.0)]))


class Supply(unittest.TestCase):
    def test_pace_and_bill_shares(self):
        debt = [('2025-11-10', 30.0e12), ('2026-08-11', 32.0e12), ('2026-10-11', 32.5e12), ('2026-11-10', 32.8e12)]
        # month-ends: bills / marketable in $ millions
        mspd = [('2025-10-31', 6_000_000, 29_000_000), ('2025-11-30', 6_200_000, 29_500_000), ('2025-12-31', 6_400_000, 29_800_000)] + [(f'2026-{m:02d}-28', 6_500_000, 30_000_000) for m in range(1, 7)] + \
               [('2026-07-31', 7_000_000, 31_000_000), ('2026-08-31', 7_100_000, 31_400_000), ('2026-09-30', 7_200_000, 31_800_000),
                ('2026-10-31', 7_381_670, 32_150_190)]
        s = m.supply(debt, mspd)
        self.assertAlmostEqual(s['change30'], 300.0)            # $bn since Oct 11
        self.assertAlmostEqual(s['change91'], 800.0)            # since Aug 11
        self.assertAlmostEqual(s['change365'], 2800.0)
        self.assertAlmostEqual(s['pacePerYear'], 800.0 * 365 / 91)
        # MSPD Oct 31, 2026: bills 7,381,670 of 32,150,190 marketable = 22.96%
        self.assertAlmostEqual(s['billShare'], 7_381_670 / 32_150_190)
        # 3 months: (7,381,670 - 7,000,000) / (32,150,190 - 31,000,000) = 381,670 / 1,150,190
        self.assertAlmostEqual(s['billShareNew3m'], 381_670 / 1_150_190)
        # 12 months back is the Oct 31, 2025 row (13 month-ends in all): 1,381,670 / 3,150,190
        self.assertAlmostEqual(s['billShareNew12m'], 1_381_670 / 3_150_190)
        self.assertIsNone(m.supply([], []))
        self.assertIsNone(m.supply(debt[-1:], [])['change30'])
        self.assertIsNone(m.supply(debt, [])['billShare'])

    def test_no_share_of_a_fall(self):
        mspd = [('2026-0%d-28' % i, 7.0e6, 32.0e6 - i * 1e5) for i in range(1, 6)]
        self.assertIsNone(m.supply([('2026-05-01', 1.0)], mspd)['billShareNew3m'])


if __name__ == '__main__':
    unittest.main()
