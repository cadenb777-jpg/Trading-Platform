"""invest.quote_row passes Schwab's assetSubType through (it tells ETFs from stocks; Schwab calls both EQUITY)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import invest  # noqa: E402


def data(**top):
    return {'assetMainType': 'EQUITY', 'quote': {'lastPrice': 100.0, 'netPercentChange': 1.5}, 'reference': {'description': 'X'}, **top}


class QuoteRowSubType(unittest.TestCase):
    def test_etf(self):
        row = invest.quote_row('SPY', data(assetSubType='ETF'))
        self.assertEqual(row['assetType'], 'EQUITY')
        self.assertEqual(row['assetSubType'], 'ETF')

    def test_common_stock(self):
        self.assertEqual(invest.quote_row('NTRS', data(assetSubType='COE'))['assetSubType'], 'COE')

    def test_missing_is_empty(self):
        row = invest.quote_row('XLF', data())
        self.assertEqual(row['assetSubType'], '')
        self.assertAlmostEqual(row['change'], 0.015)


if __name__ == '__main__':
    unittest.main()
