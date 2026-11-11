"""core.one_candle_per_day: Schwab daily candles come out in date order with one row per New York day (the self-check found
SPY's Schwab history with a day out of order or repeated)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import core, selfcheck  # noqa: E402


def c(t, close):
    return {'datetime': t * 1000, 'close': close}


def rows(candles):
    return [[x['datetime'] // 1000, x['close']] for x in core.one_candle_per_day(candles, 'TEST')]

D1, D2, D3 = 1793941200, 1794027600, 1794114000  # 2026-11-06/07/08 05:00 UTC (midnight Central, Schwab's stamp)


class OnePerDay(unittest.TestCase):
    def test_sorted_and_repeats_dropped(self):
        self.assertEqual(rows([c(D2, 2.0), c(D1, 1.0), c(D2, 2.5), c(D3, 3.0)]), [[D1, 1.0], [D2, 2.5], [D3, 3.0]])
        self.assertGreater(core.DAILY_FIXES['TEST'], 0)

    def test_same_day_two_stamps_keeps_the_later(self):
        # a day stamped at 05:00 and again at 06:00 UTC (the daylight-saving switch) is one New York day
        self.assertEqual(rows([c(D1, 1.0), c(D1 + 3600, 1.1)]), [[D1 + 3600, 1.1]])

    def test_empty(self):
        self.assertEqual(core.one_candle_per_day(None, 'TEST'), [])
        self.assertEqual(core.DAILY_FIXES['TEST'], 0)

    def test_clean_list_counts_nothing(self):
        rows([c(D1, 1.0), c(D2, 2.0), c(D3, 3.0)])
        self.assertEqual(core.DAILY_FIXES['TEST'], 0)

    def test_clean_rows_pass_the_self_check(self):
        cleaned = rows([c(D2, 100.0), c(D1, 100.0), c(D2, 100.0), c(D3, 100.0)])
        check = selfcheck.check_bars(cleaned, now_ts=D3, fixed=core.DAILY_FIXES['TEST'])
        self.assertTrue(check['ok'])
        self.assertIn('the helper fixed it', check['detail'])

    def test_self_check_names_the_bad_day(self):
        detail = selfcheck.check_bars([[D1, 100.0], [D1, 100.0], [D3, 100.0]], now_ts=D3)['detail']
        self.assertIn('first at 2026-11-06', detail)


if __name__ == '__main__':
    unittest.main()
