"""Prospecting downloads that finish and say what they loaded: one source failing doesn't stop the others, retries
resume, completeness counts, 3 years of Form D, 8 quarters of 13F totals, Form ADV PDFs and state advisers (IAPD).
Small hand-made files only, no network."""
import asyncio
import json
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
from engine import prospect_iapd as iapd  # noqa: E402
from engine.core import HANDLERS  # noqa: E402

FIX = Path(__file__).parent / 'fixtures' / 'prospect'
pr.USE_PROCESSES = False

SUB_H = ['ACCESSION_NUMBER', 'FILING_DATE', 'SUBMISSIONTYPE', 'CIK', 'PERIODOFREPORT']
COVER_H = ['ACCESSION_NUMBER', 'ISAMENDMENT', 'AMENDMENTTYPE', 'FILINGMANAGER_NAME', 'FILINGMANAGER_CITY', 'FILINGMANAGER_STATEORCOUNTRY',
           'FILINGMANAGER_ZIPCODE', 'REPORTTYPE']
INFO_H = ['ACCESSION_NUMBER', 'NAMEOFISSUER', 'TITLEOFCLASS', 'CUSIP', 'VALUE', 'SSHPRNAMT', 'SSHPRNAMTTYPE', 'PUTCALL', 'INVESTMENTDISCRETION']
OTHER_H = ['ACCESSION_NUMBER', 'SEQUENCENUMBER', 'FORM13FFILENUMBER', 'CRDNUMBER', 'SECFILENUMBER', 'NAME']
FD_SUB = ['ACCESSIONNUMBER', 'FILING_DATE', 'SUBMISSIONTYPE']
FD_ISS = ['ACCESSIONNUMBER', 'CIK', 'ENTITYNAME', 'CITY', 'STATEORCOUNTRY']
FD_OFF = ['ACCESSIONNUMBER', 'INDUSTRYGROUPTYPE', 'TOTALOFFERINGAMOUNT', 'TOTALAMOUNTSOLD']
FD_REL = ['ACCESSIONNUMBER', 'FIRSTNAME', 'LASTNAME', 'RELATIONSHIP_1']


def make_zip(path, tables):
    with zipfile.ZipFile(path, 'w') as zf:
        for name, (header, rows) in tables.items():
            zf.writestr(name, '\t'.join(header) + '\n' + ''.join('\t'.join(r) + '\n' for r in rows))
    return path


def zip_file(src, dest):
    with zipfile.ZipFile(dest, 'w') as zf:
        zf.write(src, Path(src).name)
    return dest


def zip_dir(src, dest):
    with zipfile.ZipFile(dest, 'w') as zf:
        for p in sorted(Path(src).iterdir()):
            zf.write(p, p.name)
    return dest


def formd_zip(path, acc, cik, name, filed, sold):
    return make_zip(path, {
        'FORMDSUBMISSION.tsv': (FD_SUB, [[acc, filed, 'D/A' if sold > 1 else 'D']]),
        'ISSUERS.tsv': (FD_ISS, [[acc, str(cik), name, 'DOVER', 'DE']]),
        'OFFERING.tsv': (FD_OFF, [[acc, 'Pooled Investment Fund', '1000', str(sold)]]),
        'RELATEDPERSONS.tsv': (FD_REL, [[acc, 'Ann', f'Lee{sold}', 'Executive Officer']])})


def q13f(path, acc, cik, period, filed, value, kind='13F-HR', report='13F HOLDINGS REPORT', other=None):
    tables = {'SUBMISSION.tsv': (SUB_H, [[acc, filed, kind, str(cik), period]]),
              'COVERPAGE.tsv': (COVER_H, [[acc, 'N', '', f'MANAGER {cik} LLC', 'DOVER', 'DE', '19901', report]]),
              'INFOTABLE.tsv': (INFO_H, [[acc, 'APPLE INC', 'COM', '037833100', str(value), '10', 'SH', '', 'SOLE']] if kind.startswith('13F-HR') else [])}
    if other:
        tables['OTHERMANAGER.tsv'] = (OTHER_H, [[acc, '1', '028-1', '', '', other]])
    return make_zip(path, tables)


