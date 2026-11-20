import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import invest  # noqa: E402


class CapsTest(unittest.TestCase):
    def test_reads_market_caps_from_schwab_fundamentals(self):
        data = {'instruments': [
            {'symbol': 'AAPL', 'fundamental': {'symbol': 'AAPL', 'marketCap': 3.9e12}},
            {'fundamental': {'symbol': 'msft', 'marketCap': '3.1e12'}},
            {'symbol': 'ZZZ', 'fundamental': {'marketCap': 0}},
            {'symbol': 'NOF'},
        ]}
        self.assertEqual(invest.parse_caps(data), {'AAPL': 3.9e12, 'MSFT': 3.1e12})

    def test_empty_reply(self):
        self.assertEqual(invest.parse_caps(None), {})
        self.assertEqual(invest.parse_caps({}), {})


if __name__ == '__main__':
    unittest.main()
