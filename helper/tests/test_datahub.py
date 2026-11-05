"""The data hub (helper/engine/datahub.py), the symbol normaliser (symbols.py) and the aggregation checks
(datacheck.py): pacing and coalescing on a fake clock, retries, the health registry, provenance, units and times."""
import asyncio
import datetime as dt
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import alpaca, core, datacheck, datahub, symbols  # noqa: E402


class FakeClock(datahub.Clock):
    """Time moves only when every waiting task is asleep: the earliest sleeper moves it to its wake time."""

    def __init__(self):
        self.t = 1000.0
        self.wall_t = 1_700_000_000.0
        self.sleepers = []

    def now(self):
        return self.t

    def wall(self):
        return self.wall_t + (self.t - 1000.0)

    async def sleep(self, seconds):
        target = self.t + max(0.0, seconds)
        self.sleepers.append(target)
        try:
            while True:
                await asyncio.sleep(0)
                if target <= min(self.sleepers):
                    self.t = max(self.t, target)
                    return
        finally:
            self.sleepers.remove(target)


class Resp:
    def __init__(self, status=200, headers=None, data=None):
        self.status_code, self.headers, self._data = status, headers or {}, data

    def json(self):
        return self._data


class HubTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self._old = datahub.CLOCK
        datahub.CLOCK = self.clock
        datahub._GATES.clear()
        datahub.HEALTH.clear()
        datahub._INFLIGHT.clear()

    def tearDown(self):
        datahub.CLOCK = self._old
        datahub._GATES.clear()
        datahub.HEALTH.clear()
        datahub._INFLIGHT.clear()


class Symbols(unittest.TestCase):
    def test_share_classes_have_one_canonical_form(self):
        for s in ('BRK.B', 'brk-b', 'BRK/B', 'BRK B', ' brk.b '):
            self.assertEqual(symbols.normalize(s), 'BRK.B', s)
        self.assertEqual(symbols.normalize('aapl'), 'AAPL')

    def test_source_spellings(self):
        self.assertEqual(symbols.to_source('BRK.B', 'sec'), 'BRK-B')
        self.assertEqual(symbols.to_source('BRK/B', 'yahoo'), 'BRK-B')
        self.assertEqual(symbols.to_source('BRK-B', 'schwab'), 'BRK.B')
        self.assertEqual(symbols.to_source('BRK-B', 'alpaca'), 'BRK.B')
        self.assertEqual(symbols.to_source('$SPX', 'yahoo'), '^GSPC')
        self.assertEqual(symbols.to_source('/ES', 'yahoo'), 'ES=F')
        self.assertEqual(symbols.to_source('btc/usd', 'coinbase'), 'BTC-USD')
        self.assertEqual(symbols.to_source('BTC-USD', 'alpaca'), 'BTC/USD')

    def test_back_from_sources(self):
        self.assertEqual(symbols.from_source('^GSPC', 'yahoo'), '$SPX')
        self.assertEqual(symbols.from_source('^XYZ', 'yahoo'), '$XYZ')
        self.assertEqual(symbols.from_source('ES=F', 'yahoo'), '/ES')
        self.assertEqual(symbols.from_source('ETHUSD', 'other'), 'ETH-USD')
        self.assertEqual(symbols.from_source('BRK-B', 'sec'), 'BRK.B')

    def test_kinds_and_parts(self):
        self.assertEqual(symbols.kind('$VIX'), 'index')
        self.assertEqual(symbols.kind('/CL'), 'future')
        self.assertEqual(symbols.kind('SOL-USD'), 'crypto')
        self.assertEqual(symbols.kind('BF.B'), 'stock')
        self.assertEqual(symbols.share_class('HEI.A'), 'A')
        self.assertEqual(symbols.root('BRK.B'), 'BRK')
        self.assertEqual(symbols.share_class('AAPL'), '')

    def test_lookup_finds_any_spelling(self):
        self.assertEqual(symbols.lookup({'BRK/B': 1}, 'BRK.B'), 1)
        self.assertEqual(symbols.lookup({'BRK-B': 2}, 'brk.b'), 2)
        self.assertIsNone(symbols.lookup({'BRK.A': 3}, 'BRK.B'))

    def test_stock_tickers_are_never_turned_into_pairs(self):
        for s in ('USD', 'BTCS', 'COIN', 'GBTC', 'A', 'T'):
            self.assertEqual(symbols.kind(s), 'stock', s)


