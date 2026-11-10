"""Which addresses stay in the app and which open in the normal browser."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from tp_desktop import policy  # noqa: E402

BASE = policy.PLATFORM_URL


class Links(unittest.TestCase):
    def test_platform_url_matches_the_helper(self):
        helper = open(os.path.join(os.path.dirname(__file__), '..', '..', 'helper', 'schwab_helper.py'), encoding='utf-8').read()
        self.assertIn(f"PLATFORM_URL = '{BASE}'", helper)

    def test_the_website_stays_in_the_app(self):
        for url in (BASE, BASE + '#research/AAPL', BASE + 'index.html', BASE + '?v=123#trade', BASE.rstrip('/'),
                    'https://CADENB777-JPG.github.io/Trading-Platform/#home', 'about:blank', '', 'blob:https://cadenb777-jpg.github.io/1', 'data:text/html,hi'):
            self.assertTrue(policy.stays_in_app(url), url)

    def test_other_sites_open_in_the_browser(self):
        for url in ('https://news.google.com/search?q=AAPL', 'https://www.sec.gov/cgi-bin/browse-edgar', 'https://cadenb777-jpg.github.io/Other/',
                    'https://cadenb777-jpg.github.io/Trading-PlatformX/', 'http://cadenb777-jpg.github.io/Trading-Platform/', 'mailto:a@b.c',
                    'https://github.com/cadenb777-jpg/Trading-Platform'):
            self.assertFalse(policy.stays_in_app(url), url)
            self.assertEqual(policy.new_window_kind(url), 'external', url)

    def test_the_ai_pop_out_opens_as_an_app_window(self):
        self.assertEqual(policy.new_window_kind(BASE + '#ai-window'), 'app')
        self.assertEqual(policy.new_window_kind(''), 'app')  # a blank window the page writes a picture into

    def test_permissions_only_for_the_website(self):
        self.assertTrue(policy.origin_allowed('https://cadenb777-jpg.github.io'))
        self.assertTrue(policy.origin_allowed('https://cadenb777-jpg.github.io/'))
        self.assertFalse(policy.origin_allowed('https://evil.example'))
        self.assertFalse(policy.origin_allowed('http://cadenb777-jpg.github.io'))
        self.assertFalse(policy.origin_allowed(''))

    def test_offline_page_only_for_real_failures(self):
        self.assertTrue(policy.shows_offline_page(BASE, -105, True))  # name not resolved: no internet
        self.assertTrue(policy.shows_offline_page(BASE + '#home', -106, True))  # internet disconnected
        self.assertFalse(policy.shows_offline_page('https://www.sec.gov/x', policy.ABORTED, False))  # a link sent to the browser
        self.assertFalse(policy.shows_offline_page(BASE, policy.ABORTED, False))  # stopped on purpose
        self.assertFalse(policy.shows_offline_page('https://www.sec.gov/x', -105, True))  # another site: not ours to report

    def test_only_web_links_leave_the_app(self):
        for url in ('https://news.google.com/x', 'http://example.com/', 'mailto:me@example.com'):
            self.assertTrue(policy.opens_externally(url), url)
        for url in ('file:///C:/Windows/System32/calc.exe', 'smb://server/share', '\\\\server\\share', 'ms-settings:privacy',
                    'search-ms:query=x', 'javascript:alert(1)', 'https:', 'vbscript:x', ''):
            self.assertFalse(policy.opens_externally(url), url)

    def test_look_alike_paths_are_not_the_website(self):
        for url in (BASE + '../Other/', BASE + '%2e%2e/Other/', 'https://cadenb777-jpg.github.io/Trading-Platform/%2E%2E/x',
                    'https://cadenb777-jpg.github.io@evil.example/Trading-Platform/'):
            self.assertFalse(policy.is_platform(url), url)

    def test_only_the_websites_own_blobs(self):
        self.assertTrue(policy.stays_in_app('blob:https://cadenb777-jpg.github.io/1234-abcd'))
        self.assertFalse(policy.stays_in_app('blob:https://evil.example/1234-abcd'))

    def test_a_local_test_copy_works_the_same(self):
        local = 'http://localhost:5321/'
        self.assertTrue(policy.stays_in_app(local + '#chart', local))
        self.assertFalse(policy.stays_in_app('https://news.google.com/', local))


if __name__ == '__main__':
    unittest.main()
