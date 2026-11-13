"""Last twelve months (LTM) column: four consecutive quarters after the latest fiscal year."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import research as rs  # noqa: E402


def tables(q_ends, a_ends, rev, shares, cash):
    q = {'periods': q_ends, 'values': {'revenue': rev, 'dilutedShares': shares, 'cash': cash}}
    a = {'periods': a_ends, 'values': {'revenue': [None] * len(a_ends), 'dilutedShares': [None] * len(a_ends), 'cash': [None] * len(a_ends)}}
    return q, a


class Ltm(unittest.TestCase):
    Q = ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']

    def test_flows_added_shares_averaged_balances_latest(self):
        q, a = tables(['2025-09-30'] + self.Q, ['2024-12-31', '2025-12-31'], [90, 100, 110, 120, 130], [10, 10, 10, 12, 14], [5, 6, 7, 8, 9])
        ltm = rs.last_twelve_months(q, a)
        self.assertEqual(ltm['end'], '2026-09-30')
        self.assertEqual(ltm['values']['revenue'], 100 + 110 + 120 + 130)
        self.assertEqual(ltm['values']['dilutedShares'], (10 + 10 + 12 + 14) / 4)
        self.assertEqual(ltm['values']['cash'], 9)

    def test_none_when_newest_quarter_is_the_year_end(self):
        q, a = tables(self.Q, ['2026-09-30'], [1, 2, 3, 4], [1, 1, 1, 1], [1, 1, 1, 1])
        self.assertIsNone(rs.last_twelve_months(q, a))

    def test_none_with_a_gap(self):
        q, a = tables(['2025-09-30', '2026-03-31', '2026-06-30', '2026-09-30'], ['2025-12-31'], [1, 2, 3, 4], [1, 1, 1, 1], [1, 1, 1, 1])
        self.assertIsNone(rs.last_twelve_months(q, a))

    def test_missing_quarter_value(self):
        q, a = tables(self.Q, ['2025-12-31'], [1, None, 3, 4], [1, 1, 1, 1], [1, 1, 1, 1])
        self.assertIsNone(rs.last_twelve_months(q, a)['values']['revenue'])

    def test_ttm_averages_share_counts(self):
        q, a = tables(self.Q, ['2025-12-31'], [1, 2, 3, 4], [10, 10, 12, 12], [1, 1, 1, 1])
        self.assertEqual(rs.ttm(q, a, 'dilutedShares'), 11)
        self.assertEqual(rs.ttm(q, a, 'revenue'), 10)


if __name__ == '__main__':
    unittest.main()