class Pacing(HubTest):
    def test_gap_spaces_every_caller(self):
        starts = []

        async def fn():
            starts.append(self.clock.now())
            return Resp()

        async def main():
            await asyncio.gather(*(datahub.call('sec', fn, gap=0.125) for _ in range(5)))
        asyncio.run(main())
        gaps = [b - a for a, b in zip(starts, starts[1:])]
        self.assertEqual(len(starts), 5)
        self.assertTrue(all(g >= 0.125 - 1e-9 for g in gaps), gaps)

    def test_gap_from_end_waits_for_the_previous_call_to_finish(self):
        spans = []

        async def fn():
            begin = self.clock.now()
            await self.clock.sleep(0.5)
            spans.append((begin, self.clock.now()))
            return Resp()

        async def main():
            await asyncio.gather(*(datahub.call('nasdaq', fn, gap=1.0, gap_from='end') for _ in range(3)))
        asyncio.run(main())
        for (_, end), (begin, _) in zip(spans, spans[1:]):
            self.assertGreaterEqual(begin - end, 1.0 - 1e-9)

    def test_per_minute_budget_keeps_a_reserve_for_interactive_calls(self):
        src = datahub.SOURCES['schwab']
        sent = []

        async def fn():
            sent.append(self.clock.now())
            return Resp()

        async def main():
            # background work fills its share of the budget...
            await asyncio.gather(*(datahub.call('schwab', fn, background=True) for _ in range(src.per_minute - src.reserve)))
            filled = self.clock.now()
            # ...an interactive call still goes at once, a background one waits for the window
            await datahub.call('schwab', fn)
            self.assertEqual(self.clock.now(), filled)
            await datahub.call('schwab', fn, background=True)
            self.assertGreaterEqual(self.clock.now() - sent[0], 60 - 1e-9)
        asyncio.run(main())

    def test_interactive_calls_never_exceed_the_budget(self):
        src = datahub.SOURCES['schwab']

        async def fn():
            return Resp()

        async def main():
            await asyncio.gather(*(datahub.call('schwab', fn) for _ in range(src.per_minute + 5)))
        asyncio.run(main())
        self.assertGreaterEqual(self.clock.now() - 1000.0, 60 - 1e-9)


class Coalescing(HubTest):
    def test_identical_requests_in_flight_share_one(self):
        calls = []

        async def fn():
            calls.append(1)
            await self.clock.sleep(0.2)
            return Resp(data={'n': len(calls)})

        async def main():
            return await asyncio.gather(*(datahub.call('fred', fn, key='same') for _ in range(4)), datahub.call('fred', fn, key='other'))
        out = asyncio.run(main())
        self.assertEqual(len(calls), 2)
        self.assertIs(out[0], out[3])
        self.assertEqual(datahub.HEALTH['fred'].coalesced, 3)
        self.assertEqual(datahub._INFLIGHT, {})

    def test_a_failure_reaches_every_waiter_and_is_not_kept(self):
        calls = []

        async def fn():
            calls.append(1)
            await self.clock.sleep(0.1)
            raise core.EngineError('nope')

        async def main():
            return await asyncio.gather(*(datahub.call('fred', fn, key='k') for _ in range(3)), return_exceptions=True)
        out = asyncio.run(main())
        self.assertTrue(all(isinstance(e, core.EngineError) for e in out))
        self.assertEqual(len(calls), 1)
        self.assertEqual(datahub._INFLIGHT, {})

    def test_get_keys_on_url_params_and_headers(self):
        a = datahub.request_key('GET', 'https://x/y', {'b': 1, 'a': 2}, {'K': 'secret'})
        b = datahub.request_key('GET', 'https://x/y', {'a': 2, 'b': 1}, {'K': 'secret'})
        c = datahub.request_key('GET', 'https://x/y', {'a': 2, 'b': 1}, {'K': 'other'})
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertNotIn('secret', repr(a))


