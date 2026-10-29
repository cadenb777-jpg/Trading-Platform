"""Family offices from public records (helper/engine/prospect_sources.py) on hand-made fixtures. No network."""
import asyncio
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import prospect as pr  # noqa: E402
from engine import prospect_sources as ps  # noqa: E402

FIX = Path(__file__).parent / 'fixtures' / 'prospect_sources'
pr.USE_PROCESSES = False
TODAY = dt.date(2025, 10, 2)
SFO_ID = 'sfo-sec-1900001'


def text(name):
    return (FIX / name).read_text()


def js(name):
    return json.loads(text(name))


class Ctx:
    """The engine context, with ctx.cached reduced to "load it" (the disk cache is tested in test_core)."""
    sec_contact = 'me@example.com'

    def __init__(self):
        self.keys = []

    async def cached(self, key, max_age, load, persist=False, stale_ok=False):
        self.keys.append((key, persist, stale_ok))
        return await load()


SEC_FILES = {'master.20251001.idx': 'master.20251001.idx', '0001900001-25-000001.txt': 'header_13d.txt',
             '0001900002-25-000002.txt': 'header_form4.txt', '0001900002-25-000003.txt': 'header_144.txt',
             '0000012345-25-000010.txt': 'header_8k.txt', '0000000777-25-000001.txt': 's1.htm'}


def fake_sec(calls):
    async def sec_text(ctx, url, limit=None):
        calls.append(url)
        name = SEC_FILES.get(url.rsplit('/', 1)[-1])
        return text(name) if name else None
    return sec_text


def fake_web(calls, fail=()):
    async def web_json(ctx, url, params=None, headers=None):
        calls.append((url, dict(params or {})))
        if any(f in url for f in fail):
            raise RuntimeError('site down')
        if url == ps.PROPUBLICA_SEARCH:
            return js('propublica_search.json') if 'smith' in params['q'].lower() else {'organizations': []}
        if url == ps.PROPUBLICA_ORG.format(ein=61234567):
            return js('propublica_org.json')
        if url == ps.PROPUBLICA_ORG.format(ein=62222222):
            return js('propublica_charity.json')
        if url == ps.GLEIF_RECORDS:
            return js('gleif_search.json') if params['filter[entity.legalName]'] == 'SMITH FAMILY HOLDINGS LLC' else {'data': []}
        if url.endswith('5493001SMITHHOLD0001/direct-parent') or url.endswith('5493001SMITHHOLD0001/ultimate-parent'):
            return js('gleif_parent.json')
        if url == ps.WIKIDATA_SPARQL:
            return js('wikidata.json')
        return None
    return web_json


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='tp-psrc-'))
        self.db = self.tmp / 'prospect.db'
        self.sec_calls, self.web_calls = [], []

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def refresh(self, keys=None, fail=(), events=None):
        async def emit(e):
            if events is not None:
                events.append(e)
        with mock.patch.object(ps, 'sec_text', fake_sec(self.sec_calls)), mock.patch.object(ps, 'web_json', fake_web(self.web_calls, fail)), \
                mock.patch.object(ps, 'DAYS', 3):
            return asyncio.run(_run(Ctx(), keys, emit, self.db))

    def add_firm(self, con, fid, name, type_, street, city, state, zip_code, cik=None, crd=None):
        row = [fid, name, '[]', type_, 'from filing', json.dumps(['from fixture']), crd, None, cik, street, city, state, zip_code, '', '',
               None, None, None, '', ',', None, '', '2025-01-01', 0, None, None, 0, None, 0, None, None, '']
        con.execute(f'INSERT INTO firms VALUES ({",".join("?" * 32)})', row)

    def con(self):
        return ps.connect(self.db)


async def _run(ctx, keys, emit, db):
    real = ps.recent_index

    async def fixed(ctx, days=ps.DAYS, emit=None, today=None):
        return await real(ctx, days, emit, TODAY)
    with mock.patch.object(ps, 'recent_index', fixed):
        return await ps.run_refresh(ctx, keys, emit, db)


