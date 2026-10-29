"""Smart money handlers: insider history from Form 4 (SEC mocked) and 13F holders from a prospect.db file."""
import asyncio
import datetime as dt
import os
import sqlite3
import sys
import tempfile
import unittest
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
        smartmoney._pace_lock = None
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
        with mock.patch.object(sec, 'sec_get', self.fake_get), mock.patch.object(smartmoney, 'SEC_SPACING', 0):
            return asyncio.run(smartmoney.insider_history(Ctx(), {'symbol': 'acme', 'years': years}))

    def test_open_market_trades_and_monthly_net(self):
        out = self.run_handler()
        self.assertEqual(out['company'], 'Acme Corp')
        self.assertEqual(out['filings'], 4)  # three recent Form 4s + one from the older file; the 3000-day one is out
        self.assertEqual([t['code'] for t in out['trades']], ['P', 'S', 'P'])
        self.assertEqual(out['trades'][-1]['value'], 50000)
        self.assertEqual(out['trades'][1]['insider'], 'Roe Rick')
        self.assertTrue(all('xslF345' not in u for u in self.urls))  # raw XML, not the styled view
        net = {m['month']: m['net'] for m in out['months']}
        self.assertAlmostEqual(sum(net.values()), 50000 - 12000 + 400)

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

    def test_pacing_spaces_requests(self):
        calls = []

        async def fake(ctx, url):
            calls.append(asyncio.get_running_loop().time())
            return Resp()

        async def go():
            with mock.patch.object(sec, 'sec_get', fake), mock.patch.object(smartmoney, 'SEC_SPACING', 0.05):
                await asyncio.gather(*(smartmoney.paced_sec_get(None, 'u') for _ in range(4)))
        smartmoney._pace_lock = None
        asyncio.run(go())
        gaps = [b - a for a, b in zip(calls, calls[1:])]
        self.assertTrue(all(g >= 0.045 for g in gaps), gaps)


class Holders13F(unittest.TestCase):
    def make_db(self, rows, mapped=True):
        path = os.path.join(tempfile.mkdtemp(), 'prospect.db')
        con = sqlite3.connect(path)
        con.execute('CREATE TABLE holdings_13f (cik INTEGER, period TEXT, cusip TEXT, issuer TEXT, class TEXT, value REAL, shares REAL, share_type TEXT, put_call TEXT, discretion TEXT, accession TEXT)')
        con.execute('CREATE TABLE cusip_map (cusip TEXT PRIMARY KEY, ticker TEXT, cik INTEGER, name TEXT, method TEXT, sector TEXT, sic TEXT)')
        if mapped:
            con.execute("INSERT INTO cusip_map VALUES ('000000AA1', 'ACME', 123, 'ACME CORP', 'name', NULL, NULL)")
        con.executemany('INSERT INTO holdings_13f VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [(cik, period, cusip, 'ACME CORP', 'COM', shares * 10, shares, 'SH', pc, 'SOLE', 'x') for cik, period, cusip, shares, pc in rows])
        con.commit()
        con.close()
        return path

    def test_quarter_changes(self):
        path = self.make_db([
            (1, '2025-03-31', '000000AA1', 100, ''), (2, '2025-03-31', '000000AA1', 50, ''), (3, '2025-03-31', '000000AA1', 10, ''),
            (1, '2025-06-30', '000000AA1', 150, ''), (2, '2025-06-30', '000000AA1', 20, ''), (4, '2025-06-30', '000000AA1', 5, ''),
            (5, '2025-06-30', '000000AA1', 999, 'PUT'),  # options don't count
            (6, '2025-06-30', '999999ZZ9', 999, ''),  # another company
        ])
        q = smartmoney.holders_from_db(path, 'ACME')
        self.assertEqual([r['holders'] for r in q], [3, 3])
        self.assertEqual(q[1]['shares'], 175)
        self.assertEqual((q[1]['new'], q[1]['added'], q[1]['reduced'], q[1]['soldOut']), (1, 1, 1, 1))
        self.assertNotIn('new', q[0])

    def test_missing_download_says_what_to_do(self):
        with self.assertRaises(EngineError) as e:
            smartmoney.holders_from_db('/nonexistent/prospect.db', 'ACME')
        self.assertIn('Prospecting', str(e.exception))
        with self.assertRaises(EngineError) as e:
            smartmoney.holders_from_db(self.make_db([]), 'ACME')
        self.assertIn('Prospecting', str(e.exception))

    def test_unmapped_symbol(self):
        with self.assertRaises(EngineError) as e:
            smartmoney.holders_from_db(self.make_db([(1, '2025-03-31', '000000AA1', 1, '')], mapped=False), 'ACME')
        self.assertIn('CUSIP', str(e.exception))


if __name__ == '__main__':
    unittest.main()
