"""Prediction-market odds (helper/engine/predictions.py): Polymarket and Kalshi replies, Fed cut/hold/hike odds,
filters, errors and caching. Answers come from tests/fixtures/world; nothing touches the network."""
import asyncio
import os
import sys
import unittest

import httpx

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import predictions as pr  # noqa: E402
from engine.core import EngineError  # noqa: E402
from test_worldmacro import Base, fixture  # noqa: E402


class Parsing(unittest.TestCase):
    def test_buckets(self):
        self.assertEqual([pr.bucket(t) for t in ('25 bps decrease', 'Cut >25bps', 'No change', 'Hold', '25+ bps increase', 'Hike 25bps', 'Powell out')],
                         ['cut', 'cut', 'hold', 'hold', 'hike', 'hike', None])

    def test_polymarket_markets_and_fed_group(self):
        markets, groups = pr.parse_polymarket(fixture('polymarket_fed.json'), 'fed')
        self.assertEqual(len(markets), 5)  # the closed market is left out
        m = next(x for x in markets if x['outcome'] == '25 bps decrease')
        self.assertEqual((m['yes'], m['volume'], m['url']), (0.62, 20000000, 'https://polymarket.com/event/fed-decision-in-december'))
        self.assertEqual(m['updated'], '2026-11-05T14:00:00Z')
        self.assertEqual(len(groups), 1)  # "How many cuts in 2026?" has one bucket only: not a decision market
        g = groups[0]
        self.assertEqual(g['meeting'], '2026-12-09')
        self.assertAlmostEqual(g['odds']['cut'], 0.65, places=4)
        self.assertAlmostEqual(g['odds']['hold'], 0.34, places=4)
        self.assertAlmostEqual(sum(g['odds'].values()), 1, places=3)

    def test_kalshi_prices_in_dollars_and_cents(self):
        markets, groups = pr.parse_kalshi(fixture('kalshi_fed.json'), 'fed')
        self.assertEqual(len(markets), 3)  # the settled one is left out
        cut = next(m for m in markets if m['outcome'] == 'Cut 25bps')
        self.assertAlmostEqual(cut['yes'], 0.60)
        hold = next(m for m in markets if m['outcome'] == 'Hold')
        self.assertAlmostEqual(hold['yes'], 0.37)  # mid of 36/38 cents
        hike = next(m for m in markets if m['outcome'] == 'Hike 25bps')
        self.assertAlmostEqual(hike['yes'], 0.02)  # no quotes: last trade
        self.assertEqual(cut['url'], 'https://kalshi.com/markets/kxfeddecision')
        self.assertEqual(groups[0]['meeting'], '2026-12-09')
        self.assertGreater(groups[0]['odds']['cut'], groups[0]['odds']['hold'])

    def test_kalshi_categories_from_events(self):
        markets, groups = pr.parse_kalshi(fixture('kalshi_events.json'))
        self.assertEqual({m['category'] for m in markets}, {'macro', 'politics'})  # sports left out
        self.assertEqual(groups, [])
        cpi = next(m for m in markets if m['category'] == 'macro')
        self.assertEqual(cpi['question'], 'CPI year-over-year in October 2026?: Above 3.0%')

    def test_unexpected_replies(self):
        with self.assertRaisesRegex(EngineError, 'Polymarket'):
            pr.parse_polymarket({'error': 'x'}, 'fed')
        with self.assertRaisesRegex(EngineError, 'Kalshi'):
            pr.parse_kalshi([], 'fed')


class Requests(Base):
    def setUp(self):
        super().setUp()
        self.replies = {
            r'gamma-api\.polymarket\.com.*tag_slug=fed': fixture('polymarket_fed.json'),
            r'gamma-api\.polymarket\.com': [],
            r'kalshi\.com.*series_ticker=KXFEDDECISION': fixture('kalshi_fed.json'),
            r'kalshi\.com.*series_ticker=': {'events': []},
            r'kalshi\.com': fixture('kalshi_events.json'),
        }

    def test_all_sources_filters_and_order(self):
        out = self.run_async(lambda c: pr.markets(c, {}))
        self.assertEqual(out['errors'], {})
        self.assertEqual([g['source'] for g in out['fed']], ['Polymarket', 'Kalshi'])  # same meeting: bigger volume first
        vols = [m['volume'] for m in out['markets']]
        self.assertEqual(vols, sorted(vols, reverse=True))
        only = self.run_async(lambda c: pr.markets(c, {'category': 'politics'}))
        self.assertEqual([m['source'] for m in only['markets']], ['Kalshi'])
        cpi = self.run_async(lambda c: pr.markets(c, {'query': 'cpi'}))
        self.assertEqual(len(cpi['markets']), 1)

    def test_one_source_down_is_reported_not_silent(self):
        self.replies = {r'polymarket': 500, **{k: v for k, v in self.replies.items() if 'kalshi' in k}}
        out = self.run_async(lambda c: pr.markets(c, {}))
        self.assertIn('Polymarket', out['errors'])
        self.assertTrue(out['markets'])

    def test_everything_down_is_an_error(self):
        self.replies = {r'.': 503}
        with self.assertRaisesRegex(EngineError, 'Polymarket is busy.*Kalshi is busy'):
            self.run_async(lambda c: pr.markets(c, {}))

    def test_cached_for_five_minutes(self):
        async def twice(c):
            await pr.markets(c, {})
            n = len(self.hits)
            await pr.markets(c, {'category': 'fed'})
            return n
        n = self.run_async(twice)
        self.assertEqual(len(self.hits), n)

    def test_only_get_requests(self):
        methods = []
        old = self.route

        def spy(request):
            methods.append(request.method)
            return old(request)
        self.route = spy
        self.run_async(lambda c: pr.markets(c, {}))
        self.assertEqual(set(methods), {'GET'})


if __name__ == '__main__':
    unittest.main()