class Parsers(unittest.TestCase):
    def test_master_index_and_grouping(self):
        rows = ps.parse_master_index(text('master.20251001.idx'))
        self.assertEqual(len(rows), 12)
        self.assertEqual(rows[0], {'cik': 12345, 'name': 'ACME CORP', 'form': 'SC 13D', 'date': '2025-10-01',
                                   'path': 'edgar/data/12345/0001900001-25-000001.txt', 'accession': '0001900001-25-000001'})
        groups = {g['accession']: g for g in ps.group_filings(rows)}
        self.assertEqual(len(groups['0001900002-25-000002']['names']), 3)  # issuer + two reporting owners

    def test_header_13d_and_form4(self):
        h = ps.parse_header(text('header_13d.txt'))
        self.assertEqual((h['form'], h['filed'], h['accession']), ('SC 13D', '2025-10-01', '0001900001-25-000001'))
        subject, filer = h['parties']
        self.assertEqual((subject['role'], subject['name'], subject['cik']), ('SUBJECT COMPANY', 'ACME CORP', 12345))
        self.assertEqual((filer['role'], filer['street'], filer['city'], filer['zip']), ('FILED BY', '100 MAIN STREET', 'GREENWICH', '06830'))
        f4 = ps.parse_header(text('header_form4.txt'))
        owner = f4['parties'][0]
        self.assertEqual((owner['role'], owner['name'], owner['cik']), ('REPORTING-OWNER', 'SMITH JOHN A', 1900002))
        self.assertEqual((owner['street'], owner['careOf']), ('100 MAIN ST STE 5', 'SMITH FAMILY OFFICE'))  # c/o line skipped
        self.assertEqual([p['role'] for p in f4['parties']], ['REPORTING-OWNER', 'REPORTING-OWNER', 'ISSUER'])
        k8 = ps.parse_header(text('header_8k.txt'))
        self.assertTrue(ps.item_201(k8['items']))
        self.assertFalse(ps.item_201(['Regulation FD Disclosure']))

    def test_selling_holders(self):
        self.assertEqual(ps.parse_selling_holders(text('s1.htm')), ['Smith Family Holdings LLC', 'Jane Doe'])
        self.assertEqual(ps.parse_selling_holders('<p>no table here</p>'), [])

    def test_propublica_gleif_wikidata(self):
        self.assertEqual(ps.parse_propublica_search(js('propublica_search.json'), 'SMITH'), [61234567])  # not "Smithsonian"
        f = ps.parse_propublica_org(js('propublica_org.json'))
        self.assertEqual((f['ein'], f['careOf'], f['assets'], f['taxPeriod'], f['zip']), (61234567, 'JOHN A SMITH', 25e6, '2023-12', '06830-1234'))
        self.assertIsNone(ps.parse_propublica_org(js('propublica_charity.json')))  # a public charity, not a 990-PF
        g = ps.parse_gleif_record(js('gleif_search.json')['data'][0])
        self.assertEqual((g['lei'], g['city'], g['state'], g['zip']), ('5493001SMITHHOLD0001', 'GREENWICH', 'CT', '06830'))  # headquarters
        w = ps.parse_wikidata(js('wikidata.json'))
        self.assertEqual(w['Q900001'], {'name': 'John Smith', 'worth': 2.1e9, 'companies': ['Acme Corp'], 'family': ''})

    def test_names_and_addresses(self):
        self.assertTrue(ps.is_person('SMITH JOHN A'))
        self.assertTrue(ps.is_person('John A. Smith'))
        self.assertFalse(ps.is_person('SMITH FAMILY TRUST'))
        self.assertFalse(ps.is_person('Acme Corp'))
        self.assertTrue(ps.same_person('SMITH JOHN A', 'John Smith'))
        self.assertFalse(ps.same_person('SMITH JOHN', 'SMITH JANE'))
        self.assertEqual(ps.surname('SMITH JOHN A'), 'SMITH')
        self.assertEqual(ps.surname('Jane Doe'), 'DOE')
        self.assertEqual(ps.surname('Walton Family Holdings LLC'), 'WALTON')
        self.assertEqual(ps.surname('Acme Corp'), '')
        self.assertEqual(ps.address_parts('100 Main Street, Suite 5', '06830-1234'), ('100 MAIN ST|06830', '5'))
        self.assertEqual(ps.address_parts('100 MAIN ST STE 5', '06830')[0], ps.address_parts('100 Main Street', '06830')[0])
        self.assertEqual(ps.address_parts('PO Box', ''), ('', ''))
        self.assertFalse(ps.suites_agree('5', '7'))
        self.assertTrue(ps.suites_agree('5', ''))

    def test_never_certain(self):
        for points in range(0, 12):
            self.assertNotIn('certain', ps.confidence_for(points))
        self.assertEqual(ps.confidence_for(3), 'weak signals')
        self.assertEqual(ps.confidence_for(9), 'strong signals')


