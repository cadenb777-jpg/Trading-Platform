"""Futures market page (helper/engine/futures_market.py): spec table, expiry/roll calendar, movers maths, board handler."""
import asyncio
import datetime as dt
import os
import statistics
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import flow, futures_market as fm, invest  # noqa: E402
from engine.core import EngineError  # noqa: E402

D = dt.date


class SpecTable(unittest.TestCase):
    def test_every_requested_market_is_listed_once(self):
        want = 'ES NQ YM RTY MES MNQ ZT ZF ZN ZB SR3 CL NG RB HO GC SI HG PL ZC ZS ZW ZL ZM LE HE KC SB CC 6E 6J 6B 6A 6C DX BTC MBT ETH VX'.split()
        self.assertEqual([s['root'] for s in fm.SPECS], want)

    def test_tick_value_is_tick_times_multiplier(self):
        # The CME/ICE/Cboe specs agree with themselves: one tick x dollars per point = the tick value.
        for s in fm.SPECS:
            self.assertAlmostEqual(s['tick'] * s['mult'], s['tickValue'], places=6, msg=s['root'])

    def test_known_specs(self):
        self.assertEqual((fm.SPEC['ES']['mult'], fm.SPEC['ES']['tickValue']), (50, 12.5))
        self.assertEqual((fm.SPEC['MNQ']['mult'], fm.SPEC['MNQ']['tickValue']), (2, 0.5))
        self.assertEqual((fm.SPEC['CL']['mult'], fm.SPEC['CL']['tickValue']), (1000, 10))
        self.assertEqual(fm.SPEC['ZN']['tickValue'], 15.625)
        self.assertEqual(fm.SPEC['GC']['size'], '100 troy ounces')

    def test_sectors_and_month_codes_are_valid(self):
        for s in fm.SPECS:
            self.assertIn(s['sector'], fm.SECTORS)
            self.assertTrue(s['months'] and set(s['months']) <= set(fm.MONTH_CODES), s['root'])
            self.assertTrue(s['cot'], s['root'])

    def test_every_expiry_rule_works_for_every_month(self):
        for s in fm.SPECS:
            for m in range(1, 13):
                d = fm.expiry(s['root'], 2027, m)
                self.assertTrue(fm.is_bday(d), (s['root'], m, d))
                self.assertLessEqual(fm.roll_date(s['root'], 2027, m), d)


class Calendar(unittest.TestCase):
    def test_equity_index_third_friday_and_roll_a_week_before(self):
        self.assertEqual(fm.expiry('ES', 2026, 12), D(2026, 12, 18))
        self.assertEqual(fm.roll_date('ES', 2026, 12), D(2026, 12, 10))  # the Thursday 8 days before

    def test_crude_and_natural_gas(self):
        self.assertEqual(fm.expiry('CL', 2026, 12), D(2026, 11, 20))
        self.assertEqual(fm.expiry('CL', 2027, 1), D(2026, 12, 21))  # the 25th is Christmas: 3 days before the 24th
        self.assertEqual(fm.expiry('NG', 2026, 12), D(2026, 11, 25))  # skips Thanksgiving

    def test_physical_delivery_rolls_before_first_notice(self):
        self.assertEqual(fm.expiry('GC', 2026, 12), D(2026, 12, 29))
        self.assertEqual(fm.first_notice('GC', 2026, 12), D(2026, 11, 30))
        self.assertEqual(fm.roll_date('GC', 2026, 12), D(2026, 11, 25))
        self.assertEqual(fm.expiry('ZN', 2026, 12), D(2026, 12, 21))
        self.assertEqual(fm.expiry('ZC', 2026, 12), D(2026, 12, 14))
        self.assertIsNone(fm.first_notice('ES', 2026, 12))

    def test_live_cattle_rolls_before_first_notice(self):
        self.assertEqual(fm.first_notice('LE', 2026, 12), D(2026, 12, 7))  # matches Webull's first_notice_date
        self.assertEqual(fm.first_notice('LE', 2027, 2), D(2027, 2, 8))
        self.assertEqual(fm.roll_date('LE', 2026, 12), D(2026, 12, 3))
        self.assertEqual(fm.expiry('LE', 2026, 12), D(2026, 12, 31))

    def test_fx_crypto_vix_and_sofr(self):
        self.assertEqual(fm.expiry('6E', 2026, 12), D(2026, 12, 14))
        self.assertEqual(fm.expiry('6C', 2026, 12), D(2026, 12, 15))
        self.assertEqual(fm.expiry('BTC', 2026, 10), D(2026, 10, 30))
        self.assertEqual(fm.expiry('VX', 2026, 11), D(2026, 11, 18))
        self.assertEqual(fm.expiry('SR3', 2026, 9), D(2026, 12, 15))  # after its 3-month reference quarter

    def test_contracts_start_with_the_one_held_now(self):
        self.assertEqual([c['code'] for c in fm.contracts('ES', D(2026, 10, 26), 3)], ['ESZ26', 'ESH27', 'ESM27'])
        self.assertEqual(fm.contracts('ES', D(2026, 12, 11), 1)[0]['code'], 'ESH27')  # rolled
        self.assertEqual(fm.contracts('SR3', D(2026, 10, 26), 1)[0]['code'], 'SR3U26')
        self.assertEqual(fm.contracts('GC', D(2026, 10, 26), 1)[0]['code'], 'GCZ26')
        self.assertEqual(fm.contracts('CL', D(2026, 10, 26), 1)[0]['code'], 'CLZ26')
        c = fm.contracts('GC', D(2026, 10, 26), 6)
        self.assertEqual(len(c), 6)
        self.assertEqual(c[0]['firstNotice'], '2026-11-30')


