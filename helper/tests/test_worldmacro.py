"""World macro connectors (helper/engine/worldmacro.py): parsing saved API replies, error paths, retries and caching.
No live network: every request is answered from tests/fixtures/world."""
import asyncio
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import core, settings, worldmacro as wm  # noqa: E402
from engine.core import EngineError  # noqa: E402

FIX = Path(__file__).resolve().parent / 'fixtures' / 'world'


def fixture(name):
    text = (FIX / name).read_text(encoding='utf-8')
    return json.loads(text) if name.endswith('.json') else text


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch.object(settings, 'SETTINGS_PATH', Path(self.tmp.name) / 'settings.json')
        patcher.start()
        self.addCleanup(patcher.stop)
        settings._cache = {}
        self.addCleanup(setattr, settings, '_cache', None)
        delay = mock.patch.object(wm, 'RETRY_DELAY', 0)
        delay.start()
        self.addCleanup(delay.stop)
        self.hits = []
        self.replies = {}

    def route(self, request):
        url = str(request.url)
        self.hits.append(url)
        for pattern, reply in self.replies.items():
            if re.search(pattern, url):
                if callable(reply):
                    return reply(request)
                if isinstance(reply, int):
                    return httpx.Response(reply, text='')
                if isinstance(reply, str):
                    return httpx.Response(200, text=reply)
                return httpx.Response(200, json=reply)
        return httpx.Response(404, text='not in this test')

    def ctx(self):
        c = core.EngineContext.__new__(core.EngineContext)
        c.disk = core.DiskCache(Path(self.tmp.name) / 'cache.db')
        self.addCleanup(lambda: c.disk._db and c.disk._db.close())
        c._cache, c._locks, c._refreshing = {}, {}, set()
        c.http = httpx.AsyncClient(transport=httpx.MockTransport(self.route))
        return c

    def run_async(self, coro_fn):
        async def main():
            c = self.ctx()
            try:
                return await coro_fn(c)
            finally:
                await c.http.aclose()
        return asyncio.run(main())