class Temp(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='tp-complete-'))
        self.db = self.tmp / 'p.db'
        pr.JOB.clear()
        pr.JOB['running'] = False

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class Completeness(Temp):
    def test_roster_counts_rows_loaded_and_skipped(self):
        roster = self.tmp / 'r.csv'
        roster.write_text('Organization CRD#,Primary Business Name,Main Office State,5F(2)(c)\n'
                          '1,ONE LLC,NY,10\n2,TWO LLC,NY,20\n,NO CRD LLC,NY,5\n2,TWO AGAIN LLC,NY,20\n')
        r = pr.load_adv_roster(self.db, zip_file(roster, self.tmp / 'r.zip'), 'RIA', '2025-01-01')
        self.assertEqual(r['check'], {'what': 'advisers', 'inFile': 4, 'loaded': 2, 'skipped': {'no CRD': 1, 'duplicate': 1}})
        self.assertEqual(pr.check_text(r['check']), 'Loaded 2 of 4 advisers; 2 skipped: no CRD 1, duplicate 1')
        self.assertEqual(pr.check_text({'what': 'advisers', 'inFile': 15340, 'loaded': 15312, 'skipped': {'no CRD': 28}}),
                         'Loaded 15,312 of 15,340 advisers; 28 skipped: no CRD')
        merged = pr.merge_checks([r['check'], {'what': 'advisers', 'inFile': 3, 'loaded': 3, 'skipped': {}}, None])
        self.assertEqual(merged, [{'what': 'advisers', 'inFile': 7, 'loaded': 5, 'skipped': {'no CRD': 1, 'duplicate': 1}}])

    def test_adv_full_and_13f_counts(self):
        r = pr.load_adv_full(self.db, [zip_dir(FIX / 'adv_full', self.tmp / 'adv.zip')])
        people = next(c for c in r['checks'] if c['what'].startswith('people'))
        self.assertEqual(people['inFile'], people['loaded'] + sum(people['skipped'].values()))
        self.assertGreater(people['loaded'], 0)
        r13 = pr.load_13f(self.db, zip_dir(FIX / '13f_new', self.tmp / 'n.zip'))
        pos = next(c for c in r13['checks'] if c['what'] == '13F positions')
        self.assertEqual(pos['inFile'], pos['loaded'] + sum(pos['skipped'].values()))
        con = pr.connect(self.db)
        self.assertEqual(con.execute('SELECT COUNT(*) FROM adv_filings WHERE bulk_date IS NOT NULL').fetchone()[0], r['advisers'])
        con.close()


class FormD(Temp):
    def test_newest_filing_per_issuer_wins_in_any_order(self):
        old = formd_zip(self.tmp / 'a.zip', 'D1', 501, 'CEDAR FUND LP', '01-MAR-2023', 1)
        new = formd_zip(self.tmp / 'b.zip', 'D2', 501, 'CEDAR FUND LP', '01-MAR-2025', 9)
        pr.load_formd(self.db, old)
        r = pr.load_formd(self.db, new)
        self.assertEqual(r['checks'][0]['loaded'], 1)
        r = pr.load_formd(self.db, old)  # an older quarter loaded later never replaces the newer filing
        self.assertEqual(r['checks'][0]['skipped'], {'older filing': 1})
        con = pr.connect(self.db)
        self.assertEqual([tuple(x) for x in con.execute('SELECT accession, sold FROM formd_offerings')], [('D2', 9.0)])
        self.assertEqual([x[0] for x in con.execute("SELECT name FROM people WHERE source = 'Form D related person'")], ['Ann Lee9'])
        con.close()


