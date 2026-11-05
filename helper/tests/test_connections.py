"""Settings > Data connections: each Test button's one cheap call (answered from fixtures), Finnhub and Census
connectors, and the rule that a saved key never appears in any reply to the browser."""
import asyncio
import json
import os
import sys
import unittest
from unittest import mock

import httpx

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import connections, finnhub, settings, worldmacro as wm  # noqa: E402
from engine.core import EngineError  # noqa: E402
from test_worldmacro import Base, fixture  # noqa: E402

KEYS = {'fred_key': 'f' * 32, 'bea_key': 'ABCDEF01-2345-6789-ABCD-EF0123456789', 'bls_key': '0123456789abcdef0123456789abcdef',
        'eia_key': 'e1a' * 13 + 'x', 'census_key': 'c3' * 20, 'finnhub_key': 'finnhubkey1234567890', 'anthropic_key': 'sk-ant-api03-secretsecret',
        'sec_contact': 'owner@example.com'}
SECRETS = [v for k, v in KEYS.items() if k != 'sec_contact']

GOOD = {
    r'stlouisfed\.org/fred/series': {'seriess': [{'id': 'GDP'}]},
    r'apps\.bea\.gov': {'BEAAPI': {'Results': {'Dataset': [{'DatasetName': 'NIPA'}]}}},
    r'api\.bls\.gov': {'status': 'REQUEST_SUCCEEDED', 'message': [], 'Results': {'series': []}},
    r'api\.eia\.gov/v2/': {'response': {'id': '', 'routes': []}},
    r'api\.census\.gov': fixture('census_marts.json'),
    r'finnhub\.io/api/v1/stock/recommendation': fixture('finnhub_rec.json'),
    r'finnhub\.io/api/v1/calendar/earnings': fixture('finnhub_earnings.json'),
    r'api\.anthropic\.com/v1/models': {'data': [{'id': 'claude-opus-5-5'}]},
    r'data\.sec\.gov': {'cik': '320193'},
}
BAD = {
    r'stlouisfed\.org': lambda r: httpx.Response(400, json={'error_code': 400, 'error_message': 'Bad Request.  The value for variable api_key is not registered.'}),
    r'apps\.bea\.gov': fixture('bea_error.json'),
    r'api\.bls\.gov': {'status': 'REQUEST_NOT_PROCESSED', 'message': ['The key provided by the User is invalid.']},
    r'api\.eia\.gov': fixture('eia_error.json'),
    r'api\.census\.gov': lambda r: httpx.Response(200, text='<html><h1>Invalid Key</h1></html>'),
    r'finnhub\.io': lambda r: httpx.Response(401, json={'error': 'Invalid API key'}),
    r'api\.anthropic\.com': lambda r: httpx.Response(401, json={'type': 'error'}),
    r'data\.sec\.gov': 403,
}


