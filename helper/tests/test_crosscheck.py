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


def readings(*items, as_of=T):
    """(source, value) or (source, value, basis) tuples -> readings."""
    return [{'source': i[0], 'value': i[1], 'asOf': as_of, 'basis': i[2] if len(i) > 2 else None} for i in items]


class Parsers(unittest.TestCase):
    def test_schwab(self):
        p = cc.parse_schwab('AAPL', fixture('schwab_quotes.json'))
        self.assertEqual(p['last'], (230.12, T + 0.123))
        self.assertAlmostEqual(p['prevClose'][0], 229.35)  # lastPrice - netChange
        self.assertAlmostEqual(p['divYield'][0], 0.0045)  # percent -> fraction
        self.assertEqual(p['divYield'][2], 'forward')
        self.assertNotIn('nav', p)
        self.assertEqual(p['exchange'], 'NASDAQ')

    def test_schwab_nav_only_for_mutual_funds_with_class(self):
        data = fixture('schwab_quotes.json')
        p = cc.parse_schwab('CCLFX', data)
        self.assertEqual(p['nav'], (10.62, T, 'Class I'))
        self.assertEqual(p['cls'], 'Class I')
        self.assertNotIn('nav', cc.parse_schwab('BXSL', data))  # a closed-end fund's price is not its NAV
        self.assertEqual(cc.parse_schwab('NOPE', data), {'assetType': '', 'exchange': '', 'cls': None})

    def test_yahoo_chart(self):
        p = cc.parse_yahoo_chart(fixture('yahoo_chart.json'))
        self.assertEqual(p['last'], (230.12, T))
        self.assertEqual(p['prevClose'][0], 229.35)  # the bar before the latest session, not chartPreviousClose
        self.assertNotIn('nav', p)
        self.assertEqual(cc.parse_yahoo_chart({'chart': {'result': None, 'error': {'code': 'Not Found'}}}), {})

    def test_yahoo_chart_fund_and_dividends(self):
        self.assertEqual(cc.parse_yahoo_chart(fixture('yahoo_chart_fund.json'), 'Class I')['nav'], (10.62, T, 'Class I'))
        p = cc.parse_yahoo_chart(fixture('yahoo_chart_divs.json'))
        self.assertAlmostEqual(p['divYield'][0], (0.26 + 0.25 + 0.27 + 0.27) / 28.10)  # last 12 months only
        self.assertEqual(p['divYield'][2], 'trailing')

    def test_yahoo_summary(self):
        p = cc.parse_yahoo_summary(fixture('yahoo_summary.json'))
        self.assertEqual(p['divYield'], (0.0381, T, 'trailing'))  # a fund's "yield": last 12 months
        self.assertEqual(p['expenseRatio'], (0.0006, None, 'net'))
        stock = {'quoteSummary': {'result': [{'summaryDetail': {'dividendYield': {'raw': 0.0044}, 'trailingAnnualDividendYield': {'raw': 0.0043}}}]}}
        self.assertEqual(cc.parse_yahoo_summary(stock)['divYield'], (0.0044, None, 'forward'))
        self.assertEqual(cc.parse_yahoo_summary({'quoteSummary': {'result': None}}), {})

    def test_nasdaq(self):
        p = cc.parse_nasdaq(fixture('nasdaq_info.json'), fixture('nasdaq_summary.json'))
        self.assertEqual(p['last'], (230.10, T))  # "Oct 23, 2026 4:00 PM ET"
        self.assertEqual(p['prevClose'][0], 229.35)
        self.assertEqual(p['divYield'][2], 'forward')
        self.assertAlmostEqual(p['divYield'][0], 0.0045)
        self.assertEqual(cc.parse_nasdaq(fixture('nasdaq_missing.json')), {})
        self.assertEqual(cc._nasdaq_time('Oct 23, 2026'), dt.datetime(2026, 10, 23, tzinfo=cc.NY).timestamp())

    def test_sec(self):
        facts = {'navPerShare': [{'end': '2026-03-31', 'value': 25.1}, {'end': '2026-06-30', 'value': 25.2}]}
        self.assertEqual(cc.parse_sec_facts(facts)['nav'][0], 25.2)
        hist = {'cls': 'Class I', 'points': [{'date': '2026-08-31', 'value': 25.26}, {'date': '2026-09-30', 'value': 25.31}],
                'latestByClass': [{'cls': 'Class D', 'value': 25.30, 'date': '2026-09-30'}, {'cls': 'Class I', 'value': 25.31, 'date': '2026-09-30'},
                                  {'cls': 'Class S', 'value': 25.28, 'date': '2026-09-30'}]}
        self.assertEqual(cc.parse_sec_nav(hist)['nav'][::2], (25.31, 'Class I'))
        self.assertEqual(cc.parse_sec_nav(hist, 'Class S')['nav'][::2], (25.28, 'Class S'))  # the listed symbol's class
        self.assertIsNone(cc.parse_sec_nav({'cls': 'All classes', 'points': [{'date': '2026-09-30', 'value': 9.9}]})['nav'][2])
        self.assertEqual(cc.parse_sec_nav(None), {})

    def test_numbers_and_classes(self):
        self.assertEqual(cc._num('$1,234.50'), 1234.5)
        self.assertIsNone(cc._num('N/A'))
        self.assertIsNone(cc._num('--'))
        self.assertAlmostEqual(cc._pct('3.81%'), 0.0381)
        self.assertEqual(cc.share_class('CLIFFWATER CORPORATE LENDING FUND CLASS I'), 'Class I')
        self.assertIsNone(cc.share_class('Apple Inc'))


