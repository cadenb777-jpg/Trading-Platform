"""SPX box-spread rates (engine/boxrates.py) against hand-worked values.

Hand working: a 5,500/6,500 box (width 1,000 points = $100,000 at expiry), 91 days to go. Quotes (bid/ask):
  5,500 call 589.50/590.50, 6,500 call 39.80/40.20, 6,500 put 479.50/480.50, 5,500 put 40.65/41.05
  buy  = 590.50 - 39.80 + 480.50 - 40.65 = 990.55     mid = 989.15     sell = 589.50 - 40.20 + 479.50 - 41.05 = 987.75
  fees = 4 contracts x $1.20 = $4.80 = 0.048 points
  lend   = (1000 / (990.55 + 0.048) - 1) x 365/91 = 3.80692%
  mid    = (1000 / (989.15 + 0.048) - 1) x 365/91 = 4.37998%
  borrow = (1000 / (987.75 - 0.048) - 1) x 365/91 = 4.99413%
  T-bill 4.30% for 91 days: the mid is 8.0 bp above it, $19.94 more per $100,000 over the 91 days.
"""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import boxrates as bx  # noqa: E402

Q = {'c1': {'bid': 589.5, 'ask': 590.5}, 'c2': {'bid': 39.8, 'ask': 40.2}, 'p1': {'bid': 40.65, 'ask': 41.05}, 'p2': {'bid': 479.5, 'ask': 480.5}}


def leg(kind, strike, q, exp='2027-02-19'):
    return {'type': kind, 'strike': strike, 'expiration': exp, 'bid': q['bid'], 'ask': q['ask']}


class Maths(unittest.TestCase):
    def test_prices(self):
        p = bx.box_prices(Q['c1'], Q['c2'], Q['p1'], Q['p2'])
        self.assertAlmostEqual(p['buy'], 990.55)
        self.assertAlmostEqual(p['mid'], 989.15)
        self.assertAlmostEqual(p['sell'], 987.75)

    def test_rates_after_fees(self):
        r = bx.box_rates(1000, bx.box_prices(Q['c1'], Q['c2'], Q['p1'], Q['p2']), 91)
        self.assertAlmostEqual(r['lend'], 0.0380692, places=7)
        self.assertAlmostEqual(r['midRate'], 0.0437998, places=7)
        self.assertAlmostEqual(r['borrow'], 0.0499413, places=7)
        self.assertLess(r['lend'], r['midRate'])
        self.assertLess(r['midRate'], r['borrow'])

    def test_missing_or_crossed_quotes(self):
        self.assertIsNone(bx.box_prices(Q['c1'], None, Q['p1'], Q['p2']))
        self.assertIsNone(bx.box_prices({'bid': 5, 'ask': 4}, Q['c2'], Q['p1'], Q['p2']))
        self.assertIsNone(bx.annual_rate(1000, 0, 91))

    def test_bill_interpolation(self):
        curve = [(30, 0.044), (91, 0.043), (182, 0.042)]
        self.assertAlmostEqual(bx.bill_rate(curve, 91), 0.043)
        self.assertAlmostEqual(bx.bill_rate(curve, 136.5), 0.0425)
        self.assertEqual(bx.bill_rate(curve, 10), 0.044)
        self.assertEqual(bx.bill_rate(curve, 999), 0.042)
        self.assertIsNone(bx.bill_rate([], 91))

    def test_monthly_expiries_only(self):
        self.assertTrue(bx.is_monthly('2026-12-18'))   # third Friday
        self.assertTrue(bx.is_monthly('2027-02-19'))
        self.assertFalse(bx.is_monthly('2026-12-11'))  # a weekly
        self.assertFalse(bx.is_monthly('2026-04-16'))  # an ordinary Thursday
        self.assertTrue(bx.is_monthly('2026-06-18'))   # Juneteenth falls on the third Friday (2026-06-19)


class Rows(unittest.TestCase):
    def test_widest_fully_quoted_box_and_the_bill_comparison(self):
        today = dt.date(2026, 11, 20)  # 91 days before 2027-02-19
        contracts = [leg('call', 5500, Q['c1']), leg('call', 6500, Q['c2']), leg('put', 5500, Q['p1']), leg('put', 6500, Q['p2']),
                     leg('call', 6000, {'bid': 200, 'ask': 201}), leg('put', 6000, {'bid': 190, 'ask': 191}),
                     leg('call', 7000, {'bid': 0, 'ask': 0.05}), leg('put', 7000, {'bid': 950, 'ask': 955}),  # no call bid: not used
                     leg('call', 5500, Q['c1'], '2026-12-11')]  # weekly: left out
        rows = bx.expiry_rows(contracts, today, [(91, 0.043)])
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r['k1'], r['k2'], r['width'], r['notional'], r['days']), (5500, 6500, 1000, 100000, 91))
        self.assertAlmostEqual(r['midVsBillBp'], 7.998, places=2)
        self.assertAlmostEqual(r['extraPer100k'], 19.941, places=2)
        self.assertAlmostEqual(r['feeUsd'], 4.8)
        self.assertAlmostEqual(r['midPrice'], 989.15)
        self.assertAlmostEqual(r['midRate'], 0.0437998, places=7)


class NeverTrades(unittest.TestCase):
    def test_no_order_words(self):
        with open(bx.__file__, encoding='utf-8') as f:
            src = f.read()
        for word in ('place_order', 'preview_order', 'webull'):
            self.assertNotIn(word, src)


if __name__ == '__main__':
    unittest.main()