def closes_from(prices, start=D(2025, 9, 1)):
    out, day = [], start
    for p in prices:
        while day.weekday() >= 5:
            day += dt.timedelta(days=1)
        out.append([int(dt.datetime(day.year, day.month, day.day, 5, tzinfo=dt.timezone.utc).timestamp()), p])
        day += dt.timedelta(days=1)
    return out


class Maths(unittest.TestCase):
    def test_daily_sd_needs_20_moves(self):
        self.assertIsNone(fm.daily_sd(closes_from([100] * 10)))
        alt = closes_from([100 if i % 2 == 0 else 101 for i in range(61)])
        moves = [b[1] / a[1] - 1 for a, b in zip(alt, alt[1:])]
        self.assertAlmostEqual(fm.daily_sd(alt), statistics.stdev(moves))  # sample SD of the last 60 daily moves

    def test_returns(self):
        rows = closes_from([100 + i for i in range(300)])
        r = fm.returns(rows, today=D(2026, 10, 26))
        last = rows[-1][1]
        self.assertAlmostEqual(r['w1'], last / rows[-6][1] - 1)
        self.assertIsNotNone(r['m1'])
        jan = [c for t, c in rows if t < dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc).timestamp()][-1]
        self.assertAlmostEqual(r['ytd'], last / jan - 1)
        self.assertEqual(fm.returns([]), {'w1': None, 'm1': None, 'ytd': None})
        short = closes_from([100, 101, 102], start=D(2026, 10, 20))
        self.assertIsNone(fm.returns(short, today=D(2026, 10, 26))['ytd'])  # no close before January

    def test_movers_rank_by_size_of_move(self):
        rows = [{'root': 'ES', 'name': 'a', 'change': 0.01, 'sigma': 1.0}, {'root': 'NG', 'name': 'b', 'change': -0.05, 'sigma': -1.5},
                {'root': 'ZN', 'name': 'c', 'change': -0.004, 'sigma': -2.6}, {'root': 'VX', 'name': 'd', 'change': None, 'sigma': None}]
        m = fm.movers(rows, n=2)
        self.assertEqual([r['root'] for r in m['pct']], ['NG', 'ES'])
        self.assertEqual([r['root'] for r in m['sigma']], ['ZN', 'NG'])

    def test_sector_summary(self):
        rows = [{'root': 'ES', 'sector': 'Equity index', 'change': 0.01}, {'root': 'NQ', 'sector': 'Equity index', 'change': 0.03},
                {'root': 'VX', 'sector': 'Volatility', 'change': None}]
        s = {x['sector']: x for x in fm.sector_summary(rows)}
        self.assertAlmostEqual(s['Equity index']['change'], 0.02)
        self.assertEqual(s['Equity index']['best']['root'], 'NQ')
        self.assertIsNone(s['Volatility']['change'])
        self.assertEqual(s['Metals']['markets'], 0)

    def test_williams_note_and_curve_shape(self):
        self.assertIn('bullish', fm.williams_note(90))
        self.assertIn('bearish', fm.williams_note(10))
        self.assertIn('no extreme', fm.williams_note(50))
        self.assertEqual(fm.williams_note(None), '')
        self.assertEqual(fm.curve_shape([{'price': 100}, {'price': 101}]), 'contango')
        self.assertEqual(fm.curve_shape([{'price': 100}, {'price': None}, {'price': 98}]), 'backwardation')
        self.assertEqual(fm.curve_shape([{'price': 100}, {'price': 100.05}]), 'flat')
        self.assertIsNone(fm.curve_shape([{'price': 100}, {'price': None}]))