class Thirteen(Temp):
    def test_eight_quarters_of_totals_two_of_holdings_and_notices(self):
        periods = ['31-MAR-2023', '30-JUN-2023', '30-SEP-2023', '31-DEC-2023', '31-MAR-2024', '30-JUN-2024', '30-SEP-2024', '31-DEC-2024', '31-MAR-2025']
        for i, p in enumerate(periods):
            z = q13f(self.tmp / f'{i}.zip', f'A{i}', 77, p, f'10-{p[3:6]}-{p[-4:]}', 1000 * (i + 1))
            pr.load_13f(self.db, z, holdings=i >= len(periods) - 2)
        con = pr.connect(self.db)
        hist = [tuple(r) for r in con.execute('SELECT period, total_value FROM filer_history_13f WHERE cik = 77 ORDER BY period')]
        self.assertEqual(len(hist), pr.KEEP_13F_HISTORY)  # oldest of 9 pruned
        self.assertEqual(hist[-1], ('2025-03-31', 9000.0))
        self.assertEqual(hist[0], ('2023-06-30', 2000.0))  # totals kept even without holdings
        self.assertEqual([r[0] for r in con.execute('SELECT DISTINCT period FROM holdings_13f ORDER BY period')], ['2024-12-31', '2025-03-31'])
        self.assertEqual(tuple(con.execute('SELECT total_value, entries FROM filers_13f WHERE cik = 77').fetchone()), (9000.0, 1))
        # A 13F notice: the filer stays, labelled with the manager that reports its holdings
        pr.load_13f(self.db, q13f(self.tmp / 'nt.zip', 'NT1', 88, '31-MAR-2025', '10-MAY-2025', 0, '13F-NT', '13F NOTICE', 'BIG PARENT ADVISERS LLC'))
        filer = con.execute('SELECT report_type, total_value FROM filers_13f WHERE cik = 88').fetchone()
        self.assertTrue(pr.is_notice(filer['report_type']))
        con.close()
        pr.build_firms(self.db)
        con = pr.connect(self.db)
        reasons = json.loads(con.execute("SELECT reasons FROM firms WHERE id = 'cik-88'").fetchone()[0])
        self.assertIn('files 13F notices: holdings reported by BIG PARENT ADVISERS LLC', reasons)
        profile = pr.firm_profile(con, 'cik-88')
        self.assertEqual(profile['holdings13f']['reportedBy'], ['BIG PARENT ADVISERS LLC'])
        trend = pr.firm_profile(con, 'cik-77')['holdings13f']['history']
        self.assertEqual(len(trend), 8)
        con.close()


class Runs(Temp):
    """run_ingest('all') with the SEC pages and downloads replaced by small files."""

    def setUp(self):
        super().setUp()
        self.files = {'01mar2023-31may2023_form13f.zip': zip_dir(FIX / '13f_new', self.tmp / 'a.zip'),
                      '2024q1_d.zip': formd_zip(self.tmp / 'c1.zip', 'D1', 501, 'CEDAR FUND LP', '01-MAR-2024', 1),
                      '2024q2_d.zip': formd_zip(self.tmp / 'c2.zip', 'D2', 502, 'BIRCH FUND LP', '01-JUN-2024', 2),
                      'ia030125.zip': zip_file(FIX / 'ia030125.csv', self.tmp / 'd.zip'),
                      'ia030125-exempt.zip': zip_file(FIX / 'ia030125-exempt.csv', self.tmp / 'e.zip'),
                      'adv_data_20240331.zip': zip_dir(FIX / 'adv_full', self.tmp / 'f.zip')}
        self.downloads, self.fail = [], set()
        (self.tmp / 'dl').mkdir()

    def run_ingest(self, source):
        files = self.files

        async def page(ctx, url):
            return ''.join(f'<a href="/files/{name}">x</a>' for name in files)

        async def fake_download(ctx, url, dest, emit=None, label='', **kw):
            name = url.rsplit('/', 1)[-1]
            self.downloads.append(name)
            if name in self.fail:
                raise pr.EngineError(f'Download of {name} failed after 5 tries: connection reset')
            shutil.copy(files[name], dest)
            return Path(dest)

        async def tickers(ctx):
            return {}

        async def geo(ctx, emit, db):
            return {'geocoded': 0}

        async def state(ctx, emit, db):
            return {'advisers': 0}
        ctx = mock.Mock(sec_contact='me@example.com')
        with mock.patch.object(pr, 'sec_page', page), mock.patch.object(pr, 'download', fake_download), \
                mock.patch.object(pr, 'DOWNLOADS', self.tmp / 'dl'), mock.patch('engine.sec.tickers', tickers), \
                mock.patch.dict(pr.INGESTERS, {'geo': geo, 'state': state}):
            return asyncio.run(pr.run_ingest(ctx, source, None, self.db))

    def test_one_source_failing_does_not_stop_the_others(self):
        self.fail = {'01mar2023-31may2023_form13f.zip'}
        out = self.run_ingest('all')
        self.assertIn('error', out['13f'])
        self.assertEqual(pr.JOB['stage'], 'Done with problems')
        self.assertEqual(pr.overall_percent(), 100)
        con = pr.connect(self.db)
        self.assertGreater(con.execute('SELECT COUNT(*) FROM formd_offerings').fetchone()[0], 0)  # later sources loaded
        self.assertGreater(con.execute('SELECT COUNT(*) FROM firms').fetchone()[0], 0)  # and the firm list was built
        st = pr.status(con, self.db)
        con.close()
        self.assertFalse(st['results']['13f']['ok'])
        self.assertIn('connection reset', st['results']['13f']['reason'])
        self.assertIn('Retry failed sources', st['results']['13f']['action'])
        self.assertTrue(st['results']['formd']['ok'] and st['results']['build']['ok'])
        self.assertEqual(pr.failed_sources(self.db), ['13f'])
        self.assertTrue(st['checks']['adv'][0]['text'].startswith('Loaded '))
        # Retry failed sources: only 13F (then matching and map locations) runs again
        self.fail, self.downloads = set(), []
        self.assertEqual([s for s, _ in pr._plan('failed', self.db)], ['13f', 'build', 'geo'])
        self.run_ingest('failed')
        self.assertEqual(self.downloads, ['01mar2023-31may2023_form13f.zip'])
        self.assertEqual(pr.failed_sources(self.db), [])
        self.assertEqual(pr.JOB['stage'], 'Done')
        with self.assertRaises(pr.EngineError):
            pr._plan('failed', self.db)  # nothing left to retry

    def test_a_retry_skips_files_already_loaded(self):
        real = pr.load_formd
        calls = []

        def flaky(db, path):
            calls.append(Path(path).name)
            if len(calls) == 2:
                raise RuntimeError('worker crashed')
            return real(db, path)
        with mock.patch.object(pr, 'load_formd', flaky):
            with self.assertRaises(pr.EngineError):
                self.run_ingest('formd')
            self.assertEqual(self.downloads, ['2024q1_d.zip', '2024q2_d.zip'])  # oldest first
            self.assertTrue((self.tmp / 'dl' / '2024q2_d.zip').exists())  # kept for the retry
            self.downloads = []
            self.run_ingest('formd')
        self.assertEqual(self.downloads, [])  # q1 was loaded; q2 was already on disk
        self.assertEqual(calls, ['2024q1_d.zip', '2024q2_d.zip', '2024q2_d.zip'])
        self.downloads = []
        self.run_ingest('formd')
        self.assertEqual(self.downloads, [])  # both remembered as loaded
        self.assertEqual(set(pr.loaded_files(self.db, 'formd')), {'2024q1_d.zip', '2024q2_d.zip'})

    def test_overall_progress_is_weighted_by_stage(self):
        job = {'running': True, 'plan': [('adv', 10), ('13f', 30), ('build', 10)], 'results': {'adv': {'ok': True}},
               'current': '13f', 'part': (1, 2), 'sub': 0.0}
        self.assertEqual(pr.overall_percent(job), 50)  # (10 + 30 * 1/2) of 50
        job['sub'] = 1.0
        self.assertEqual(pr.overall_percent(job), 80)  # (10 + 30) of 50
        self.assertEqual(pr.overall_percent({'running': False, 'finished': 1, 'plan': [('adv', 10)]}), 100)


