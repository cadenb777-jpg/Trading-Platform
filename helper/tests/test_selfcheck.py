"""The self-check's checks give the right verdicts (pure: no network)."""
import datetime as dt
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import selfcheck as sc  # noqa: E402


class Checks(unittest.TestCase):
    def test_security(self):
        self.assertTrue(sc.check_listening('127.0.0.1')['ok'])
        self.assertFalse(sc.check_listening('0.0.0.0')['ok'])
        self.assertTrue(sc.check_origins(['https://cadenb777-jpg.github.io', 'http://127.0.0.1:4173'])['ok'])
        self.assertFalse(sc.check_origins(['https://evil.example'])['ok'])

    @unittest.skipIf(os.name == 'nt', 'permission bits are POSIX')
    def test_private_files(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'token.json'
            f.write_text('{}')
            os.chmod(f, 0o600)
            self.assertTrue(sc.check_private_files([f])['ok'])
            os.chmod(f, 0o644)
            self.assertFalse(sc.check_private_files([f])['ok'])
        self.assertIsNone(sc.check_private_files([], posix=False)['ok'])

    def test_sources_and_freshness(self):
        self.assertTrue(sc.check_sources([{'source': 'sec', 'calls': 10, 'failed': 1}])['ok'])
        self.assertFalse(sc.check_sources([{'source': 'nasdaq', 'label': 'Nasdaq.com', 'calls': 12, 'failed': 12}])['ok'])
        session = dt.datetime(2026, 11, 11, 11, 0, tzinfo=sc.NEW_YORK)  # a Wednesday morning
        night = dt.datetime(2026, 11, 11, 22, 0, tzinfo=sc.NEW_YORK)
        self.assertIsNone(sc.check_quotes_fresh({'lastOk': 0}, now=night)['ok'])
        self.assertTrue(sc.check_quotes_fresh({'lastOk': 1000}, now_ts=1060, now=session)['ok'])
        self.assertFalse(sc.check_quotes_fresh({'lastOk': 1000}, now_ts=2000, now=session)['ok'])

    def test_maths_known_answers(self):
        self.assertTrue(sc.check_maths()['ok'], sc.check_maths()['detail'])

    def test_crosscheck_and_speed(self):
        self.assertTrue(sc.check_crosscheck({'agreeing': 3, 'spread': 0.0004})['ok'])
        self.assertFalse(sc.check_crosscheck({'agreeing': 1, 'message': 'only Schwab'})['ok'])
        now = 10_000
        fast = [{'type': 'history', 'ms': 300, 'ok': True, 'at': now - 60}] * 20
        slow = [{'type': 'history', 'ms': 9000, 'ok': True, 'at': now - 60}] * 20
        self.assertTrue(sc.check_speed(fast, now)['ok'])
        self.assertFalse(sc.check_speed(slow, now)['ok'])
        self.assertIsNone(sc.check_speed([], now)['ok'])

    def test_history_keeps_a_day(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'sc.json'
            for i in range(sc.KEEP + 5):
                sc.save({'at': i, 'ok': True, 'checks': []}, f)
            runs = sc.history(f)
            self.assertEqual(len(runs), sc.KEEP)
            self.assertEqual(runs[-1]['at'], sc.KEEP + 4)

    def test_never_trades(self):
        text = Path(sc.__file__).read_text(encoding='utf-8')
        for word in ('place_order', 'preview_order', 'webull'):
            self.assertNotIn(word, text.lower().replace('it never trades', ''))


if __name__ == '__main__':
    unittest.main()