class Resp:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


class FakeSchwab:
    def __init__(self, status=200):
        self.status = status

    async def get_quotes(self, symbols):
        if self.status != 200:
            return Resp(self.status, {})
        data = {}
        if '/ES' in symbols:
            data['/ES'] = {'quote': {'lastPrice': 6800.0, 'closePrice': 6732.67, 'netChange': 67.33, 'openInterest': 2_000_000},
                           'reference': {'futureActiveSymbol': '/ESZ26', 'futureMultiplier': 50, 'futureExpirationDate': 1797638400000}}
        for s in symbols:
            if s.startswith('/ESZ26') or s.startswith('/ESH27'):
                data[s] = {'quote': {'lastPrice': 6800.0 if 'Z26' in s else 6860.0}}
        return Resp(200, data)

    async def get_price_history_every_day(self, symbol, **kw):
        if symbol != '/ES':
            return Resp(400, {})
        return Resp(200, {'candles': [{'datetime': t * 1000, 'close': c} for t, c in closes_from([6000 + 3 * i for i in range(300)])]})


class FakeCtx:
    def __init__(self, schwab):
        self.schwab = schwab
        self.http = None
        self._cache = {}

    async def cached(self, key, max_age, load, persist=False, stale_ok=False):
        if key not in self._cache:
            self._cache[key] = await load()
        return self._cache[key]


class HistoryRetry(unittest.TestCase):
    def test_empty_reply_waits_6_hours_error_5_minutes(self):
        fm._NO_HISTORY.clear()
        calls = []

        async def empty(ctx, s):
            calls.append(s)
            return []

        async def broken(ctx, s):
            calls.append(s)
            raise EngineError('Schwab returned 500 for /X')
        orig = invest.closes
        try:
            invest.closes = empty
            asyncio.run(fm._closes(None, '/A'))
            invest.closes = broken
            asyncio.run(fm._closes(None, '/B'))
            now = fm.time.time()
            self.assertAlmostEqual(fm._NO_HISTORY['/A'] - now, fm.EMPTY_RETRY, delta=5)
            self.assertAlmostEqual(fm._NO_HISTORY['/B'] - now, fm.ERROR_RETRY, delta=5)
            asyncio.run(fm._closes(None, '/A'))
            self.assertEqual(calls, ['/A', '/B'])  # not asked again yet
        finally:
            invest.closes = orig
            fm._NO_HISTORY.clear()


