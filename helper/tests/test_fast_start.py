"""Fast start (2026-11-11): the owner's diagnostics showed clicks waiting 45-54 s after the helper started, because
saved copies refreshing themselves used up Schwab's 120-a-minute budget at interactive priority. Self-started refreshes
are now background work, and a stock's daily closes are kept until the next session close."""
import asyncio
import datetime as dt
import os
import sys
import unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

from engine import core, datahub, invest  # noqa: E402
from test_datahub import FakeClock  # noqa: E402

NY = ZoneInfo('America/New_York')


def ny(*a):
    return dt.datetime(*a, tzinfo=NY)


class LastClose(unittest.TestCase):
    def test_after_and_before_the_close(self):
        self.assertEqual(invest.last_close_cutoff(ny(2026, 11, 11, 17, 0)), ny(2026, 11, 11, 16, 15).timestamp())
        self.assertEqual(invest.last_close_cutoff(ny(2026, 11, 11, 9, 0)), ny(2026, 11, 10, 16, 15).timestamp())

    def test_weekend_holiday_and_early_close(self):
        self.assertEqual(invest.last_close_cutoff(ny(2026, 11, 15, 12, 0)), ny(2026, 11, 13, 16, 15).timestamp())  # Sunday
        self.assertEqual(invest.last_close_cutoff(ny(2026, 11, 26, 12, 0)), ny(2026, 11, 25, 16, 15).timestamp())  # Thanksgiving
        self.assertEqual(invest.last_close_cutoff(ny(2026, 11, 27, 15, 0)), ny(2026, 11, 27, 13, 15).timestamp())  # early close

    def test_a_morning_start_keeps_last_nights_copy(self):
        now = ny(2026, 11, 12, 8, 30)
        age = invest.closes_max_age('SPY', now)
        saved_last_night = ny(2026, 11, 11, 21, 0).timestamp()
        saved_before_the_close = ny(2026, 11, 11, 15, 0).timestamp()
        self.assertLess(now.timestamp() - saved_last_night, age)
        self.assertGreater(now.timestamp() - saved_before_the_close, age)
        self.assertEqual(invest.closes_max_age('/ES', now), 3 * 3600)

    def test_todays_unfinished_candle_is_left_out(self):
        rows = [[ny(2026, 11, 10, 0, 0).timestamp(), 1.0], [ny(2026, 11, 11, 0, 0).timestamp(), 2.0]]
        self.assertEqual(invest.completed_sessions(rows, ny(2026, 11, 11, 11, 0)), rows[:1])
        self.assertEqual(invest.completed_sessions(rows, ny(2026, 11, 11, 16, 30)), rows)


class MissingCloseAndLivePoint(unittest.TestCase):
    def test_a_copy_without_the_last_close_is_looked_at_again(self):
        rows = [[ny(2026, 11, 10, 0, 0).timestamp(), 1.0]]
        self.assertTrue(invest.missing_last_close(rows, ny(2026, 11, 11, 18, 0)))     # Nov 11 close not in yet
        self.assertFalse(invest.missing_last_close(rows, ny(2026, 11, 11, 16, 20)))   # only 5 minutes after the cutoff
        self.assertFalse(invest.missing_last_close(rows, ny(2026, 11, 11, 12, 0)))    # Nov 10 is the last finished one

    def test_detail_chart_ends_at_the_live_price(self):
        rows = [[ny(2026, 11, 10, 0, 0).timestamp(), 100.0]]
        out = invest.with_live_point(rows, {'price': 103.0}, ny(2026, 11, 11, 14, 0))
        self.assertEqual(out[-1][1], 103.0)
        self.assertEqual(len(out), 2)
        self.assertEqual(invest.with_live_point(rows, {'price': 103.0}, ny(2026, 11, 11, 8, 0)), rows)   # before the open
        self.assertEqual(invest.with_live_point(rows, {'price': 103.0}, ny(2026, 11, 14, 12, 0)), rows)  # Saturday
        self.assertEqual(invest.with_live_point(rows, None, ny(2026, 11, 11, 14, 0)), rows)


class RefreshIsBackground(unittest.TestCase):
    def setUp(self):
        self.clock, self._old = FakeClock(), datahub.CLOCK
        datahub.CLOCK = self.clock
        datahub._GATES.clear()
        datahub.HEALTH.clear()

    def tearDown(self):
        datahub.CLOCK = self._old
        datahub._GATES.clear()
        datahub.HEALTH.clear()

    def test_a_refresh_uses_the_background_budget_and_a_click_does_not(self):
        seen = []

        async def go():
            async def load():
                seen.append(datahub.BACKGROUND_WORK.get())
                return await datahub.call('schwab', lambda: 'ok')
            ctx = object.__new__(core.EngineContext)
            ctx._cache, ctx._locks, ctx._refreshing = {}, {}, set()
            ctx._load = lambda key, ld, persist, max_age=0: ld()
            await core.EngineContext._refresh(ctx, 'k', load, False)
            await load()  # a page asking: interactive
        asyncio.run(go())
        self.assertEqual(seen, [True, False])
        self.assertEqual(len(datahub.HEALTH['schwab'].waits), 1)  # only the interactive call's wait is recorded

    def test_a_click_never_queues_behind_150_refreshes(self):
        async def reply():
            await datahub.CLOCK.sleep(0.24)
            return 'ok'

        async def refresh():
            datahub.BACKGROUND_WORK.set(True)
            return await datahub.call('schwab', reply)

        async def go():
            tasks = [asyncio.ensure_future(refresh()) for _ in range(150)]
            await datahub.CLOCK.sleep(15)
            t0 = datahub.CLOCK.now()
            await datahub.call('schwab', reply)
            waited = datahub.CLOCK.now() - t0
            await asyncio.gather(*tasks)
            return waited
        self.assertLess(asyncio.run(go()), 1.0)  # 45 s when refreshes were interactive (queue_bench)
        row = next(r for r in datahub.snapshot()['sources'] if r['source'] == 'schwab')
        self.assertLess(row['waitMaxMs'], 1000)


if __name__ == '__main__':
    unittest.main()
