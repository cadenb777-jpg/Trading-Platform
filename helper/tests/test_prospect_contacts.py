"""Website contacts, email labels, review queue, watcher, AI citations and opt-outs (engine/prospect_contacts.py).
Hand-made pages in fixtures/prospect_contacts; no network."""
import asyncio
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import prospect as pr  # noqa: E402
from engine import prospect_contacts as pc  # noqa: E402
from engine.core import HANDLERS  # noqa: E402

FIX = Path(__file__).parent / 'fixtures' / 'prospect_contacts'
SITE = 'https://www.oakridgewealth.com'
PAGES = {'/robots.txt': 'robots.txt', '/': 'home.html', '/about-us': 'about.html', '/our-team/': 'team.html',
         '/our-team/jane-doe': 'jane.html', '/contact': 'contact.html'}


class FakeFetch:
    """Serves the fixture site; anything else is a 404. Records every URL and when it was asked for."""

    def __init__(self, pages=None, robots_status=200, overrides=None):
        self.pages = {SITE + k: (FIX / v).read_text() for k, v in (pages or PAGES).items()}
        self.pages.update(overrides or {})
        self.robots_status = robots_status
        self.calls = []

    async def __call__(self, url):
        self.calls.append((url, time.monotonic()))
        if url.endswith('/robots.txt') and self.robots_status != 200:
            return pc.Page(self.robots_status, url)
        if url in self.pages:
            return pc.Page(200, url, 'text/html', self.pages[url])
        return pc.Page(404, url, 'text/html')


def run(coro):
    return asyncio.run(coro)


def page(name, url=SITE + '/', kind='team'):
    parsed = pc.parse_html((FIX / name).read_text(), url)
    return {'url': url, 'kind': kind, 'parsed': parsed, 'title': parsed['title'], 'text': pc.page_text(parsed)}


class DbCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = Path(self.dir) / 'prospect.db'
        con = pc.connect(self.db)
        con.execute("INSERT INTO firms (id, name, type, confidence, reasons, other_names, crd, website, phone, aum_total, filing_date, city, state, zip, street, "
                    "has13f, funds, offerings) VALUES ('crd-1', 'Oak Ridge Wealth Partners', 'Registered RIA', 'from filing', '[]', '[]', 1, "
                    "'WWW.OAKRIDGEWEALTH.COM', '312-555-0100', 500000000, '2026-03-30', 'Chicago', 'IL', '60602', '100 N LaSalle', 0, 0, 0)")
        con.execute("INSERT INTO people (firm_id, name, title, source, key_title, filed) VALUES ('crd-1', 'GREEN, THOMAS PAUL', 'CHIEF COMPLIANCE OFFICER', "
                    "'Form ADV Schedule A', 0, '2026-03-30')")
        con.commit()
        con.close()
        self.patches = [mock.patch.object(pr, 'DB_PATH', self.db), mock.patch.object(pc, 'note_opt_outs', return_value=set()),
                        mock.patch.object(pc, 'HOST_GAP', 0)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def con(self):
        return pc.connect(self.db)

    def crawl(self, fetch=None):
        return run(pc.crawl_firm(None, 'crd-1', db_path=self.db, fetch=fetch or FakeFetch()))

    def view(self, smtp=False):
        con = self.con()
        try:
            return pc.contacts(con, 'crd-1', smtp, set())
        finally:
            con.close()


class Extraction(unittest.TestCase):
    def test_people_titles_and_bios(self):
        people = {p['name']: p for p in pc.extract_people(page('team.html')['parsed'])}
        self.assertEqual(set(people), {'Jane A. Doe', 'Robert Smith', 'Maria Lopez'})  # "Investment Philosophy" is not a person
        self.assertEqual(people['Jane A. Doe']['title'], 'Founder & Chief Investment Officer')
        self.assertTrue(people['Jane A. Doe']['bio'].startswith('Jane founded Oak Ridge'))
        self.assertEqual(people['Robert Smith']['title'], 'Partner, Senior Wealth Advisor')
        self.assertEqual(people['Maria Lopez']['bio'], '')

    def test_jsonld_person(self):
        people = pc.extract_people(page('jane.html')['parsed'])
        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]['email'], 'jdoe@oakridgewealth.com')

    def test_emails_only_on_the_firm_domain(self):
        found = {e for e, _ in pc.extract_emails(page('team.html')['parsed'], 'oakridgewealth.com')}
        self.assertEqual(found, {'jdoe@oakridgewealth.com', 'bsmith@oakridgewealth.com'})  # gmail skipped, [at] decoded
        home = {e for e, _ in pc.extract_emails(page('home.html')['parsed'], 'oakridgewealth.com')}
        self.assertEqual(home, {'info@oakridgewealth.com'})  # the address inside <script> is not page text

    def test_phones_main_and_direct_only(self):
        team = pc.extract_phones(page('team.html')['parsed'], 'team', '3125550100')
        self.assertEqual([(d, k) for d, k, _ in team], [('3125550142', 'direct')])  # the mobile number is dropped
        home = pc.extract_phones(page('home.html', kind='home')['parsed'], 'home', '3125550100')
        self.assertEqual([(d, k) for d, k, _ in home], [('3125550100', 'main')])  # fax dropped
        self.assertIsNone(pc.classify_phone('', 'bio', '3125550111', '3125550100'))  # unlabelled on a bio page: could be personal
        for label in ('C: ', 'M ', 'Mob. ', 'iPhone: ', 'Cell: ', 'm. ', 'Mobile - '):
            self.assertIsNone(pc.classify_phone(label, 'contact', '3125550111', '3125550100'), label)
        self.assertIsNone(pc.classify_phone('', 'home', '3125550111', '3125550100'))  # unlabelled: never the main line
        self.assertIsNone(pc.classify_phone('Office: ', 'team', '3125550111', '3125550100'))  # team page: only "direct"
        self.assertEqual(pc.classify_phone('Office: ', 'contact', '3125550111', '3125550100'), 'main')
        self.assertEqual(pc.classify_phone('T: ', 'home', '3125550111', '3125550100'), 'main')
        self.assertEqual(pc.classify_phone('Direct: ', 'bio', '3125550111', '3125550100'), 'direct')
        self.assertEqual(pc.classify_phone('', 'bio', '3125550100', '3125550100'), 'main')  # the Form ADV number
        about = pc.parse_html('<p>Call 312-555-0111 any time</p><p>Phone: 312-555-0122</p>', SITE + '/about-us')
        self.assertEqual(pc.extract_phones(about, 'about', ''), [])  # about pages give no main line

    def test_focus(self):
        focus = pc.investment_focus([page('home.html', kind='home'), page('about.html', SITE + '/about-us', 'about')])
        tags = {t['tag'] for t in focus['tags']}
        self.assertTrue({'Private equity', 'Estate planning', 'Tax planning', 'Fixed income', 'Retirement planning', 'Alternatives'} <= tags)
        self.assertTrue(all(s['url'].startswith(SITE) for s in focus['sentences']))
        self.assertTrue(focus['sentences'])

    def test_names(self):
        self.assertEqual(pc.split_name('SMITH, JOHN ALBERT'), ('john', 'smith'))
        self.assertEqual(pc.split_name('Jane A. Doe, CFA'), ('jane', 'doe'))
        self.assertEqual(pc.split_name('Maria de la Cruz'), ('maria', 'delacruz'))
        self.assertEqual(pc.split_name('Dr. Jane Doe'), ('jane', 'doe'))
        self.assertEqual(pc.split_name('Mr. Robert Smith Jr.'), ('robert', 'smith'))
        self.assertEqual(pc.split_name('Prof. Alan Wu III'), ('alan', 'wu'))
        self.assertEqual(pc.split_name('DOE, JANE, MRS'), ('jane', 'doe'))
        self.assertEqual(pc.local_for('flast', 'Dr. Jane Doe'), 'jdoe')
        self.assertIsNone(pc.looks_like_name('Wealth Management Group'))
        self.assertIsNone(pc.looks_like_name('Contact Us Today'))

    def test_site_url(self):
        self.assertEqual(pc.site_url('WWW.OAKRIDGEWEALTH.COM'), 'https://www.oakridgewealth.com/')
        self.assertEqual(pc.site_url('https://www.linkedin.com/company/x; http://firm.com/home'), 'http://firm.com/home')
        self.assertIsNone(pc.site_url(''))
        self.assertEqual(pc.base_domain('www.a.co.uk'), 'a.co.uk')
        self.assertTrue(pc.same_site('https://mail.firm.com/x', 'firm.com'))
        self.assertFalse(pc.same_site('https://firm.com.evil.io/', 'firm.com'))


