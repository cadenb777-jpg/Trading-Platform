"""Cross-check of values across free sources (helper/engine/crosscheck.py): parsers on saved fixtures, the confidence
rubric, the best-estimate choice and the cache key. No live network: sites are answered by httpx.MockTransport."""
import asyncio
import datetime as dt
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import httpx  # noqa: E402

from engine import core  # noqa: E402
from engine import crosscheck as cc  # noqa: E402

FIX = Path(__file__).parent / 'fixtures' / 'crosscheck'
T = 1792785600  # Friday 2026-10-23, 4:00 pm New York
NOW = dt.datetime.fromtimestamp(T + 3600, dt.timezone.utc)  # an hour after the close


def fixture(name):
    text = (FIX / name).read_text(encoding='utf-8')
    return json.loads(text) if name.endswith('.json') else text


def readings(*pairs, as_of=T):
    return [{'source': s, 'value': v, 'asOf': as_of} for s, v in pairs]


class Parsers(unittest.TestCase):
    def test_schwab(self):
        p = cc.parse_schwab('AAPL', fixture('schwab_quotes.json'))
        self.assertEqual(p['last'], (230.12, T + 0.123))
        self.assertAlmostEqual(p['prevClose'][0], 229.35)  # lastPrice - netChange
        self.assertAlmostEqual(p['divYield'][0], 0.0045)  # percent -> fraction
        self.assertNotIn('nav', p)
        self.assertEqual(p['exchange'], 'NASDAQ')

    def test_schwab_nav_only_for_mutual_funds(self):
        data = fixture('schwab_quotes.json')
        self.assertEqual(cc.parse_schwab('CCLFX', data)['nav'][0], 10.62)
        self.assertNotIn('nav', cc.parse_schwab('BXSL', data))  # a closed-end fund's price is not its NAV
        self.assertEqual(cc.parse_schwab('NOPE', data), {'assetType': '', 'exchange': ''})

    def test_yahoo_chart(self):
        p = cc.parse_yahoo_chart(fixture('yahoo_chart.json'))
        self.assertEqual(p['last'], (230.12, T))
        self.assertEqual(p['prevClose'][0], 229.35)  # the bar before the latest session, not chartPreviousClose
        self.assertNotIn('nav', p)
        self.assertEqual(cc.parse_yahoo_chart({'chart': {'result': None, 'error': {'code': 'Not Found'}}}), {})

    def test_yahoo_chart_fund_and_dividends(self):
        self.assertEqual(cc.parse_yahoo_chart(fixture('yahoo_chart_fund.json'))['nav'], (10.62, T))
        p = cc.parse_yahoo_chart(fixture('yahoo_chart_divs.json'))
        self.assertAlmostEqual(p['divYield'][0], (0.26 + 0.25 + 0.27 + 0.27) / 28.10)  # last 12 months only

    def test_yahoo_summary(self):
        p = cc.parse_yahoo_summary(fixture('yahoo_summary.json'))
        self.assertEqual(p['divYield'], (0.0381, T))
        self.assertEqual(p['expenseRatio'], (0.0006, None))
        self.assertEqual(p['nav'][0], 28.09)
        self.assertEqual(cc.parse_yahoo_summary({'quoteSummary': {'result': None}}), {})

    def test_google(self):
        p = cc.parse_google(fixture('google_quote.html'))
        self.assertEqual(p['last'], (230.05, T))
        self.assertEqual(p['prevClose'], (229.35, T))
        self.assertAlmostEqual(p['divYield'][0], 0.0045)
        self.assertNotIn('expenseRatio', p)
        etf = cc.parse_google(fixture('google_etf.html'))
        self.assertAlmostEqual(etf['expenseRatio'][0], 0.0006)
        self.assertEqual(cc.parse_google(fixture('google_notfound.html')), {})

    def test_nasdaq(self):
        p = cc.parse_nasdaq(fixture('nasdaq_info.json'), fixture('nasdaq_summary.json'))
        self.assertEqual(p['last'], (230.10, T))  # "Oct 23, 2026 4:00 PM ET"
        self.assertEqual(p['prevClose'][0], 229.35)
        self.assertAlmostEqual(p['divYield'][0], 0.0045)
        self.assertEqual(cc.parse_nasdaq(fixture('nasdaq_missing.json')), {})
        self.assertEqual(cc._nasdaq_time('Oct 23, 2026'), dt.datetime(2026, 10, 23, tzinfo=cc.NY).timestamp())

    def test_stooq(self):
        p = cc.parse_stooq(fixture('stooq.csv'))
        self.assertEqual(p['last'][0], 230.12)
        self.assertEqual(p['last'][1], T + 12)  # 22:00:12 Warsaw time = 4:00:12 pm New York
        self.assertEqual(cc.parse_stooq(fixture('stooq_nd.csv')), {})
        self.assertEqual(cc.parse_stooq(''), {})

    def test_sec(self):
        facts = {'navPerShare': [{'end': '2026-03-31', 'value': 25.1}, {'end': '2026-06-30', 'value': 25.2}]}
        self.assertEqual(cc.parse_sec_facts(facts)['nav'][0], 25.2)
        hist = {'cls': 'Class I', 'points': [{'date': '2026-08-31', 'value': 25.26}, {'date': '2026-09-30', 'value': 25.31}]}
        p = cc.parse_sec_nav(hist)
        self.assertEqual(p['nav'][0], 25.31)
        self.assertEqual(p['cls'], 'Class I')
        self.assertEqual(cc.parse_sec_nav(None), {})

    def test_numbers(self):
        self.assertEqual(cc._num('$1,234.50'), 1234.5)
        self.assertIsNone(cc._num('N/A'))
        self.assertIsNone(cc._num('--'))
        self.assertAlmostEqual(cc._pct('3.81%'), 0.0381)


