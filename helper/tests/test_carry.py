"""Index futures fair value (engine/carry.py) against hand-worked values.

Hand working (S&P 500 at 6,000, SOFR 4.30%, dividend yield 1.20%, 36 days to expiry):
  financing  6000 x 0.043 x 36/360 = 25.80
  dividends  6000 x 0.012 x 36/365 = 7.10137
  fair value 6000 + 25.80 - 7.10137 = 6,018.69863   (fair premium 18.69863)
  futures at 6,020: implied rate = ((6020 + 7.10137) / 6000 - 1) x 360/36 = 4.51690%  (+21.69 bp over SOFR)
  cash shut, futures at 6,020: implied open = 6020 - 18.69863 = 6,001.30137  (+0.02169%)
  roll to a contract 91 days later priced 6,075: fair = 6020 x (1 + 0.043 x 91/360) - 6020 x 0.012 x 91/365
  = 6020 + 65.43406 - 18.01052 = 6,067.42354, so the next contract is rich by 7.57646 points = $378.82 per E-mini.
"""
import datetime as dt
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import carry  # noqa: E402

M = carry.MARKETS[0]


class FairValue(unittest.TestCase):
    def test_hand_worked(self):
        self.assertAlmostEqual(carry.fair_value(6000, 0.043, 0.012, 36), 6018.69863, places=4)

    def test_close_to_hulls_continuous_form(self):
        # F0 = S0 e^((r - q) T) with the ACT/360 rate restated on ACT/365 (Hull ch. 5): same price within 0.1 point
        cont = 6000 * math.exp((0.043 * 365 / 360 - 0.012) * 36 / 365)
        self.assertLess(abs(carry.fair_value(6000, 0.043, 0.012, 36) - cont), 0.1)

    def test_expiry_day_is_the_index(self):
        self.assertEqual(carry.fair_value(6000, 0.043, 0.012, 0), 6000)

    def test_implied_rate_inverts_fair_value(self):
        self.assertAlmostEqual(carry.implied_rate(6020, 6000, 0.012, 36), 0.0451690, places=6)
        fv = carry.fair_value(6000, 0.05, 0.012, 50)
        self.assertAlmostEqual(carry.implied_rate(fv, 6000, 0.012, 50), 0.05, places=12)

    def test_missing_inputs_give_none(self):
        self.assertIsNone(carry.fair_value(None, 0.043, 0.012, 36))
        self.assertIsNone(carry.fair_value(6000, float('nan'), 0.012, 36))
        self.assertIsNone(carry.implied_rate(6020, 6000, 0.012, 0))


class IndexYield(unittest.TestCase):
    TODAY = dt.date(2026, 12, 18)
    # quarterly payments on third Fridays: on 2026-12-18 a 365-day window would hold 5 of them
    DIVS = {dt.date(2025, 12, 19): 1.9, dt.date(2026, 3, 20): 1.7, dt.date(2026, 6, 19): 1.8,
            dt.date(2026, 9, 18): 1.8, dt.date(2026, 12, 18): 2.0}

    def test_last_regular_payment_times_four_plus_the_fee(self):
        # 2.00 x 4 / 600 + 0.0945% = 1.3333% + 0.0945%
        self.assertAlmostEqual(carry.index_yield(self.DIVS, 600, self.TODAY, 0.000945), 8.0 / 600 + 0.000945)

    def test_needs_a_regular_record(self):
        self.assertIsNone(carry.index_yield({dt.date(2026, 6, 1): 2.0}, 600, self.TODAY, 0))
        self.assertIsNone(carry.index_yield(None, 600, self.TODAY, 0))
        self.assertIsNone(carry.index_yield(self.DIVS, None, self.TODAY, 0))


class Dates(unittest.TestCase):
    def test_next_session(self):
        ny = carry.NY
        self.assertEqual(carry.next_session(dt.datetime(2026, 11, 13, 8, 0, tzinfo=ny)), dt.date(2026, 11, 13))  # Fri pre-open
        self.assertEqual(carry.next_session(dt.datetime(2026, 11, 13, 18, 0, tzinfo=ny)), dt.date(2026, 11, 16))  # Fri night
        self.assertEqual(carry.next_session(dt.datetime(2026, 11, 14, 12, 0, tzinfo=ny)), dt.date(2026, 11, 16))  # Saturday
        self.assertEqual(carry.next_session(dt.datetime(2026, 11, 25, 20, 0, tzinfo=ny)), dt.date(2026, 11, 27))  # Thanksgiving

    def test_sofr_quarter_has_not_started(self):
        code, start = carry.sofr_quarter(dt.date(2026, 11, 11))
        self.assertEqual(code, 'SR3Z26')
        self.assertEqual(start, dt.date(2026, 12, 1))