class Rubric(unittest.TestCase):
    def test_single_source_is_capped(self):
        r = cc.score('last', readings(('schwab', 230.0)), NOW)
        self.assertEqual(r['score'], cc.SINGLE_CAP)
        self.assertEqual(r['status'], 'single')
        self.assertEqual(r['best'], 230.0)

    def test_one_family_counts_once(self):
        sec = cc.score('nav', readings(('sec_xbrl', 25.3), ('sec_nav', 25.31)), NOW)
        self.assertEqual(sec['status'], 'single')  # both SEC: not independent
        self.assertLessEqual(sec['score'], cc.SINGLE_CAP)
        self.assertIn('count once', sec['message'])
        yahoo = cc.score('divYield', readings(('yahoo', 0.01, 'forward'), ('yahoo_summary', 0.01, 'forward')), NOW)
        self.assertLessEqual(yahoo['score'], cc.SINGLE_CAP)
        two = cc.score('nav', readings(('sec_nav', 25.31), ('schwab', 25.31)), NOW)
        self.assertGreater(two['score'], cc.SINGLE_CAP)

    def test_agreement_boosts(self):
        one = cc.score('last', readings(('schwab', 230.0)), NOW)['score']
        two = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.1)), NOW)
        three = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.1), ('nasdaq', 230.05)), NOW)
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
        self.assertEqual(cc.freshness(None, 100), 0.4)  # unknown time

    def test_closing_price_is_fresh_while_market_closed(self):
        sunday = dt.datetime(2026, 10, 25, 15, tzinfo=dt.timezone.utc)
        self.assertEqual(cc.effective_age('last', T, sunday), 0.0)
        self.assertGreater(cc.effective_age('last', T - 86400, sunday), 0)
        self.assertEqual(cc.last_regular_close(sunday), T)

    def test_disagreement_penalised_and_flagged(self):
        agree = cc.score('last', readings(('schwab', 230.0), ('nasdaq', 230.05)), NOW)
        outlier = cc.score('last', readings(('schwab', 230.0), ('nasdaq', 230.05), ('yahoo', 240.0)), NOW)
        self.assertLess(outlier['score'], agree['score'])
        self.assertEqual(outlier['status'], 'differ')
        self.assertEqual(outlier['tone'], 'amber')
        self.assertIn('Yahoo Finance', outlier['message'])
        self.assertEqual(outlier['best'], 230.0)  # the outlier is left out of the best estimate
        conflict = cc.score('last', readings(('schwab', 230.0), ('yahoo', 250.0)), NOW)
        self.assertEqual(conflict['status'], 'conflict')
        self.assertEqual(conflict['tone'], 'red')
        self.assertLess(conflict['score'], 0.5)

    def test_filing_preferred_over_disagreeing_market_data(self):
        rs = readings(('sec_nav', 25.31), ('schwab', 25.90), ('yahoo', 25.91))
        r = cc.score('nav', rs, NOW)
        self.assertEqual(r['best'], 25.31)
        self.assertEqual(r['bestSource'], 'sec_nav')
        self.assertTrue(rs[0]['agrees'])  # the filing is never the outlier here
        self.assertFalse(rs[1]['agrees'])
        self.assertIn("fund's filing", r['message'])
        self.assertEqual(r['tone'], 'amber')

    def test_stale_filing_is_not_preferred(self):
        cadence = cc.FIELDS['nav']['cadence']
        rs = [{'source': 'sec_xbrl', 'value': 24.0, 'asOf': T - 6 * cadence}] + readings(('schwab', 25.90), ('yahoo', 25.91))
        r = cc.score('nav', rs, NOW)
        self.assertEqual(r['best'], 25.90)
        self.assertFalse(rs[0]['agrees'])

    def test_only_matching_definitions_are_compared(self):
        rs = readings(('schwab', 0.0100, 'forward'), ('nasdaq', 0.0101, 'forward'), ('yahoo', 0.0200, 'trailing'))
        r = cc.score('divYield', rs, NOW)
        self.assertEqual(r['basis'], 'forward')
        self.assertEqual(r['status'], 'agree')  # the trailing yield is not a disagreement
        self.assertFalse(rs[2]['compared'])
        self.assertIn('different definition', r['message'])
        self.assertEqual(r['best'], 0.0100)

    def test_nav_share_class_must_match(self):
        rs = readings(('sec_nav', 25.31, 'Class I'), ('schwab', 25.00, 'Class S'), ('sec_xbrl', 25.30))
        r = cc.score('nav', rs, NOW)
        self.assertEqual(r['basis'], 'Class I')
        self.assertFalse(rs[1]['compared'])
        self.assertTrue(rs[2]['compared'])  # no class stated: joins the main one

    def test_expense_ratio_is_labelled_aggregator_only(self):
        r = cc.score('expenseRatio', readings(('yahoo_summary', 0.0006, 'net'), as_of=None), NOW)
        self.assertIn('aggregator only', r['message'])
        self.assertAlmostEqual(r['score'], 0.8 * 0.65 * 0.4, places=3)  # no date: freshness 0.4

    def test_tolerance_is_per_field(self):
        # 3% apart: a disagreement for a price, but within the 10% allowed for yields
        self.assertEqual(cc.score('last', readings(('schwab', 100.0), ('yahoo', 103.0)), NOW)['status'], 'conflict')
        self.assertEqual(cc.score('divYield', readings(('schwab', 0.0100, 'forward'), ('nasdaq', 0.0103, 'forward')), NOW)['status'], 'agree')

    def test_best_is_a_reported_value_never_an_average(self):
        r = cc.score('last', readings(('schwab', 230.0), ('yahoo', 230.4), ('nasdaq', 230.2)), NOW)
        self.assertEqual(r['best'], 230.0)  # the most trusted agreeing source
        even = cc.score('last', readings(('nasdaq', 230.4), ('yahoo', 230.0)), NOW)
        self.assertEqual(even['best'], 230.4)  # not 230.2

    def test_tie_goes_to_the_newer_reading(self):
        rs = [{'source': 'sec_xbrl', 'value': 25.54, 'asOf': T - 20 * 86400}, {'source': 'sec_nav', 'value': 25.31, 'asOf': T - 5 * 86400}]
        r = cc.score('nav', rs, NOW)
        self.assertEqual(r['bestSource'], 'sec_nav')
        self.assertEqual(r['best'], 25.31)

    def test_heavier_group_wins(self):
        # two agreeing sources of one family vs one strong source: a family counts once
        group = cc.agreeing_group([{'source': 'schwab', 'value': 10.0, 'weight': 0.9}, {'source': 'yahoo', 'value': 11.0, 'weight': 0.7},
                                   {'source': 'yahoo_summary', 'value': 11.01, 'weight': 0.65}], 0.01)
        self.assertEqual(group, [0])

    def test_no_values_never_guesses(self):
        r = cc.score('nav', [{'source': 'yahoo', 'value': None, 'asOf': None, 'error': 'down'}], NOW)
        self.assertIsNone(r['best'])
        self.assertEqual(r['score'], 0.0)
        self.assertEqual(r['status'], 'none')

    def test_cache_key(self):
        self.assertEqual(cc.cache_key('nasdaq', 'aapl', 'last'), ('crosscheck', 'nasdaq', 'AAPL', 'last'))
        self.assertNotEqual(cc.cache_key('nasdaq', 'AAPL', 'last'), cc.cache_key('nasdaq', 'AAPL', 'prevClose'))
        self.assertNotEqual(cc.cache_key('nasdaq', 'AAPL', 'last'), cc.cache_key('yahoo', 'AAPL', 'last'))