class Retries(HubTest):
    def test_429_waits_retry_after_pauses_the_source_then_succeeds(self):
        replies = [Resp(429, {'Retry-After': '7'}), Resp(200)]

        async def fn():
            return replies.pop(0)

        async def main():
            return await datahub.call('yahoo', fn, retries=1)
        out = asyncio.run(main())
        self.assertEqual(out.status_code, 200)
        self.assertGreaterEqual(self.clock.now() - 1000.0, 7 - 1e-9)
        h = datahub.HEALTH['yahoo']
        self.assertEqual((h.rate_limited, h.retried, h.ok, h.failed), (1, 1, 1, 1))

    def test_server_errors_back_off_then_raise_a_data_error(self):
        async def fn():
            return Resp(503)

        async def main():
            with self.assertRaises(datahub.DataError) as cm:
                await datahub.call('cftc', fn, retries=2)
            return cm.exception
        err = asyncio.run(main())
        self.assertEqual((err.source, err.status, err.retryable), ('cftc', 503, True))
        self.assertIn('CFTC', str(err))
        self.assertEqual(datahub.HEALTH['cftc'].calls, 3)
        self.assertGreater(self.clock.now() - 1000.0, 1.0)  # 1 s then 2 s (with jitter)

    def test_network_errors_retry_and_definite_answers_do_not(self):
        tries = []

        async def flaky():
            tries.append(1)
            if len(tries) < 2:
                raise ConnectionError('reset')
            return Resp(404)

        async def main():
            return await datahub.call('sec', flaky, retries=2)
        self.assertEqual(asyncio.run(main()).status_code, 404)  # 404 is an answer: returned, not retried
        self.assertEqual(len(tries), 2)
        self.assertEqual(datahub.state('sec'), 'ok')

    def test_passthrough_returns_the_last_busy_reply(self):
        async def fn():
            return Resp(429)

        async def main():
            return await datahub.call('alpaca', fn, retries=0, passthrough=True)
        self.assertEqual(asyncio.run(main()).status_code, 429)

    def test_errors_never_carry_query_strings(self):
        err = datahub.DataError('failed for https://api.stlouisfed.org/fred/series?api_key=SECRET123&x=1')
        self.assertNotIn('SECRET123', str(err))
        self.assertIn('https://api.stlouisfed.org/fred/series', str(err))


class Routed(HubTest):
    def test_get_calls_go_through_the_gate_and_others_pass(self):
        class Client:
            Instrument = 'enum'

            def __init__(self):
                self.n = 0

            async def get_quotes(self, symbols_):
                self.n += 1
                return Resp(data={s: {} for s in symbols_})

        client = Client()
        routed = datahub.Routed(client)

        async def main():
            await routed.get_quotes(['AAPL'])
            await routed.background().get_quotes(['MSFT'])
        asyncio.run(main())
        self.assertEqual(client.n, 2)
        self.assertEqual(datahub.HEALTH['schwab'].calls, 2)
        self.assertEqual(routed.Instrument, 'enum')
        self.assertIs(datahub.raw(routed), client)
        self.assertIs(datahub.raw(routed.background()), client)


