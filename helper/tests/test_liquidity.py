"""Interval and tender-offer funds: repurchase notices from SEC filings (parsing only; no network)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import liquidity as liq  # noqa: E402

NOTICE = """<html><body><p>NOTIFICATION OF REPURCHASE OFFER</p>
<p>The Fund is offering to repurchase up to 5% of the Fund&#8217;s outstanding shares.</p>
<p>The Repurchase Request Deadline is <b>March 14, 2026</b> at 4:00 p.m. Eastern Time.</p>
<p>The Repurchase Pricing Date will be March&nbsp;14, 2026.</p></body></html>"""

TENDER = "The Fund is offering to purchase up to 2.5% of its outstanding shares. The offer will expire at 11:59 p.m. on Friday, May 29, 2026, unless extended."


class Notices(unittest.TestCase):
    def test_interval_notice(self):
        got = liq.parse_notice(liq.plain(NOTICE))
        self.assertEqual(got, {'deadline': '2026-03-14', 'pricingDate': '2026-03-14', 'percent': 5.0})

    def test_tender_offer(self):
        got = liq.parse_notice(TENDER)
        self.assertEqual((got['deadline'], got['percent']), ('2026-05-29', 2.5))

    def test_missing_parts_are_none(self):
        self.assertEqual(liq.parse_notice('nothing here'), {'deadline': None, 'pricingDate': None, 'percent': None})

    def test_next_offer_estimate_from_the_usual_gap(self):
        self.assertEqual(liq.next_estimate(['2025-02-14', '2025-05-15', '2025-08-14', '2025-11-14']), '2026-02-13')
        self.assertIsNone(liq.next_estimate(['2025-02-14', '2025-05-15']))

    def test_sec_fund_ticker_file(self):
        data = {'fields': ['cik', 'seriesId', 'classId', 'symbol'], 'data': [[1784254, 'S000071000', 'C000226000', 'cclfx'], [36405, 'S1', 'C1', 'VFIAX']]}
        self.assertEqual(liq.parse_mf_tickers(data), {'CCLFX': 1784254, 'VFIAX': 36405})
        self.assertEqual(liq.parse_mf_tickers({}), {})


if __name__ == '__main__':
    unittest.main()