class Parsers(unittest.TestCase):
    def test_world_bank_skips_nulls_and_sorts_oldest_first(self):
        values, updated = wm.parse_worldbank(fixture('worldbank_gdp.json'))
        self.assertEqual(updated, '2026-10-15')
        self.assertEqual(values['USA'], [('2022', 2.5), ('2023', 2.9), ('2024', 2.8)])  # 2025 not published yet
        self.assertEqual(values['DEU'][-1], ('2025', -0.1))

    def test_world_bank_error_message_is_shown(self):
        with self.assertRaisesRegex(EngineError, 'World Bank: The provided parameter value is not valid'):
            wm.parse_worldbank(fixture('worldbank_error.json'))

    def test_imf_values_by_country(self):
        out = wm.parse_imf(fixture('imf_ngdp.json'), 'NGDP_RPCH')
        self.assertEqual(out['JPN'][-1], ('2027', 0.6))
        with self.assertRaisesRegex(EngineError, 'IMF'):
            wm.parse_imf({'values': {}}, 'NGDP_RPCH')

    def test_oecd_cli_and_phases(self):
        out = wm.parse_oecd_csv(fixture('oecd_cli.csv'))
        self.assertEqual(out['USA'][0], ('2026-04-01', 99.2))
        self.assertEqual(wm.cli_phase(out['USA']), 'Expansion')   # above 100 and rising
        self.assertEqual(wm.cli_phase(out['DEU']), 'Slowdown')    # below 100 and falling
        self.assertEqual(wm.cli_phase([('a', 101), ('b', 101), ('c', 101), ('d', 100.5)]), 'Downturn')
        self.assertEqual(wm.cli_phase([('a', 98), ('b', 98), ('c', 98), ('d', 99)]), 'Recovery')
        self.assertEqual(wm.parse_oecd_csv('NoResultsFound'), {})
        with self.assertRaisesRegex(EngineError, 'OECD'):
            wm.parse_oecd_csv('<html>error</html>')

    def test_bls_monthly_rows_skip_annual_average(self):
        out = wm.parse_bls(fixture('bls_ok.json'))
        cpi = out['CUSR0000SA0']
        self.assertEqual(len(cpi), 26)
        self.assertEqual(cpi[0], ('2024-08-01', 310.0))
        self.assertNotIn(999.0, [v for _, v in cpi])

    def test_bls_threshold_explains_the_free_key(self):
        with self.assertRaisesRegex(EngineError, 'daily threshold.*free BLS key'):
            wm.parse_bls(fixture('bls_threshold.json'))

    def test_bea_first_line_per_description(self):
        out = wm.parse_bea(fixture('bea_gdp.json'))
        self.assertEqual(out['Gross domestic product'], [('2026-01-01', 1.6), ('2026-04-01', 3.0), ('2026-07-01', 3.8)])
        self.assertEqual(out['Personal consumption expenditures'][-1], ('2026-07-01', 2.4))  # line 2, not the later line 26
        pce = wm.parse_bea(fixture('bea_pce.json'))['PCE excluding food and energy']
        self.assertEqual(pce[0], ('2024-09-01', 121.0))

    def test_bea_bad_key(self):
        with self.assertRaisesRegex(EngineError, 'BEA: The UserId provided is not valid.*Settings'):
            wm.parse_bea(fixture('bea_error.json'))

    def test_fiscal_debt_and_cash(self):
        total, public = wm.parse_debt(fixture('fiscal_debt.json')['data'])
        self.assertAlmostEqual(total[-1][1], 38.123456789, places=6)
        self.assertEqual(public[0][0], '2026-10-26')
        tga = wm.parse_tga(fixture('fiscal_dts.json')['data'])
        self.assertEqual(tga, [('2026-10-27', 820.0), ('2026-11-03', 862.345)])

    def test_ecb_csv_and_step_rates(self):
        dfr = wm.parse_ecb_csv(fixture('ecb_dfr.csv'))
        self.assertEqual(dfr[-1], ('2025-06-11', 2.0))
        monthly = wm.step_monthly(dfr, '2025-08-15')
        self.assertEqual(monthly[0], ('2024-07-01', 3.75))
        self.assertEqual(dict(monthly)['2024-10-01'], 3.5)
        self.assertEqual(dict(monthly)['2025-08-01'], 2.0)
        self.assertEqual(wm.parse_ecb_csv(fixture('ecb_hicp.csv'))[-1], ('2026-09-01', 2.2))

    def test_eia(self):
        rows = wm.parse_eia(fixture('eia_crude.json'))
        self.assertEqual(rows, [('2026-10-24', 423100.0), ('2026-10-31', 421500.0)])
        with self.assertRaisesRegex(EngineError, 'EIA: An invalid api_key'):
            wm.parse_eia(fixture('eia_error.json'))

    def test_year_on_year_and_changes(self):
        rows = [(f'2025-{m:02d}-01', 100 + m) for m in range(1, 13)] + [('2026-01-01', 113.0), ('2026-03-01', 115.0)]
        self.assertEqual(wm.yoy(rows), [('2026-01-01', 100 * (113 / 101 - 1)), ('2026-03-01', 100 * (115 / 103 - 1))])
        self.assertEqual(wm.diff([('a', 1), ('b', 4)]), [('b', 3)])

    def test_series_entry_without_data_says_so(self):
        e = wm.series_entry('x', 'X', '%', [])
        self.assertIsNone(e['value'])
        self.assertIn('No data', e['note'])

    def test_table_groups_by_region_and_carries_source(self):
        wb = {'gdp': {'values': {'USA': [('2023', 2.9), ('2024', 2.8)]}, 'updated': '2026-10-15'}}
        imf = {'gdpForecast': {'values': {'USA': [('2025', 2.0), ('2026', 2.1), ('2027', 2.0)]}}}
        rows = wm.build_table(wb, imf, None, ['USA', 'DEU'], 2026)
        self.assertEqual([(r['code'], r['region']) for r in rows], [('USA', 'Americas'), ('DEU', 'Europe')])
        usa = rows[0]['cells']
        self.assertEqual((usa['gdp']['value'], usa['gdp']['period'], usa['gdp']['source']), (2.8, '2024', 'World Bank'))
        self.assertEqual((usa['gdpForecast']['value'], usa['gdpForecast']['next']), (2.1, 2.0))
        self.assertIsNone(usa['inflation'])
        self.assertIsNone(rows[1]['cells']['gdp'])


class Fetching(Base):
    def test_retries_busy_then_succeeds(self):
        calls = []

        def flaky(request):
            calls.append(1)
            return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json={'ok': 1})
        self.replies = {'example': flaky}
        self.assertEqual(self.run_async(lambda c: wm.fetch(c, 'Test', 'https://example.org/x')), {'ok': 1})
        self.assertEqual(len(calls), 3)

    def test_gives_up_with_the_source_name(self):
        def down(request):
            raise httpx.ConnectError('boom')
        self.replies = {'example': down}
        with self.assertRaisesRegex(EngineError, r'^ECB could not be reached \(ConnectError\)'):
            self.run_async(lambda c: wm.fetch(c, 'ECB', 'https://example.org/x'))
        self.assertEqual(len(self.hits), wm.TRIES)

    def test_client_error_is_not_retried_and_hides_the_url(self):
        self.replies = {'example': 403}
        with self.assertRaises(EngineError) as caught:
            self.run_async(lambda c: wm.fetch(c, 'EIA', 'https://example.org/x', params={'api_key': 'SECRET123'}))
        self.assertEqual(len(self.hits), 1)
        self.assertIn('Check the key in Settings', str(caught.exception))
        self.assertNotIn('SECRET123', str(caught.exception))

    def test_not_json(self):
        self.replies = {'example': 'plain text'}
        with self.assertRaisesRegex(EngineError, 'could not be read'):
            self.run_async(lambda c: wm.fetch(c, 'IMF', 'https://example.org/x'))