class HealthRegistry(HubTest):
    def test_states_and_snapshot(self):
        self.assertEqual(datahub.state('fred'), 'idle')

        async def bad():
            return Resp(500)

        async def good():
            return Resp(200)

        async def main():
            with self.assertRaises(datahub.DataError):
                await datahub.call('fred', bad, retries=0)
            self.assertEqual(datahub.state('fred'), 'failing')
            await datahub.call('fred', good)
            self.assertEqual(datahub.state('fred'), 'ok')
            await datahub.call('yahoo', lambda: Resp(429), retries=0, passthrough=True)
            self.assertEqual(datahub.state('yahoo'), 'rate-limited')
        asyncio.run(main())
        datahub.record_cache('fred', True)
        datahub.record_cache('fred', False)
        datahub.record_cache('fred', True, stale=True)
        datahub.note('fred', 'see https://x.org/a?api_key=K')
        rows = {r['source']: r for r in datahub.snapshot()['sources']}
        self.assertEqual(set(rows), set(datahub.SOURCES))
        fred = rows['fred']
        self.assertEqual((fred['ok'], fred['failed'], fred['cacheHits'], fred['cacheMisses'], fred['staleServed']), (1, 1, 2, 1, 1))
        self.assertAlmostEqual(fred['cacheHitRate'], 0.667, places=3)
        self.assertEqual(fred['ageSeconds'], 0)
        self.assertNotIn('api_key', repr(fred['notes']))
        self.assertGreater(rows['yahoo']['rateLimitedFor'], 0)

    def test_cache_keys_map_to_sources(self):
        self.assertEqual(datahub.source_of_key(('sec-subs', 1)), 'sec')
        self.assertEqual(datahub.source_of_key(('form4', 'x')), 'sec')
        self.assertEqual(datahub.source_of_key(('fred', 'DGS10')), 'fred')
        self.assertEqual(datahub.source_of_key('treasury-curve'), 'treasury')
        self.assertEqual(datahub.source_of_key(('scan-daily-15y', 'AAPL')), 'schwab')
        self.assertEqual(datahub.source_of_key(('yahoo-events', 'AAPL')), 'yahoo')
        self.assertIsNone(datahub.source_of_key(('something', 1)))


class Provenance(HubTest):
    def test_envelope(self):
        env = datahub.envelope(4.2, 'fred', as_of='2026-10-01', fetched_at=1_700_000_100.4)
        self.assertEqual(env, {'value': 4.2, 'source': 'fred', 'sourceName': 'FRED', 'asOf': '2026-10-01',
                               'fetchedAt': 1_700_000_100, 'stale': False})

    def test_a_reply_records_the_oldest_value_and_stale_copies(self):
        disk = core.DiskCache(Path(tempfile.mkdtemp()) / 'c.db')
        ctx = core.EngineContext.__new__(core.EngineContext)
        ctx.disk, ctx._cache, ctx._locks, ctx._refreshing = disk, {}, {}, set()
        now = time.time()
        ctx._cache[('fred', 'A')] = (now - 7200, [1])  # older than its hour: served stale while it refreshes
        ctx._cache[('sec-subs', 1)] = (now - 60, {'x': 1})

        async def load():
            return [2]

        async def main():
            record = datahub.track()
            await ctx.cached(('fred', 'A'), 3600, load, stale_ok=True)
            await ctx.cached(('sec-subs', 1), 3600, load)
            await ctx.cached(('cot', 'X'), 3600, load)
            prov = datahub.provenance(record)
            await asyncio.sleep(0)  # let the background refresh finish
            return prov
        prov = asyncio.run(main())
        disk._db and disk._db.close()
        self.assertTrue(prov['stale'])
        self.assertAlmostEqual(prov['fetchedAt'], now - 7200, delta=2)
        self.assertEqual(set(prov['sources']), {'fred', 'sec', 'cftc'})
        self.assertTrue(prov['sources']['fred']['stale'])
        self.assertFalse(prov['sources']['sec']['stale'])
        self.assertEqual(datahub.HEALTH['cftc'].cache_misses, 1)
        self.assertEqual(datahub.HEALTH['sec'].cache_hits, 1)

    def test_no_tracking_outside_a_request(self):
        datahub.note_value(('fred', 'A'), 1.0, False)  # nothing recorded, nothing raised
        self.assertIsNone(datahub.provenance({}))

    def test_memory_cache_drops_the_oldest(self):
        ctx = core.EngineContext.__new__(core.EngineContext)
        ctx._cache, ctx._locks, ctx._refreshing = {}, {}, set()
        ctx.MEMORY_LIMIT = 8
        for i in range(20):
            ctx._remember(('k', i), (float(i), i))
        self.assertLessEqual(len(ctx._cache), 8)
        self.assertIn(('k', 19), ctx._cache)
        self.assertNotIn(('k', 0), ctx._cache)