class Refresh(Base):
    def test_collectors_save_facts_with_source_and_date(self):
        events = []
        out = self.refresh(events=events)
        self.assertTrue(all('error' not in out[k] for k in ps.ORDER), out)
        con = self.con()
        kinds = {r['key']: r['kind'] for r in con.execute('SELECT key, kind FROM src_entities')}
        self.assertEqual((kinds['sec-1900001'], kinds['sec-1900002'], kinds['sec-1900003'], kinds['sec-12345']), ('entity', 'person', 'entity', 'issuer'))
        self.assertEqual(kinds['ein-61234567'], 'foundation')
        self.assertNotIn('sec-1955555', kinds)  # a Form 4 with no entity-like name is not read
        self.assertNotIn('ein-62222222', kinds)
        facts = [dict(r) for r in con.execute('SELECT * FROM src_facts')]
        self.assertTrue(facts and all(f['url'].startswith('https://') and f['date'] for f in facts))
        codes = {(f['entity_key'], f['code']) for f in facts}
        self.assertIn(('sec-1900001', 'owner_13d'), codes)
        self.assertIn(('sec-1900002', 'insider'), codes)
        self.assertIn(('sec-1900002', 'liquidity'), codes)  # Form 144
        self.assertIn(('sec-1900003', 'liquidity'), codes)  # 8-K Item 2.01 at a company it holds
        self.assertIn(('s1-smith-family-holdings', 'liquidity'), codes)
        self.assertIn(('lei-5493001SMITHHOLD0001', 'lei_parent'), codes)
        # politeness: the 8-K of a company nobody holds is never fetched; only yesterday-and-before indexes, no weekends
        self.assertFalse(any('0000066666-25-000011' in u for u in self.sec_calls))
        self.assertFalse(any('20251004' in u or '20251005' in u for u in self.sec_calls))
        self.assertTrue(any(e['text'].startswith('Linking public records') for e in events))
        st = ps.status(con)
        self.assertEqual([s['key'] for s in st['sources']], list(ps.ORDER))
        self.assertTrue(all(s['last']['ok'] and s['last']['at'] for s in st['sources']))
        self.assertEqual(st['sources'][0]['last']['sourceDate'], '2025-10-01')
        con.close()

    def test_raw_replies_go_to_the_persistent_cache(self):
        ctx = Ctx()
        with mock.patch.object(ps, 'sec_text', fake_sec([])), mock.patch.object(ps, 'web_json', fake_web([])), mock.patch.object(ps, 'DAYS', 3):
            asyncio.run(_run(ctx, None, None, self.db))
        self.assertTrue(ctx.keys and all(persist and stale for _, persist, stale in ctx.keys))
        self.assertTrue({k[0][0] for k in ctx.keys} >= {'psrc-idx', 'psrc-head', 'psrc-s1', 'psrc-gleif', 'psrc-pp-search', 'psrc-pp-org', 'psrc-wikidata'})

    def test_a_failing_source_is_recorded_and_the_rest_run(self):
        out = self.refresh(fail=('gleif',))
        self.assertIn('error', out['gleif'])
        self.assertNotIn('error', out['propublica'])
        con = self.con()
        st = ps.status(con)
        gleif = next(s for s in st['sources'] if s['key'] == 'gleif')
        self.assertFalse(gleif['last']['ok'])
        self.assertIn('site down', gleif['last']['error'])
        self.assertEqual(ps.JOB['stage'], 'Done with problems')
        self.assertTrue(con.execute('SELECT COUNT(*) FROM firms WHERE type = ?', (ps.TYPE_SFO,)).fetchone()[0])  # still found
        con.close()


