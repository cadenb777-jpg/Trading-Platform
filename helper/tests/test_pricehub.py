"""Triangulated prices: newest trade wins, stray backup prints are refused, quiet symbols found."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import pricehub as ph  # noqa: E402

NOW = 1_800_000_000.0


class Hub(unittest.TestCase):
    def test_newest_trade_wins_and_older_never_replaces(self):
        h = ph.Hub()
        self.assertTrue(h.offer('NVDA', 100.0, NOW - 30, 'stream', NOW))
        self.assertTrue(h.offer('NVDA', 100.5, (NOW - 5) * 1000, 'schwab', NOW))  # milliseconds accepted
        self.assertFalse(h.offer('NVDA', 99.0, NOW - 60, 'yahoo', NOW))  # older trade
        self.assertEqual(h.best['NVDA'][0], 100.5)
        self.assertEqual(h.best['NVDA'][2], 'schwab')

    def test_backup_bad_tick_refused_but_schwab_jump_shown(self):
        h = ph.Hub()
        h.offer('NVDA', 100.0, NOW - 20, 'stream', NOW)
        h.offer('NVDA', 100.1, NOW - 15, 'schwab', NOW)
        self.assertFalse(h.offer('NVDA', 110.0, NOW - 1, 'alpaca', NOW))  # 10% off two agreeing sources
        self.assertEqual(h.refused['NVDA'][0], 'alpaca')
        self.assertTrue(h.offer('NVDA', 103.0, NOW, 'stream', NOW))  # a real 3% jump from Schwab goes straight through
        self.assertTrue(h.offer('NVDA', 103.1, NOW + 1, 'yahoo', NOW + 1))  # others no longer agree with each other

    def test_bad_values_ignored(self):
        h = ph.Hub()
        self.assertFalse(h.offer('X', None, NOW, 'stream', NOW))
        self.assertFalse(h.offer('X', -1, NOW, 'stream', NOW))
        self.assertFalse(h.offer('X', 5, 0, 'stream', NOW))

    def test_stale_and_describe(self):
        h = ph.Hub()
        h.offer('A', 10, NOW - 5, 'stream', NOW)
        h.offer('B', 20, NOW - 100, 'stream', NOW)
        self.assertEqual(h.stale(['A', 'B', 'C'], NOW), ['B', 'C'])
        h.offer('A', 10.05, NOW - 3, 'alpaca', NOW)
        d = h.describe('A', NOW)
        self.assertEqual(d['chosen']['source'], 'alpaca')
        self.assertEqual([r['source'] for r in d['sources']], ['alpaca', 'stream'])
        self.assertAlmostEqual(d['spread'], 0.005, places=6)


class Parsers(unittest.TestCase):
    def test_alpaca_latest_nanoseconds(self):
        out = ph.parse_alpaca_latest({'trades': {'NVDA': {'t': '2026-11-12T15:01:02.123456789Z', 'p': 496.1, 's': 100, 'x': 'V'}}})
        price, at = out['NVDA']
        self.assertEqual(price, 496.1)
        self.assertAlmostEqual(at % 60, 2.123456789, places=5)

    def test_yahoo_newest_session(self):
        data = {'quoteResponse': {'result': [{'symbol': 'NVDA', 'regularMarketPrice': 495.0, 'regularMarketTime': 1000, 'postMarketPrice': 497.0, 'postMarketTime': 2000}]}}
        self.assertEqual(ph.parse_yahoo_quotes(data), {'NVDA': (497.0, 2000.0)})

    def test_chain_underlying(self):
        ph.HUB.best.pop('ZZZ', None)
        ph.offer_chain('ZZZ', {'underlying': {'last': 12.5, 'tradeTime': NOW * 1000}})
        self.assertEqual(ph.HUB.best['ZZZ'][0], 12.5)


if __name__ == '__main__':
    unittest.main()