class TimesAndUnits(unittest.TestCase):
    def test_utc_seconds(self):
        self.assertEqual(datahub.utc_seconds(1_700_000_000_000), 1_700_000_000)
        self.assertEqual(datahub.utc_seconds(1_700_000_000), 1_700_000_000)
        self.assertEqual(datahub.utc_seconds('2026-01-02T00:00:00Z'), 1767312000)
        self.assertEqual(datahub.utc_seconds('2026-01-02T00:00:00'), 1767312000)  # naive = UTC
        self.assertEqual(datahub.utc_seconds(dt.date(2026, 1, 2)), 1767312000)
        self.assertIsNone(datahub.utc_seconds('soon'))

    def test_new_york_sessions(self):
        # 2026-03-09 03:00 UTC is still March 8 in New York; a daily bar at 05:00 UTC is that day
        self.assertEqual(datahub.ny_date(datahub.utc_seconds('2026-03-09T03:00:00Z')), dt.date(2026, 3, 8))
        self.assertEqual(datahub.ny_session_close(dt.date(2026, 7, 1)), datahub.utc_seconds('2026-07-01T20:00:00Z'))  # EDT
        self.assertEqual(datahub.ny_session_close(dt.date(2026, 1, 5)), datahub.utc_seconds('2026-01-05T21:00:00Z'))  # EST
        self.assertEqual(datahub.ny_session_close(dt.date(2026, 11, 27)), datahub.utc_seconds('2026-11-27T18:00:00Z'))  # early close
        self.assertFalse(datahub.is_trading_day(dt.date(2026, 11, 26)))
        self.assertTrue(datahub.is_trading_day(dt.date(2026, 11, 27)))

    def test_units(self):
        self.assertAlmostEqual(datahub.fraction(4.2), 0.042)
        self.assertAlmostEqual(datahub.percent(0.042), 4.2)
        self.assertAlmostEqual(datahub.bp_to_fraction(25), 0.0025)
        self.assertEqual(datahub.from_thousands(1.5), 1500.0)
        self.assertIsNone(datahub.fraction(None))


def _ts(day):
    return int(dt.datetime(day.year, day.month, day.day, 5, tzinfo=dt.timezone.utc).timestamp())


