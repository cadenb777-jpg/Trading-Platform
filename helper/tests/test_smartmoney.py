"""Smart money handlers: insider history from Form 4 (SEC mocked), helper-wide SEC pacing and 13F holders from a prospect.db file."""
import asyncio
import datetime as dt
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import sec, smartmoney  # noqa: E402
from engine.core import EngineError  # noqa: E402


def form4(code, date, shares, price, name='DOE JANE', officer='CEO'):
    return f"""<?xml version="1.0"?><ownershipDocument>
<reportingOwner><reportingOwnerId><rptOwnerName>{name}</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>{officer}</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable><nonDerivativeTransaction>
<transactionDate><value>{date}</value></transactionDate>
<transactionCoding><transactionCode>{code}</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>{shares}</value></transactionShares>
<transactionPricePerShare><value>{price}</value></transactionPricePerShare>
<transactionAcquiredDisposedCode><value>{'A' if code == 'P' else 'D'}</value></transactionAcquiredDisposedCode></transactionAmounts>
</nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>"""


class Resp:
    def __init__(self, text='', data=None):
        self.text, self._data, self.status_code = text, data, 200

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


class Ctx:
    def __init__(self):
        self.sec_contact, self._cache = 'me@example.com', {}

    async def cached(self, key, max_age, load, persist=False, stale_ok=False):
        if key not in self._cache:
            self._cache[key] = await load()
        return self._cache[key]


def days_ago(n):
    return (dt.date.today() - dt.timedelta(days=n)).isoformat()


class InsiderHistory(unittest.TestCase):
    def setUp(self):
        self.recent = {
            'form': ['4', '10-Q', '4', '4', '4'],
            'filingDate': [days_ago(10), days_ago(20), days_ago(40), days_ago(45), days_ago(3000)],
            'accessionNumber': ['0001-24-000001', '0001-24-000002', '0001-24-000003', '0001-24-000004', '0001-10-000005'],
            'primaryDocument': ['xslF345X05/a.xml', 'q.htm', 'xslF345X05/b.xml', 'xslF345X05/c.xml', 'old.xml'],
        }
        self.older = {'form': ['4'], 'filingDate': [days_ago(400)], 'accessionNumber': ['0001-23-000009'], 'primaryDocument': ['d.xml']}
        self.docs = {
            'a.xml': form4('P', days_ago(12), 1000, 50),
            'b.xml': form4('S', days_ago(42), 200, 60, name='Roe Rick', officer='CFO'),
            'c.xml': form4('M', days_ago(46), 500, 10),  # option exercise: left out
            'd.xml': form4('P', days_ago(402), 10, 40),
        }
        self.urls = []

    async def fake_get(self, ctx, url):
        self.urls.append(url)
        if url == sec.TICKERS_URL:
            return Resp(data={'0': {'ticker': 'ACME', 'cik_str': 123, 'title': 'Acme Corp'}})
        if url.endswith('-submissions-001.json'):
            return Resp(data=self.older)
        if 'submissions/CIK' in url:
            return Resp(data={'filings': {'recent': self.recent, 'files': [{'name': 'CIK0000000123-submissions-001.json', 'filingFrom': days_ago(900), 'filingTo': days_ago(300)}]}})
        return Resp(text=self.docs[url.rsplit('/', 1)[1]])

    def run_handler(self, years=3):
        with mock.patch.object(sec, 'sec_get', self.fake_get):
            return asyncio.run(smartmoney.insider_history(Ctx(), {'symbol': 'acme', 'years': years}))

    def test_open_market_trades_and_monthly_net_by_filing_date(self):
        out = self.run_handler()
        self.assertEqual(out['company'], 'Acme Corp')
        self.assertEqual(out['filings'], 4)  # three recent Form 4s + one from the older file; the 3000-day one is out
        self.assertEqual([t['code'] for t in out['trades']], ['P', 'S', 'P'])
        self.assertEqual(out['trades'][-1]['value'], 50000)
        self.assertEqual(out['trades'][-1]['filed'], days_ago(10))
        self.assertEqual(out['trades'][1]['insider'], 'Roe Rick')
        self.assertTrue(all('xslF345' not in u for u in self.urls))  # raw XML, not the styled view
        net = {m['month']: m['net'] for m in out['months']}
        self.assertAlmostEqual(sum(net.values()), 50000 - 12000 + 400)
        self.assertEqual(sorted(net), sorted({days_ago(10)[:7], days_ago(40)[:7], days_ago(400)[:7]}))

    def test_months_follow_the_filing_not_the_trade(self):
        trades = [{'code': 'P', 'date': '2025-01-30', 'filed': '2025-02-03', 'value': 100.0}]
        self.assertEqual(smartmoney.monthly_net(trades), [{'month': '2025-02', 'buy': 100.0, 'sell': 0.0, 'net': 100.0}])

    def test_window_is_respected(self):
        out = self.run_handler(years=1)
        self.assertIn('-submissions-001.json', ' '.join(self.urls))  # the older file overlaps the last year...
        self.assertNotIn('d.xml', ' '.join(self.urls))  # ...but its filing is 400 days old
        self.assertEqual([t['code'] for t in out['trades']], ['S', 'P'])

    def test_needs_sec_email(self):
        ctx = Ctx()
        ctx.sec_contact = ''
        with self.assertRaises(EngineError):
            asyncio.run(smartmoney.insider_history(ctx, {'symbol': 'ACME'}))


