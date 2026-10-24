"""Tests for the engine's shared plumbing: background tasks, the disk cache and request caching.

Run from the repository root:  python -m unittest discover helper/tests
"""
import asyncio
import gc
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import core  # noqa: E402


class BackgroundTasks(unittest.TestCase):
    def test_task_nobody_holds_still_finishes(self):
        done = []

        async def work():
            await asyncio.sleep(0.01)
            done.append(1)

        async def main():
            core.background(work())
            gc.collect()  # a task held only weakly by asyncio could be collected here
            await asyncio.sleep(0.05)

        asyncio.run(main())
        self.assertEqual(done, [1])
        self.assertEqual(len(core._BACKGROUND), 0)  # finished tasks are let go


class DiskCacheTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.disk = core.DiskCache(Path(self.dir.name) / 'cache.db')

    def tearDown(self):
        if self.disk._db is not None:
            self.disk._db.close()
        self.dir.cleanup()

    def test_put_and_get_round_trip(self):
        self.disk.put('k', 12.5, {'a': [1, 2]})
        self.assertEqual(self.disk.get('k'), (12.5, {'a': [1, 2]}))

    def test_unserialisable_value_is_skipped(self):
        self.assertIsNone(self.disk.encode('k', {1, 2}))
        self.disk.put('k', 1.0, {1, 2})
        self.assertIsNone(self.disk.get('k'))

    def test_cached_persist_writes_through_and_reads_back(self):
        calls = []

        async def load():
            calls.append(1)
            return [{'time': 1, 'close': 2.0}]

        async def main():
            ctx = core.EngineContext.__new__(core.EngineContext)
            ctx.disk, ctx._cache, ctx._locks, ctx._refreshing = self.disk, {}, {}, set()
            first = await ctx.cached(('daily', 'X'), 60, load, persist=True)
            ctx._cache.clear()  # as after a restart: only the disk copy is left
            second = await ctx.cached(('daily', 'X'), 60, load, persist=True)
            return first, second

        first, second = asyncio.run(main())
        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()


class SafeUrls(unittest.TestCase):
    """The article `summary` request must not fetch local or private addresses (SSRF)."""

    def test_blocks_local_private_and_odd_schemes(self):
        for url in ('http://127.0.0.1:8765/', 'http://localhost/admin', 'http://10.0.0.5/', 'http://192.168.1.1/',
                    'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/',
                    'http://[::ffff:127.0.0.1]/', 'http://0.0.0.0/', 'file:///etc/passwd', 'ftp://8.8.8.8/',
                    'javascript:alert(1)', 'http:///nohost', 'not a url'):
            self.assertFalse(core.is_safe_url(url), url)

    def test_allows_public_addresses(self):
        self.assertTrue(core.is_safe_url('https://8.8.8.8/article'))
        self.assertTrue(core.is_safe_url('http://1.1.1.1/'))


class MarketSession(unittest.TestCase):
    def at(self, *args):
        from zoneinfo import ZoneInfo
        import datetime as dt
        return core.market_session(dt.datetime(*args, tzinfo=ZoneInfo('America/New_York')))

    def test_normal_weekday(self):
        self.assertEqual(self.at(2026, 10, 22, 10, 0), 'open')
        self.assertEqual(self.at(2026, 10, 22, 17, 0), 'extended')
        self.assertEqual(self.at(2026, 10, 24, 10, 0), 'closed')  # Saturday

    def test_holidays_are_closed(self):
        self.assertEqual(self.at(2026, 11, 26, 10, 0), 'closed')  # Thanksgiving
        self.assertEqual(self.at(2026, 12, 25, 11, 0), 'closed')  # Christmas
        self.assertEqual(self.at(2027, 3, 26, 11, 0), 'closed')  # Good Friday
        self.assertEqual(self.at(2027, 7, 5, 11, 0), 'closed')  # Independence Day observed

    def test_early_close(self):
        self.assertEqual(self.at(2026, 11, 27, 12, 59), 'open')
        self.assertEqual(self.at(2026, 11, 27, 13, 0), 'extended')
        self.assertEqual(self.at(2026, 11, 27, 17, 0), 'closed')

    def test_holiday_list_is_on_weekdays(self):
        for day in core.NYSE_HOLIDAYS | core.NYSE_EARLY_CLOSES:
            self.assertLess(day.weekday(), 5, day)
