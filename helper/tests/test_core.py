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