class EmailLayer(unittest.TestCase):
    def test_pattern(self):
        self.assertEqual(pc.detect_pattern(['jdoe@x.com', 'bsmith@x.com', 'info@x.com'], ['Jane Doe', 'Robert Smith'])['pattern'], 'flast')
        self.assertEqual(pc.detect_pattern(['jane.doe@x.com'], ['Jane Doe'])['pattern'], 'first.last')
        self.assertIsNone(pc.detect_pattern(['info@x.com'], ['Jane Doe']))
        self.assertEqual(pc.local_for('flast', 'Maria Lopez'), 'mlopez')

    def test_labels_never_verified(self):
        self.assertEqual(pc.guess_label(True, True, False, {'result': 'accepted'}), 'pattern + server-checked')
        self.assertEqual(pc.guess_label(True, True, False, None), 'pattern + domain accepts mail')
        self.assertEqual(pc.guess_label(True, True, False, {'result': 'rejected'}), 'guess')
        self.assertEqual(pc.guess_label(False, True, False, {'result': 'accepted'}), 'guess')
        self.assertEqual(pc.guess_label(True, True, True, {'result': 'accepted'}), "catch-all (can't verify)")
        self.assertEqual(pc.guess_label(True, None, None, None), 'guess')
        self.assertNotIn('verified', pc.LABELS)

    def test_doh(self):
        data = {'Status': 0, 'Answer': [{'type': 15, 'data': '20 alt.mx.net.'}, {'type': 15, 'data': '10 mx.firm.com.'}, {'type': 5, 'data': 'x'}]}
        self.assertEqual(pc.parse_doh(data), ['mx.firm.com', 'alt.mx.net'])
        self.assertEqual(pc.parse_doh({'Status': 3}), [])

    def test_mx_lookup_falls_back_to_second_resolver(self):
        class Http:
            calls = []

            async def get(self, url, **kw):
                self.calls.append(url)
                if 'cloudflare' in url:
                    raise OSError('down')
                return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'Answer': [{'type': 15, 'data': '5 mx.firm.com.'}]})
        with mock.patch.dict(sys.modules, {'dns': None, 'dns.asyncresolver': None}):
            hosts, via = run(pc.mx_lookup(Http(), 'firm.com'))
        self.assertEqual((hosts, via), (['mx.firm.com'], 'dns.google'))

    def test_smtp_probe(self):
        class Server:
            accept_all = False

            seen = []

            def __init__(self, host, port, timeout, local_hostname=None):
                self.sent = []
                Server.seen.append((host, local_hostname))

            def ehlo_or_helo_if_needed(self):
                pass

            def mail(self, sender):
                self.sent.append(('MAIL', sender))
                return 250, b'ok'

            def rcpt(self, addr):
                return (250, b'ok') if self.accept_all or addr.startswith('jdoe') else (550, b'no such user')

            def quit(self):
                pass
        resolve = mock.patch.object(pc, 'RESOLVE', lambda host: {'mx.firm.com': '203.0.113.7'}.get(host))
        resolve.start()
        self.addCleanup(resolve.stop)
        with mock.patch.object(pc, 'SMTP_FACTORY', Server):
            r = pc.smtp_probe(['mx.firm.com'], 'firm.com', ['jdoe@firm.com', 'mlopez@firm.com'])
        self.assertEqual(Server.seen[-1], ('203.0.113.7', 'localhost.localdomain'))  # the checked IP; no computer name
        self.assertFalse(r['catchAll'])
        self.assertEqual(r['results'], {'jdoe@firm.com': ('accepted', 250), 'mlopez@firm.com': ('rejected', 550)})
        Server.accept_all = True
        with mock.patch.object(pc, 'SMTP_FACTORY', Server):
            r = pc.smtp_probe(['mx.firm.com'], 'firm.com', ['jdoe@firm.com'])
        self.assertTrue(r['catchAll'])
        self.assertEqual(r['results'], {})  # a catch-all answer means nothing

        with mock.patch.object(pc, 'SMTP_FACTORY', Server):
            r = pc.smtp_probe(['mx.internal.lan'], 'firm.com', ['jdoe@firm.com'])  # resolves to nothing public
        self.assertEqual(r['results'], {})
        self.assertIn('not a public', r['note'])
        self.assertFalse(any(h == 'mx.internal.lan' for h, _ in Server.seen))

        def blocked(*a, **k):
            raise OSError('Connection timed out')
        with mock.patch.object(pc, 'SMTP_FACTORY', blocked):
            r = pc.smtp_probe(['mx.firm.com'], 'firm.com', ['jdoe@firm.com'])
        self.assertIsNone(r['catchAll'])
        self.assertIn('port 25', r['note'])