class Connections(Base):
    def setUp(self):
        super().setUp()
        settings._cache = dict(KEYS)

    def ctx(self):
        c = super().ctx()
        c.sec_http = c.http
        return c

    def test_each_connection_passes_with_a_good_key(self):
        self.replies = GOOD
        for name in connections.TESTS:
            out = self.run_async(lambda c: connections.test_connection(c, {'connection': name}))
            self.assertTrue(out['ok'], (name, out))
            self.assertTrue(out['message'].startswith('Connected'), out)
            self.assertFalse(connections.leaks(out, SECRETS), name)

    def test_each_connection_explains_a_bad_key(self):
        self.replies = BAD
        expect = {'fred': 'not registered', 'bea': 'not valid', 'bls': 'invalid', 'eia': 'invalid api_key', 'census': 'not valid',
                  'finnhub': 'not valid', 'ai': 'not valid', 'sec': 'email'}
        for name, word in expect.items():
            out = self.run_async(lambda c: connections.test_connection(c, {'connection': name}))
            self.assertFalse(out['ok'], name)
            self.assertIn(word, out['message'], name)
            self.assertFalse(connections.leaks(out, SECRETS), name)

    def test_no_key_saved_makes_no_call(self):
        settings._cache = {}
        out = self.run_async(lambda c: connections.test_connection(c, {'connection': 'eia'}))
        self.assertEqual((out['ok'], out['keySet']), (False, False))
        self.assertEqual(self.hits, [])

    def test_network_failure_is_a_message(self):
        def down(request):
            raise httpx.ConnectTimeout('slow')
        self.replies = {r'.': down}
        out = self.run_async(lambda c: connections.test_connection(c, {'connection': 'finnhub'}))
        self.assertIn('could not be reached (ConnectTimeout)', out['message'])

    def test_a_key_echoed_by_a_site_is_masked(self):
        self.replies = {r'stlouisfed': lambda r: httpx.Response(400, json={'error_message': f'Key {KEYS["fred_key"]} unknown'})}
        out = self.run_async(lambda c: connections.test_connection(c, {'connection': 'fred'}))
        self.assertIn('•••', out['message'])
        self.assertFalse(connections.leaks(out, SECRETS))

    def test_alpaca_uses_its_own_test(self):
        from engine import alpaca

        async def fake(ctx, msg):
            return {'ok': True, 'keysSet': True, 'message': 'Connected. Intraday price history back to 2016 is available.', 'earliest': None}
        with mock.patch.object(alpaca, 'status', fake):
            out = self.run_async(lambda c: connections.test_connection(c, {'connection': 'alpaca'}))
        self.assertTrue(out['ok'])

    def test_unknown_connection(self):
        with self.assertRaisesRegex(EngineError, 'Unknown'):
            self.run_async(lambda c: connections.test_connection(c, {'connection': 'x'}))

    def test_no_reply_ever_contains_a_key(self):
        """Every request the browser can make about these sources, with every key saved: no key text in any reply."""
        self.replies = {**GOOD, r'imf\.org|worldbank|oecd|ecb|fiscaldata|polymarket|kalshi': 503,
                        r'TableName=T10102': fixture('bea_gdp.json'), r'TableName=T20804': fixture('bea_pce.json'),
                        r'api\.bls\.gov': fixture('bls_ok.json'), r'api\.eia\.gov/v2/seriesid': fixture('eia_crude.json')}

        class SettingsCtx:
            def apply_settings(self):
                pass
        replies = [asyncio.run(settings.get_settings(SettingsCtx(), {})),
                   asyncio.run(settings.set_settings(SettingsCtx(), {'model': 'claude-opus-5-5'}))]
        for panel in ('bls', 'bea', 'census', 'eia'):
            replies.append(self.run_async(lambda c: wm.world_panel(c, {'panel': panel})))
        replies.append(self.run_async(lambda c: wm.world_sources(c, {})))
        replies.append(self.run_async(lambda c: finnhub.recommendations(c, {'symbol': 'AAPL'})))
        replies.append(self.run_async(lambda c: finnhub.earnings(c, {})))
        for name in connections.TESTS:
            replies.append(self.run_async(lambda c: connections.test_connection(c, {'connection': name})))
        for r in replies:
            self.assertFalse(connections.leaks(r, SECRETS), json.dumps(r)[:300])
        public = replies[0]
        for flag in ('fredKeySet', 'beaKeySet', 'blsKeySet', 'eiaKeySet', 'censusKeySet', 'finnhubKeySet', 'aiKeySet'):
            self.assertIs(public[flag], True, flag)
        # The keys did reach their own sites (in the request), so the features really are on.
        self.assertTrue(any(KEYS['finnhub_key'] in u for u in self.hits if 'finnhub.io' in u))
        self.assertFalse(any(KEYS['finnhub_key'] in u for u in self.hits if 'finnhub.io' not in u))


class Finnhub(Base):
    def test_parsers(self):
        trends = finnhub.parse_recommendations(fixture('finnhub_rec.json'))
        self.assertEqual([t['period'] for t in trends], ['2026-11-01', '2026-10-01'])  # newest first, empty month dropped
        self.assertEqual(trends[0]['total'], 44)
        self.assertEqual(trends[0]['consensus'], 'Buy')
        events = finnhub.parse_earnings(fixture('finnhub_earnings.json'))
        self.assertEqual([e['symbol'] for e in events], ['QCOM', 'NVDA'])
        self.assertEqual(events[1]['hour'], 'after the close')
        with self.assertRaisesRegex(EngineError, 'Finnhub'):
            finnhub.parse_earnings({'error': 'x'})

    def test_without_key(self):
        out = self.run_async(lambda c: finnhub.recommendations(c, {'symbol': 'aapl'}))
        self.assertTrue(out['needsKey'])
        self.assertEqual(self.hits, [])

    def test_with_key_cached(self):
        settings._cache = {'finnhub_key': KEYS['finnhub_key']}
        self.replies = GOOD

        async def twice(c):
            a = await finnhub.recommendations(c, {'symbol': 'AAPL'})
            c._cache.clear()
            b = await finnhub.recommendations(c, {'symbol': 'AAPL'})
            return a, b
        a, b = self.run_async(twice)
        self.assertEqual(len(self.hits), 1)  # second answer from cache.db
        self.assertEqual(a['trends'], b['trends'])

    def test_bad_symbol(self):
        with self.assertRaisesRegex(EngineError, 'ticker'):
            self.run_async(lambda c: finnhub.recommendations(c, {'symbol': ''}))


class Census(Base):
    def test_retail_sales_without_key(self):
        self.replies = {r'api\.census\.gov': fixture('census_marts.json')}
        out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'census'}))
        by = {s['name']: s for s in out['series']}
        self.assertAlmostEqual(by['Retail sales (monthly change)']['value'], 0.3, places=1)
        self.assertAlmostEqual(by['Retail sales (yearly)']['value'], 100 * (1.003 ** 12 - 1), places=1)
        self.assertFalse(any('key=' in u for u in self.hits))

    def test_parse_errors(self):
        with self.assertRaisesRegex(EngineError, 'Census'):
            wm.parse_census({'error': 'x'})


if __name__ == '__main__':
    unittest.main()
