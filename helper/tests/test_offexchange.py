"""Off-exchange share (FINRA weekly) and fund premium/discount."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import offexchange as ox  # noqa: E402


class OffExchange(unittest.TestCase):
    def test_query_shape(self):
        q = ox.finra_query('AAPL', ox.ATS)
        self.assertEqual(q['compareFilters'][0]['fieldValue'], 'AAPL')
        self.assertEqual(q['compareFilters'][1]['fieldValue'], 'ATS_W_SMBL')
        self.assertEqual(q['sortFields'], ['-weekStartDate'])

    def test_weekly_shares_adds_rows_of_the_same_week(self):
        rows = [{'weekStartDate': '2026-10-19', 'totalWeeklyShareQuantity': 100}, {'weekStartDate': '2026-10-19', 'totalWeeklyShareQuantity': 50},
                {'weekStartDate': '2026-10-26', 'totalWeeklyShareQuantity': 70}, {'weekStartDate': None, 'totalWeeklyShareQuantity': 9}]
        self.assertEqual(ox.weekly_shares(rows), {'2026-10-19': 150, '2026-10-26': 70})

    def test_shares_of_volume(self):
        bars = [(dt.date(2026, 10, 19) + dt.timedelta(days=i), 200) for i in range(5)]  # 1,000 shares that week
        rows = ox.shares_of_volume({'2026-10-19': 150}, {'2026-10-19': 250}, bars)
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]['atsShare'], 0.15)
        self.assertAlmostEqual(rows[0]['offShare'], 0.40)
        self.assertEqual(ox.shares_of_volume({'2026-11-02': 5}, {}, bars), [])  # no volume that week: left out

    def test_daily_shares(self):
        bars = [(dt.date(2026, 11, 10), 1000), (dt.date(2026, 11, 11), 2000)]
        rows = [{'date': '2026-11-10', 'total': 450}, {'date': '2026-11-11', 'total': 5000}, {'date': '2026-11-12', 'total': 10}]
        out = ox.daily_shares(rows, bars)
        self.assertEqual(len(out), 1)  # 11-11 doesn't fit (more off-exchange than total), 11-12 has no bar yet
        self.assertAlmostEqual(out[0]['share'], 0.45)

    def test_premium_and_yahoo_nav(self):
        self.assertAlmostEqual(ox.premium(9.0, 10.0), -0.10)
        self.assertIsNone(ox.premium(None, 10))
        self.assertEqual(ox.yahoo_nav({'quoteSummary': {'result': [{'summaryDetail': {'navPrice': {'raw': 512.3, 'fmt': '512.30'}}}]}}), 512.3)
        self.assertIsNone(ox.yahoo_nav({'quoteSummary': {'result': [{'summaryDetail': {}}]}}))


if __name__ == '__main__':
    unittest.main()