class Handlers(Base):
    def setUp(self):
        super().setUp()
        self.replies = {
            r'api\.worldbank\.org/.*NY\.GDP': fixture('worldbank_gdp.json'),
            r'api\.worldbank\.org': 500,
            r'imf\.org/.*NGDP_RPCH': fixture('imf_ngdp.json'),
            r'imf\.org': {'values': {'PCPIPCH': {'USA': {'2026': 2.9, '2027': 2.4}}}},
            r'sdmx\.oecd\.org': fixture('oecd_cli.csv'),
        }

    def test_table_reports_failed_source_and_keeps_the_rest(self):
        out = self.run_async(lambda c: wm.world_table(c, {}))
        self.assertIn('World Bank', out['errors'])
        self.assertIn('busy', out['errors']['World Bank'])
        usa = next(r for r in out['rows'] if r['code'] == 'USA')
        self.assertEqual(usa['cells']['gdp']['value'], 2.8)  # GDP worked, the other World Bank indicators failed
        self.assertIsNone(usa['cells']['debt'])
        self.assertEqual(usa['cells']['cli']['phase'], 'Expansion')
        self.assertEqual(usa['cells']['inflationForecast']['source'], 'IMF WEO')
        self.assertEqual([r['region'] for r in out['rows']][:4], ['Americas'] * 4)
        self.assertEqual(out['regions'], ['Americas', 'Europe', 'Asia-Pacific'])

    def test_one_request_per_indicator_for_all_countries(self):
        self.run_async(lambda c: wm.world_table(c, {'countries': ['USA']}))
        wb = [u for u in self.hits if 'worldbank' in u]
        gdp = [u for u in wb if 'NY.GDP' in u]
        self.assertEqual(len(gdp), 1)
        self.assertIn('USA%3BCAN', gdp[0].replace(';', '%3B'))

    def test_downloads_are_cached_on_disk(self):
        async def twice(c):
            await wm.world_table(c, {})
            first = len(self.hits)
            c._cache.clear()  # a restarted helper: memory gone, cache.db still there
            await wm.world_table(c, {})
            return first
        first = self.run_async(twice)
        # Only the failed World Bank indicators are asked again (failures are never cached).
        again = self.hits[first:]
        self.assertTrue(again and all('worldbank' in u and 'NY.GDP' not in u for u in again), again)

    def test_bea_without_key_points_to_settings(self):
        out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'bea'}))
        self.assertTrue(out['needsKey'])
        self.assertIn('Settings', out['note'])
        self.assertEqual(out['signup'], 'https://apps.bea.gov/API/signup/')
        self.assertEqual(self.hits, [])

    def test_bea_with_key(self):
        settings._cache = {'bea_key': 'ABCDEF01-2345-6789-ABCD-EF0123456789'}
        self.replies = {r'TableName=T10102': fixture('bea_gdp.json'), r'TableName=T20804': fixture('bea_pce.json')}
        out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'bea'}))
        by = {s['name']: s for s in out['series']}
        self.assertEqual(by['Real GDP growth (annualised)']['value'], 3.8)
        self.assertEqual(by['Net exports (contribution)']['unit'], 'pts')
        self.assertAlmostEqual(by['Core PCE price index (yearly)']['value'], 100 * (1.0025 ** 12 - 1), places=2)

    def test_bls_v1_without_key_v2_with_key(self):
        self.replies = {r'api\.bls\.gov': fixture('bls_ok.json')}
        out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'bls'}))
        self.assertIn('/v1/', self.hits[0])
        self.assertIn('signup', out)
        by = {s['id']: s for s in out['series']}
        self.assertAlmostEqual(by['CES0000000001']['value'], 150.0)  # monthly change in thousands
        self.assertAlmostEqual(by['CUSR0000SA0']['value'], 100 * (328.75 / 319.75 - 1), places=4)
        self.assertNotIn('CES2000000001', by)  # key-only series
        self.assertIn('No data', by['CUSR0000SETA02']['note'])

        settings._cache = {'bls_key': '0123456789abcdef0123456789abcdef'}
        sent = []

        def keep(request):
            sent.append(json.loads(request.content))
            return httpx.Response(200, json=fixture('bls_ok.json'))
        self.replies = {r'api\.bls\.gov': keep}
        out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'bls'}))
        self.assertIn('/v2/', self.hits[-1])
        self.assertEqual(sent[0]['registrationkey'], '0123456789abcdef0123456789abcdef')
        self.assertIn('CES2000000001', sent[0]['seriesid'])
        self.assertNotIn('signup', out)
        self.assertNotIn('0123456789abcdef', json.dumps(out))  # the key never goes back to the browser

    def test_fiscal_reuses_bonds_auctions(self):
        from engine import invest
        self.replies = {r'debt_to_penny': fixture('fiscal_debt.json'), r'operating_cash_balance': fixture('fiscal_dts.json')}

        async def fake_auctions(ctx, msg):
            return {'results': [{'type': 'Bill', 'term': '4-Week'}, {'type': 'Note', 'term': '10-Year', 'bidToCover': 2.5}], 'upcoming': []}
        with mock.patch.object(invest, 'auctions', fake_auctions):
            out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'fiscal'}))
        self.assertEqual([a['term'] for a in out['auctions']], ['10-Year'])
        by = {s['id']: s for s in out['series']}
        self.assertAlmostEqual(by['tga']['value'], 862.345)

    def test_ecb_partial_failure_is_reported(self):
        self.replies = {r'DFR': fixture('ecb_dfr.csv'), r'MRR_FR': 500, r'000000\.4\.ANR': fixture('ecb_hicp.csv'),
                        r'XEF000': fixture('ecb_hicp.csv'), r'EXR': 404}
        out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'ecb'}))
        self.assertEqual(len(out['series']), 3)
        self.assertIn('ECB is busy', out['errors']['ECB main refinancing rate'])
        self.assertIn('HTTP 404', out['errors']['EUR/USD reference rate'])

    def test_eia_needs_key_then_scales_inventories(self):
        out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'eia'}))
        self.assertTrue(out['needsKey'])
        settings._cache = {'eia_key': 'a' * 40}
        self.replies = {r'WCESTUS1': fixture('eia_crude.json'), r'api\.eia\.gov': fixture('eia_error.json')}
        out = self.run_async(lambda c: wm.world_panel(c, {'panel': 'eia'}))
        self.assertEqual(out['series'][0]['value'], 421.5)  # million barrels
        self.assertIn('invalid api_key', out['errors']['WTI crude spot price'])

    def test_unknown_panel(self):
        with self.assertRaisesRegex(EngineError, 'Unknown'):
            self.run_async(lambda c: wm.world_panel(c, {'panel': 'nope'}))


