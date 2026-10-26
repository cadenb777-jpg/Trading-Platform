"""Account page (v33): first-seen share logs kept at each portfolio save, dividends received and the owner's overrides."""
import asyncio
import datetime as dt
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import dividends as dv  # noqa: E402
from engine import store  # noqa: E402

D = dt.date
TODAY = D(2026, 10, 26)
#: quarterly $0.50 ex-dates; the last one (Oct 1) has not been paid yet (pay = ex + 21 days)
DIVS = {D(2026, 1, 10): 0.5, D(2026, 4, 10): 0.5, D(2026, 7, 10): 0.5, D(2026, 10, 10): 0.5}


def portfolio(*holdings, mode='shares'):
    return {'name': 'Roth', 'mode': mode, 'holdings': [dict(h) for h in holdings]}


def stock(symbol, shares, **kw):
    return {'symbol': symbol, 'kind': 'security', 'shares': shares, 'weight': 0, 'assetClass': 'US stocks', **kw}


class TrackHoldingsTests(unittest.TestCase):
    def test_first_seen_then_changes_only(self):
        a = store.track_holdings(None, portfolio(stock('KO', 10)), D(2026, 1, 1))
        self.assertEqual(a['holdings'][0]['seen'], [{'date': '2026-01-01', 'shares': 10.0}])
        # a Webull sync rebuilds the holdings without the log: it is carried forward, unchanged shares add nothing
        b = store.track_holdings(a, portfolio(stock('KO', 10)), D(2026, 2, 1))
        self.assertEqual(b['holdings'][0]['seen'], [{'date': '2026-01-01', 'shares': 10.0}])
        c = store.track_holdings(b, portfolio(stock('ko', 15)), D(2026, 3, 1))
        self.assertEqual([e['shares'] for e in c['holdings'][0]['seen']], [10.0, 15.0])
        # two changes on one day keep only the latest
        d = store.track_holdings(c, portfolio(stock('KO', 16)), D(2026, 3, 1))
        self.assertEqual(d['holdings'][0]['seen'][-1], {'date': '2026-03-01', 'shares': 16.0})
        self.assertEqual(len(d['holdings'][0]['seen']), 2)

    def test_owner_fields_kept_and_cleared(self):
        a = store.track_holdings(None, portfolio(stock('KO', 10, purchaseDate='2020-05-01', dividends=120, dividendsAsOf='2026-01-01')), D(2026, 1, 1))
        synced = store.track_holdings(a, portfolio(stock('KO', 10)), D(2026, 2, 1))  # sync knows nothing of them
        self.assertEqual(synced['holdings'][0]['purchaseDate'], '2020-05-01')
        self.assertEqual(synced['holdings'][0]['dividends'], 120)
        cleared = store.track_holdings(synced, portfolio(stock('KO', 10, dividends=None)), D(2026, 2, 2))
        self.assertNotIn('dividends', cleared['holdings'][0])
        self.assertEqual(cleared['holdings'][0]['purchaseDate'], '2020-05-01')

    def test_statement_never_replaces_typed_dividends(self):
        typed = store.track_holdings(None, portfolio(stock('KO', 10, dividends=80, dividendsSource='entered', dividendsAsOf='2026-01-01')), D(2026, 1, 1))
        again = store.track_holdings(typed, portfolio(stock('KO', 10, dividends=55, dividendsSource='statement', dividendsAsOf='2026-02-01')), D(2026, 2, 1))
        self.assertEqual((again['holdings'][0]['dividends'], again['holdings'][0]['dividendsSource']), (80, 'entered'))
        # a statement figure can be updated by a newer statement
        st = store.track_holdings(None, portfolio(stock('KO', 10, dividends=40, dividendsSource='statement', dividendsAsOf='2026-01-01')), D(2026, 1, 1))
        st2 = store.track_holdings(st, portfolio(stock('KO', 10, dividends=55, dividendsSource='statement', dividendsAsOf='2026-02-01')), D(2026, 2, 1))
        self.assertEqual(st2['holdings'][0]['dividends'], 55)

    def test_lots_share_one_log_on_the_first_holding(self):
        a = store.track_holdings(None, portfolio(stock('KO', 10, purchaseDate='2020-01-02'), stock('KO', 5)), D(2026, 1, 1))
        self.assertEqual(a['holdings'][0]['seen'], [{'date': '2026-01-01', 'shares': 15.0}])
        self.assertNotIn('seen', a['holdings'][1])
        # selling one lot changes the total; the owner's fields stay on the first holding only
        b = store.track_holdings(a, portfolio(stock('KO', 10), stock('KO', 2, purchaseDate='2021-01-01')), D(2026, 2, 1))
        self.assertEqual([e['shares'] for e in b['holdings'][0]['seen']], [15.0, 12.0])
        self.assertEqual(b['holdings'][0]['purchaseDate'], '2020-01-02')
        self.assertNotIn('purchaseDate', b['holdings'][1])

    def test_first_seen_never_moves_forward(self):
        a = store.track_holdings(None, portfolio(stock('KO', 10)), D(2026, 1, 1))
        # the browser can't replace the log (a stale or empty copy is ignored)
        for sent in ([], [{'date': '2026-05-01', 'shares': 10}]):
            b = store.track_holdings(a, portfolio(stock('KO', 10, seen=sent)), D(2026, 6, 1))
            self.assertEqual(b['holdings'][0]['seen'][0]['date'], '2026-01-01')
        # sold out, then bought back: the archived log comes back with a new entry
        gone = store.track_holdings(a, portfolio(stock('PG', 1)), D(2026, 3, 1))
        self.assertEqual(gone['seenArchive']['KO']['seen'][0]['date'], '2026-01-01')
        back = store.track_holdings(gone, portfolio(stock('PG', 1), stock('KO', 4)), D(2026, 4, 1))
        self.assertEqual([e['date'] for e in back['holdings'][1]['seen']], ['2026-01-01', '2026-04-01'])
        self.assertNotIn('seenArchive', back)

    def test_owner_fields_checked(self):
        for bad in ({'purchaseDate': '2099-01-01'}, {'purchaseDate': 'yesterday'}, {'dividends': -5}, {'dividends': float('nan')},
                    {'rocPct': 1.5}, {'rocPct': -0.1}, {'rocYear': '20x5'}, {'dividendsAsOf': '2026-13-01'}):
            with self.assertRaises(Exception, msg=bad):
                store.track_holdings(None, portfolio(stock('KO', 1, **bad)), D(2026, 1, 1))
        ok = store.track_holdings(None, portfolio(stock('KO', 1, purchaseDate='2025-12-31', dividends=0, rocPct=1, rocYear='2025')), D(2026, 1, 1))
        self.assertEqual(ok['holdings'][0]['rocPct'], 1)

    def test_cash_and_percent_portfolios_untouched(self):
        cash = {'symbol': 'CASH', 'kind': 'cash', 'amount': 50, 'weight': 0, 'assetClass': 'Cash'}
        a = store.track_holdings(None, portfolio(stock('KO', 1), cash), TODAY)
        self.assertNotIn('seen', a['holdings'][1])
        w = store.track_holdings(None, portfolio(stock('KO', 0), mode='weight'), TODAY)
        self.assertNotIn('seen', w['holdings'][0])

    def test_save_doc_tracks(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_path, old_db = store.DB_PATH, store._db
            store.DB_PATH, store._db = Path(tmp) / 'platform.db', None
            try:
                saved = store.save_doc('portfolios', portfolio(stock('KO', 3)))
                self.assertEqual(saved['holdings'][0]['seen'][0]['shares'], 3.0)
                again = store.save_doc('portfolios', {**saved, 'holdings': [stock('KO', 3)]})
                self.assertEqual(again['holdings'][0]['seen'], saved['holdings'][0]['seen'])
            finally:
                store._db.close()
                store.DB_PATH, store._db = old_path, old_db


class ReceivedTests(unittest.TestCase):
    def test_tracked_since_first_seen(self):
        r = dv.received_dividends(DIVS, TODAY, [{'date': '2026-03-01', 'shares': 10}])
        self.assertEqual(r['method'], 'tracked')
        self.assertEqual(r['since'], '2026-03-01')
        # April and July count; January was before first seen; October's pay date hasn't passed
        self.assertEqual([p['exDate'] for p in r['payments']], ['2026-04-10', '2026-07-10'])
        self.assertAlmostEqual(r['amount'], 10.0)

    def test_shares_follow_the_log(self):
        log = [{'date': '2026-03-01', 'shares': 10}, {'date': '2026-05-01', 'shares': 30}]
        r = dv.received_dividends(DIVS, TODAY, log)
        self.assertEqual([p['shares'] for p in r['payments']], [10, 30])
        self.assertAlmostEqual(r['amount'], 20.0)

    def test_purchase_date_overrides_first_seen(self):
        r = dv.received_dividends(DIVS, TODAY, [{'date': '2026-06-01', 'shares': 10}], purchase='2025-12-01')
        self.assertEqual(r['method'], 'purchase')
        self.assertEqual(r['firstSeen'], '2026-06-01')
        # before the log starts, today's first logged share count is assumed
        self.assertAlmostEqual(r['amount'], 15.0)
        # bought on the ex-date: not entitled
        self.assertAlmostEqual(dv.received_dividends(DIVS, TODAY, [{'date': '2026-06-01', 'shares': 10}], purchase='2026-04-10')['amount'], 5.0)

    def test_entered_total_plus_later_payments(self):
        r = dv.received_dividends(DIVS, TODAY, [{'date': '2026-01-01', 'shares': 10}], base=100, base_as_of='2026-05-01')
        self.assertEqual(r['method'], 'entered')
        self.assertAlmostEqual(r['base'], 100)
        self.assertAlmostEqual(r['estimated'], 5.0)  # July only
        self.assertAlmostEqual(r['amount'], 105.0)
        s = dv.received_dividends(DIVS, TODAY, None, base=40, base_as_of='2026-10-01', base_source='statement')
        self.assertEqual((s['method'], s['amount']), ('statement', 40.0))

    def test_splits_convert_logged_shares_to_todays_shares(self):
        # 10 shares logged in March, a 2-for-1 split in June: Yahoo's amounts are per today's share
        log = [{'date': '2026-03-01', 'shares': 10}]
        r = dv.received_dividends(DIVS, TODAY, log, splits={D(2026, 6, 1): 2.0})
        self.assertEqual([p['shares'] for p in r['payments']], [20.0, 20.0])
        self.assertAlmostEqual(r['amount'], 20.0)
        self.assertIn('split', r['note'])
        # splits unknown: flagged, not guessed
        self.assertIn('couldn’t be checked', dv.received_dividends(DIVS, TODAY, log, splits=None)['note'])
        self.assertNotIn('note', dv.received_dividends(DIVS, TODAY, log, splits={}))

    def test_nothing_to_go_on(self):
        r = dv.received_dividends(DIVS, TODAY)
        self.assertEqual(r['method'], 'none')
        self.assertIsNone(r['amount'])

    def test_handler_records_first_seen_for_old_portfolios(self):
        class Ctx:
            async def dividends(self, symbol):
                return DIVS if symbol == 'KO' else None

        with tempfile.TemporaryDirectory() as tmp:
            old_path, old_db = store.DB_PATH, store._db
            store.DB_PATH, store._db = Path(tmp) / 'platform.db', None
            try:
                doc = {**portfolio(stock('KO', 4), stock('ZZZ', 2)), 'id': 'p1'}
                store.db().execute('INSERT INTO docs VALUES (?, ?, ?, ?)', ('portfolios', 'p1', __import__('json').dumps(doc), 0))
                out = asyncio.run(dv.received(Ctx(), [{'key': 'p1:KO', 'portfolioId': 'p1', 'symbol': 'KO'},
                                                      {'key': 'p1:ZZZ', 'portfolioId': 'p1', 'symbol': 'ZZZ'}], TODAY))
                self.assertEqual(out['p1:KO']['method'], 'tracked')
                self.assertEqual(out['p1:KO']['since'], dt.date.today().isoformat())
                self.assertIsNone(out['p1:ZZZ']['amount'])
                self.assertTrue(store.get_doc('portfolios', 'p1')['holdings'][0]['seen'])
            finally:
                store._db.close()
                store.DB_PATH, store._db = old_path, old_db


class PayoutSeriesTests(unittest.TestCase):
    def test_last_five_years_with_their_dividends(self):
        start = dt.datetime(2019, 1, 1, 21, tzinfo=dt.timezone.utc)
        bars = [{'time': int((start + dt.timedelta(days=i)).timestamp()), 'close': 10 + i * 0.001} for i in range(0, 7 * 365)]
        divs = {D(2018, 6, 1): 1.0, D(2023, 6, 1): 0.1, D(2025, 6, 1): 0.2, D(2025, 7, 1): 0}
        out = dv.payout_series(bars, divs)
        first, last = D.fromisoformat(out['closes'][0][0]), D.fromisoformat(out['closes'][-1][0])
        self.assertAlmostEqual((last - first).days, round(365.25 * 5) + 7, delta=1)
        self.assertEqual(out['dividends'], [['2023-06-01', 0.1], ['2025-06-01', 0.2]])
        self.assertEqual(dv.payout_series([], divs), {'closes': [], 'dividends': []})

    def test_handler(self):
        class Ctx:
            async def daily_bars(self, symbol, years):
                return [{'time': 1700000000, 'close': 5}, {'time': 1700086400, 'close': 6}]

            async def dividends(self, symbol):
                return {} if symbol == 'QYLD' else None

        self.assertEqual(asyncio.run(dv.history(Ctx(), {'symbol': 'qyld'}))['closes'][-1][1], 6.0)
        with self.assertRaises(Exception):
            asyncio.run(dv.history(Ctx(), {'symbol': 'NONE'}))


class SinceInceptionTests(unittest.TestCase):
    def test_young_fund_gets_since_inception(self):
        # a 2-year-old income fund: price falls 10% a year, pays 1% of price monthly
        days = [D(2024, 10, 26) + dt.timedelta(days=i) for i in range(0, 731)]
        closes = [(d, 20 * 0.9 ** (i / 365.25)) for i, d in enumerate(days)]
        divs = {d: c * 0.01 for i, (d, c) in enumerate(closes) if i and d.day == 15}
        r = dv.total_return_stats(closes, divs)
        self.assertIsNone(r['tr3y'])
        self.assertEqual(r['sinceStart'], '2024-10-26')
        self.assertAlmostEqual(r['sinceYears'], 2.0, places=1)
        self.assertAlmostEqual(r['priceSince'], -0.10, places=3)
        self.assertGreater(r['trSince'], r['priceSince'])
        # under a year: the plain change, not a yearly rate
        short = dv.total_return_stats(closes[:100], {})
        self.assertLess(short['sinceYears'], 1)
        self.assertAlmostEqual(short['priceSince'], closes[99][1] / closes[0][1] - 1)
        self.assertIsNone(dv.total_return_stats([], {})['trSince'])


if __name__ == '__main__':
    unittest.main()
