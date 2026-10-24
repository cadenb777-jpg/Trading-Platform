"""Dividend maths (helper/engine/dividends.py) on made-up dividend histories."""
import asyncio
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import dividends as dv  # noqa: E402

TODAY = dt.date(2026, 10, 24)


def series(start, months_apart, count, amount, grow=0.0):
    """Payments every `months_apart` months from `start`, each `grow` (fraction) bigger than a year before."""
    out = {}
    y, m = start.year, start.month
    for _ in range(count):
        d = dt.date(y, m, min(start.day, 28))
        out[d] = round(amount * (1 + grow) ** ((d - start).days / 365), 6)
        y, m = dv._add_months(y, m, months_apart)
    return {d: a for d, a in out.items() if d <= TODAY}


class DividendTests(unittest.TestCase):
    def test_quarterly_payer(self):
        divs = series(dt.date(2015, 1, 10), 3, 60, 0.50, grow=0.06)
        r = dv.analyse(divs, TODAY, shares=100, cost=8000, price=100)
        self.assertEqual(r['frequency'], 4)
        last = divs[max(divs)]
        self.assertAlmostEqual(r['forward'], last * 4, places=5)
        self.assertAlmostEqual(r['annualIncome'], round(last * 4 * 100, 2))
        self.assertAlmostEqual(r['yield'], last * 4 / 100)
        self.assertAlmostEqual(r['yieldOnCost'], last * 4 * 100 / 8000)
        self.assertAlmostEqual(r['growth5y'], 0.06, delta=0.01)
        self.assertGreater(r['nextExDate'], TODAY.isoformat())
        self.assertEqual(len(r['history12']), 12)
        self.assertAlmostEqual(sum(x['amount'] for x in r['history12']), r['ttm'], places=5)
        self.assertEqual(len(r['upcoming']), 4)
        self.assertAlmostEqual(r['gain'], 2000)

    def test_monthly_and_annual_payers(self):
        monthly = dv.analyse(series(dt.date(2020, 1, 15), 1, 90, 0.25), TODAY, shares=10, price=50)
        self.assertEqual(monthly['frequency'], 12)
        self.assertAlmostEqual(monthly['forward'], 3.0)
        self.assertEqual(len(monthly['upcoming']), 11)  # October's payment was already made
        yearly = dv.analyse(series(dt.date(2018, 5, 1), 12, 10, 2.0), TODAY, shares=10, price=50)
        self.assertEqual(yearly['frequency'], 1)
        self.assertAlmostEqual(yearly['forward'], 2.0)
        self.assertEqual(yearly['nextExDate'][:7], '2027-05')

    def test_special_dividend_is_ignored_for_forward(self):
        divs = series(dt.date(2023, 1, 10), 3, 16, 0.40)
        divs[dt.date(2026, 6, 20)] = 3.00  # one-off special
        r = dv.analyse(divs, TODAY, shares=1, price=40)
        self.assertAlmostEqual(r['forward'], 1.60)
        self.assertTrue(r['specialRecent'])
        self.assertGreater(r['ttm'], 4.5)  # trailing 12 months still includes the special

    def test_dividend_cut(self):
        divs = series(dt.date(2022, 1, 10), 3, 20, 1.00)
        divs[max(divs)] = 0.50
        r = dv.analyse(divs, TODAY, shares=10, price=50)
        self.assertAlmostEqual(r['forward'], 2.0)
        self.assertIn('cut', r['note'])

    def test_no_dividends_and_new_holding(self):
        r = dv.analyse({}, TODAY, shares=5, cost=500, price=120)
        self.assertEqual((r['frequency'], r['annualIncome'], r['yield'], r['nextExDate']), (0, 0.0, 0.0, None))
        self.assertEqual(len(r['history12']), 12)
        new = dv.analyse({dt.date(2026, 8, 1): 0.30, dt.date(2026, 9, 1): 0.30, dt.date(2026, 10, 1): 0.30}, TODAY, shares=100, price=30)
        self.assertEqual(new['frequency'], 12)
        self.assertIsNone(new['growth5y'])
        self.assertAlmostEqual(new['annualIncome'], 360.0)

    def test_stopped_dividends(self):
        r = dv.analyse(series(dt.date(2015, 1, 10), 3, 30, 0.5), TODAY, shares=10, price=20)  # last paid 2022
        self.assertEqual(r['forward'], 0.0)
        self.assertIn('stopped', r['note'])

    def test_summary_and_calendar(self):
        a = {'symbol': 'AAA', **dv.analyse(series(dt.date(2020, 1, 15), 1, 90, 0.25), TODAY, shares=10, cost=400, price=50)}
        b = {'symbol': 'BBB', **dv.analyse(series(dt.date(2019, 2, 10), 3, 40, 1.0), TODAY, shares=20, cost=1500, price=100)}
        s = dv.summarise([a, b], TODAY)
        self.assertEqual(len(s['calendar']), 12)
        self.assertEqual(s['calendar'][0]['month'], '2026-10')
        self.assertAlmostEqual(s['annualIncome'], 30 + 80)
        self.assertAlmostEqual(s['monthly'], 110 / 12, places=2)
        self.assertAlmostEqual(s['value'], 2500)
        self.assertAlmostEqual(s['yieldOnCost'], 110 / 1900)
        self.assertAlmostEqual(sum(m['total'] for m in s['calendar']), 110, delta=10)
        self.assertTrue(all(p['estimated'] for m in s['calendar'] for p in m['payments']))

    def test_handler_merges_and_rejects(self):
        class Ctx:
            async def dividends(self, symbol):
                return {} if symbol == 'NODIV' else series(dt.date(2020, 1, 10), 3, 30, 0.5)
        from engine import invest

        async def quotes(ctx, symbols):
            return {s: {'price': 25.0, 'name': s} for s in symbols}
        orig, invest.quotes = invest.quotes, quotes
        try:
            r = asyncio.run(dv.portfolio(Ctx(), {'holdings': [{'symbol': 'abc', 'shares': 10, 'costBasis': 200}, {'symbol': 'ABC', 'shares': 10}, {'symbol': 'NODIV', 'shares': 1}]}))
            with self.assertRaises(dv.EngineError):
                asyncio.run(dv.portfolio(Ctx(), {'holdings': [{'symbol': 'X', 'shares': 0}]}))
        finally:
            invest.quotes = orig
        abc = next(x for x in r['holdings'] if x['symbol'] == 'ABC')
        self.assertEqual(abc['shares'], 20)
        self.assertEqual(len(r['calendar']), 12)


if __name__ == '__main__':
    unittest.main()
