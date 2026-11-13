"""The scanner's stock list: Nasdaq common stocks, liquidity gate, most traded first, Nasdaq-100 always in."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import universe as uv  # noqa: E402

DIRECTORY = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N
ZXZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N
ABCDW|Abc Corp - Warrant|S|N|N|100|N|N
ABCDU|Abc Corp - Unit|S|N|N|100|N|N
LATE|Late Filer Inc - Common Stock|S|N|D|100|N|N
TSM|Example Semiconductor - American Depositary Shares|Q|N|N|100|N|N
PFXP|Example Bank - 7.5% Preferred Stock|G|N|N|100|N|N
File Creation Time: 1113202615:00|||||||
"""


def q(price, avg10, total=None):
    return {'quote': {'lastPrice': price, 'totalVolume': total}, 'fundamental': {'avg10DaysVolume': avg10}}


class Universe(unittest.TestCase):
    def test_directory_keeps_common_stocks_and_adrs(self):
        self.assertEqual([r['symbol'] for r in uv.parse_directory(DIRECTORY)], ['AAPL', 'TSM'])
        self.assertEqual(uv.parse_directory('garbage'), [])

    def test_liquidity_gate_and_order(self):
        ranked = uv.rank_liquid({'A': q(100, 1_000_000), 'B': q(4, 50_000_000), 'C': q(20, 100_000), 'D': q(50, 400_000), 'E': q(None, 10)})
        self.assertEqual([s for s, _ in ranked], ['A', 'D'])  # B under $5, C under $10M a day
        self.assertEqual(ranked[0][1], 100_000_000)

    def test_choose_caps_and_keeps_core(self):
        ranked = [('A', 9), ('B', 8), ('C', 7)]
        self.assertEqual(uv.choose(ranked, ['C', 'X'], cap=2), ['A', 'B', 'C', 'X'])


if __name__ == '__main__':
    unittest.main()