class SecPacing(unittest.TestCase):
    """Every SEC request in the helper goes through sec_get, which spaces them helper-wide."""

    def test_sec_get_spaces_all_callers(self):
        calls = []

        class Http:
            async def get(self, url):
                calls.append(time.monotonic())
                return Resp(data={})

        ctx = Ctx()
        ctx.sec_http = Http()

        async def go():
            sec._pace_lock = None
            with mock.patch.object(sec, 'SEC_SPACING', 0.05):
                # different callers asking at once share one limit
                await asyncio.gather(*(sec.sec_get(ctx, f'u{i}') for i in range(3)), *(sec._json(ctx, 'j') for _ in range(2)))
        asyncio.run(go())
        gaps = [b - a for a, b in zip(calls, calls[1:])]
        self.assertEqual(len(calls), 5)
        self.assertTrue(all(g >= 0.045 for g in gaps), gaps)

    def test_default_is_at_most_8_a_second(self):
        self.assertGreaterEqual(sec.SEC_SPACING, 0.125)

    def test_smartmoney_has_no_pacing_of_its_own(self):
        self.assertFalse(hasattr(smartmoney, 'paced_sec_get'))
        self.assertFalse(hasattr(smartmoney, '_pace_lock'))


class Holders13F(unittest.TestCase):
    def make_db(self, rows, cusips=(('000000AA1', 'ACME', 123),)):
        path = os.path.join(tempfile.mkdtemp(), 'prospect.db')
        con = sqlite3.connect(path)
        con.execute('CREATE TABLE holdings_13f (cik INTEGER, period TEXT, cusip TEXT, issuer TEXT, class TEXT, value REAL, shares REAL, share_type TEXT, put_call TEXT, discretion TEXT, accession TEXT)')
        con.execute('CREATE TABLE cusip_map (cusip TEXT PRIMARY KEY, ticker TEXT, cik INTEGER, name TEXT, method TEXT, sector TEXT, sic TEXT)')
        con.executemany("INSERT INTO cusip_map VALUES (?, ?, ?, 'ACME', 'name', NULL, NULL)", cusips)
        con.executemany('INSERT INTO holdings_13f VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [(cik, period, cusip, 'ACME CORP', cls, shares * 10, shares, 'SH', pc, 'SOLE', 'x') for cik, period, cusip, shares, pc, cls in rows])
        con.commit()
        con.close()
        return path

    @staticmethod
    def row(cik, period, shares, cusip='000000AA1', pc='', cls='COM'):
        return (cik, period, cusip, shares, pc, cls)

    def test_quarter_changes_among_filers_in_both_quarters(self):
        r = self.row
        rows = [
            r(1, '2025-03-31', 100), r(2, '2025-03-31', 50), r(3, '2025-03-31', 10), r(7, '2025-03-31', 40),
            r(1, '2025-06-30', 150), r(2, '2025-06-30', 20), r(4, '2025-06-30', 5),
            r(3, '2025-06-30', 9, cusip='999999ZZ9'),  # filer 3 reported, without ACME: sold out
            # filer 7 didn't report June at all (late): not a sale; filer 4 didn't report March: not "new"
            r(5, '2025-06-30', 999, pc='Put'),  # options don't count
            r(9, '2024-12-31', 77),  # a stale quarter one slow filer still holds: ignored
        ]
        out = smartmoney.holders_from_db(self.make_db(rows), 123, 'ACME')
        q = out['quarters']
        self.assertEqual([x['period'] for x in q], ['2025-03-31', '2025-06-30'])
        self.assertEqual([x['holders'] for x in q], [4, 3])
        self.assertEqual(q[1]['shares'], 175)
        self.assertEqual((q[1]['new'], q[1]['added'], q[1]['reduced'], q[1]['soldOut']), (0, 1, 1, 1))
        self.assertNotIn('new', q[0])

    def test_share_classes_stay_apart(self):
        cusips = (('02079K305', 'GOOG', 1652044), ('02079K107', 'GOOG', 1652044))
        rows = [self.row(1, '2025-06-30', 100, cusip='02079K305', cls='CAP STK CL A'), self.row(2, '2025-06-30', 300, cusip='02079K107', cls='CAP STK CL C'),
                self.row(3, '2025-06-30', 50, cusip='02079K305', cls='CAP STK CL A')]
        out = smartmoney.holders_from_db(self.make_db(rows, cusips), 1652044, 'GOOGL')
        self.assertEqual(out['quarters'][0]['holders'], 1)  # one class, never the two summed
        self.assertIn('share classes', out['note'])
        brk = (('084670702', 'BRK-A', 1067983), ('084670108', 'BRK-A', 1067983))
        rows = [self.row(1, '2025-06-30', 5, cusip='084670108', cls='CL A'), self.row(2, '2025-06-30', 9000, cusip='084670702', cls='CL B NEW'),
                self.row(3, '2025-06-30', 8000, cusip='084670702', cls='CL B NEW')]
        out = smartmoney.holders_from_db(self.make_db(rows, brk), 1067983, 'BRK.B')
        self.assertEqual((out['cusip'], out['note']), ('084670702', ''))
        self.assertEqual(smartmoney.holders_from_db(self.make_db(rows, brk), 1067983, 'BRK.A')['cusip'], '084670108')

    def test_handler_matches_any_sec_ticker_of_the_company(self):
        path = self.make_db([self.row(1, '2025-06-30', 10, cusip='02079K305')], (('02079K305', 'GOOG', 1652044),))
        seen = []

        async def company(ctx, symbol):
            seen.append(symbol)
            return {'cik': 1652044, 'name': 'Alphabet Inc.'}
        with mock.patch.object(smartmoney, 'PROSPECT_DB', Path(path)), mock.patch.object(sec, 'company', company):
            out = asyncio.run(smartmoney.holders_by_symbol(Ctx(), {'symbol': 'googl'}))
        self.assertEqual(seen, ['GOOGL'])
        self.assertEqual(out['quarters'][0]['holders'], 1)

    def test_missing_download_says_what_to_do(self):
        with self.assertRaises(EngineError) as e:
            smartmoney.holders_from_db('/nonexistent/prospect.db', 123)
        self.assertIn('Prospecting first', str(e.exception))
        with self.assertRaises(EngineError) as e:
            smartmoney.holders_from_db(self.make_db([]), 123)
        self.assertIn('Prospecting first', str(e.exception))

    def test_busy_database_says_try_again(self):
        path = self.make_db([self.row(1, '2025-06-30', 10)])
        locker = sqlite3.connect(path)
        locker.execute('PRAGMA locking_mode=EXCLUSIVE')
        locker.execute('BEGIN EXCLUSIVE')
        real_connect = sqlite3.connect
        try:
            with mock.patch.object(smartmoney.sqlite3, 'connect', lambda *a, **k: real_connect(*a, **{**k, 'timeout': 0.1})), self.assertRaises(EngineError) as e:
                smartmoney.holders_from_db(path, 123)
        finally:
            locker.rollback()
            locker.close()
        self.assertIn('busy', str(e.exception))

    def test_unmapped_company(self):
        with self.assertRaises(EngineError) as e:
            smartmoney.holders_from_db(self.make_db([self.row(1, '2025-03-31', 1)]), 999, 'XYZ')
        self.assertIn('CUSIP', str(e.exception))


if __name__ == '__main__':
    unittest.main()
