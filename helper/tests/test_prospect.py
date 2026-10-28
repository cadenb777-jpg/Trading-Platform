"""Prospecting data (helper/engine/prospect.py) on small hand-made SEC/Census files. No network."""
import asyncio
import csv
import io
import os
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import prospect as pr  # noqa: E402

FIX = Path(__file__).parent / 'fixtures' / 'prospect'
pr.USE_PROCESSES = False


def zip_dir(src, dest, names=None):
    with zipfile.ZipFile(dest, 'w') as zf:
        for p in sorted(Path(src).iterdir()):
            zf.write(p, (names or {}).get(p.name, p.name))
    return dest


def zip_file(src, dest, name=None):
    with zipfile.ZipFile(dest, 'w') as zf:
        zf.write(src, name or Path(src).name)
    return dest


def xlsx(rows):
    """A tiny .xlsx (shared strings and inline numbers) built by hand."""
    strings, sheet = [], []
    for r, row in enumerate(rows, 1):
        cells = []
        for c, value in enumerate(row):
            ref = f'{chr(65 + c)}{r}'
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                strings.append(value)
                cells.append(f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>')
        sheet.append(f'<row r="{r}">{"".join(cells)}</row>')
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as zf:
        zf.writestr('xl/sharedStrings.xml', f'<sst xmlns="{ns}">' + ''.join(f'<si><t>{s}</t></si>' for s in strings) + '</sst>')
        zf.writestr('xl/worksheets/sheet1.xml', f'<worksheet xmlns="{ns}"><sheetData>{"".join(sheet)}</sheetData></worksheet>')
    return out.getvalue()


TICKERS = {'AAPL': {'cik': 320193, 'name': 'Apple Inc.'}, 'MSFT': {'cik': 789019, 'name': 'MICROSOFT CORP'},
           'NVDA': {'cik': 1045810, 'name': 'NVIDIA CORP'}, 'JNJ': {'cik': 200406, 'name': 'JOHNSON & JOHNSON'},
           'XOM': {'cik': 34088, 'name': 'EXXON MOBIL CORP'}}


class Loaded(unittest.TestCase):
    """Loads every fixture once into a temporary prospect.db."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix='tp-prospect-'))
        cls.db = cls.tmp / 'prospect.db'
        ria = zip_file(FIX / 'ia030125.csv', cls.tmp / 'ia030125.zip')
        old = zip_file(FIX / 'ia120124.csv', cls.tmp / 'ia120124.zip')
        era = zip_file(FIX / 'ia030125-exempt.csv', cls.tmp / 'ia030125-exempt.zip')
        pr.load_adv_roster(cls.db, ria, 'RIA', '2025-03-01')
        pr.load_adv_roster(cls.db, old, 'RIA', '2024-12-01', True)
        pr.load_adv_roster(cls.db, era, 'ERA', '2025-03-01')
        cls.full = pr.load_adv_full(cls.db, [zip_dir(FIX / 'adv_full', cls.tmp / 'adv.zip')])
        cls.old13f = pr.load_13f(cls.db, zip_dir(FIX / '13f_old', cls.tmp / '13f_old.zip'))
        cls.new13f = pr.load_13f(cls.db, zip_dir(FIX / '13f_new', cls.tmp / '13f_new.zip'))
        cls.formd = pr.load_formd(cls.db, zip_dir(FIX / 'formd', cls.tmp / 'formd.zip'))
        con = pr.connect(cls.db)
        with con:
            con.executemany('INSERT INTO zcta VALUES (?, ?, ?)', pr.parse_zcta((FIX / 'zcta.txt').read_text()))
            con.execute("INSERT INTO geocache VALUES ('1 PARK AVE|NEW YORK|NY|10022', 40.75, -73.98, '1 PARK AVE', 'match', 0)")
        con.close()
        cls.build = pr.build_firms(cls.db, TICKERS)
        cls.con = pr.connect(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.con.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def firm(self, firm_id):
        return dict(self.con.execute('SELECT * FROM firms WHERE id = ?', (firm_id,)).fetchone())


class Parsers(Loaded):
    def test_monthly_roster_fields_and_client_mix(self):
        a = dict(self.con.execute('SELECT * FROM adv_firms WHERE crd = 1001').fetchone())
        self.assertEqual(a['business_name'], 'ACME WEALTH ADVISORS, LLC')
        self.assertEqual(a['city'], 'New York')  # its header had a line break inside
        self.assertEqual(a['aum_total'], 500_000_000)
        self.assertEqual(a['aum_disc'], 450_000_000)
        self.assertEqual(a['clients_total'], 250)
        self.assertEqual(a['filing_date'], '2025-01-15')
        self.assertEqual(a['phone'], '212-555-0100')
        self.assertIn('Percentage of assets', a['fees'])
        cafe = dict(self.con.execute('SELECT * FROM adv_firms WHERE crd = 1005').fetchone())
        self.assertEqual(cafe['legal_name'], 'CAFÉ ADVISORS INC')  # Windows-1252 decoded
        self.assertEqual(cafe['clients_approx'], 1)  # "fewer than 5" only

    def test_aum_history_from_older_roster(self):
        hist = self.con.execute('SELECT roster_date, aum_total FROM adv_history WHERE crd = 1001 ORDER BY roster_date').fetchall()
        self.assertEqual([tuple(h) for h in hist], [('2024-12-01', 420_000_000), ('2025-03-01', 500_000_000)])
        # the older roster doesn't overwrite the current firm record
        self.assertEqual(self.con.execute('SELECT aum_total FROM adv_firms WHERE crd = 1001').fetchone()[0], 500_000_000)

    def test_exempt_reporting_adviser(self):
        self.assertEqual(self.con.execute('SELECT kind FROM adv_firms WHERE crd = 2001').fetchone()[0], 'ERA')

    def test_xlsx_roster(self):
        rows = pr.xlsx_rows(xlsx([['Organization CRD#', 'Primary Business Name', '5F(2)(c)'], [42, 'Workbook Advisers', 1234.5]]))
        firm = pr.parse_adv_row(rows[0], 'RIA')
        self.assertEqual((firm['crd'], firm['business_name'], firm['aum_total']), (42, 'Workbook Advisers', 1234.5))

    def test_adv_full_keeps_latest_filing_people_and_funds(self):
        people = self.con.execute("SELECT name, title, source, key_title FROM people WHERE firm_key = 'crd-1003' AND source LIKE 'ADV%' ORDER BY name").fetchall()
        self.assertEqual([p['name'] for p in people], ['PINE, JANE', 'PINE, ROBERT'])  # not the entity, not the older filing
        jane = people[0]
        self.assertEqual(jane['source'], 'ADV Schedule A')
        self.assertEqual(jane['key_title'], 1)  # Chief Investment Officer flagged
        self.assertEqual(people[1]['source'], 'ADV Schedule B')
        funds = self.con.execute('SELECT name, gav, owners FROM private_funds WHERE crd = 1003').fetchall()
        self.assertEqual([tuple(f) for f in funds], [('PINE STREET OPPORTUNITIES FUND LP', 750_000_000, 120)])

    def test_13f_value_units_before_and_after_2023(self):
        self.assertEqual(pr.value_multiplier('2022-11-14'), 1000)
        self.assertEqual(pr.value_multiplier('2023-01-03'), 1)
        old = self.con.execute("SELECT value FROM holdings_13f WHERE cik = 9001 AND period = '2022-09-30' AND cusip = '037833100'").fetchone()[0]
        new = self.con.execute("SELECT value FROM holdings_13f WHERE cik = 9001 AND period = '2022-12-31' AND cusip = '037833100' AND put_call = ''").fetchone()[0]
        self.assertEqual(old, 1_000_000)  # 1000 thousand
        self.assertEqual(new, 1_500_000)

    def test_13f_amendments(self):
        smith = {r[0] for r in self.con.execute("SELECT cusip FROM holdings_13f WHERE cik = 9002")}
        self.assertEqual(smith, {'037833100', '67066G104', '478160104'})  # NEW HOLDINGS amendment adds JNJ
        bank = [tuple(r) for r in self.con.execute('SELECT cusip, value FROM holdings_13f WHERE cik = 9003')]
        self.assertEqual(bank, [('478160104', 5_000_000)])  # RESTATEMENT replaces the original
        self.assertEqual(self.con.execute('SELECT total_value FROM filers_13f WHERE cik = 9002').fetchone()[0], 4_000_000)

    def test_13f_put_call_signature_other_managers(self):
        put = self.con.execute("SELECT put_call FROM holdings_13f WHERE cik = 9001 AND value = 50000").fetchone()[0]
        self.assertEqual(put, 'Put')
        sig = self.con.execute("SELECT title, key_title FROM people WHERE firm_key = 'cik-9002'").fetchone()
        self.assertEqual(tuple(sig), ('Chief Investment Officer', 1))
        self.assertEqual(self.con.execute('SELECT name FROM other_managers_13f WHERE cik = 9001').fetchone()[0], 'PINE STREET SUB-ADVISER LLC')
        self.assertEqual(self.con.execute('SELECT crd FROM filers_13f WHERE cik = 9001').fetchone()[0], 1003)

    def test_form_d_keeps_funds_and_family_office_issuers(self):
        names = {r[0] for r in self.con.execute('SELECT name FROM formd_offerings')}
        self.assertEqual(names, {'PINE STREET OPPORTUNITIES FUND LP', 'JONES FAMILY OFFICE HOLDINGS LLC'})
        jane = self.con.execute("SELECT title, key_title FROM people WHERE firm_key = 'cik-7001'").fetchone()
        self.assertIn('Chief Investment Officer of the General Partner', jane['title'])
        self.assertEqual(jane['key_title'], 1)
        off = self.con.execute("SELECT offering, sold, investors, filed FROM formd_offerings WHERE cik = 7001").fetchone()
        self.assertEqual(tuple(off), (None, 250_000_000, 120, '2024-03-15'))  # "Indefinite" offering stays empty

    def test_census_and_zcta_parsers(self):
        res = pr.parse_census_batch((FIX / 'census_batch_response.csv').read_text())
        self.assertEqual(res[0][:2], (40.75, -73.98))  # longitude comes first in the reply
        self.assertIsNone(res[1])
        self.assertIsNone(res[2])  # a tie isn't a match
        self.assertEqual(pr.census_batch_csv([('1 Park Ave', 'New York', 'NY', '10022-1234')]).strip(), '0,1 Park Ave,New York,NY,10022')
        self.assertEqual(len(pr.parse_zcta((FIX / 'zcta.txt').read_text())), 4)

    def test_dates(self):
        self.assertEqual(pr.parse_date('31-MAR-2025'), '2025-03-31')
        self.assertEqual(pr.parse_date('3/1/2025 9:42'), '2025-03-01')
        self.assertEqual(pr.parse_date('2025-03-01'), '2025-03-01')
        self.assertEqual(pr.parse_date('Indefinite'), '')


class FileLists(unittest.TestCase):
    def test_13f_picks_newest_windows(self):
        links = pr.page_links((FIX / 'index_13f.html').read_text(), pr.INDEX_PAGES['13f'])
        files = pr.pick_13f_files(links)
        self.assertEqual([f.rsplit('/', 1)[-1] for f in files], ['01mar2025-31may2025_form13f.zip', '01dec2024-28feb2025_form13f.zip'])
        self.assertTrue(files[0].startswith('https://www.sec.gov/files/'))
        self.assertEqual(pr._date_key('2024q3_form13f.zip'), '2024-09-30')

    def test_adv_picks_newest_plus_quarterly_history(self):
        links = pr.page_links((FIX / 'index_adv.html').read_text(), pr.INDEX_PAGES['adv'])
        picks = [(u.rsplit('/', 1)[-1], kind, date) for u, kind, date in pr.pick_adv_files(links, history=4)]
        self.assertEqual(picks[0], ('ia100125.zip', 'RIA', '2025-10-01'))
        self.assertEqual(picks[1], ('ia100125-exempt.zip', 'ERA', '2025-10-01'))
        self.assertEqual([p[0] for p in picks[2:]], ['ia070125.zip', 'ia040125.zip', 'ia100124.zip'])  # about 3, 6 and 9-12 months back

    def test_formd_and_adv_full(self):
        self.assertEqual(pr.pick_formd_files(['https://x/2024q2_d.zip', 'https://x/2024q3_d.zip', 'https://x/readme.zip']), ['https://x/2024q3_d.zip'])
        full = pr.pick_adv_full_files(['https://x/adv_20240101_20240331_part1.zip', 'https://x/adv_20240101_20240331_part2.zip', 'https://x/adv_20231001_20231231.zip'])
        self.assertEqual(len(full), 2)


class Classifier(unittest.TestCase):
    def test_registered_and_exempt(self):
        c = pr.classify({'kind': 'RIA', 'name': 'Acme Wealth Advisors', 'client_mix': {'individuals': {'count': 200}, 'hnw': {'count': 50}}, 'clients_total': 250, 'aum_total': 5e8})
        self.assertEqual((c['type'], c['confidence']), (pr.TYPE_RIA, 'from filing'))
        self.assertEqual(pr.classify({'kind': 'ERA', 'name': 'Redwood Venture Partners'})['type'], pr.TYPE_ERA)

    def test_multi_family_office(self):
        c = pr.classify({'kind': 'RIA', 'name': 'Harbor Multi-Family Office LLC', 'client_mix': {'hnw': {'count': 40}}, 'clients_total': 45, 'aum_total': 2e9})
        self.assertEqual((c['type'], c['confidence']), (pr.TYPE_MFO, 'strong signals'))
        self.assertTrue(any('multi-family' in r.lower() for r in c['reasons']))
        weak = pr.classify({'kind': 'RIA', 'name': 'Quiet Partners LLC', 'client_mix': {'hnw': {'count': 30}}, 'clients_total': 30, 'aum_total': 1.5e9})
        self.assertEqual((weak['type'], weak['confidence']), (pr.TYPE_MFO, 'weak signals'))
        self.assertTrue(any('100% of clients' in r for r in weak['reasons']))

    def test_unregistered_13f_filers(self):
        fo = pr.classify({'kind': None, 'name': 'Smith Family Office LLC', 'has13f': 1})
        self.assertEqual((fo['type'], fo['confidence']), (pr.TYPE_FO, 'strong signals'))
        self.assertTrue(any('202(a)(11)(G)-1' in r for r in fo['reasons']))
        bank = pr.classify({'kind': None, 'name': 'First National Bank of Springfield', 'has13f': 1})
        self.assertEqual(bank['type'], pr.TYPE_13F)
        self.assertTrue(any('"Bank"' in r for r in bank['reasons']))
        hint = pr.classify({'kind': None, 'name': 'Blue Lake Holdings LLC', 'has13f': 1})
        self.assertEqual((hint['type'], hint['confidence']), (pr.TYPE_FO, 'weak signals'))
        plain = pr.classify({'kind': None, 'name': 'Zeta Capital LLC', 'has13f': 1})
        self.assertEqual((plain['type'], plain['confidence']), (pr.TYPE_13F, 'unknown'))

    def test_never_certain(self):
        for f in ({'name': 'Smith Family Office', 'has13f': 1}, {'name': 'Jones Family Office', 'offerings': 1},
                  {'kind': 'RIA', 'name': 'X Multi-Family Office', 'clients_total': 10, 'client_mix': {'hnw': {'count': 10}}, 'aum_total': 1e9}):
            c = pr.classify(f)
            self.assertIn(c['confidence'], ('strong signals', 'moderate signals', 'weak signals'))
            self.assertTrue(c['reasons'])


class Matching(Loaded):
    def test_normalize_and_score(self):
        self.assertEqual(pr.normalize_name('The Smith Family Office, L.L.C. /DE/'), 'smith family office')
        s, reasons = pr.match_score({'name': 'ACME WEALTH ADVISORS LLC', 'zip': '10022-1234', 'state': 'NY'},
                                    {'name': 'Acme Wealth Advisors, LLC', 'zip': '10022', 'state': 'NY'})
        self.assertEqual(s, 1.0)
        self.assertIn('same ZIP', reasons)
        far, _ = pr.match_score({'name': 'Acme Wealth Advisors', 'state': 'TX'}, {'name': 'Acme Wealth Advisors', 'state': 'NY'})
        self.assertLess(far, pr.LINK_SCORE)
        self.assertLess(pr.match_score({'name': 'Acme Capital'}, {'name': 'Zenith Partners'})[0], 0.5)

    def test_links_by_identifier_then_name(self):
        pine = self.firm('crd-1003')
        self.assertEqual(pine['cik'], 9001)
        self.assertEqual(pine['has13f'], 1)
        methods = {r['source']: r['method'] for r in self.con.execute("SELECT * FROM links WHERE firm_id = 'crd-1003'")}
        self.assertEqual(methods['Form 13F'], 'CRD on the 13F cover page')
        self.assertEqual(methods['Form D (fund)'], 'fund name in Schedule D 7.B.(1)')
        acme = self.con.execute("SELECT method, score, status FROM links WHERE firm_id = 'crd-1001' AND source = 'Form 13F'").fetchone()
        self.assertTrue(acme['method'].startswith('name and address'))
        self.assertGreaterEqual(acme['score'], pr.LINK_SCORE)
        self.assertEqual(acme['status'], 'linked')
        self.assertIsNone(self.con.execute("SELECT id FROM firms WHERE id = 'cik-9004'").fetchone())  # merged, not duplicated

    def test_firm_types_after_build(self):
        types = {r['id']: r['type'] for r in self.con.execute('SELECT id, type FROM firms')}
        self.assertEqual(types['crd-1001'], pr.TYPE_RIA)
        self.assertEqual(types['crd-1002'], pr.TYPE_MFO)
        self.assertEqual(types['crd-2001'], pr.TYPE_ERA)
        self.assertEqual(types['cik-9002'], pr.TYPE_FO)
        self.assertEqual(types['cik-9003'], pr.TYPE_13F)
        self.assertEqual(types['cik-7002'], pr.TYPE_FO)  # Form D issuer named "family office"
        self.assertNotIn('cik-7003', types)  # an operating company's Form D isn't a prospect
        self.assertNotIn('cik-7001', types)  # a fund belongs to its adviser

    def test_people_attach_to_merged_firm(self):
        sources = {r['source'] for r in self.con.execute("SELECT source FROM people WHERE firm_id = 'crd-1003'")}
        self.assertEqual(sources, {'ADV Schedule A', 'ADV Schedule B', '13F signature'})

    def test_cusip_map_by_issuer_name(self):
        m = {r['cusip']: r['ticker'] for r in self.con.execute('SELECT * FROM cusip_map')}
        self.assertEqual(m['037833100'], 'AAPL')
        self.assertEqual(m['478160104'], 'JNJ')
        self.assertNotIn('000000000', m)


class Search(Loaded):
    def q(self, **kw):
        return pr.search(self.con, kw)

    def ids(self, **kw):
        return [r['id'] for r in self.q(**kw)['rows']]

    def test_filters(self):
        self.assertEqual(self.ids(type=[pr.TYPE_FO]), ['cik-9002', 'cik-7002'])
        self.assertEqual(self.ids(state='ct'), ['crd-1003'])
        self.assertEqual(self.ids(city='Boston'), ['crd-1002'])
        self.assertEqual(self.ids(zip='100'), ['crd-1001'])
        self.assertEqual(self.ids(aumMin=1e9, aumMax=2e9), ['crd-1002', 'crd-1004'])
        self.assertEqual(self.ids(clientTypes=['pooled']), ['crd-1003'])
        self.assertEqual(set(self.ids(has13f=True)), {'crd-1003', 'crd-1001', 'cik-9002', 'cik-9003', 'cik-9005'})
        self.assertEqual(self.ids(hasPrivateFunds=True), ['crd-1003'])
        self.assertEqual(self.ids(text='Jane Pine'), ['crd-1003'])  # a person's name finds the firm
        self.assertEqual(self.ids(text='1004'), ['crd-1004'])  # CRD
        self.assertEqual(self.q(limit=2, offset=0, sort='name')['total'], len(self.ids(limit=100)))
        self.assertEqual(self.ids(sort='name', limit=2), ['crd-1001', 'crd-1005'])

    def test_holds_symbol_and_min_position(self):
        rows = self.q(holds={'symbol': 'AAPL'})['rows']
        self.assertEqual([(r['id'], r['position']) for r in rows], [('cik-9002', 2_000_000), ('crd-1003', 1_500_000), ('crd-1001', 800_000)])
        self.assertEqual(self.ids(holds={'cusip': '037833100'}, minPosition=1_000_000), ['cik-9002', 'crd-1003'])
        self.assertEqual(self.q(holds={'symbol': 'ZZZZ'})['total'], 0)

    def test_radius(self):
        self.assertAlmostEqual(pr.haversine_miles(40.7128, -74.0060, 34.0522, -118.2437), 2445, delta=10)  # NYC-LA
        near = self.q(near={'lat': 40.76, 'lon': -73.97, 'miles': 50})
        self.assertEqual([r['id'] for r in near['rows']], ['crd-1001', 'crd-1003'])  # Manhattan, then Greenwich (~29 mi)
        self.assertLess(near['rows'][0]['distanceMiles'], 2)
        self.assertEqual(self.ids(near={'zip': '10022', 'miles': 5}), ['crd-1001'])
        self.assertEqual(self.firm('crd-1001')['geo'], 'address')
        self.assertEqual(self.firm('crd-1003')['geo'], 'zip')

    def test_export(self):
        out = pr.export_csv(self.con, {'state': 'NY'})
        rows = list(csv.reader(io.StringIO(out['csv'])))
        self.assertEqual(rows[0][:3], ['Name', 'Type', 'Confidence'])
        self.assertEqual(rows[1][0], 'ACME WEALTH ADVISORS, LLC')
        self.assertEqual(rows[1][rows[0].index('Regulatory AUM ($)')], '500000000.0')
        self.assertIn('files Form ADV', rows[1][-1])
        self.assertEqual(out['count'], 1)


class Portfolio(Loaded):
    def test_qoq_changes(self):
        (period, cur), (prev_period, prev) = pr.latest_positions(self.con, 9001)
        self.assertEqual((period, prev_period), ('2022-12-31', '2022-09-30'))
        changes = {(p['cusip'], p['putCall']): p['change'] for p in pr.qoq_changes(cur, prev)}
        self.assertEqual(changes[('037833100', '')], 'added')
        self.assertEqual(changes[('594918104', '')], 'trimmed')
        self.assertEqual(changes[('67066G104', '')], 'new')
        self.assertEqual(changes[('30231G102', '')], 'exited')
        self.assertEqual(changes[('037833100', 'Put')], 'new')
        same = pr.qoq_changes({('X', ''): {'cusip': 'X', 'shares': 100.5, 'value': 1}}, {('X', ''): {'cusip': 'X', 'shares': 100, 'value': 1}})
        self.assertEqual(same[0]['change'], 'unchanged')

    def test_overlap_and_turnover(self):
        a = {'A': 0.5, 'B': 0.3, 'C': 0.2}
        b = {'A': 0.2, 'B': 0.3, 'D': 0.5}
        o = pr.overlap(a, b)
        self.assertAlmostEqual(o['overlap'], 0.5)  # min(.5,.2) + min(.3,.3)
        self.assertEqual(o['shared'], 2)
        self.assertEqual(o['differences'][0]['cusip'], 'D')
        self.assertAlmostEqual(pr.turnover(a, a), 0.0)
        self.assertAlmostEqual(pr.turnover({'A': 1.0}, {'B': 1.0}), 1.0)
        self.assertIsNone(pr.turnover(a, {}))

    def test_profile(self):
        p = pr.firm_profile(self.con, 'crd-1003')
        h = p['holdings13f']
        self.assertEqual(h['period'], '2022-12-31')
        self.assertEqual(h['changes'], {'added': 1, 'trimmed': 1, 'new': 2, 'exited': 1})
        self.assertAlmostEqual(sum(x['weight'] for x in h['positions']), 1.0)
        self.assertEqual(h['positions'][0]['ticker'], 'AAPL')
        self.assertEqual(h['otherManagers'][0]['name'], 'PINE STREET SUB-ADVISER LLC')
        self.assertEqual([f['name'] for f in p['privateFunds']], ['PINE STREET OPPORTUNITIES FUND LP'])
        self.assertEqual([o['cik'] for o in p['formDOfferings']], [7001])
        self.assertTrue(any(s['url'].endswith('/1003') for s in p['sources']))
        self.assertEqual(p['people'][0]['keyTitle'], True)  # CIO first
        self.assertEqual(p['type'], pr.TYPE_RIA)
        self.assertIn('Not mapped', h['sectors'])  # no sectors fetched in tests
        with self.assertRaises(pr.EngineError):
            pr.firm_profile(self.con, 'crd-0')

    def test_compare(self):
        c = pr.compare(self.con, ['crd-1003', 'cik-9002', 'crd-1001'])
        pair = next(p for p in c['pairs'] if p['a'] == 'crd-1003' and p['b'] == 'cik-9002')
        pine_w = {'037833100': 1.5 / 2.5, '594918104': 0.4 / 2.5, '67066G104': 0.6 / 2.5}
        smith_w = {'037833100': 0.5, '67066G104': 0.25, '478160104': 0.25}
        self.assertAlmostEqual(pair['overlap'], sum(min(pine_w[k], smith_w[k]) for k in ('037833100', '67066G104')))
        self.assertEqual(pair['shared'], 2)
        apple = next(s for s in c['sharedHoldings'] if s['cusip'] == '037833100')
        self.assertEqual((apple['heldBy'], apple['ticker']), (3, 'AAPL'))
        firms = {f['id']: f for f in c['firms']}
        self.assertAlmostEqual(firms['crd-1003']['turnover'], 0.5 * (abs(.6 - 1000 / 1800) + abs(.16 - (500 / 1800)) + abs(.24) + abs(300 / 1800)), places=6)
        self.assertEqual(firms['crd-1001']['aumPerClient'], 2_000_000)
        self.assertAlmostEqual(firms['crd-1001']['clientMix']['hnw']['share'], 0.2)


class Handlers(Loaded):
    def test_handlers_and_reserved_names(self):
        ctx = mock.Mock(sec_contact='')
        with mock.patch.object(pr, 'DB_PATH', self.db):
            out = asyncio.run(pr.h_search(ctx, {'state': 'MA', '_emit': None}))
            self.assertEqual([r['id'] for r in out['rows']], ['crd-1002'])
            prof = asyncio.run(pr.h_firm(ctx, {'firmId': 'crd-1003'}))
            self.assertEqual(prof['crd'], 1003)
            st = asyncio.run(pr.h_status(ctx, {}))
            self.assertEqual(st['counts']['private_funds'], 1)
            self.assertGreater(st['types'][pr.TYPE_RIA], 0)
            with self.assertRaises(pr.EngineError):
                asyncio.run(pr.h_compare(ctx, {'ids': ['crd-1003']}))
            with self.assertRaises(pr.EngineError):
                asyncio.run(pr.h_ingest(ctx, {'source': '13f'}))  # no SEC email set
            with self.assertRaises(pr.EngineError):
                asyncio.run(pr.h_ingest(ctx, {'source': 'everything'}))
            exp = asyncio.run(pr.h_export(ctx, {'query': {'type': [pr.TYPE_MFO]}}))
            self.assertEqual(exp['count'], 2)


class Ingest(unittest.TestCase):
    """The ingest jobs end to end, with the SEC pages and downloads replaced by the fixtures."""

    def test_13f_formd_adv_jobs_and_status(self):
        tmp = Path(tempfile.mkdtemp(prefix='tp-ingest-'))
        files = {'01mar2023-31may2023_form13f.zip': zip_dir(FIX / '13f_new', tmp / 'a.zip'),
                 '01dec2022-28feb2023_form13f.zip': zip_dir(FIX / '13f_old', tmp / 'b.zip'),
                 '2024q1_d.zip': zip_dir(FIX / 'formd', tmp / 'c.zip'),
                 'ia030125.zip': zip_file(FIX / 'ia030125.csv', tmp / 'd.zip'),
                 'ia030125-exempt.zip': zip_file(FIX / 'ia030125-exempt.csv', tmp / 'e.zip')}

        async def page(ctx, url):
            return ''.join(f'<a href="/files/{name}">x</a>' for name in files)

        async def fake_download(ctx, url, dest, emit=None, label='', **kw):
            shutil.copy(files[url.rsplit('/', 1)[-1]], dest)
            return Path(dest)

        async def tickers(ctx):
            return TICKERS
        events = []

        async def emit(e):
            events.append(e)
        ctx = mock.Mock(sec_contact='me@example.com')
        db = tmp / 'prospect.db'
        with mock.patch.object(pr, 'sec_page', page), mock.patch.object(pr, 'download', fake_download), \
                mock.patch.object(pr, 'DOWNLOADS', tmp / 'dl'), mock.patch('engine.sec.tickers', tickers):
            (tmp / 'dl').mkdir()
            out = asyncio.run(pr.run_ingest(ctx, '13f', emit, db))
            self.assertEqual([f['file'] for f in out['13f']], ['01dec2022-28feb2023_form13f.zip', '01mar2023-31may2023_form13f.zip'])
            self.assertEqual(out['build']['cusipsMapped'], 5)
            asyncio.run(pr.run_ingest(ctx, 'formd', None, db))
            out = asyncio.run(pr.run_ingest(ctx, 'adv', None, db))
            self.assertEqual({f['kind'] for f in out['adv']}, {'RIA', 'ERA'})
            self.assertEqual(out['build']['cusipsMapped'], 0)  # already mapped
        con = pr.connect(db)
        st = pr.status(con, db)
        con.close()
        self.assertEqual(st['sources']['13f']['sourceDate'], '2023-05-31')
        self.assertEqual(st['counts']['filers_13f'], 5)
        self.assertEqual(st['job']['stage'], 'Done')
        self.assertIn(pr.TYPE_MFO, st['types'])
        self.assertFalse(any((tmp / 'dl').iterdir()))  # downloads removed after loading
        shutil.rmtree(tmp, ignore_errors=True)


class FakeResponse:
    def __init__(self, status, chunks, headers=None):
        self.status_code, self.chunks, self.headers = status, chunks, headers or {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    async def aiter_bytes(self, size):
        for c in self.chunks:
            if isinstance(c, Exception):
                raise c
            yield c


class Downloads(unittest.TestCase):
    def test_resume_after_a_dropped_connection_and_backoff(self):
        tmp = Path(tempfile.mkdtemp(prefix='tp-dl-'))
        calls = []

        class Client:
            def stream(self, method, url, headers=None, timeout=None):
                calls.append(dict(headers or {}))
                if len(calls) == 1:
                    return FakeResponse(200, [b'abc', ConnectionError('dropped')], {'Content-Length': '6'})
                if len(calls) == 2:
                    return FakeResponse(503, [], {'Retry-After': '0'})
                return FakeResponse(206, [b'def'], {'Content-Length': '3'})

        ctx = mock.Mock(sec_contact='me@example.com')
        sleeps = []

        async def no_sleep(s):
            sleeps.append(s)
        with mock.patch.object(pr.asyncio, 'sleep', no_sleep), mock.patch.object(pr, 'SEC_GAP', 0):
            path = asyncio.run(pr.download(ctx, 'https://www.sec.gov/files/x.zip', tmp / 'x.zip', client=Client()))
        self.assertEqual(path.read_bytes(), b'abcdef')
        self.assertEqual(calls[0], {})
        self.assertEqual(calls[2], {'Range': 'bytes=3-'})  # resumed where it stopped
        self.assertEqual(sleeps[:2], [2, 4])  # backed off
        shutil.rmtree(tmp, ignore_errors=True)

    def test_refuses_without_contact_and_on_403(self):
        tmp = Path(tempfile.mkdtemp(prefix='tp-dl-'))
        with self.assertRaises(pr.EngineError):
            asyncio.run(pr.download(mock.Mock(sec_contact=''), 'https://www.sec.gov/x.zip', tmp / 'x.zip'))

        class Client:
            def stream(self, *a, **k):
                return FakeResponse(403, [])
        with mock.patch.object(pr, 'SEC_GAP', 0), self.assertRaises(pr.EngineError):
            asyncio.run(pr.download(mock.Mock(sec_contact='me@example.com'), 'https://www.sec.gov/x.zip', tmp / 'x.zip', client=Client()))
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