class Checks(unittest.TestCase):
    def test_yahoo_events_parse_dividends_and_splits_in_one_reply(self):
        t = _ts(dt.date(2024, 6, 10))
        out = core.parse_yahoo_events({'chart': {'result': [{'events': {
            'dividends': {'1': {'date': t, 'amount': 0.25}, '2': {'date': 'bad'}},
            'splits': {'3': {'date': t, 'numerator': 10, 'denominator': 1}}}}]}})
        self.assertEqual(out, {'dividends': {'2024-06-10': 0.25}, 'splits': {'2024-06-10': 10.0}})
        self.assertEqual(core.parse_yahoo_events({}), {'dividends': {}, 'splits': {}})

    def test_dividends_agree_after_a_split(self):
        facts = {'facts': {'us-gaap': {'CommonStockDividendsPerShareCashPaid': {'units': {'USD/shares': [
            {'start': '2023-01-01', 'end': '2023-12-31', 'val': 4.0, 'form': '10-K', 'filed': '2024-02-01'},
            {'start': '2023-10-01', 'end': '2023-12-31', 'val': 1.0, 'form': '10-K', 'filed': '2024-02-01'},
        ]}}}}}
        years = datacheck.annual_dividends(facts)
        self.assertEqual(list(years), ['2023-12-31'])
        splits = {dt.date(2024, 6, 10): 4.0}  # Yahoo's amounts are on today's (post-split) basis
        divs = {dt.date(2023, m, 15): 0.25 for m in (2, 5, 8, 11)}
        rows = datacheck.compare_dividends(years, divs, splits)
        self.assertEqual(rows[0]['status'], 'agree')
        self.assertAlmostEqual(rows[0]['sec'], 1.0)
        self.assertAlmostEqual(rows[0]['yahoo'], 1.0)
        rows = datacheck.compare_dividends(years, {d: 0.4 for d in divs}, splits)
        self.assertEqual(rows[0]['status'], 'differ')
        rows = datacheck.compare_dividends(years, None, splits)
        self.assertEqual(rows[0]['status'], 'not comparable')

    def test_split_check_spots_unadjusted_history(self):
        days = [dt.date(2024, 6, d) for d in (5, 6, 7, 10, 11)]
        adjusted = [{'time': _ts(d), 'close': c} for d, c in zip(days, (100, 101, 100.5, 102, 101))]
        raw = [{'time': _ts(d), 'close': c} for d, c in zip(days, (400, 404, 402, 102, 101))]
        splits = {dt.date(2024, 6, 10): 4.0}
        self.assertEqual(datacheck.check_splits(adjusted, splits)[0]['status'], 'adjusted')
        self.assertEqual(datacheck.check_splits(raw, splits)[0]['status'], 'not adjusted')
        self.assertEqual(datacheck.check_splits(adjusted, {}), [])


class AlpacaSeam(unittest.TestCase):
    def bars(self, closes, start=0):
        return [{'time': start + i * 60, 'open': c, 'high': c, 'low': c, 'close': c, 'volume': 1} for i, c in enumerate(closes)]

    def test_saved_bars_on_an_old_basis_are_spotted(self):
        saved = self.bars([400, 404, 408])
        self.assertTrue(alpaca.consistent(saved, self.bars([408, 410], start=120)))
        self.assertFalse(alpaca.consistent(saved, self.bars([102, 103], start=120)))  # 4-for-1 since saving
        self.assertTrue(alpaca.consistent(saved, self.bars([1, 2], start=10_000)))  # no overlap: nothing to say

    def test_older_alpaca_bars_follow_schwab_at_the_seam(self):
        schwab = self.bars([100, 101], start=600)
        older = self.bars([380, 390, 400], start=480)  # last one at 600 overlaps Schwab's first
        out = alpaca.align_to_schwab('X', schwab, older)
        self.assertAlmostEqual(out[-1]['close'], 100)
        self.assertAlmostEqual(out[0]['close'], 95)
        close = self.bars([99.5], start=600)
        self.assertIs(alpaca.align_to_schwab('X', schwab, close), close)  # within tolerance: untouched

    def test_alpaca_asks_for_split_adjusted_bars_like_schwab(self):
        self.assertEqual(alpaca.ADJUSTMENT, 'split')