class Matching(Base):
    def test_new_possible_single_family_office(self):
        self.refresh()
        con = self.con()
        firm = dict(con.execute('SELECT * FROM firms WHERE id = ?', (SFO_ID,)).fetchone())
        self.assertEqual((firm['type'], firm['confidence'], firm['city'], firm['cik']), (ps.TYPE_SFO, 'strong signals', 'GREENWICH', 1900001))
        reasons = json.loads(firm['reasons'])
        self.assertTrue(any('990-PF foundation' in r and 'same address' in r for r in reasons))
        self.assertTrue(any('Schedule 13D' in r for r in reasons))
        self.assertTrue(any('Wikidata' in r and 'Acme Corp' in r for r in reasons))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM firms WHERE id LIKE 'sfo-%'").fetchone()[0], 1)  # Jane Doe alone is not enough
        prof = pr.firm_profile(con, SFO_ID)
        self.assertTrue(prof['signals'] and all(set(s) == {'label', 'source', 'url', 'date', 'code'} and s['url'] for s in prof['signals']))
        self.assertIn('liquidity', {s['code'] for s in prof['signals']})
        self.assertIn('SMITH JOHN A', {p['name'] for p in prof['people']})
        self.assertTrue(all(link['status'] == 'linked' for link in prof['links']))
        self.assertGreaterEqual(len(prof['links']), 6)
        self.assertEqual([r['id'] for r in pr.search(con, {'types': [ps.TYPE_SFO]})['rows']], [SFO_ID])
        with mock.patch.object(pr, 'RECENT_LIQUIDITY_DAYS', 100000):
            self.assertEqual([r['id'] for r in pr.search(con, {'recentLiquidity': True})['rows']], [SFO_ID])
        with mock.patch.object(pr, 'RECENT_LIQUIDITY_DAYS', 1):
            self.assertEqual(pr.search(con, {'recentLiquidity': True})['total'], 0)  # the fixture events are older
        # running the linking again gives the same result (it removes its own rows first)
        with con:
            again = ps.apply(con)
        self.assertEqual(again['newFirms'], 1)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM people WHERE source LIKE 'Public records:%'").fetchone()[0], len(prof['people']))
        con.close()

    def test_same_address_links_to_an_existing_13f_filer_and_upgrades_it(self):
        con = self.con()
        with con:
            self.add_firm(con, 'cik-9500', 'GREENWICH PARTNERS', pr.TYPE_13F, '100 Main St, Suite 5', 'Greenwich', 'CT', '06830', cik=9500)
            self.add_firm(con, 'crd-77', 'SOUND ADVISERS', pr.TYPE_RIA, '100 Main St Ste 5', 'Greenwich', 'CT', '06830', crd=77)
        con.close()
        self.refresh()
        con = self.con()
        types = {r['id']: (r['type'], r['confidence']) for r in con.execute('SELECT id, type, confidence FROM firms')}
        self.assertNotIn(SFO_ID, types)  # joined to the existing firm instead of a new one
        linked = {r['firm_id'] for r in con.execute('SELECT firm_id FROM signals')}
        self.assertEqual(linked, {'cik-9500'})  # the firm without Form ADV, not the RIA in the same suite
        target = 'cik-9500'
        link = con.execute("SELECT method, score, status FROM links WHERE firm_id = ? AND source LIKE 'Public records:%'", (target,)).fetchone()
        self.assertEqual((link['score'], link['status']), (ps.STRONG, 'linked'))
        self.assertIn('same address', link['method'])
        self.assertEqual(types['crd-77'][0], pr.TYPE_RIA)  # a registered adviser is never relabelled
        self.assertEqual(types['cik-9500'], (ps.TYPE_SFO, 'strong signals'))
        reasons = json.loads(con.execute("SELECT reasons FROM firms WHERE id = 'cik-9500'").fetchone()[0])
        self.assertEqual(reasons[0], 'from fixture')  # the original reasons are kept
        # without the public records the upgrade is undone
        with con:
            con.execute('DELETE FROM src_facts')
            con.execute('DELETE FROM src_entities')
            ps.apply(con)
        self.assertEqual(con.execute("SELECT type FROM firms WHERE id = 'cik-9500'").fetchone()[0], pr.TYPE_13F)
        self.assertEqual(con.execute('SELECT COUNT(*) FROM signals').fetchone()[0], 0)
        con.close()

    def test_crowded_building_is_not_an_address_match(self):
        con = self.con()
        with con:
            for i in range(ps.CROWDED + 1):
                self.add_firm(con, f'crd-{i}', f'TENANT {i} ADVISERS', pr.TYPE_RIA, '100 Main Street', 'Greenwich', 'CT', '06830', crd=i)
        con.close()
        self.refresh()
        con = self.con()
        self.assertEqual(con.execute("SELECT COUNT(*) FROM signals WHERE firm_id LIKE 'crd-%'").fetchone()[0], 0)
        self.assertTrue(con.execute('SELECT COUNT(*) FROM firms WHERE id = ?', (SFO_ID,)).fetchone()[0])
        con.close()

    def test_shared_person_and_city_is_a_medium_link(self):
        con = self.con()
        with con:
            self.add_firm(con, 'cik-9600', 'NORTH STREET CAPITAL', pr.TYPE_13F, '9 Elm St', 'Greenwich', 'CT', '06831', cik=9600)
            con.execute("INSERT INTO people VALUES ('cik-9600', 'cik-9600', 'John A. Smith', 'Managing Member', '13F signature', 'x', 0, '2025-05-01', '')")
        con.close()
        self.refresh()
        con = self.con()
        link = con.execute("SELECT method, score, status FROM links WHERE firm_id = 'cik-9600' AND source LIKE 'Public records:%'").fetchone()
        self.assertEqual((link['score'], link['status']), (ps.MEDIUM, 'linked'))
        self.assertIn('shared person', link['method'])
        con.close()

    def test_name_only_is_a_weak_possible_link(self):
        con = self.con()
        with con:
            self.add_firm(con, 'cik-9700', 'SMITH FAMILY HOLDINGS', pr.TYPE_13F, '1 Ocean Dr', 'Miami', 'FL', '33139', cik=9700)
        con.close()
        self.refresh()
        con = self.con()
        link = con.execute("SELECT score, status, method FROM links WHERE firm_id = 'cik-9700' AND source LIKE 'Public records:%'").fetchone()
        self.assertEqual(link['status'], 'possible')
        self.assertLessEqual(link['score'], 0.6)
        self.assertIn('name only', link['method'])
        self.assertEqual(con.execute("SELECT COUNT(*) FROM signals WHERE firm_id = 'cik-9700'").fetchone()[0], 0)
        self.assertTrue(con.execute('SELECT COUNT(*) FROM firms WHERE id = ?', (SFO_ID,)).fetchone()[0])  # still its own firm
        con.close()

    def test_rebuilding_the_firm_list_keeps_the_public_records(self):
        self.refresh()
        con = self.con()
        with con:
            con.execute("INSERT INTO filers_13f (cik, name, city, state, zip, latest_period, latest_filed) VALUES (9800, 'OTHER MANAGER LLC', 'Boston', 'MA', '02110', '2025-06-30', '2025-08-01')")
        con.close()
        pr.build_firms(self.db)
        con = self.con()
        self.assertEqual(con.execute('SELECT type FROM firms WHERE id = ?', (SFO_ID,)).fetchone()[0], ps.TYPE_SFO)
        self.assertTrue(con.execute("SELECT COUNT(*) FROM firms WHERE id = 'cik-9800'").fetchone()[0])
        self.assertTrue(con.execute('SELECT COUNT(*) FROM signals WHERE firm_id = ?', (SFO_ID,)).fetchone()[0])
        con.close()