class Crawling(DbCase):
    def test_polite_crawl(self):
        fetch = FakeFetch()
        result = run(pc.Crawler(fetch, gap=0).run(SITE + '/'))
        urls = [u for u, _ in fetch.calls]
        self.assertEqual(urls[0], SITE + '/robots.txt')
        self.assertEqual(urls.count(SITE + '/robots.txt'), 1)
        self.assertNotIn(SITE + '/private/team-archive', urls)  # robots.txt says no
        self.assertTrue(any(s['url'] == SITE + '/private/team-archive' and 'robots' in s['reason'] for s in result['skipped']))
        self.assertFalse(any('linkedin' in u or u.endswith('.pdf') or 'login' in u for u in urls))
        self.assertIn(SITE + '/our-team/jane-doe', urls)  # bio page linked from the team page
        self.assertLessEqual(len(result['pages']), pc.MAX_PAGES)
        self.assertEqual(result['status'], 'done')

    def test_page_limit_and_gap(self):
        many = {SITE + '/': '<html><body>' + ''.join(f'<a href="/team/{i}">Team {i}</a>' for i in range(30)) + '</body></html>'}
        many.update({SITE + f'/team/{i}': '<p>x</p>' for i in range(30)})
        fetch = FakeFetch(pages={'/robots.txt': 'robots.txt'}, overrides=many)
        result = run(pc.Crawler(fetch, gap=0.05).run(SITE + '/'))
        self.assertEqual(len(result['pages']), pc.MAX_PAGES)
        times = [t for _, t in fetch.calls]
        self.assertTrue(all(b - a >= 0.045 for a, b in zip(times, times[1:])))  # one request per gap per host

    def test_unreadable_robots_stops(self):
        fetch = FakeFetch(robots_status=503)
        result = run(pc.Crawler(fetch, gap=0).run(SITE + '/'))
        self.assertEqual([u for u, _ in fetch.calls], [SITE + '/robots.txt'])
        self.assertEqual(result['status'], 'failed')
        self.assertIn('robots.txt', result['note'])

    def test_forbidden_robots_means_nothing(self):
        fetch = FakeFetch(robots_status=403)
        result = run(pc.Crawler(fetch, gap=0).run(SITE + '/'))
        self.assertEqual(result['pages'], [])

    def test_private_addresses_blocked(self):
        async def go():
            f = pc.HttpFetcher()
            try:
                return await f('http://127.0.0.1:8765/')
            finally:
                await f.close()
        p = run(go())
        self.assertEqual(p.status, 0)
        self.assertIn('public', p.error)

    def test_user_agent_is_honest_and_private(self):
        ua = pc.user_agent()
        self.assertIn('TradingPlatform', ua)
        self.assertIn('robots.txt', ua)
        self.assertIn(pc.PROJECT_URL, ua)
        self.assertNotIn('@', ua)  # never the owner's email
        f = pc.HttpFetcher()
        try:
            self.assertEqual(f.client.headers['User-Agent'], ua)
        finally:
            run(f.close())
        # crawl_firm builds the fetcher without the SEC contact even when one is set
        src = Path(pc.__file__).read_text()
        self.assertNotIn('sec_contact', src)

    def test_peer_check_after_connecting(self):
        def resp(addr):
            stream = SimpleNamespace(get_extra_info=lambda k: addr)
            return SimpleNamespace(extensions={'network_stream': stream})
        self.assertFalse(pc.peer_is_public(resp(('127.0.0.1', 443))))
        self.assertFalse(pc.peer_is_public(resp(('10.0.0.5', 443))))
        self.assertFalse(pc.peer_is_public(resp(None)))  # unknown peer: fail closed
        self.assertFalse(pc.peer_is_public(SimpleNamespace(extensions={})))
        self.assertTrue(pc.peer_is_public(resp(('8.8.8.8', 443))))