class FakeSchwab:
    def __init__(self):
        self.calls = 0

    async def get_quotes(self, symbols):
        self.calls += 1
        data = fixture('schwab_quotes.json')
        return httpx.Response(200, json={s: data[s] for s in symbols if s in data})


HITS = []


def route(request):
    url = str(request.url)
    HITS.append(url)
    if 'query1.finance.yahoo.com/v8/finance/chart/AAPL' in url:
        return httpx.Response(200, json=fixture('yahoo_chart.json'))
    if 'api.nasdaq.com' in url:
        raise httpx.ConnectError('blocked')
    if 'fc.yahoo.com' in url or 'getcrumb' in url:
        return httpx.Response(404, text='<html>not found</html>')
    return httpx.Response(404, text='not found')


class Gather(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.pacing = dict(cc.PACING)
        cc.PACING.update({k: 0 for k in ('schwab', 'yahoo', 'nasdaq')})
        self.addCleanup(lambda: cc.PACING.update(self.pacing))
        cc._gates.clear()
        cc._failures.clear()
        HITS.clear()

    def ctx(self):
        c = core.EngineContext.__new__(core.EngineContext)
        c.disk, c._cache, c._locks, c._refreshing = core.DiskCache(Path(self.dir.name) / 'cache.db'), {}, {}, set()
        c.http = httpx.AsyncClient(transport=httpx.MockTransport(route))
        c.schwab = FakeSchwab()
        return c

    def test_every_source_listed_with_its_value_or_reason(self):
        async def main():
            c = self.ctx()
            out = await cc.gather(c, 'last', 'AAPL', now=NOW)
            await c.http.aclose()
            return out
        out = asyncio.run(main())
        by = {r['source']: r for r in out['sources']}
        self.assertEqual(set(by), {'schwab', 'nasdaq', 'yahoo'})
        self.assertEqual(by['yahoo']['value'], 230.12)
        self.assertEqual(by['yahoo']['url'], 'https://finance.yahoo.com/quote/AAPL')
        self.assertIn('ConnectError', by['nasdaq']['error'])  # a failing site is shown, never hidden
        self.assertEqual(out['status'], 'agree')
        self.assertGreater(out['score'], 0.8)
        self.assertTrue(all(r.get('name') for r in out['sources']))
        self.assertEqual(out['sources'][-1]['source'], 'nasdaq')  # sources with no value listed last

    def test_answers_cached_and_failures_remembered(self):
        async def main():
            c = self.ctx()
            await cc.gather(c, 'last', 'AAPL', now=NOW)
            nasdaq_hits = sum('nasdaq' in u for u in HITS)
            await cc.gather(c, 'last', 'AAPL', now=NOW)
            calls = c.schwab.calls
            again = sum('nasdaq' in u for u in HITS)
            await cc.gather(c, 'prevClose', 'AAPL', now=NOW)
            await c.http.aclose()
            return c, calls, nasdaq_hits, again
        c, calls, nasdaq_hits, again = asyncio.run(main())
        self.assertEqual(calls, 1)  # the second check came from the cache
        self.assertEqual(c.schwab.calls, 2)  # another field is its own entry
        self.assertIsNotNone(c.disk.get(repr(cc.cache_key('schwab', 'AAPL', 'last'))))  # kept in cache.db
        self.assertGreater(nasdaq_hits, 0)
        self.assertEqual(again, nasdaq_hits)  # the failed site wasn't asked again

    def test_yahoo_crumb_failure_remembered(self):
        async def main():
            c = self.ctx()
            first = await cc.gather(c, 'expenseRatio', 'AAPL', now=NOW)
            hits = sum('getcrumb' in u for u in HITS)
            c._cache.clear()  # the answer itself isn't cached (it failed); the failure is
            second = await cc.gather(c, 'expenseRatio', 'AAPL', now=NOW)
            await c.http.aclose()
            return first, second, hits
        first, second, hits = asyncio.run(main())
        self.assertEqual(hits, 1)
        self.assertEqual(sum('getcrumb' in u for u in HITS), 1)
        self.assertIn('session code', first['sources'][0]['error'])
        self.assertIsNone(second['best'])

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