class Geo(Temp):
    def test_failed_batches_retry_then_report(self):
        con = pr.connect(self.db)
        with con:
            con.executemany("INSERT INTO firms (id, name, street, city, state, zip, geo) VALUES (?, ?, ?, ?, ?, ?, '')",
                            [('a', 'A', '1 MAIN ST', 'DOVER', 'DE', '19901'), ('b', 'B', '', 'LONDON', '', ''), ('c', 'C', '2 OAK ST', 'AUSTIN', 'TX', '78701')])
            con.executemany('INSERT INTO zcta VALUES (?, ?, ?)', [('19901', 39.1, -75.5), ('78701', 30.2, -97.7)])
        con.close()

        class Down:
            async def post(self, *a, **k):
                raise ConnectionError('census down')

        async def no_sleep(s):
            return None
        ctx = mock.Mock(http=Down())
        with mock.patch.object(pr.asyncio, 'sleep', no_sleep):
            for run in range(pr.GEO_RETRIES + 1):
                r = asyncio.run(pr.ingest_geo(ctx, None, self.db))
                self.assertEqual(r['geocoded'], 2 if run < pr.GEO_RETRIES else 0)  # given up after 3 runs
        self.assertEqual(r['report']['zip'], 2)
        self.assertEqual(r['report']['none'], 1)
        self.assertIn('0 of 3 located by address, 2 by ZIP only, 1 no usable US address (foreign or missing)', r['report']['text'])
        self.assertEqual(r['report']['gaveUp'], 2)


PDF_TEXT = (FIX / 'iapd_adv_text.txt').read_text()


