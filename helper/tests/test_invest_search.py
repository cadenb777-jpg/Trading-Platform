import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import invest  # noqa: E402


def r(sym, name, kind):
    return {'symbol': sym, 'name': name, 'kind': kind}


class SearchRanking(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(invest.search_kind({'assetType': 'EQUITY', 'description': 'APPLE INC'}), 'stock')
        self.assertEqual(invest.search_kind({'assetType': 'ETF', 'description': 'SPDR S&P 500 ETF'}), 'etf')
        self.assertEqual(invest.search_kind({'assetType': 'EQUITY', 'description': 'VANGUARD TOTAL STOCK MARKET ETF'}), 'etf')
        self.assertEqual(invest.search_kind({'assetType': 'MUTUAL_FUND', 'description': 'VANGUARD 500 INDEX ADMIRAL'}), 'mutual_fund')
        self.assertEqual(invest.search_kind({'assetType': 'BOND'}), 'bond')

    def test_exact_ticker_then_names_starting_with_the_query(self):
        items = [r('APLE', 'APPLE HOSPITALITY REIT INC', 'stock'), r('AAPL', 'APPLE INC', 'stock'), r('PINE', 'PINEAPPLE ENERGY', 'stock')]
        self.assertEqual([x['symbol'] for x in invest.rank_results('apple', items)], ['AAPL', 'APLE', 'PINE'])
        ranked = [x['symbol'] for x in invest.rank_results('AAPL', items)]
        self.assertEqual(ranked[0], 'AAPL')
        ranked = [x['symbol'] for x in invest.rank_results('apple', items)]
        self.assertEqual(ranked[-1], 'PINE')  # contains the word but doesn't start with it

    def test_several_words_and_kind_order(self):
        items = [r('VTSAX', 'VANGUARD TOTAL STOCK MARKET INDEX ADMIRAL', 'mutual_fund'), r('VTI', 'VANGUARD TOTAL STOCK MARKET ETF', 'etf'),
                 r('XYZ', 'SOMETHING ELSE', 'stock'), r('$VT', 'VANGUARD TOTAL INDEX', 'index')]
        ranked = [x['symbol'] for x in invest.rank_results('vanguard total stock', items)]
        self.assertEqual(ranked[:2], ['VTI', 'VTSAX'])
        self.assertEqual(ranked[-1], '$VT')  # an index after stocks and funds that match as well


if __name__ == '__main__':
    unittest.main()
