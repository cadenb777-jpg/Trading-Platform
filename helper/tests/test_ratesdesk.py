"""Credit spreads by rating and the Kim-Wright term premium split, on hand-worked values."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import invest, ratesdesk as r  # noqa: E402


class Percentiles(unittest.TestCase):
    def test_rank_with_ties(self):
        # 2 of 5 below 3, one tie: (2 + 0.5) / 5 = 50%
        self.assertAlmostEqual(r.percentile_rank([1, 2, 3, 4, 5], 3), 50.0)
        self.assertAlmostEqual(r.percentile_rank([1, 2, 3, 4, 5], 0.5), 0.0)
        self.assertAlmostEqual(r.percentile_rank([1, 2, 3, 4, 5], 9), 100.0)
        self.assertAlmostEqual(r.percentile_rank([2, 2, 2, 2], 2), 50.0)
        self.assertIsNone(r.percentile_rank([], 1))

    def test_value_ago(self):
        rows = [('2026-01-01', 1.0), ('2026-01-20', 2.0), ('2026-02-01', 3.0), ('2026-02-28', 4.0)]
        # 28 days before Feb 28 = Jan 31: the last reading on or before it is Jan 20
        self.assertEqual(r.value_ago(rows, 28), 2.0)
        self.assertIsNone(r.value_ago(rows, 400))
        self.assertIsNone(r.value_ago([], 28))

    def test_words(self):
        self.assertEqual(r.word(5), 'unusually tight')
        self.assertEqual(r.word(10), 'unusually tight')
        self.assertEqual(r.word(50), 'in its usual range')
        self.assertEqual(r.word(95), 'unusually wide')
        self.assertEqual(r.word(None), '')


class CreditLadder(unittest.TestCase):
    def test_ladder_and_steps(self):
        days = [f'2026-0{m}-1{d}' for m in (1, 2, 3) for d in range(5)]  # 15 dates
        bbb = [(d, 1.0 + 0.01 * i) for i, d in enumerate(days)]          # 1.00 .. 1.14, rising: today is the widest
        bb = [(d, 2.5 - 0.02 * i) for i, d in enumerate(days)]           # 2.50 .. 2.22, falling
        out = r.credit_ladder({'BBB': bbb, 'BB': bb})
        rows = {x['rating']: x for x in out}
        self.assertIsNone(rows['AAA']['spread'])
        b = rows['BBB']
        self.assertAlmostEqual(b['spread'], 1.14)
        self.assertAlmostEqual(b['percentile'], 100 * 14.5 / 15)
        self.assertEqual(b['reading'], 'unusually wide')
        # the crossover step: BB - BBB = (2.22 - 1.14) x 100 = 108 bp, its narrowest ever -> 1/2 of one day = 3.3%
        self.assertAlmostEqual(b['step']['bp'], 108.0)
        self.assertEqual(b['step']['to'], 'BB')
        self.assertAlmostEqual(b['step']['percentile'], 100 * 0.5 / 15)
        self.assertEqual(b['step']['reading'], 'unusually tight')
        self.assertAlmostEqual(b['step']['high'], 150.0)
        # BB's next rating (B) has no data: no step
        self.assertNotIn('step', rows['BB'])
        self.assertEqual([x['rating'] for x in out], [x[0] for x in r.RATINGS])

    def test_steps_use_common_dates_only(self):
        out = r.credit_ladder({'A': [('2026-01-01', 0.8), ('2026-01-02', 0.9)], 'BBB': [('2026-01-02', 1.2)]})
        a = next(x for x in out if x['rating'] == 'A')
        self.assertAlmostEqual(a['step']['bp'], 30.0)
        self.assertEqual(a['step']['date'], '2026-01-02')


class TermPremium(unittest.TestCase):
    def test_split(self):
        fitted = [('2026-10-01', 4.80), ('2026-11-06', 4.8869)]
        prem = [('2026-10-01', 0.95), ('2026-11-06', 0.8738)]
        tp = r.term_premium(fitted, prem)
        # FRED 2026-11-06: THREEFY10 4.8869, THREEFYTP10 0.8738 -> expected short rates 4.0131%
        self.assertAlmostEqual(tp['expected'], 4.0131, places=6)
        self.assertEqual(tp['date'], '2026-11-06')
        self.assertEqual(tp['monthAgo'], 0.95)
        self.assertAlmostEqual(tp['percentile'], 25.0)  # 0.8738 is the lower of two
        self.assertEqual(len(tp['history']), 2)
        self.assertIsNone(r.term_premium([('2026-01-01', 4.0)], [('2026-01-02', 1.0)]))

    def test_history_is_trimmed_to_five_years(self):
        import datetime as dt
        days = [(dt.date(2000, 1, 3) + dt.timedelta(weeks=i)).isoformat() for i in range(600)]
        tp = r.term_premium([(d, 4.0) for d in days], [(d, 0.5 + i / 1000) for i, d in enumerate(days)])
        self.assertEqual(len(tp['history']), r.TP_WEEKS)
        self.assertEqual(tp['history'][-1]['date'], days[-1])
        self.assertAlmostEqual(tp['percentile'], 100 * 599.5 / 600)  # the percentile still uses every reading


class AuctionRows(unittest.TestCase):
    def test_bidder_fields(self):
        # Fiscal Data, 10-year reopening of Oct 7, 2026
        row = invest.auction_row({'auction_date': '2026-10-07', 'security_type': 'Note', 'security_term': '9-Year 10-Month',
                                  'high_yield': '5.3000', 'bid_to_cover_ratio': '2.770000', 'primary_dealer_accepted': '984000000',
                                  'direct_bidder_accepted': '6618200000', 'indirect_bidder_accepted': '31063238000',
                                  'total_accepted': '39926321900', 'inflation_index_security': 'No', 'floating_rate': 'No',
                                  'reopening': 'Yes'})
        self.assertEqual(row['dealers'], 984000000.0)
        self.assertEqual(row['indirect'], 31063238000.0)
        self.assertFalse(row['tips'])
        self.assertFalse(row['frn'])
        self.assertIsNone(invest.auction_row({'primary_dealer_accepted': 'null'})['dealers'])


if __name__ == '__main__':
    unittest.main()