class AdvPdf(Temp):
    def test_schedule_a_rows_including_wrapped_ones(self):
        rows, problem = iapd.parse_schedule_a(PDF_TEXT)
        self.assertEqual(problem, '')
        self.assertEqual([r['name'] for r in rows], ['PINE, JANE, ANNE', 'PINE STREET HOLDINGS LLC', 'DOE, JOHN', "O'BRIEN-SMITH, MARY"])
        jane, holdco, doe, mary = rows
        self.assertEqual((jane['title'], jane['acquired'], jane['ownership'], jane['crd'], jane['individual']),
                         ('CHIEF INVESTMENT OFFICER, MANAGING PARTNER', '01/2010', 'E', 1234567, True))
        self.assertFalse(holdco['individual'])
        self.assertEqual((doe['title'], doe['ownership'], doe['crd']), ('CHIEF COMPLIANCE OFFICER', 'NA', 7654321))
        self.assertEqual(mary['ownership'], 'A')

    def test_private_funds_and_filing_date(self):
        funds, problem = iapd.parse_private_funds(PDF_TEXT)
        self.assertEqual(problem, '')
        self.assertEqual(funds, [
            {'name': 'PINE STREET OPPORTUNITIES FUND LP', 'fund_id': '805-1234567890', 'fund_type': 'Hedge Fund', 'gav': 250_000_000.0, 'owners': 120},
            {'name': 'PINE STREET REAL ESTATE PARTNERS II, L.P.', 'fund_id': '805-9876543210', 'fund_type': 'Real Estate Fund', 'gav': 75_500_000.0, 'owners': 1045}])
        self.assertEqual(iapd.filing_date(PDF_TEXT), '2025-03-28')

    def test_self_check_reports_what_it_could_not_read(self):
        self.assertEqual(iapd.parse_schedule_a('Item 1 only'), ([], "couldn't find Schedule A"))
        self.assertEqual(iapd.parse_schedule_a('Schedule A\nDirect Owners\nsomething odd here\nSchedule B\n'), ([], "couldn't read Schedule A"))
        funds, problem = iapd.parse_private_funds('SECTION 7.B.(1) Private Fund Reporting\n1. (a) Name of the private fund:\nX FUND\n')
        self.assertEqual((funds, problem), ([], "couldn't read 1 of 1 private funds (Section 7.B.(1))"))
        self.assertEqual(iapd.parse_private_funds('no funds section'), ([], ''))

    def test_read_firm_saves_people_and_funds_and_replaces_bulk(self):
        pr.load_adv_roster(self.db, zip_file(FIX / 'ia030125.csv', self.tmp / 'r.zip'), 'RIA', '2025-03-01')
        pr.load_adv_full(self.db, [zip_dir(FIX / 'adv_full', self.tmp / 'adv.zip')])
        pr.build_firms(self.db)
        con = pr.connect(self.db)
        crd = 1003
        self.assertGreater(con.execute("SELECT COUNT(*) FROM people WHERE firm_key = 'crd-1003' AND source LIKE 'ADV Schedule%'").fetchone()[0], 0)
        con.close()

        class Resp:
            status_code, content = 200, b'%PDF'

            def raise_for_status(self):
                pass

        class Http:
            async def get(self, url, timeout=None):
                self.url = url
                return Resp()
        http = Http()
        ctx = mock.Mock(sec_contact='me@example.com', sec_http=http)
        with mock.patch.object(iapd, 'pdf_reader_available', lambda: True), mock.patch.object(iapd, 'pdf_text', lambda data: PDF_TEXT), \
                mock.patch.object(iapd, 'IAPD_GAP', 0):
            r = asyncio.run(iapd.read_firm(ctx, self.db, crd))
        self.assertEqual(http.url, 'https://reports.adviserinfo.sec.gov/reports/ADV/1003/PDF/1003.pdf')
        self.assertEqual((r['status'], r['people'], r['funds']), ('ok', 3, 2))
        con = pr.connect(self.db)
        sources = {x[0] for x in con.execute("SELECT DISTINCT source FROM people WHERE firm_key = 'crd-1003'")} - {'13F signature', 'Form D related person'}
        self.assertEqual(sources, {iapd.PDF_SOURCE})  # the older bulk rows were replaced
        prof = pr.firm_profile(con, 'crd-1003')
        self.assertEqual({f['source'] for f in prof['privateFunds']}, {'iapd'})
        self.assertEqual(prof['funds'], 2)
        self.assertEqual(prof['advPdf']['status'], 'ok')
        self.assertIn('https://adviserinfo.sec.gov/firm/brochure/1003', [s['url'] for s in prof['sources']])
        jane = next(p for p in prof['people'] if p['name'] == 'PINE, JANE, ANNE')
        self.assertEqual((jane['filed'], jane['ownership']), ('2025-03-28', 'E (75% or more)'))
        con.close()
        # Loading the bulk data again keeps the newer PDF facts
        pr.load_adv_full(self.db, [self.tmp / 'adv.zip'])
        con = pr.connect(self.db)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM people WHERE firm_key = 'crd-1003' AND source LIKE 'ADV Schedule%'").fetchone()[0], 0)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM private_funds WHERE crd = 1003").fetchone()[0], 2)
        con.close()

    def test_queue_order_and_unreadable_firms(self):
        roster = self.tmp / 'r.csv'
        roster.write_text('Organization CRD#,Primary Business Name,Main Office State,5F(2)(c),Latest ADV Filing Date\n'
                          '1,SMALL LLC,NY,10,03/01/2025\n2,BIG LLC,NY,999,03/01/2025\n3,OLD LLC,NY,500,01/01/2024\n4,SAVED LLC,NY,1,03/01/2025\n')
        pr.load_adv_roster(self.db, zip_file(roster, self.tmp / 'r.zip'), 'RIA', '2025-03-01')
        con = pr.connect(self.db)
        with con:
            con.executemany('INSERT INTO adv_filings (crd, bulk_date) VALUES (?, ?)', [(1, '2024-06-01'), (2, '2024-06-01'), (3, '2024-06-01')])
        iapd.WANTED.clear()
        iapd.want(1)
        order = [r['crd'] for r in iapd.next_candidates(con, 10, saved=[4])]
        self.assertEqual(order, [4, 1, 2])  # saved, opened, then by AUM; CRD 3 filed nothing newer than the bulk data
        st = iapd.pdf_status(con)
        self.assertEqual(st['waiting'], 3)
        self.assertFalse(st['verified'])
        con.close()

        class Http:
            async def get(self, url, timeout=None):
                return mock.Mock(status_code=200, content=b'%PDF', raise_for_status=lambda: None)
        ctx = mock.Mock(sec_contact='me@example.com', sec_http=Http())
        with mock.patch.object(iapd, 'pdf_reader_available', lambda: True), mock.patch.object(iapd, 'pdf_text', lambda d: 'a scanned page'), \
                mock.patch.object(iapd, 'IAPD_GAP', 0):
            r = asyncio.run(iapd.read_firm(ctx, self.db, 2))
        self.assertEqual(r, {'status': 'unreadable', 'note': "couldn't find Schedule A"})
        con = pr.connect(self.db)
        st = iapd.pdf_status(con)
        self.assertEqual((st['unreadable'], st['waiting']), (1, 2))  # reported, and not fetched again for this filing
        self.assertEqual(st['problems'][0]['note'], "couldn't find Schedule A")
        con.close()
        iapd.WANTED.clear()

    def test_without_pypdf_it_says_how_to_install(self):
        with mock.patch.object(iapd, 'pdf_reader_available', lambda: False):
            r = asyncio.run(iapd.read_firm(mock.Mock(), self.db, 1))
        self.assertEqual(r['status'], 'unavailable')
        self.assertIn('pypdf', r['note'])


