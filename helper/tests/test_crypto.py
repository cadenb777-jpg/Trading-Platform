"""Crypto backup route: Alpaca and Kraken replies turned into Coinbase's candle format."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import crypto as cx  # noqa: E402
from engine.core import EngineError  # noqa: E402


class Crypto(unittest.TestCase):
    def test_symbols(self):
        self.assertEqual(cx.clean_symbol('btc-usd'), 'BTC-USD')
        for bad in ('', 'BTCUSD', 'BTC/USD', 'A' * 30):
            with self.assertRaises(EngineError):
                cx.clean_symbol(bad)
        self.assertEqual(cx.kraken_pair('BTC-USD'), 'XBTUSD')
        self.assertEqual(cx.kraken_pair('ETH-BTC'), 'ETHXBT')

    def test_alpaca_bars_to_candles(self):
        data = {'bars': {'BTC/USD': [{'t': '2026-11-13T00:00:00Z', 'o': 100, 'h': 110, 'l': 95, 'c': 105, 'v': 2},
                                     {'t': '2026-11-13T01:00:00Z', 'o': 105, 'h': 108, 'l': 101, 'c': 102, 'v': 3}]}}
        rows = cx.alpaca_candles(data, 'BTC-USD')
        self.assertEqual(rows[0][0] - rows[1][0], 3600)  # newest first
        self.assertEqual(rows[1][1:], [95.0, 110.0, 100.0, 105.0, 2.0])  # low, high, open, close, volume

    def test_kraken_ohlc_to_candles(self):
        data = {'error': [], 'result': {'XXBTZUSD': [[1000, '100', '110', '95', '105', '101', '7', 5], [2000, '105', '108', '101', '102', '104', '3', 2]], 'last': 2000}}
        self.assertEqual(cx.kraken_candles(data, 0, 1500), [[1000, 95.0, 110.0, 100.0, 105.0, 7.0]])
        with self.assertRaises(EngineError):
            cx.kraken_candles({'error': ['EQuery:Unknown asset pair']}, 0, 1)

    def test_alpaca_stats(self):
        data = {'snapshots': {'BTC/USD': {'latestTrade': {'p': 61000}, 'dailyBar': {'o': 60000}}, 'ETH/USD': {'minuteBar': {'c': 3000}, 'prevDailyBar': {'c': 2900}}}}
        self.assertEqual(cx.alpaca_stats(data), {'BTC-USD': {'last': 61000.0, 'open': 60000.0}, 'ETH-USD': {'last': 3000.0, 'open': 2900.0}})


if __name__ == '__main__':
    unittest.main()