class Review(HubTest):
    def test_retry_after_http_date_and_cap(self):
        now = 1_700_000_000.0
        when = 'Tue, 14 Nov 2023 22:13:40 GMT'  # 1_700_000_020
        self.assertAlmostEqual(datahub.retry_after_seconds(when, now), 20, delta=1)
        self.assertEqual(datahub.retry_after_seconds('7', now), 7)
        self.assertIsNone(datahub.retry_after_seconds('soon', now))
        self.assertIsNone(datahub.retry_after_seconds(None, now))
        with self.assertLogs('engine.datahub', 'INFO'):
            self.assertEqual(datahub._retry_after(Resp(429, {'Retry-After': '900'}), 0, 1.0), datahub.MAX_RETRY_WAIT)

    def test_only_budgeted_sources_keep_send_times(self):
        async def fn():
            return Resp()

        async def main():
            for _ in range(5):
                await datahub.call('fred', fn)
                await datahub.call('schwab', fn)
        asyncio.run(main())
        self.assertEqual(len(datahub.gate('fred').sent), 0)
        self.assertEqual(len(datahub.gate('schwab').sent), 5)

    def test_cache_migrations_back_up_then_run_once(self):
        disk = core.DiskCache(Path(tempfile.mkdtemp()) / 'c.db')
        for key in (('alpaca', 'AAPL', '1h'), ('alpaca', 'AAPL', '1h', 'split'), ('scan-30m', 'AAPL', '2026-01'),
                    ('scan-daily-15y', 'AAPL'), ('fred', 'X')):
            disk.put(repr(key), 1.0, [1])
        with self.assertLogs('engine.datahub', 'INFO'):
            done = datahub.run_migrations(disk)
        self.assertEqual(done, {'alpaca-split-only': 1})
        self.assertIsNone(disk.get(repr(('alpaca', 'AAPL', '1h'))))
        for key in (('alpaca', 'AAPL', '1h', 'split'), ('scan-30m', 'AAPL', '2026-01'), ('scan-daily-15y', 'AAPL'), ('fred', 'X')):
            self.assertIsNotNone(disk.get(repr(key)), key)  # nothing else touched (the 30-minute record never deleted)
        backup = disk.db().execute('SELECT key, migration FROM cache_backup').fetchall()
        self.assertEqual(backup, [(repr(('alpaca', 'AAPL', '1h')), 'alpaca-split-only')])
        disk.put(repr(('alpaca', 'MSFT', '1h')), 2.0, [2])
        self.assertEqual(datahub.run_migrations(disk), {})  # once only: new rows stay
        self.assertIsNotNone(disk.get(repr(('alpaca', 'MSFT', '1h'))))
        disk._db.close()


