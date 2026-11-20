"""YCharts through the Excel add-in: formulas (YCharts' own syntax sheet), reading Excel's cells, the scratch
workbook, and one full request with PowerShell's reply faked (Excel itself only exists on the owner's Windows PC)."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import settings, ycharts  # noqa: E402
from engine import ycharts_excel as xl  # noqa: E402
from engine.core import EngineError  # noqa: E402

NAME_ERR = {'err': 2029}


class Formulas(unittest.TestCase):
    def test_point_series_info_holdings(self):
        self.assertEqual(xl.point_formula('WMT', 'price'), '=YCP("WMT","price",,,,"TP_NULL")')
        self.assertEqual(xl.point_formula('WMT', 'price', '2019-12-31'), '=YCP("WMT","price","2019-12-31",,,"TP_NULL")')
        self.assertEqual(xl.point_formula('I:USGDP', 'value'), '=YCP("I:USGDP",,,,,"TP_NULL")')  # indicators: no calculation
        self.assertEqual(xl.series_formula('WMT', 'price', '2020-06-01', '2020-06-15'), '=YCS("WMT","price","2020-06-01","2020-06-15",,,"Y","TP_NULL")')
        self.assertEqual(xl.info_formula('AAPL', 'industry'), '=YCI("AAPL","industry",,,"TP_NULL")')
        self.assertEqual(xl.holdings_formula('SPY'), '=YCH("SPY","Y",,,"Y")')

    def test_nothing_can_break_out_of_a_quoted_argument(self):
        for bad in ['A"B', 'AAPL),1', 'x y', '', 'A' * 30]:
            with self.assertRaises(EngineError):
                xl.check_id(bad)
        for bad in ['PE_RATIO"', 'pe ratio', '']:
            with self.assertRaises(EngineError):
                xl.check_code(bad)
        self.assertEqual(xl.check_id('M:VFIAX'), 'M:VFIAX')


class Cells(unittest.TestCase):
    def test_point_values_and_errors(self):
        self.assertEqual(xl.point_value({'v': 112.54}), {'value': 112.54, 'date': None, 'error': None})
        self.assertEqual(xl.point_value({'v': 'TP_NULL'})['error'], 'no data')
        self.assertEqual(xl.point_value({'v': {'err': 2042}})['error'], '#N/A')
        self.assertEqual(xl.point_value({'v': 'ERR: INVALID CALCULATION'})['error'], 'ERR: INVALID CALCULATION')
        self.assertEqual(xl.point_value({'v': 'Loading...', 'pending': True})['error'], 'still loading in Excel')
        self.assertEqual(xl.point_value({'v': 'Technology Hardware'})['value'], 'Technology Hardware')

    def test_series_from_a_two_column_spill(self):
        cell = {'spill': [['2020-06-02', 117.1], ['2020-06-01', 118.5], ['2020-06-03', 'TP_NULL'], [43987.0, 119.0]]}
        self.assertEqual(xl.series_points(cell), [['2020-06-01', 118.5], ['2020-06-02', 117.1], ['2020-06-05', 119.0]])
        self.assertEqual(xl.series_points({'spill': None}), [])

    def test_holdings_with_headers(self):
        cell = {'spill': [['Holdings', 'Weight'], ['NVDA', 7.9], ['AAPL', 6.8], [{'err': 2042}, None]]}
        self.assertEqual(xl.holdings_rows(cell), [{'holding': 'NVDA', 'weight': 7.9}, {'holding': 'AAPL', 'weight': 6.8}])

    def test_add_in_missing_is_every_cell_name_error(self):
        self.assertTrue(xl.addin_missing([{'v': NAME_ERR}, {'v': NAME_ERR}]))
        self.assertFalse(xl.addin_missing([{'v': NAME_ERR}, {'v': 3.0}]))
        self.assertFalse(xl.addin_missing([]))


class Bridge(unittest.TestCase):
    def test_scratch_workbook_is_a_valid_empty_xlsx(self):
        with tempfile.TemporaryDirectory() as d:
            path = xl.ensure_bridge(Path(d) / 'b.xlsx')
            with zipfile.ZipFile(path) as zf:
                self.assertIn('xl/worksheets/sheet1.xml', zf.namelist())
            try:
                import openpyxl
            except ImportError:
                return
            self.assertEqual(openpyxl.load_workbook(path).sheetnames, ['YCharts'])

    def test_script_only_reads_and_touches_only_its_own_workbook(self):
        s = xl.SCRIPT
        self.assertIn('$w.FullName -ieq $req.path', s)
        self.assertNotRegex(s, r'(?i)\.SaveAs|\.Save\(|Remove-Item|Invoke-WebRequest|\.Close\(|\.Quit\(')
        self.assertIn('$wb.Saved = $true', s)


class FakeProcess:
    def __init__(self, reply):
        self.reply = reply

    async def communicate(self):
        return json.dumps(self.reply).encode('utf-8'), b''

    def kill(self):
        pass


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        patches = [mock.patch.object(xl, 'BRIDGE', base / 'bridge.xlsx'), mock.patch.object(xl, 'REQUEST', base / 'req.json'),
                   mock.patch.object(xl, 'available', return_value=True)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.sent = []

    def fake(self, reply):
        async def spawn(*args, **kwargs):
            self.sent.append((args, json.loads((Path(self.tmp.name) / 'req.json').read_text())))
            return FakeProcess(reply)
        return mock.patch.object(xl.asyncio, 'create_subprocess_exec', spawn)

    def test_points_grid(self):
        reply = {'ok': True, 'launched': True, 'cells': [{'r': 1, 'c': 1, 'v': 270.1}, {'r': 1, 'c': 2, 'v': 'TP_NULL'}]}
        with self.fake(reply):
            got, data = asyncio.run(xl.points(['AAPL'], ['price', 'beta']))
        self.assertEqual(got['AAPL']['price']['value'], 270.1)
        self.assertEqual(got['AAPL']['beta']['error'], 'no data')
        args, req = self.sent[0]
        self.assertEqual(args[0], 'powershell.exe')
        self.assertIn('-EncodedCommand', args)
        self.assertEqual([c['f'] for c in req['cells']], ['=YCP("AAPL","price",,,,"TP_NULL")', '=YCP("AAPL","beta",,,,"TP_NULL")'])

    def test_single_cell_reply_and_missing_add_in(self):
        with self.fake({'ok': True, 'cells': {'r': 1, 'c': 1, 'v': NAME_ERR}}), self.assertRaises(EngineError) as e:
            asyncio.run(xl.points(['AAPL'], ['price']))
        self.assertIn('YCharts tab', str(e.exception))

    def test_excel_not_installed(self):
        with self.fake({'ok': False, 'code': 'no-excel'}), self.assertRaises(EngineError) as e:
            asyncio.run(xl.points(['AAPL'], ['price']))
        self.assertIn('needs Microsoft Excel', str(e.exception))

    def test_status_through_excel(self):
        settings._cache = {'ycharts_source': 'excel'}
        self.addCleanup(lambda: setattr(settings, '_cache', None))
        with self.fake({'ok': True, 'launched': False, 'cells': [{'r': 1, 'c': 1, 'v': 270.1}]}):
            out = asyncio.run(ycharts.status(None, {}))
        self.assertTrue(out['ok'], out)
        self.assertIn('Excel add-in', out['message'])


if __name__ == '__main__':
    unittest.main()


class CrossCheck(unittest.TestCase):
    def test_dated_point_and_reading(self):
        from engine import crosscheck as cc
        self.assertEqual(xl.dated_point_formula('WMT', 'price'), '=YCP("WMT","price",,"Y",,"TP_NULL")')
        self.assertEqual(xl.dated_value({'spill': [['2026-01-31', 112.5]]}), (112.5, '2026-01-31'))
        self.assertEqual(xl.dated_value({'v': 'TP_NULL'}), (None, None))
        got = cc.parse_ycharts('divYield', 0.0042, '2026-11-19')  # Excel sends fractions
        self.assertAlmostEqual(got['divYield'][0], 0.0042)
        self.assertAlmostEqual(cc.parse_ycharts('expenseRatio', 0.0169, None)['expenseRatio'][0], 0.0169)
        self.assertAlmostEqual(cc.parse_ycharts('expenseRatio', 1.69, None)['expenseRatio'][0], 0.0169)  # percent units
        self.assertEqual(got['divYield'][2], 'trailing')
        self.assertEqual(cc.parse_ycharts('nav', None, None), {})

    def test_ycharts_only_asked_when_the_excel_route_is_on(self):
        from engine import crosscheck as cc
        asked = []

        async def one(ctx, source, key_id, field, hint):
            asked.append(source)
            return {'source': source, 'value': None, 'asOf': None, 'url': None, 'error': 'x'}
        for on, expect in ((False, False), (True, True)):
            asked.clear()
            with mock.patch.object(cc, '_one', one), mock.patch.object(cc, 'ycharts_on', return_value=on):
                asyncio.run(cc.gather(None, 'last', 'AAPL'))
            self.assertEqual('ycharts' in asked, expect)


class Calculations(unittest.TestCase):
    def test_resample_and_aggregate_formulas_follow_the_syntax_sheet(self):
        self.assertEqual(xl.series_formula('WMT', 'price', '2019-06-30', '2019-12-31', 'monthly'),
                         '=YCS("WMT","price","2019-06-30","2019-12-31",,,"Y","TP_NULL","monthly","last")')
        self.assertEqual(xl.calc_formula('WMT', 'price', '2019-05-31', '2020-05-31', 'max'),
                         '=YCS("WMT","price","2019-05-31","2020-05-31",,,"Y","TP_NULL",,,,"max")')
        with self.assertRaises(EngineError):
            xl.calc_formula('WMT', 'price', '2019-05-31', None, 'average"')
        with self.assertRaises(EngineError):
            xl.series_formula('WMT', 'price', '2019-05-31', None, 'hourly')


class ClientPrivacy(unittest.TestCase):
    """Owner's rule: YCharts Portfolios hold client portfolios and are never read."""

    def test_portfolio_tickers_are_refused_everywhere(self):
        for sid in ('P:1234', 'p:98765'):
            with self.assertRaises(EngineError):
                xl.check_id(sid)
            with self.assertRaises(EngineError):
                xl.guard_formula(f'=YCH("{sid}","Y",,,"Y")')
        with self.assertRaises(EngineError):
            ycharts._clean('companies', ['AAPL', 'P:1234'], ['price'])

    def test_account_formulas_never_reach_excel(self):
        for f in ('=YCU("client")', '=YCP("AAPL","price")+YCU("holding")', '=SUM(1,2)'):
            with self.assertRaises(EngineError):
                xl.guard_formula(f)
        self.assertTrue(xl.guard_formula('=YCP("AAPL","price",,,,"TP_NULL")'))

    def test_run_checks_before_starting_powershell(self):
        with mock.patch.object(xl, 'available', return_value=True), \
             mock.patch.object(xl.asyncio, 'create_subprocess_exec', side_effect=AssertionError('must not start')):
            with self.assertRaises(EngineError):
                asyncio.run(xl.run([{'r': 1, 'c': 1, 'f': '=YCU("client")'}]))

    def test_no_helper_file_builds_an_account_formula(self):
        engine = Path(__file__).resolve().parents[1] / 'engine'
        for f in engine.glob('*.py'):
            text = f.read_text(encoding='utf-8')
            self.assertNotRegex(text.replace('YCU (', '').replace("'YCU'", ''), r'=YCU\(|"YCU\(', f.name)