class StateAdvisers(Temp):
    def test_parse_search_and_keep_only_state_registered(self):
        total, firms = iapd.parse_firm_search(json.loads((FIX / 'iapd_search_tx.json').read_text()))
        self.assertEqual(total, 4)
        self.assertEqual(firms[0], {'crd': 300001, 'name': 'LONE STAR WEALTH PLANNING LLC', 'sec_number': '', 'scope': 'ACTIVE',
                                    'street': '100 CONGRESS AVE SUITE 400', 'city': 'AUSTIN', 'state': 'TX', 'zip': '78701', 'country': 'United States'})
        self.assertEqual(firms[1]['city'], 'FREDERICKSBURG')  # address as an object works too
        check = iapd.load_state_firms(self.db, firms, '2026-10-01')
        self.assertEqual(check, {'what': 'state-registered advisers', 'inFile': 4, 'loaded': 2,
                                 'skipped': {'SEC-registered or exempt (already in the SEC lists)': 1, 'not active': 1}})
        pr.build_firms(self.db)
        con = pr.connect(self.db)
        row = con.execute("SELECT type, confidence FROM firms WHERE id = 'crd-300001'").fetchone()
        self.assertEqual(tuple(row), (pr.TYPE_STATE, 'from filing'))
        con.close()

    def test_unknown_shape_fails_clearly(self):
        for bad in ({}, {'hits': {'hits': 'x'}}, {'results': []}):
            with self.assertRaises(iapd.ShapeError):
                iapd.parse_firm_search(bad)
        with self.assertRaises(iapd.ShapeError):
            iapd.parse_firm_search({'hits': {'total': 1, 'hits': [{'_source': {'something': 1}}]}})

    def test_ingest_pages_by_state_and_resumes(self):
        page = json.loads((FIX / 'iapd_search_tx.json').read_text())
        asked = []

        async def search_page(ctx, st, start):
            asked.append((st, start))
            if st == 'CA':
                raise ConnectionError('dropped')
            return page if st == 'TX' else {'hits': {'total': 0, 'hits': []}}
        with mock.patch.object(iapd, 'search_page', search_page):
            with self.assertRaises(ConnectionError):
                asyncio.run(iapd.ingest_state(mock.Mock(), None, self.db))
            done_before = set(pr.loaded_files(self.db, 'state')) - {'run'}
            self.assertEqual(done_before, {'AL', 'AK', 'AZ', 'AR'})
            asked.clear()
            with mock.patch.object(iapd, 'STATES', [s for s in iapd.STATES if s != 'CA']):
                out = asyncio.run(iapd.ingest_state(mock.Mock(), None, self.db))
        self.assertNotIn(('AL', 0), asked)  # finished states skipped on the retry
        self.assertEqual(out, {'advisers': 2})
        info = pr._loaded(self.db, 'state')
        self.assertTrue(info['beta'])