class ContactsView(DbCase):
    def test_crawl_saves_findings_with_sources(self):
        r = self.crawl()
        self.assertEqual(r['website'], SITE + '/')
        v = self.view()
        people = {p['name']: p for p in v['people']}
        self.assertEqual(people['Jane A. Doe']['email']['label'], 'published')
        self.assertEqual(people['Robert Smith']['email']['email'], 'bsmith@oakridgewealth.com')
        self.assertEqual(v['pattern']['pattern'], 'flast')
        maria = people['Maria Lopez']['email']
        self.assertEqual((maria['email'], maria['label']), ('mlopez@oakridgewealth.com', 'guess'))  # no MX check yet
        self.assertEqual(people['Jane A. Doe']['phones'][0]['number'], '(312) 555-0142')
        self.assertTrue(all(p['sourceUrl'].startswith(SITE) and p['foundAt'] and p['status'] == 'pending' for p in v['people']))
        self.assertEqual(v['phones'][0]['source'], 'Form ADV')  # the main line, also on the website
        self.assertEqual({e['email'] for e in v['generalEmails']}, {'info@oakridgewealth.com', 'careers@oakridgewealth.com'})
        self.assertEqual(v['filingPeople'][0]['email']['email'], 'tgreen@oakridgewealth.com')  # filings people get a guess too
        self.assertTrue(v['focus']['tags'])
        self.assertEqual(v['pagesSaved'], r['pages'])

    def test_labels_follow_domain_checks(self):
        self.crawl()
        con = self.con()
        con.execute("INSERT INTO contact_domains (domain, mx, mx_ok, mx_at, mx_via) VALUES ('oakridgewealth.com', '[\"mx.o.com\"]', 1, ?, 'test')", (time.time(),))
        con.commit()
        con.close()
        lab = {p['name']: p['email']['label'] for p in self.view()['people']}
        self.assertEqual(lab['Maria Lopez'], 'pattern + domain accepts mail')
        con = self.con()
        con.execute("INSERT INTO contact_email_checks VALUES ('mlopez@oakridgewealth.com', 'accepted', 250, ?)", (time.time(),))
        con.commit()
        self.assertEqual({p['name']: p['email']['label'] for p in pc.contacts(con, 'crd-1', True, set())['people']}['Maria Lopez'], 'pattern + server-checked')
        con.execute("UPDATE contact_domains SET catch_all = 1")
        con.commit()
        lab = {p['name']: p['email']['label'] for p in pc.contacts(con, 'crd-1', True, set())['people']}
        con.close()
        self.assertEqual(lab['Maria Lopez'], "catch-all (can't verify)")
        self.assertEqual(lab['Jane A. Doe'], 'published')  # published stays published

    def test_email_check_needs_the_setting(self):
        with mock.patch.object(pc, 'smtp_enabled', return_value=False):
            with self.assertRaises(pc.EngineError):
                run(pc.email_check(SimpleNamespace(http=None), 'crd-1', db_path=self.db))

    def test_review_and_recrawl(self):
        self.crawl()
        con = self.con()
        items = pc.review_list(con)['items']
        self.assertTrue(items)
        jane = next(i for i in items if i['kind'] == 'person' and 'Jane' in i['summary'])
        maria = next(i for i in items if i['kind'] == 'person' and 'Maria' in i['summary'])
        pc.review_decide(con, [jane['fid']], 'approve')
        pc.review_decide(con, [maria['fid']], 'reject')
        con.close()
        v = self.view()
        people = {p['name']: p for p in v['people']}
        self.assertEqual(people['Jane A. Doe']['reviewedOn'], pc._today())
        self.assertNotIn('Maria Lopez', people)  # rejected: hidden
        # the site changes: Jane's title, Robert leaves, a new person joins
        team = (FIX / 'team.html').read_text().replace('Founder &amp; Chief Investment Officer', 'Founder &amp; Managing Partner')
        team = team.replace('<h3>Robert Smith</h3><p>Partner, Senior Wealth Advisor</p>', '<h3>Alan Wu</h3><p>Portfolio Manager</p>')
        self.crawl(FakeFetch(overrides={SITE + '/our-team/': team}))
        con = self.con()
        people = {p['name']: p for p in pc.contacts(con, 'crd-1', False, set())['people']}
        self.assertEqual(people['Jane A. Doe']['status'], 'pending')  # a material change goes back to review
        self.assertEqual(people['Jane A. Doe']['previousTitle'], 'Founder & Chief Investment Officer')
        self.assertEqual(people['Alan Wu']['note'], 'new on the website since the last check')
        self.assertNotIn('Maria Lopez', people)  # still rejected
        changes = [i['summary'] for i in pc.review_list(con)['items'] if i['kind'] == 'change']
        con.close()
        self.assertTrue(any('Robert Smith is no longer listed' in c for c in changes))
        self.assertTrue(any(c.startswith('Website text changed') for c in changes))
        self.assertTrue(any(s.startswith('Title change: Jane A. Doe') for s in (pc.fact_summary('person', people['Jane A. Doe']),)))

    def test_opt_out_leaves_exports(self):
        self.crawl()
        con = self.con()
        out = pc.contacts_csv(con, None, True, set())
        self.assertIn('Email label', out['csv'].splitlines()[0])
        self.assertIn('jdoe@oakridgewealth.com,published', out['csv'])
        self.assertIn('mlopez@oakridgewealth.com,guess', out['csv'])
        pc.set_opt_out(con, email='JDOE@oakridgewealth.com')
        out = pc.contacts_csv(con, None, True, set())
        self.assertNotIn('jdoe@', out['csv'])
        self.assertEqual(out['skippedEmails'], 1)
        self.assertIn('jdoe@oakridgewealth.com', pc.contacts(con, 'crd-1', False, set())['optOut']['emails'])
        self.assertTrue(pr.export_csv(con, {})['count'] >= 1)
        pc.set_opt_out(con, firm_id='crd-1')
        out = pc.contacts_csv(con, None, True, set())
        self.assertEqual((out['rows'], out['skippedFirms']), (0, 1))
        exp = pr.export_csv(con, {})
        self.assertEqual((exp['count'], exp['doNotContact']), (0, 1))  # the firm export leaves it out too
        pc.set_opt_out(con, firm_id='crd-1', on=False)
        self.assertEqual(pr.export_csv(con, {})['count'], 1)
        # an outreach note set to "do not contact" counts as well
        self.assertTrue(pc.contacts(con, 'crd-1', False, {'crd-1'})['optOut']['firm'])
        self.assertEqual(pc.contacts_csv(con, None, True, {'crd-1'})['rows'], 0)
        with self.assertRaises(pc.EngineError):
            pc.set_opt_out(con, email='not-an-email')
        con.close()

    def test_no_website(self):
        con = self.con()
        con.execute("UPDATE firms SET website = ''")
        con.commit()
        con.close()
        with self.assertRaises(pc.EngineError):
            self.crawl()


