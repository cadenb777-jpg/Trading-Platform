"""Security protections in the helper: XML entity bombs are refused, the data folder is private, SQL column names in
dynamic statements come from fixed lists, and the WebSocket server only accepts the website.

Run from the repository root:  python -m unittest discover helper/tests
"""
import io
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import safexml  # noqa: E402

BOMB = ('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;">'
        '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;">]><r>&lol3;</r>')
XXE = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'


class SafeXML(unittest.TestCase):
    def test_entity_bombs_and_external_entities_are_refused(self):
        for doc in (BOMB, XXE, BOMB.encode()):
            with self.assertRaises(safexml.UnsafeXML):
                safexml.fromstring(doc)
            with self.assertRaises(safexml.UnsafeXML):
                list(safexml.iterparse(io.BytesIO(doc if isinstance(doc, bytes) else doc.encode())))

    def test_a_false_encoding_line_cannot_slip_past(self):
        # ElementTree ignores the encoding line of text it is given, so the check must too (found in review)
        for enc in ('UTF-16', 'utf-32', 'ISO-8859-1', 'bogus-charset'):
            doc = f'<?xml version="1.0" encoding="{enc}"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><r>&b;</r>'
            with self.assertRaises(safexml.UnsafeXML, msg=enc):
                safexml.fromstring(doc)
        self.assertEqual(safexml.fromstring('<?xml version="1.0" encoding="ISO-8859-1"?><x>caf\u00e9</x>').text, 'caf\u00e9')

    def test_real_documents_still_read(self):
        rss = '<rss version="2.0"><channel><item><title>Fed &amp; markets</title><link>https://x.example/a</link></item></channel></rss>'
        self.assertEqual(safexml.fromstring(rss).find('channel/item/title').text, 'Fed & markets')
        self.assertEqual(safexml.fromstring('<?xml version="1.0" encoding="UTF-8"?><x>café</x>'.encode()).text, 'café')
        big = b'<sst>' + b''.join(b'<si><t>s%d</t></si>' % i for i in range(20000)) + b'</sst>'  # streamed in chunks
        self.assertEqual(sum(1 for _, el in safexml.iterparse(io.BytesIO(big)) if el.tag == 't'), 20000)

    def test_broken_xml_is_still_a_parse_error(self):
        with self.assertRaises(safexml.ParseError):
            safexml.fromstring('<a><b></a>')

    def test_no_module_parses_xml_without_the_check(self):
        here = Path(__file__).resolve().parents[1]
        for path in [here / 'schwab_helper.py', *(here / 'engine').glob('*.py')]:
            if path.name == 'safexml.py':
                continue
            text = path.read_text(encoding='utf-8')
            for unsafe in ('ET.fromstring(', 'ET.parse(', 'ET.iterparse(', 'minidom.parse', 'expat.ParserCreate', 'lxml'):
                self.assertNotIn(unsafe, text, f'{path.name} parses XML without engine/safexml.py')


class NewsFeeds(unittest.TestCase):
    def test_the_news_reader_reads_feeds_and_refuses_bombs(self):
        try:
            import schwab_helper
        except ImportError as err:  # schwab-py not installed in this Python
            self.skipTest(str(err))
        rss = ('<rss version="2.0"><channel><item><title>Apple beats estimates</title><link>https://example.com/a</link>'
               '<pubDate>Mon, 09 Nov 2026 14:00:00 GMT</pubDate></item></channel></rss>')
        items = schwab_helper.parse_feed(rss, 'Test')
        self.assertEqual([i['title'] for i in items][:1], ['Apple beats estimates'])
        with self.assertRaises(safexml.UnsafeXML):
            schwab_helper.parse_feed(BOMB, 'Test')


@unittest.skipIf(os.name == 'nt', 'Windows keeps the user folder private by itself')
class PrivateFolder(unittest.TestCase):
    def test_files_and_folders_become_owner_only(self):
        try:
            import schwab_helper
        except ImportError as err:  # schwab-py not installed in this Python
            self.skipTest(str(err))
        old = os.umask(0o022)
        try:
            with tempfile.TemporaryDirectory() as d:
                data = Path(d) / '.trading-platform'
                (data / 'desktop-browser').mkdir(parents=True)
                for name in ('schwab_token.json', 'platform.db', 'orders.log'):
                    (data / name).write_text('x')
                    (data / name).chmod(0o644)
                (data / 'desktop-browser' / 'Cookies').write_text('x')
                outside = Path(d) / 'outside.txt'
                outside.write_text('x')
                outside.chmod(0o644)
                (data / 'link').symlink_to(outside)
                self.assertGreater(schwab_helper.make_private(data), 0)
                for path in (data, data / 'desktop-browser'):
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700, path)
                for name in ('schwab_token.json', 'platform.db', 'orders.log', 'desktop-browser/Cookies'):
                    self.assertEqual(stat.S_IMODE((data / name).stat().st_mode), 0o600, name)
                self.assertEqual(stat.S_IMODE(outside.stat().st_mode), 0o644)  # a link out of the folder is never followed
                (data / 'new.json').write_text('x')  # created after: private from the start (umask)
                self.assertEqual(stat.S_IMODE((data / 'new.json').stat().st_mode), 0o600)
        finally:
            os.umask(old)


class WebsiteOnly(unittest.TestCase):
    def test_only_the_website_and_local_development_may_connect(self):
        text = (Path(__file__).resolve().parents[1] / 'schwab_helper.py').read_text(encoding='utf-8')
        start = text.index('ALLOWED_ORIGINS = [')
        block = text[start:text.index(']', start)]
        origins = [line.strip().strip(',').strip("'") for line in block.splitlines()[1:] if line.strip()]
        self.assertEqual(origins[0], 'https://cadenb777-jpg.github.io')
        for o in origins[1:]:
            self.assertRegex(o, r'^http://(localhost|127\.0\.0\.1):\d+$')  # only this computer's own dev servers


class SqlColumns(unittest.TestCase):
    def test_adviser_notes_refuse_unknown_column_names(self):
        try:
            from engine import prospect_iapd
        except ImportError as err:
            self.skipTest(str(err))
        with self.assertRaises(ValueError):
            prospect_iapd._note(None, 1, **{'pdf_status = 1; DROP TABLE firms; --': 'x'})


if __name__ == '__main__':
    unittest.main()