class Handlers(Base):
    def test_refresh_and_status_requests(self):
        no_email = Ctx()
        no_email.sec_contact = ''
        with mock.patch.object(pr, 'DB_PATH', self.db):
            with self.assertRaises(pr.EngineError):
                asyncio.run(ps.h_sources_refresh(no_email, {'id': 3, 'type': 'prospect.sources.refresh'}))
            with self.assertRaises(pr.EngineError):
                asyncio.run(ps.h_sources_refresh(Ctx(), {'sources': ['opencorporates']}))
            with mock.patch.object(ps, 'sec_text', fake_sec([])), mock.patch.object(ps, 'web_json', fake_web([])):
                out = asyncio.run(ps.h_sources_refresh(no_email, {'id': 4, 'type': 'prospect.sources.refresh', 'sources': ['wikidata'], 'wait': True, '_emit': None}))
            self.assertEqual(out['result']['wikidata'], {'people': 2})
            st = asyncio.run(ps.h_sources_status(no_email, {'id': 5, 'type': 'prospect.sources.status'}))
        self.assertEqual(len(st['sources']), 5)
        self.assertTrue(next(s for s in st['sources'] if s['key'] == 'wikidata')['last']['ok'])
        self.assertIsNone(next(s for s in st['sources'] if s['key'] == 'gleif')['last'])
        self.assertIn('possibleSfo', st['counts'])
        from engine.core import HANDLERS
        self.assertTrue({'prospect.sources.refresh', 'prospect.sources.status'} <= set(HANDLERS))

    def test_other_sites_get_one_request_a_second(self):
        sleeps = []

        async def sleep(s):
            sleeps.append(s)
        ps._web_last.clear()
        with mock.patch.object(ps.asyncio, 'sleep', sleep):
            async def two():
                await ps._web_pace('api.gleif.org')
                await ps._web_pace('api.gleif.org')
                await ps._web_pace('query.wikidata.org')
            asyncio.run(two())
        self.assertEqual(len(sleeps), 1)
        self.assertGreater(sleeps[0], 0.9)


if __name__ == '__main__':
    unittest.main()
