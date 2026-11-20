"""YCharts replies (engine/ycharts.py): points, series and info, per-metric errors kept, nothing guessed."""
import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine import ycharts as yc  # noqa: E402
from engine.core import EngineError  # noqa: E402

POINTS = {'meta': {'status': 'ok'}, 'response': {
    'AAPL': {'meta': {'status': 'ok'}, 'results': {
        'price': {'meta': {'status': 'ok'}, 'data': ['2026-11-19', 232.1]},
        'pe_ratio': {'meta': {'status': 'ok'}, 'data': ['2026-11-19', 31.4]},
        'secret_metric': {'meta': {'status': 'error', 'error_message': 'Metric not in your plan'}, 'data': None}}}}}
SERIES = {'response': {'AAPL': {'results': {'price': {'meta': {'status': 'ok'}, 'data': [['2026-11-17', 230.0], ['2026-11-18', None], ['2026-11-19', 232.1]]}}}}}


class Parse(unittest.TestCase):
    def test_points_keep_values_and_say_what_is_missing(self):
        p = yc.parse_points(POINTS)['AAPL']
        self.assertEqual(p['price'], {'value': 232.1, 'date': '2026-11-19', 'error': None})
        self.assertIsNone(p['secret_metric']['value'])
        self.assertEqual(p['secret_metric']['error'], 'Metric not in your plan')

    def test_series_drop_blanks(self):
        s = yc.parse_series(SERIES)['AAPL']['price']
        self.assertEqual(s['points'], [['2026-11-17', 230.0], ['2026-11-19', 232.1]])

    def test_info(self):
        self.assertEqual(yc.parse_info({'response': {'AAPL': {'results': {'exchange': {'data': 'NASDAQ'}}}}}), {'AAPL': {'exchange': 'NASDAQ'}})

    def test_bad_input_is_refused_before_any_request(self):
        with self.assertRaises(EngineError):
            yc._clean('stocks', ['AAPL'], ['price'])
        with self.assertRaises(EngineError):
            yc._clean('companies', ['AA PL'], ['price'])
        with self.assertRaises(EngineError):
            yc._clean('companies', ['AAPL'], ['Price; drop'])
        self.assertEqual(yc._clean('mutual_funds', 'M:VFIAX', 'expense_ratio'), (['M:VFIAX'], ['expense_ratio']))


class Requests(unittest.TestCase):
    def test_the_key_goes_only_to_ycharts_in_its_header(self):
        seen = {}

        class Resp:
            status_code = 200

            def json(self):
                return POINTS

        class Http:
            async def get(self, url, params=None, headers=None, timeout=None):
                seen.update(url=url, headers=headers, params=params)
                return Resp()

        class Ctx:
            http = Http()

            async def cached(self, key, ttl, load, persist=False, stale_ok=False):
                return await load()
        with mock.patch.object(yc.settings, 'load', return_value={'ycharts_key': 'fake-test-key'}):
            out = asyncio.run(yc.points(Ctx(), {'kind': 'companies', 'ids': ['AAPL'], 'metrics': ['price', 'pe_ratio']}))
        self.assertEqual(seen['url'], 'https://ycharts.com/api/v3/companies/AAPL/points/price,pe_ratio')
        self.assertEqual(seen['headers']['X-YCHARTSAUTHORIZATION'], 'fake-test-key')
        self.assertEqual(out['results']['AAPL']['pe_ratio']['value'], 31.4)

    def test_no_key_says_where_to_add_it(self):
        with mock.patch.object(yc.settings, 'load', return_value={}):
            with self.assertRaises(EngineError) as cm:
                yc._key()
        self.assertIn('Settings', str(cm.exception))


if __name__ == '__main__':
    unittest.main()