class Watcher(DbCase):
    def test_diffs(self):
        old = {'aum': 100e6, 'filed': '2025-03-01', 'website': 'https://a.com/', 'period13f': None, 'offerings': 0,
               'people': {'janedoe': {'name': 'Jane Doe', 'title': 'CIO'}}}
        new = {**old, 'aum': 125e6, 'filed': '2026-03-01', 'offerings': 1, 'website': 'https://b.com/',
               'people': {'janedoe': {'name': 'Jane Doe', 'title': 'CEO'}, 'bobsmith': {'name': 'Bob Smith', 'title': 'Partner'}}}
        kinds = {c for c, *_ in pc.diff_snapshots(old, new)}
        self.assertEqual(kinds, {'AUM change', 'new filing', 'website change', 'new person', 'title change'})
        self.assertIn('+25%', next(s for c, s, *_ in pc.diff_snapshots(old, new) if c == 'AUM change'))
        self.assertEqual(pc.diff_snapshots(None, new), [])

    def test_watch_sec_baseline_then_changes(self):
        con = self.con()
        self.assertEqual(pc.watch_sec(con, 'crd-1'), [])  # first run is the baseline
        con.execute("UPDATE firms SET aum_total = 650000000, filing_date = '2026-09-30' WHERE id = 'crd-1'")
        con.execute("INSERT INTO people (firm_id, name, title, source, key_title, filed) VALUES ('crd-1', 'WU, ALAN', 'CIO', 'Form ADV Schedule A', 1, '2026-09-30')")
        con.commit()
        changes = {c for c, *_ in pc.watch_sec(con, 'crd-1')}
        self.assertEqual(changes, {'AUM change', 'new filing', 'new person'})
        items = [i for i in pc.review_list(con)['items'] if i['origin'] == 'watch']
        self.assertEqual(len(items), 3)
        self.assertTrue(all(i['sourceUrl'] == 'https://adviserinfo.sec.gov/firm/summary/1' for i in items))
        self.assertEqual(pc.watch_sec(con, 'crd-1'), [])  # nothing new the next time
        con.close()

    def test_do_not_contact_is_never_watched(self):
        con = self.con()
        pc.set_watch(con, 'crd-1', True)
        pc.set_opt_out(con, firm_id='crd-1')
        self.assertEqual(pc.watched_firms(con, saved=['crd-1']), [])
        con.close()
        fetch = FakeFetch()
        note = run(pc.watch_firm(None, 'crd-1', db_path=self.db, fetch=fetch))
        self.assertIn('do-not-contact', note)
        self.assertEqual(fetch.calls, [])  # nothing fetched
        with mock.patch.object(pc, 'note_opt_outs', return_value={'crd-1'}):
            con = self.con()
            pc.set_opt_out(con, firm_id='crd-1', on=False)
            self.assertEqual(pc.watched_firms(con, saved=[]), [])  # outreach status "do not contact" counts too
            con.close()

    def test_watched_firms_and_run(self):
        con = self.con()
        pc.set_watch(con, 'crd-1', True)
        self.assertEqual(pc.watched_firms(con, saved=['crd-1', 'crd-9']), ['crd-1', 'crd-9'])
        con.close()
        with mock.patch.object(pc, 'watched_firms', return_value=['crd-1']):
            out = run(pc.run_watch(None, db_path=self.db, fetch=FakeFetch()))
        self.assertEqual(out['firms'], 1)
        con = self.con()
        st = pc.watch_status(con)
        self.assertEqual(st['lastRun'], pc._today())
        self.assertIn('website: ', con.execute("SELECT last_note FROM contact_watch WHERE firm_id = 'crd-1'").fetchone()[0])
        con.close()


