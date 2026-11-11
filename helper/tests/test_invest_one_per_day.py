"""invest.one_per_day: daily closes come out in date order with one row per New York day (the self-check found
SPY's Schwab history with a day out of order or repeated)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import invest, selfcheck  # noqa: E402

D1, D2, D3 = 1793941200, 1794027600, 1794114000  # 2026-11-06/07/08 05:00 UTC (midnight Central, Schwab's stamp)


class OnePerDay(unittest.TestCase):
    def test_sorted_and_repeats_dropped(self):
        rows = [[D2, 2.0], [D1, 1.0], [D2, 2.5], [D3, 3.0]]
        self.assertEqual(invest.one_per_day(rows), [[D1, 1.0], [D2, 2.5], [D3, 3.0]])

    def test_same_day_two_stamps_keeps_the_later(self):
        # a day stamped at 05:00 and again at 06:00 UTC (the daylight-saving switch) is one New York day
        self.assertEqual(invest.one_per_day([[D1, 1.0], [D1 + 3600, 1.1]]), [[D1 + 3600, 1.1]])

    def test_empty(self):
        self.assertEqual(invest.one_per_day(None), [])

    def test_clean_rows_pass_the_self_check(self):
        rows = invest.one_per_day([[D2, 100.0], [D1, 100.0], [D2, 100.0], [D3, 100.0]])
        self.assertTrue(selfcheck.check_bars(rows, now_ts=D3)['ok'])

    def test_self_check_names_the_bad_day(self):
        detail = selfcheck.check_bars([[D1, 100.0], [D1, 100.0], [D3, 100.0]], now_ts=D3)['detail']
        self.assertIn('first at 2026-11-06', detail)


if __name__ == '__main__':
    unittest.main()