class KeysInSettings(Base):
    def test_keys_saved_in_the_helper_and_never_returned(self):
        class Ctx:
            def apply_settings(self):
                pass
        out = asyncio.run(settings.set_settings(Ctx(), {'blsKey': '0123456789abcdef0123456789abcdef', 'beaKey': 'ABCDEF01-2345-6789-ABCD-EF0123456789',
                                                        'eiaKey': 'x' * 40}))
        self.assertEqual((out['blsKeySet'], out['beaKeySet'], out['eiaKeySet']), (True, True, True))
        self.assertNotIn('0123456789abcdef', json.dumps(out))
        saved = json.loads(settings.SETTINGS_PATH.read_text())
        self.assertEqual(saved['bea_key'], 'ABCDEF01-2345-6789-ABCD-EF0123456789')
        with self.assertRaisesRegex(EngineError, 'BEA key'):
            asyncio.run(settings.set_settings(Ctx(), {'beaKey': 'not a key'}))
        out = asyncio.run(settings.set_settings(Ctx(), {'eiaKey': ''}))
        self.assertFalse(out['eiaKeySet'])
        for k in ('bls_key', 'bea_key', 'eia_key'):
            self.assertIn(k, settings.SECRET_KEYS)


class ReadOnly(unittest.TestCase):
    def test_world_modules_only_read(self):
        engine = Path(__file__).resolve().parent.parent / 'engine'
        for name in ('worldmacro.py', 'predictions.py'):
            text = (engine / name).read_text(encoding='utf-8')
            self.assertIsNone(re.search(r'/portfolio/|/orders|place_order|create_order|/v2/orders|signature|private_key', text, re.I), name)
            # GETs only, except the BLS data query, which the BLS API takes as a POST
            self.assertEqual(set(re.findall(r'\.http\.(\w+)\(', text)) - {'get'}, {'post'} if name == 'worldmacro.py' else set())


if __name__ == '__main__':
    unittest.main()
