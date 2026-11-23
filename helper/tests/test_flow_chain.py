import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import flow  # noqa: E402
from engine.core import EngineError  # noqa: E402


def contract(strike, bid, ask, last, delta, oi=100, vol=10, iv=30.0, dte=7):
    return {'symbol': f'X{strike}', 'daysToExpiration': dte, 'strikePrice': strike, 'bid': bid, 'ask': ask, 'last': last, 'mark': (bid + ask) / 2,
            'totalVolume': vol, 'openInterest': oi, 'volatility': iv, 'delta': delta, 'gamma': 0.01}


CHAIN = {
    'symbol': 'XYZ',
    'underlying': {'last': 101.0},
    'callExpDateMap': {'2026-11-20:2': {'100.0': [contract(100, 2.0, 2.2, 2.1, 0.55)], '105.0': [contract(105, 0.4, 0.5, 0.45, 0.2)]}},
    'putExpDateMap': {'2026-11-20:2': {'100.0': [contract(100, 0.9, 1.0, 0.95, -0.45)], '105.0': [contract(105, 4.0, 4.3, -999, -0.8)]}},
}


class ChainRows(unittest.TestCase):
    def test_each_strike_carries_both_quotes(self):
        r = flow.analyze_chain(CHAIN)
        s100, s105 = r['strikes']
        self.assertEqual(s100['strike'], 100.0)
        self.assertEqual((s100['callBid'], s100['callAsk'], s100['callLast'], s100['callDelta']), (2.0, 2.2, 2.1, 0.55))
        self.assertEqual((s100['putBid'], s100['putAsk'], s100['putDelta']), (0.9, 1.0, -0.45))
        self.assertEqual(s105['putLast'], 0)  # Schwab's -999 "no value" becomes 0, never a price
        self.assertEqual(r['spot'], 101.0)

    def test_same_day_expiry_is_not_the_default(self):
        today = {'100.0': [contract(100, 0.1, 0.2, 0.15, 0.5, iv=13240.0, dte=0)]}
        week = {'100.0': [contract(100, 2.0, 2.2, 2.1, 0.55, iv=40.0, dte=7)]}
        chain = {'symbol': 'XYZ', 'underlying': {'last': 100.0},
                 'callExpDateMap': {'2026-11-23:0': today, '2026-11-30:7': week},
                 'putExpDateMap': {'2026-11-23:0': today, '2026-11-30:7': week}}
        r = flow.analyze_chain(chain)
        self.assertEqual(r['expiration'], '2026-11-30')
        self.assertAlmostEqual(r['summary']['atmIv'], 40.0)
        self.assertEqual(flow.analyze_chain(chain, '2026-11-23')['expiration'], '2026-11-23')  # asked by name

    def test_no_chain(self):
        with self.assertRaises(EngineError):
            flow.analyze_chain({'underlying': {'last': 1}})


if __name__ == '__main__':
    unittest.main()