class Profiles(unittest.TestCase):
    def test_profile_codes_are_valid_and_portfolios_refused(self):
        for group in ('stock', 'fund'):
            for c in ycharts.PROFILE_INFO[group] + ycharts.PROFILE_FIGURES[group]:
                self.assertEqual(xl.check_code(c), c)
        self.assertEqual(ycharts.profile_id('vfiax', 'mutual_fund'), 'M:VFIAX')
        self.assertEqual(ycharts.profile_id('SPY', 'etf'), 'SPY')
        with self.assertRaises(EngineError):
            ycharts.profile_id('P:1234', 'stock')

    def test_profile_one_excel_pass(self):
        settings._cache = {'ycharts_source': 'excel'}
        self.addCleanup(lambda: setattr(settings, '_cache', None))
        n_info, n_fig = len(ycharts.PROFILE_INFO['stock']), len(ycharts.PROFILE_FIGURES['stock'])
        cells = [{'r': 1, 'c': 1, 'v': 'Apple designs phones.'}, {'r': 3, 'c': 1, 'v': 'Technology'}, {'r': 1, 'c': 2, 'v': 3.9e12}]
        sent = []

        async def fake_run(c, timeout=60):
            sent.append(c)
            return {'ok': True, 'cells': cells}

        class Ctx:
            async def cached(self, key, ttl, load, **kw):
                return await load()
        with mock.patch.object(xl, 'run', fake_run):
            out = asyncio.run(ycharts.profile(Ctx(), {'symbol': 'aapl', 'asset': 'stock'}))
        self.assertEqual(len(sent[0]), n_info + n_fig)
        self.assertEqual(out['info'], {'long_description': 'Apple designs phones.', 'sector': 'Technology'})
        self.assertEqual(out['figures'], {'market_cap': 3.9e12})