class ThirtyMinuteMigration(unittest.TestCase):
    """The kept 30-minute record: Alpaca's old dividend-adjusted bars are cleaned, Schwab's bars are never removed."""
    DAY = 86400
    NOW = 1_790_000_000  # mid 2026

    def setUp(self):
        from engine import scanner
        self.scanner = scanner
        self.disk = core.DiskCache(Path(tempfile.mkdtemp()) / 'c.db')
        self.addCleanup(lambda: self.disk._db and self.disk._db.close())
        # Alpaca era: 900-800 days ago (dividend-adjusted: 98% of Schwab's basis). Schwab era kept for good: from 700
        # days ago (older than Schwab's 9 months, so it can't be downloaded again) to today.
        self.alp = [(self.NOW - (900 - i) * self.DAY, 98.0, 99.0, 97.0, 98.0, 5000.0) for i in range(0, 100, 10)]
        self.sch = [(self.NOW - (700 - i) * self.DAY, 100.0, 101.0, 99.0, 100.0, 4000.0) for i in range(0, 700, 10)]
        # The old Alpaca download also covered some Schwab days (a chart asked for them): there it is 98 vs Schwab's 100.
        overlap = [(t, 98.0, 99.0, 97.0, 98.0, 5100.0) for t, *_ in self.sch[:5]]
        self.disk.put(repr(('alpaca', 'AAPL', '30m')), 1.0, {'from': 0, 'to': 1, 'checked': 0, 'bars': [list(r) for r in self.alp + overlap]})
        months = {}
        for r in self.alp + self.sch:
            months.setdefault(self.scanner._month(r[0]), []).append(list(r))
        for m, rows in months.items():
            self.disk.put(repr(('scan-30m', 'AAPL', m)), 1.0, rows)
        self.disk.put(repr(('scan-30m-months', 'AAPL')), 1.0, sorted(months))
        # A stock with no saved Alpaca download: its origin can't be told, so it is left exactly as it is.
        self.disk.put(repr(('scan-30m', 'MSFT', '2024-01')), 1.0, [list(self.sch[0])])

    def rows(self, symbol='AAPL'):
        months = self.disk.get(repr(('scan-30m-months', symbol)))[1]
        return sorted(tuple(r) for m in months for r in self.disk.get(repr(('scan-30m', symbol, m)))[1])

    def migrate(self, keys):
        migrations = (('scan-30m-split-only', lambda con, name: self.scanner.migrate_30m_split_only(con, name, keys)),
                      *datahub.MIGRATIONS)
        return datahub.run_migrations(self.disk, migrations)

    def test_schwab_rows_older_than_nine_months_survive_and_alpaca_rows_go_with_keys(self):
        done = self.migrate(keys=True)
        self.assertEqual(done['scan-30m-split-only'], len(self.alp))
        self.assertEqual(self.rows(), sorted(self.sch))  # every Schwab bar kept, unchanged, also those 700 days old
        self.assertTrue(any(r[0] < self.NOW - 270 * self.DAY for r in self.rows()))
        self.assertEqual(self.disk.get(repr(('scan-30m', 'MSFT', '2024-01')))[1], [list(self.sch[0])])
        backed = {k for (k,) in self.disk.db().execute("SELECT key FROM cache_backup WHERE migration = 'scan-30m-split-only'")}
        self.assertIn(repr(('scan-30m-months', 'AAPL')), backed)
        self.assertTrue(all("'AAPL'" in k for k in backed))
        self.assertIsNone(self.disk.get(repr(('alpaca', 'AAPL', '30m'))))  # then the old Alpaca rows (backed up)

    def test_without_keys_alpaca_rows_are_rescaled_not_deleted(self):
        self.migrate(keys=False)
        rows = self.rows()
        self.assertEqual(len(rows), len(self.alp) + len(self.sch))
        self.assertEqual([r for r in rows if r[0] >= self.sch[0][0]], sorted(self.sch))  # Schwab untouched
        first = rows[0]
        self.assertAlmostEqual(first[4], 100.0)  # 98 / (98 / 100)
        self.assertAlmostEqual(first[5], 5000.0 * 0.98)

    def test_runs_once(self):
        self.migrate(keys=True)
        self.disk.put(repr(('scan-30m', 'AAPL', '1999-01')), 1.0, [list(self.alp[0])])
        self.assertEqual(self.migrate(keys=True), {})

    def test_dividends_restated_after_a_split_are_not_adjusted_twice(self):
        splits = {dt.date(2024, 6, 10): 4.0}
        divs = {dt.date(2024, m, 15): 0.25 for m in (2, 5, 8, 11)}  # Yahoo: today's basis
        restated = {'2024-12-31': {'start': '2024-01-01', 'end': '2024-12-31', 'value': 1.0,
                                   'tag': 'CommonStockDividendsPerShareCashPaid', 'filed': '2025-02-01'}}
        rows = datacheck.compare_dividends(restated, divs, splits)
        self.assertEqual((rows[0]['sec'], rows[0]['status']), (1.0, 'agree'))
        before = {'2023-12-31': {'start': '2023-01-01', 'end': '2023-12-31', 'value': 4.0,
                                 'tag': 'CommonStockDividendsPerShareCashPaid', 'filed': '2024-02-01'}}
        rows = datacheck.compare_dividends(before, {dt.date(2023, m, 15): 0.25 for m in (2, 5, 8, 11)}, splits)
        self.assertEqual((rows[0]['sec'], rows[0]['status']), (1.0, 'agree'))  # filed before the split: adjusted once


if __name__ == '__main__':
    unittest.main()