class ReviewFixes(Temp):
    def test_new_holdings_amendment_adds_to_a_totals_only_quarter(self):
        # the original was loaded as totals only (older data set); the amendment comes with holdings kept
        pr.load_13f(self.db, q13f(self.tmp / 'a.zip', 'A1', 91, '31-MAR-2025', '10-MAY-2025', 1000), holdings=False)
        later = make_zip(self.tmp / 'b.zip', {
            'SUBMISSION.tsv': (SUB_H, [['A2', '01-JUN-2025', '13F-HR/A', '91', '31-MAR-2025']]),
            'COVERPAGE.tsv': (COVER_H, [['A2', 'Y', 'NEW HOLDINGS', 'MANAGER 91 LLC', 'DOVER', 'DE', '19901', '13F HOLDINGS REPORT']]),
            'INFOTABLE.tsv': (INFO_H, [['A2', 'MICROSOFT CORP', 'COM', '594918104', '500', '5', 'SH', '', 'SOLE']])})
        pr.load_13f(self.db, later, holdings=True)
        pr.load_13f(self.db, later, holdings=True)  # loading it again doesn't count it twice
        con = pr.connect(self.db)
        self.assertEqual(tuple(con.execute('SELECT total_value, entries FROM filer_history_13f WHERE cik = 91').fetchone()), (1500.0, 2))
        con.close()

    def test_pdf_backoff_and_reset_on_a_new_filing(self):
        roster = self.tmp / 'r.csv'
        roster.write_text('Organization CRD#,Primary Business Name,Main Office State,5F(2)(c),Latest ADV Filing Date\n1,ONE LLC,NY,10,03/01/2025\n')
        pr.load_adv_roster(self.db, zip_file(roster, self.tmp / 'r.zip'), 'RIA', '2025-03-01')

        class Http:
            async def get(self, url, timeout=None):
                return mock.Mock(status_code=503, content=b'')
        ctx = mock.Mock(sec_contact='me@example.com', sec_http=Http())
        with mock.patch.object(iapd, 'pdf_reader_available', lambda: True), mock.patch.object(iapd, 'IAPD_GAP', 0):
            r = asyncio.run(iapd.read_firm(ctx, self.db, 1))
        self.assertEqual((r['status'], r['code']), ('failed', 503))
        self.assertIn('tries again in 1 h', r['note'])
        con = pr.connect(self.db)
        now = __import__('time').time()
        self.assertEqual(iapd.next_candidates(con, now=now), [])  # waiting out the 1-hour backoff
        self.assertEqual([x['crd'] for x in iapd.next_candidates(con, now=now + 3700)], [1])
        with con:
            con.execute("UPDATE adv_filings SET tries = 4")
        self.assertEqual(iapd.next_candidates(con, now=now + 10 ** 6), [])  # left after 4 failures
        with con:
            con.execute("UPDATE adv_firms SET filing_date = '2025-06-01'")  # a newer filing starts the count again
        self.assertEqual([x['crd'] for x in iapd.next_candidates(con, now=now)], [1])
        con.close()

    def test_full_read_is_opt_in(self):
        roster = self.tmp / 'r.csv'
        roster.write_text('Organization CRD#,Primary Business Name,Main Office State,5F(2)(c),Latest ADV Filing Date\n1,ONE LLC,NY,10,03/01/2025\n2,TWO LLC,NY,20,03/01/2025\n')
        pr.load_adv_roster(self.db, zip_file(roster, self.tmp / 'r.zip'), 'RIA', '2025-03-01')
        con = pr.connect(self.db)
        iapd.WANTED.clear()
        self.assertEqual(iapd.next_candidates(con, everyone=False), [])
        self.assertEqual([x['crd'] for x in iapd.next_candidates(con, saved=[1], everyone=False)], [1])
        con.close()
        self.assertFalse(iapd.reader_on(self.db))
        with mock.patch.object(pr, 'DB_PATH', self.db):
            st = asyncio.run(HANDLERS['prospect.adv_pdf_reader'](mock.Mock(), {'action': 'start'}))
            self.assertTrue(st['enabled'])
            asyncio.run(HANDLERS['prospect.adv_pdf_reader'](mock.Mock(), {'action': 'pause'}))
        self.assertFalse(iapd.reader_on(self.db))

    def test_state_paging_and_short_reads(self):
        def page(n, total, start=0, st='TX'):
            return {'hits': {**({'total': total} if total is not None else {}),
                             'hits': [{'_source': {'firm_source_id': str(400000 + start + k), 'firm_name': f'F{start + k}', 'firm_ia_scope': 'ACTIVE',
                                                   'firm_address_details': {'officeAddress': {'state': st}}}} for k in range(n)]}}
        asked = []

        async def search(ctx, st, start):
            asked.append(start)
            return page(100 if start < 200 else 30, None, start) if st == 'TX' else page(0, 0)
        with mock.patch.object(iapd, 'search_page', search), mock.patch.object(iapd, 'STATES', ['TX']):
            out = asyncio.run(iapd.ingest_state(mock.Mock(), None, self.db))
        self.assertEqual(asked, [0, 100, 200])  # no total: stops on the short page
        self.assertEqual(out, {'advisers': 230})

        async def cut_short(ctx, st, start):
            return page(100, 500, start, st) if start < 200 else page(0, 500, start, st)
        with mock.patch.object(iapd, 'search_page', cut_short), mock.patch.object(iapd, 'STATES', ['NY']):
            with self.assertRaises(pr.EngineError) as err:
                asyncio.run(iapd.ingest_state(mock.Mock(), None, self.db))
        self.assertIn('reported 500 advisers for NY but only 200', str(err.exception))
        self.assertFalse(iapd.is_state_registered({'crd': 1, 'scope': '', 'sec_number': ''}))

    def test_kept_download_is_checked_against_the_server(self):
        dl = self.tmp / 'dl'
        dl.mkdir()
        (dl / 'x.zip').write_bytes(b'12345')

        class Http:
            def __init__(self, size):
                self.size = size

            async def head(self, url, timeout=None, follow_redirects=None):
                return mock.Mock(status_code=200, headers={'Content-Length': self.size})
        got = []

        async def fake_download(ctx, url, dest, emit=None, label=''):
            got.append(url)
            return dest
        with mock.patch.object(pr, 'DOWNLOADS', dl), mock.patch.object(pr, 'download', fake_download), mock.patch.object(pr, 'SEC_GAP', 0):
            asyncio.run(pr.fetch(mock.Mock(http=Http('5')), 'https://example.com/x.zip', None, 'x'))
            self.assertEqual(got, [])  # same size: reused
            asyncio.run(pr.fetch(mock.Mock(http=Http('9')), 'https://example.com/x.zip', None, 'x'))
            self.assertEqual(got, ['https://example.com/x.zip'])  # different size: downloaded again


class Handlers(Temp):
    def test_ingest_accepts_failed_and_state(self):
        ctx = mock.Mock(sec_contact='me@example.com')
        with mock.patch.object(pr, 'DB_PATH', self.db):
            with self.assertRaises(pr.EngineError) as err:
                asyncio.run(HANDLERS['prospect.ingest'](ctx, {'source': 'failed'}))
            self.assertIn('Nothing failed', str(err.exception))
        self.assertIn('prospect.adv_pdf', HANDLERS)
        self.assertIn('state', pr.INGESTERS)


if __name__ == '__main__':
    unittest.main()