class Handlers(unittest.TestCase):
    def setUp(self):
        fm._NO_HISTORY.clear()
        self.cot = {'13874A': {'date': '2026-10-20', 'commNet': -10000.0, 'specNet': 5000.0, 'smallNet': 5000.0, 'openInterest': 2e6,
                               'commIndex': 85.0, 'specIndex': 20.0, 'smallIndex': 50.0}}

        async def fake_cot(ctx):
            return self.cot
        self._orig = fm.cot_latest
        fm.cot_latest = fake_cot

    def tearDown(self):
        fm.cot_latest = self._orig

    def test_board_prices_what_schwab_has_and_leaves_the_rest_unavailable(self):
        out = asyncio.run(fm.board(FakeCtx(FakeSchwab()), {}))
        rows = {r['root']: r for r in out['rows']}
        es = rows['ES']
        self.assertAlmostEqual(es['change'], 6800 / 6732.67 - 1)
        self.assertEqual(es['notional'], 6800 * 50)
        self.assertEqual(es['activeSymbol'], '/ESZ26')
        self.assertIsNotNone(es['sigma'])
        self.assertIsNotNone(es['w1'])
        self.assertIn('bullish', es['positioning']['note'])
        self.assertEqual(rows['MES']['positioning']['commIndex'], 85.0)  # micros read their parent market's COT
        gc = rows['GC']
        self.assertEqual((gc['price'], gc['change'], gc['sigma'], gc['w1'], gc['notional']), (None, None, None, None, None))
        self.assertFalse(gc['quoted'])
        self.assertIsNone(gc['positioning'])
        self.assertEqual(gc['contract'][:2], 'GC')
        self.assertEqual(out['movers']['pct'][0]['root'], 'ES')
        self.assertEqual(out['errors'], {})

    def test_board_reports_no_quotes_and_a_failed_cot(self):
        async def broken(ctx):
            raise RuntimeError('timeout')
        fm.cot_latest = broken
        out = asyncio.run(fm.board(FakeCtx(FakeSchwab(status=500)), {}))
        self.assertIn('quotes', out['errors'])
        self.assertIn('cot', out['errors'])
        self.assertTrue(all(r['price'] is None for r in out['rows'] if r['root'] != 'ES'))

    def test_expired_login_is_an_error(self):
        with self.assertRaises(EngineError):
            asyncio.run(fm.board(FakeCtx(FakeSchwab(status=401)), {}))

    def test_curve_uses_individual_contracts_or_says_unavailable(self):
        orig = fm.contracts
        fm.contracts = lambda root, today=None, count=6: orig(root, D(2026, 10, 26), count)
        try:
            out = asyncio.run(fm.curve(FakeCtx(FakeSchwab()), {'root': 'ES'}))
            self.assertTrue(out['available'])
            self.assertEqual(out['shape'], 'contango')
            self.assertEqual([p['price'] for p in out['points'][:3]], [6800.0, 6860.0, None])
            gold = asyncio.run(fm.curve(FakeCtx(FakeSchwab()), {'root': 'GC'}))
            self.assertFalse(gold['available'])
            self.assertIsNone(gold['shape'])
        finally:
            fm.contracts = orig
        with self.assertRaises(EngineError):
            asyncio.run(fm.curve(FakeCtx(FakeSchwab()), {'root': 'XX'}))

    def test_cot_latest_parses_one_cftc_request(self):
        fm.cot_latest = self._orig
        rows = [{'cftc_contract_market_code': '088691', 'report_date_as_yyyy_mm_dd': (dt.date(2026, 1, 6) + dt.timedelta(weeks=m)).isoformat() + 'T00:00:00.000',
                 'comm_positions_long_all': str(100 + m), 'comm_positions_short_all': '100', 'noncomm_positions_long_all': '50',
                 'noncomm_positions_short_all': str(40 + m), 'nonrept_positions_long_all': '10', 'nonrept_positions_short_all': '5',
                 'open_interest_all': '1000'} for m in range(1, 31)]
        seen = {}

        class Http:
            async def get(self, url, params=None):
                seen.update(params)
                class R:
                    def raise_for_status(self):
                        pass
                    def json(self):
                        return rows
                return R()
        ctx = FakeCtx(None)
        ctx.http = Http()
        out = asyncio.run(fm.cot_latest(ctx))
        self.assertIn("'088691'", seen['$where'])
        self.assertEqual(out['088691']['commNet'], 30)
        self.assertEqual(out['088691']['commIndex'], 100.0)
        self.assertEqual(out['088691']['specIndex'], 0.0)
        rows[:] = rows[:10]  # under 26 weeks: no index, like the detail panel
        ctx2 = FakeCtx(None)
        ctx2.http = Http()
        self.assertIsNone(asyncio.run(fm.cot_latest(ctx2))['088691']['commIndex'])
        self.assertEqual(flow.COT_URL.split('/')[2], 'publicreporting.cftc.gov')


if __name__ == '__main__':
    unittest.main()