class Rubric(unittest.TestCase):
    def test_single_source_is_capped(self):
        r = cc.score('last', readings(('sec_xbrl', 230.0)), NOW)
        self.assertEqual(r['score'], cc.SINGLE_CAP)
        self.assertEqual(r['status'], 'single')
        self.assertEqual(r['best'], 230.0)

    def test_agreement_boosts(self):
        one = cc.score('last', readings(('schwab', 230.0)), NOW)['score']
        two = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.1)), NOW)
        three = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.1), ('google', 230.05)), NOW)
        self.assertGreater(two['score'], one)
        self.assertGreater(three['score'], two['score'])
        self.assertEqual(two['status'], 'agree')
        self.assertEqual(two['tone'], 'ok')
        self.assertLessEqual(three['score'], cc.MAX_SCORE)

    def test_stale_decays(self):
        cadence = cc.FIELDS['nav']['cadence']
        fresh = cc.score('nav', readings(('sec_nav', 25.0), ('schwab', 25.0), as_of=T), NOW)['score']
        stale = cc.score('nav', readings(('sec_nav', 25.0), ('schwab', 25.0), as_of=T - 3 * cadence), NOW)['score']
        self.assertLess(stale, fresh)
        self.assertEqual(cc.freshness(0, 100), 1.0)
        self.assertAlmostEqual(cc.freshness(200, 100), 0.5)
        self.assertEqual(cc.freshness(10_000, 100), 0.1)
        self.assertEqual(cc.freshness(None, 100), 0.6)

    def test_closing_price_is_fresh_while_market_closed(self):
        sunday = dt.datetime(2026, 10, 25, 15, tzinfo=dt.timezone.utc)
        self.assertEqual(cc.effective_age('last', T, sunday), 0.0)
        self.assertGreater(cc.effective_age('last', T - 86400, sunday), 0)
        self.assertEqual(cc.last_regular_close(sunday), T)

    def test_disagreement_penalised_and_flagged(self):
        agree = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.1), ('nasdaq', 230.05)), NOW)
        outlier = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.1), ('nasdaq', 230.05), ('google', 240.0)), NOW)
        self.assertLess(outlier['score'], agree['score'])
        self.assertEqual(outlier['status'], 'differ')
        self.assertEqual(outlier['tone'], 'amber')
        self.assertIn('Google Finance', outlier['message'])
        self.assertAlmostEqual(outlier['best'], 230.05)  # the outlier is left out of the best estimate
        conflict = cc.score('last', readings(('schwab', 230.0), ('yahoo', 250.0)), NOW)
        self.assertEqual(conflict['status'], 'conflict')
        self.assertEqual(conflict['tone'], 'red')
        self.assertLess(conflict['score'], 0.5)

    def test_tolerance_is_per_field(self):
        # 3% apart: a disagreement for a price, but within the 10% allowed for yields (computed differently by sites)
        self.assertEqual(cc.score('last', readings(('schwab', 100.0), ('yahoo', 103.0)), NOW)['status'], 'conflict')
        self.assertEqual(cc.score('divYield', readings(('schwab', 0.0100), ('yahoo', 0.0103)), NOW)['status'], 'agree')

    def test_median_of_agreeing_sources(self):
        r = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.4), ('nasdaq', 230.2), ('google', 200.0)), NOW)
        self.assertEqual(r['best'], 230.2)
        even = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.4)), NOW)
        self.assertAlmostEqual(even['best'], 230.2)  # median of two agreeing values is their middle

    def test_heavier_group_wins(self):
        # two weak sources agreeing vs one strong one: the weights decide, not the head count alone
        group = cc.agreeing_group([{'value': 10.0, 'weight': 0.95}, {'value': 11.0, 'weight': 0.3}, {'value': 11.01, 'weight': 0.3}], 0.01)
        self.assertEqual(group, [0])

    def test_no_values_never_guesses(self):
        r = cc.score('nav', [{'source': 'yahoo', 'value': None, 'asOf': None, 'error': 'down'}], NOW)
        self.assertIsNone(r['best'])
        self.assertEqual(r['score'], 0.0)
        self.assertEqual(r['status'], 'none')

    def test_cache_key(self):
        self.assertEqual(cc.cache_key('google', 'aapl', 'last'), ('crosscheck', 'google', 'AAPL', 'last'))
        self.assertNotEqual(cc.cache_key('google', 'AAPL', 'last'), cc.cache_key('google', 'AAPL', 'prevClose'))
        self.assertNotEqual(cc.cache_key('google', 'AAPL', 'last'), cc.cache_key('yahoo', 'AAPL', 'last'))

    def test_google_exchange_guess(self):
        self.assertEqual(cc.google_exchanges('AAPL', 'last', {'exchange': 'NASDAQ'}), ['NASDAQ'])
        self.assertEqual(cc.google_exchanges('SCHD', 'last', {'exchange': 'NYSE Arca'}), ['NYSEARCA', 'NASDAQ'])
        self.assertEqual(cc.google_exchanges('CCLFX', 'nav', {}), ['MUTF'])