class Row(unittest.TestCase):
    FRONT = {'code': 'ESZ26', 'expiry': '2026-12-18', 'days': 36, 'price': 6020.0}
    NEXT = {'code': 'ESH27', 'expiry': '2027-03-19', 'days': 127, 'price': 6075.0}

    def test_cash_open_gives_the_rate_not_the_open(self):
        r = carry.carry_row(M, 6000, 0.043, 0.012, self.FRONT, self.NEXT, True, 50)
        self.assertAlmostEqual(r['fairPremium'], 18.69863, places=4)
        self.assertAlmostEqual(r['mispricing'], 1.30137, places=4)
        self.assertAlmostEqual(r['mispricingUsd'], 65.0685, places=3)
        self.assertAlmostEqual(r['spreadBp'], 21.690, places=2)
        self.assertIsNone(r['impliedOpen'])

    def test_cash_shut_gives_the_open_not_the_rate(self):
        r = carry.carry_row(M, 6000, 0.043, 0.012, self.FRONT, None, False, 50)
        self.assertAlmostEqual(r['impliedOpen'], 6001.30137, places=4)
        self.assertAlmostEqual(r['impliedOpenChange'], 0.0002169, places=6)
        self.assertIsNone(r['impliedRate'])
        self.assertIsNone(r['roll'])

    def test_roll(self):
        roll = carry.carry_row(M, 6000, 0.043, 0.012, self.FRONT, self.NEXT, True, 50)['roll']
        self.assertEqual(roll['days'], 91)
        self.assertAlmostEqual(roll['rich'], 7.57646, places=4)
        self.assertAlmostEqual(roll['richUsd'], 378.823, places=2)
        self.assertAlmostEqual(roll['spread'], 55.0)

    def test_no_dividend_yield_no_figures(self):
        r = carry.carry_row(M, 6000, 0.043, None, self.FRONT, self.NEXT, True, 50)
        self.assertIsNone(r['fairValue'])
        self.assertIsNone(r['roll'])

    def test_no_futures_price_keeps_the_fair_value(self):
        r = carry.carry_row(M, 6000, 0.043, 0.012, {**self.FRONT, 'price': None}, None, False, 50)
        self.assertAlmostEqual(r['fairValue'], 6018.69863, places=4)
        self.assertIsNone(r['mispricing'])
        self.assertIsNone(r['impliedOpen'])


class NeverTrades(unittest.TestCase):
    def test_no_order_words(self):
        with open(carry.__file__, encoding='utf-8') as f:
            src = f.read()
        for word in ('place_order', 'preview_order', 'webull'):
            self.assertNotIn(word, src)


class Resp:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


class FakeSchwab:
    """Front ES 20 points over the index, the next contract 55 over that; QQQ/DIA/IWM missing on purpose."""
    def __init__(self, status=200):
        self.status = status

    async def get_quotes(self, symbols):
        if self.status != 200:
            return Resp(self.status, {})
        es = [c['code'] for c in carry.futures_market.contracts('ES', carry.dt.datetime.now(carry.NY).date(), 3)
              if carry.days_to(c['expiry'], carry.dt.datetime.now(carry.NY).date()) >= 0]
        prices = {'$SPX': 6000.0, 'SPY': 600.0, f'/{es[0]}': 6020.0, f'/{es[1]}': 6075.0}
        return Resp(200, {s: {'quote': {'lastPrice': p, 'tradeTime': 1794370000000}} for s, p in prices.items() if s in symbols})


class FakeCtx:
    def __init__(self, schwab):
        self.schwab, self.http, self._cache = schwab, None, {}

    async def cached(self, key, max_age, load, persist=False, stale_ok=False):
        if key not in self._cache:
            self._cache[key] = await load()
        return self._cache[key]

    async def dividends(self, symbol):
        if symbol != 'SPY':
            return None
        today = carry.dt.datetime.now(carry.NY).date()
        return {today - carry.dt.timedelta(days=d): 1.8 for d in (30, 120, 210, 300)}


class Handler(unittest.TestCase):
    def run_it(self, status=200):
        import asyncio
        from unittest import mock

        async def sofr(ctx, sid):
            return [('2026-11-09', 4.30)]
        with mock.patch.object(carry.macro, 'fred', sofr), mock.patch.object(carry, 'market_session', lambda: 'open'):
            return asyncio.run(carry.carry(FakeCtx(FakeSchwab(status)), {}))

    def test_es_has_figures_and_the_others_say_why(self):
        out = self.run_it()
        es, nq = out['rows'][0], out['rows'][1]
        self.assertEqual(es['root'], 'ES')
        q = 1.8 * 4 / 600 + 0.000945
        self.assertAlmostEqual(out['yields']['SPY']['value'], q)
        self.assertAlmostEqual(es['fairValue'], carry.fair_value(6000, 0.043, q, es['contract']['days']))
        self.assertIsNotNone(es['spreadBp'])
        self.assertIsNotNone(es['roll'])
        self.assertIsNone(nq['fairValue'])
        self.assertIn('Schwab didn’t price QQQ', nq['why'])
        self.assertEqual(out['rate']['value'], 0.043)
        self.assertEqual(out['rate']['source'], 'fred')

    def test_schwab_down_says_so(self):
        out = self.run_it(status=500)
        self.assertTrue(out['errors'])
        self.assertTrue(all(r['fairValue'] is None for r in out['rows']))

    def test_login_expired_is_raised(self):
        with self.assertRaises(carry.EngineError):
            self.run_it(status=401)


if __name__ == '__main__':
    unittest.main()