class Analyst(DbCase):
    def test_keep_cited(self):
        sources = [{'url': 'https://a.com/', 'text': 'We serve about 300 families across the Midwest.'}]
        kept, dropped = pc.keep_cited([
            {'topic': 'clients', 'text': 'Serves ~300 families', 'source': 'https://a.com/', 'quote': 'serve about 300 families'},
            {'topic': 'assets', 'text': 'Has $2B', 'source': 'https://a.com/', 'quote': 'manages $2 billion'},
            {'topic': 'history', 'text': 'Founded 1990', 'source': 'https://elsewhere.com/', 'quote': 'founded in 1990'},
            {'topic': 'other', 'text': 'No source', 'source': '', 'quote': ''},
        ], sources)
        self.assertEqual([k['text'] for k in kept], ['Serves ~300 families'])
        self.assertEqual(len(dropped), 3)

    def test_estimate_and_run(self):
        self.crawl()
        con = self.con()
        est = pc.ai_estimate(con, 'crd-1', 'claude-opus-5-5')
        con.close()
        self.assertGreaterEqual(est['pages'], 4)
        self.assertGreater(est['costUsd'], 0)
        answer = json.dumps({'facts': [
            {'topic': 'history', 'text': 'Founded in 2004.', 'source': SITE + '/about-us', 'quote': 'Founded in 2004'},
            {'topic': 'assets', 'text': 'Manages $500M.', 'source': 'https://adviserinfo.sec.gov/firm/summary/1', 'quote': 'Regulatory assets under management: $500,000,000'},
            {'topic': 'clients', 'text': 'Has 5,000 clients.', 'source': SITE + '/about-us', 'quote': 'serves 5,000 families'},
        ]})
        seen = {}

        class Stream:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get_final_message(self):
                return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=answer)], usage=SimpleNamespace(input_tokens=10, output_tokens=5))

        def stream(**opts):
            seen.update(opts)
            return Stream()
        fake = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(stream=stream)), messages=SimpleNamespace(stream=stream))
        from engine import ai, settings
        events = []

        async def emit(e):
            events.append(e)
        with mock.patch.object(ai, 'client', return_value=fake), mock.patch.object(settings, 'load', return_value={}):
            out = run(pc.ai_profile(None, 'crd-1', emit, db_path=self.db))
        self.assertEqual(len(out['kept']), 2)
        self.assertEqual(out['dropped'][0]['why'], 'quote not found in the source')
        self.assertEqual(seen['output_config']['format']['type'], 'json_schema')
        self.assertTrue(events)
        v = self.view()
        self.assertEqual({f['sourceUrl'] for f in v['aiFacts']}, {SITE + '/about-us', 'https://adviserinfo.sec.gov/firm/summary/1'})
        self.assertTrue(all(f['status'] == 'pending' for f in v['aiFacts']))

    def test_needs_pages(self):
        with self.assertRaises(pc.EngineError):
            run(pc.ai_profile(None, 'crd-1', db_path=self.db))


class Wiring(unittest.TestCase):
    def test_handlers(self):
        for name in ('prospect.crawl', 'prospect.contacts', 'prospect.ai_profile', 'prospect.watch.run', 'prospect.watch.status',
                     'prospect.watch.set', 'prospect.review.list', 'prospect.review.decide', 'prospect.optout.set', 'prospect.optout.list',
                     'prospect.contacts_export', 'prospect.email_check', 'prospect.contacts_settings'):
            self.assertIn(name, HANDLERS)
        self.assertIn(pc.excluded_firms, pr.EXPORT_FILTERS)
        self.assertIn(pc.watch_loop, pr.SCHEDULE_HOOKS)

    def test_no_people_search_or_linkedin(self):
        src = Path(pc.__file__).read_text().lower()
        for bad in ('spokeo', 'whitepages', 'beenverified', 'zoominfo', 'apollo.io', 'linkedin.com/in', 'hunter.io'):
            self.assertNotIn(bad, src)

    def test_smtp_off_by_default(self):
        from engine import settings
        with mock.patch.object(settings, 'load', return_value={}):
            self.assertFalse(pc.smtp_enabled())
            self.assertFalse(settings.public()['prospectSmtpCheck'])


if __name__ == '__main__':
    unittest.main()