class FakeSchwab:
    def __init__(self):
        self.calls = 0

    async def get_quotes(self, symbols):
        self.calls += 1
        data = fixture('schwab_quotes.json')
        return httpx.Response(200, json={s: data[s] for s in symbols if s in data})


def route(request):
    url = str(request.url)
    if 'query1.finance.yahoo.com/v8/finance/chart/AAPL' in url:
        return httpx.Response(200, json=fixture('yahoo_chart.json'))
    if 'google.com/finance/quote/AAPL:NASDAQ' in url:
        return httpx.Response(200, text=fixture('google_quote.html'))
    if 'api.nasdaq.com' in url:
        return httpx.Response(200, json=fixture('nasdaq_info.json' if url.split('?')[0].endswith('/info') else 'nasdaq_summary.json'))
    if 'stooq.com' in url:
        raise httpx.ConnectError('blocked')
    return httpx.Response(404, text='not found')


class Gather(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.pacing = dict(cc.PACING)
        cc.PACING.update({k: 0 for k in ('schwab', 'google', 'yahoo', 'nasdaq', 'stooq')})
        self.addCleanup(lambda: cc.PACING.update(self.pacing))
        cc._gates.clear()

    def run_check(self, field, symbol, ctx=None):
        async def main():
            c = ctx or self.ctx()
            try:
                return await cc.gather(c, field, symbol, now=NOW), c
            finally:
                await c.http.aclose()
        return asyncio.run(main())

    def ctx(self):
        c = core.EngineContext.__new__(core.EngineContext)
        c.disk, c._cache, c._locks, c._refreshing = core.DiskCache(Path(self.dir.name) / 'cache.db'), {}, {}, set()
        c.http = httpx.AsyncClient(transport=httpx.MockTransport(route))
        c.schwab = FakeSchwab()
        return c

    def test_every_source_listed_with_its_value_or_reason(self):
        out, _ = self.run_check('last', 'AAPL')
        by = {r['source']: r for r in out['sources']}
        self.assertEqual(set(by), {'schwab', 'nasdaq', 'yahoo', 'stooq', 'google'})
        self.assertEqual(by['google']['value'], 230.05)
        self.assertEqual(by['google']['url'], 'https://www.google.com/finance/quote/AAPL:NASDAQ')
        self.assertIn('ConnectError', by['stooq']['error'])  # a failing site is shown, never hidden
        self.assertIsNone(by['stooq']['value'])
        self.assertEqual(out['status'], 'agree')
        self.assertGreater(out['score'], 0.8)
        self.assertTrue(all(r.get('name') for r in out['sources']))
        self.assertEqual(out['sources'][-1]['source'], 'stooq')  # sources with no value listed last

    def test_answers_cached_per_source_symbol_field(self):
        async def main():
            c = self.ctx()
            await cc.gather(c, 'last', 'AAPL')
            await cc.gather(c, 'last', 'AAPL')
            calls = c.schwab.calls
            await cc.gather(c, 'prevClose', 'AAPL')
            await c.http.aclose()
            return c, calls
        c, calls = asyncio.run(main())
        self.assertEqual(calls, 1)  # the second check came from the cache
        self.assertEqual(c.schwab.calls, 2)  # another field is its own entry
        self.assertIsNotNone(c.disk.get(repr(cc.cache_key('schwab', 'AAPL', 'last'))))  # kept in cache.db

    def test_handler_validates(self):
        async def main():
            with self.assertRaises(core.EngineError):
                await cc.value(None, {'field': 'price', 'symbol': 'AAPL'})
            with self.assertRaises(core.EngineError):
                await cc.value(None, {'field': 'last', 'symbol': 'AA PL;'})
            with self.assertRaises(core.EngineError):
                await cc.value(None, {'field': 'nav'})
        asyncio.run(main())


if __name__ == '__main__':
    unittest.main()
