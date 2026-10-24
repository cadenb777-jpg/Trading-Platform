"""Alpaca price history: pages, the saved cache, merging with Schwab, keys and the market-data-only rule.
No network and no real keys: Alpaca's replies are faked."""
import asyncio
import datetime as dt
import json
import os
import re
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import alpaca, core, settings  # noqa: E402

HOUR = 3600


def iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def raw_bar(t, price=100.0):
    return {'t': iso(t), 'o': price, 'h': price + 1, 'l': price - 1, 'c': price + 0.5, 'v': 1000, 'n': 10, 'vw': price}


class Resp:
    def __init__(self, status, data=None, headers=None):
        self.status_code, self._data, self.headers = status, data or {}, headers or {}
        self.text = json.dumps(self._data)

    def json(self):
        return self._data


class FakeAlpaca:
    """Answers GET /v2/stocks/bars from a fixed list of hourly bar times, in pages of `page` bars."""

    def __init__(self, times, page=3, status=200):
        self.times, self.page, self.status = sorted(times), page, status
        self.calls = []

    async def get(self, url, params=None, headers=None):
        self.calls.append({'url': url, 'params': dict(params), 'headers': dict(headers or {})})
        if self.status != 200:
            return Resp(self.status, {'message': 'forbidden'})
        start = alpaca._parse_time(params['start'])
        end = alpaca._parse_time(params['end'])
        inside = [t for t in self.times if start <= t <= end]
        offset = int(params.get('page_token') or 0)
        chunk = inside[offset:offset + self.page]
        nxt = str(offset + self.page) if offset + self.page < len(inside) else None
        return Resp(200, {'bars': {params['symbols']: [raw_bar(t) for t in chunk]}, 'next_page_token': nxt})


class Ctx:
    def __init__(self, http, path):
        self.http = http
        self.disk = core.DiskCache(Path(path))
        self._cache = {}


KEYS = {'alpaca_key_id': 'PKTESTKEYID12345', 'alpaca_secret': 'testsecretvalue0123456789abcdef'}


class AlpacaBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch.object(settings, 'SETTINGS_PATH', Path(self.tmp.name) / 'settings.json')
        patcher.start()
        self.addCleanup(patcher.stop)
        settings._cache = dict(KEYS)
        self.addCleanup(setattr, settings, '_cache', None)
        alpaca._locks.clear()
        alpaca._pace_lock = None
        gap = mock.patch.object(alpaca, 'MIN_CALL_GAP', 0)
        gap.start()
        self.addCleanup(gap.stop)
        # A fixed "now" well after the bars so the 16-minute limit never cuts them.
        self.now = int(dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc).timestamp())
        clock = mock.patch.object(alpaca.time, 'time', return_value=self.now)
        clock.start()
        self.addCleanup(clock.stop)

    def ctx(self, fake):
        return Ctx(fake, os.path.join(self.tmp.name, 'cache.db'))


class Pagination(AlpacaBase):
    def test_pages_are_joined_in_order(self):
        base = int(dt.datetime(2020, 3, 2, 14, tzinfo=dt.timezone.utc).timestamp())
        times = [base + k * HOUR for k in range(10)]
        fake = FakeAlpaca(times, page=3)
        bars = asyncio.run(alpaca.bars(self.ctx(fake), 'aapl', '1h', base - HOUR, base + 20 * HOUR))
        self.assertEqual([b['time'] for b in bars], times)
        self.assertEqual(len(fake.calls), 4)  # 3 + 3 + 3 + 1
        self.assertEqual(fake.calls[1]['params']['page_token'], '3')
        p = fake.calls[0]['params']
        self.assertEqual((p['symbols'], p['timeframe'], p['adjustment'], p['feed']), ('AAPL', '1Hour', 'all', 'sip'))
        self.assertTrue(fake.calls[0]['url'].startswith('https://data.alpaca.markets/'))
        self.assertEqual(set(bars[0]), {'time', 'open', 'high', 'low', 'close', 'volume'})

    def test_end_is_kept_out_of_the_newest_15_minutes(self):
        fake = FakeAlpaca([])
        asyncio.run(alpaca.bars(self.ctx(fake), 'SPY', '1m', self.now - 3600, self.now))
        self.assertLessEqual(alpaca._parse_time(fake.calls[0]['params']['end']), self.now - 15 * 60)

    def test_start_is_not_before_2016(self):
        fake = FakeAlpaca([])
        asyncio.run(alpaca.bars(self.ctx(fake), 'SPY', '1D', dt.date(2005, 1, 1), dt.date(2017, 1, 1)))
        self.assertEqual(alpaca._parse_time(fake.calls[0]['params']['start']), alpaca.EARLIEST)


class Caching(AlpacaBase):
    def test_saved_bars_are_reused_and_only_missing_parts_downloaded(self):
        base = int(dt.datetime(2021, 6, 1, 13, tzinfo=dt.timezone.utc).timestamp())
        times = [base + k * HOUR for k in range(100)]
        fake = FakeAlpaca(times, page=1000)
        path = os.path.join(self.tmp.name, 'cache.db')
        ctx = Ctx(fake, path)
        first = asyncio.run(alpaca.bars(ctx, 'MSFT', '1h', base + 40 * HOUR, base + 60 * HOUR))
        self.assertEqual(len(first), 21)
        self.assertEqual(len(fake.calls), 1)

        # Same range again (a fresh helper reading the disk cache): nothing downloaded.
        ctx2 = Ctx(fake, path)
        again = asyncio.run(alpaca.bars(ctx2, 'MSFT', '1h', base + 40 * HOUR, base + 60 * HOUR))
        self.assertEqual(again, first)
        self.assertEqual(len(fake.calls), 1)

        # Older history: only the part before the saved range is fetched.
        older = asyncio.run(alpaca.bars(ctx2, 'MSFT', '1h', base, base + 60 * HOUR))
        self.assertEqual(len(older), 61)
        call = fake.calls[-1]['params']
        self.assertEqual(alpaca._parse_time(call['start']), base)
        self.assertEqual(alpaca._parse_time(call['end']), base + 40 * HOUR)

        # Newer history: fetched from the newest saved bar (it may have been unfinished), merged without duplicates.
        newer = asyncio.run(alpaca.bars(ctx2, 'MSFT', '1h', base, base + 99 * HOUR))
        call = fake.calls[-1]['params']
        self.assertEqual(alpaca._parse_time(call['start']), base + 60 * HOUR)
        self.assertEqual([b['time'] for b in newer], times)
        self.assertEqual(len(fake.calls), 3)


    def test_newest_bars_are_not_asked_again_within_seconds(self):
        fake = FakeAlpaca([self.now - 2 * HOUR], page=1000)
        ctx = self.ctx(fake)
        asyncio.run(alpaca.bars(ctx, 'SPY', '1h', self.now - 86400))
        with mock.patch.object(alpaca.time, 'time', return_value=self.now + 30):
            asyncio.run(alpaca.bars(ctx, 'SPY', '1h', self.now - 86400))
        self.assertEqual(len(fake.calls), 1)
        with mock.patch.object(alpaca.time, 'time', return_value=self.now + 3600):
            asyncio.run(alpaca.bars(ctx, 'SPY', '1h', self.now - 86400))
        self.assertEqual(len(fake.calls), 2)


class SchwabMerge(unittest.TestCase):
    def test_schwab_wins_and_alpaca_fills_only_older_part(self):
        alp = [{'time': t, 'open': 1, 'high': 1, 'low': 1, 'close': 1, 'volume': 1} for t in (100, 200, 300, 400)]
        sch = [{'time': t, 'open': 2, 'high': 2, 'low': 2, 'close': 2, 'volume': 2} for t in (300, 400, 500)]
        merged = alpaca.merge_with_schwab(sch, alp)
        self.assertEqual([b['time'] for b in merged], [100, 200, 300, 400, 500])
        self.assertEqual([b['close'] for b in merged], [1, 1, 2, 2, 2])

    def test_merge_has_no_duplicate_times(self):
        a = [{'time': 1, 'close': 1}, {'time': 2, 'close': 1}]
        b = [{'time': 2, 'close': 2}, {'time': 3, 'close': 2}]
        self.assertEqual(alpaca.merge(a, b), [{'time': 1, 'close': 1}, {'time': 2, 'close': 2}, {'time': 3, 'close': 2}])


class FillOlder(AlpacaBase):
    def test_chart_history_gets_older_intraday_bars(self):
        recent_start = self.now - 200 * 86400
        sch = [{'time': recent_start + k * 1800, 'open': 5, 'high': 5, 'low': 5, 'close': 5, 'volume': 5} for k in range(3)]
        old_times = [self.now - 300 * 86400 + k * 1800 for k in range(4)] + [recent_start, recent_start + 1800]
        fake = FakeAlpaca(old_times, page=100)
        merged = asyncio.run(alpaca.fill_older(self.ctx(fake), 'NVDA', '30m', 365, sch))
        self.assertEqual(len(merged), 4 + 3)
        self.assertEqual([b['close'] for b in merged[-3:]], [5, 5, 5])
        self.assertEqual(fake.calls[0]['params']['timeframe'], '30Min')

    def test_no_keys_or_daily_leaves_schwab_alone(self):
        sch = [{'time': self.now - 10 * 86400, 'open': 1, 'high': 1, 'low': 1, 'close': 1, 'volume': 1}]
        fake = FakeAlpaca([self.now - 300 * 86400])
        self.assertIs(asyncio.run(alpaca.fill_older(self.ctx(fake), 'NVDA', '1D', 365, sch)), sch)
        settings._cache = {}
        self.assertIs(asyncio.run(alpaca.fill_older(self.ctx(fake), 'NVDA', '30m', 365, sch)), sch)
        self.assertEqual(fake.calls, [])

    def test_alpaca_failure_never_breaks_the_chart(self):
        sch = [{'time': self.now - 10 * 86400, 'open': 1, 'high': 1, 'low': 1, 'close': 1, 'volume': 1}]
        fake = FakeAlpaca([], status=403)
        self.assertIs(asyncio.run(alpaca.fill_older(self.ctx(fake), 'NVDA', '5m', 365, sch)), sch)


class KeysAndErrors(AlpacaBase):
    def test_missing_keys(self):
        settings._cache = {}
        self.assertFalse(alpaca.available())
        fake = FakeAlpaca([])
        with self.assertRaises(core.EngineError) as e:
            asyncio.run(alpaca.bars(self.ctx(fake), 'SPY', '1h', 0))
        self.assertIn('Add your Alpaca keys in Settings', str(e.exception))
        reply = asyncio.run(alpaca.status(self.ctx(fake), {}))
        self.assertFalse(reply['ok'])
        self.assertIn('Add your Alpaca keys in Settings', reply['message'])
        self.assertEqual(fake.calls, [])

    def test_bad_keys(self):
        fake = FakeAlpaca([], status=401)
        reply = asyncio.run(alpaca.status(self.ctx(fake), {}))
        self.assertFalse(reply['ok'])
        self.assertIn('Alpaca rejected the keys', reply['message'])
        with self.assertRaises(core.EngineError) as e:
            asyncio.run(alpaca.bars(self.ctx(FakeAlpaca([], status=403)), 'SPY', '1h', 0))
        self.assertIn('Alpaca rejected the keys', str(e.exception))

    def test_status_ok_never_returns_keys(self):
        fake = FakeAlpaca([alpaca.EARLIEST + 86400 * 3])
        reply = asyncio.run(alpaca.status(self.ctx(fake), {}))
        self.assertTrue(reply['ok'])
        self.assertEqual(reply['earliest'], '2016-01-04')
        text = json.dumps(reply)
        for secret in KEYS.values():
            self.assertNotIn(secret, text)
        self.assertEqual(fake.calls[0]['headers']['APCA-API-KEY-ID'], KEYS['alpaca_key_id'])

    def test_rate_limit_is_retried_once(self):
        class Busy(FakeAlpaca):
            async def get(self, url, params=None, headers=None):
                if not self.calls:
                    self.calls.append('busy')
                    return Resp(429, {'message': 'too many requests'}, {'Retry-After': '0'})
                return await super().get(url, params, headers)
        fake = Busy([])
        asyncio.run(alpaca.bars(self.ctx(fake), 'SPY', '1h', self.now - 86400 * 5))
        self.assertEqual(len(fake.calls), 2)


class MarketDataOnly(unittest.TestCase):
    def test_no_trading_hosts_or_order_paths(self):
        helper_dir = Path(__file__).resolve().parent.parent
        files = [helper_dir / 'engine' / 'alpaca.py', helper_dir / 'engine' / 'ai.py', helper_dir / 'schwab_helper.py']
        trading = re.compile(r'(?<![\w.-])(paper-)?api\.alpaca\.markets|/v2/orders|/v2/positions|/v2/account|broker-api|alpaca_trade_api|alpaca\.trading', re.I)
        for path in files:
            text = path.read_text(encoding='utf-8')
            self.assertIsNone(trading.search(text), f'{path.name} mentions an Alpaca trading endpoint')
        self.assertTrue(alpaca.DATA_URL.startswith('https://data.alpaca.markets/v2/stocks/'))

    def test_only_get_requests_to_the_data_host(self):
        text = (Path(alpaca.__file__)).read_text(encoding='utf-8')
        self.assertEqual(set(re.findall(r'\.http\.(\w+)\(', text)), {'get'})
        hosts = set(re.findall(r'https?://([\w.-]+)', text))
        self.assertEqual(hosts - {'alpaca.markets'}, {'data.alpaca.markets'})


class SettingsPrivacy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch.object(settings, 'SETTINGS_PATH', Path(self.tmp.name) / 'settings.json')
        patcher.start()
        self.addCleanup(patcher.stop)
        settings._cache = {}
        self.addCleanup(setattr, settings, '_cache', None)

    def test_keys_are_saved_but_never_sent_back(self):
        class C:
            def apply_settings(self):
                pass
        reply = asyncio.run(settings.set_settings(C(), {'alpacaKeyId': ' ' + KEYS['alpaca_key_id'], 'alpacaSecret': KEYS['alpaca_secret']}))
        self.assertTrue(reply['alpacaSet'])
        self.assertEqual(settings.get('alpaca_secret'), KEYS['alpaca_secret'])
        self.assertEqual(settings.get('alpaca_key_id'), KEYS['alpaca_key_id'])
        self.assertIn('alpaca_secret', settings.SECRET_KEYS)
        for out in (reply, asyncio.run(settings.get_settings(C(), {}))):
            text = json.dumps(out)
            for secret in KEYS.values():
                self.assertNotIn(secret, text)
        saved = json.loads((Path(self.tmp.name) / 'settings.json').read_text())
        self.assertEqual(saved['alpaca_secret'], KEYS['alpaca_secret'])

    def test_removing_and_bad_values(self):
        class C:
            def apply_settings(self):
                pass
        with self.assertRaises(core.EngineError):
            asyncio.run(settings.set_settings(C(), {'alpacaSecret': 'has spaces in it ok'}))
        asyncio.run(settings.set_settings(C(), {'alpacaKeyId': KEYS['alpaca_key_id'], 'alpacaSecret': KEYS['alpaca_secret']}))
        reply = asyncio.run(settings.set_settings(C(), {'alpacaSecret': ''}))
        self.assertFalse(reply['alpacaSet'])


class AiTool(AlpacaBase):
    def test_hourly_history_uses_alpaca_beyond_schwab(self):
        from engine import ai
        now = dt.datetime.fromtimestamp(self.now, dt.timezone.utc)
        recent = self.now - 100 * 86400
        recent -= recent % HOUR

        class Schwab:
            async def get_price_history_every_thirty_minutes(self, symbol, **kw):
                candles = [{'datetime': (recent + k * 1800) * 1000, 'open': 9, 'high': 9, 'low': 9, 'close': 9, 'volume': 1} for k in range(4)]
                return Resp(200, {'candles': candles})
        old = self.now - 700 * 86400
        old -= old % HOUR
        fake = FakeAlpaca([old + k * HOUR for k in range(5)], page=100)
        ctx = self.ctx(fake)
        ctx.schwab = Schwab()
        bars, sources = asyncio.run(ai.intraday_history(ctx, 'AMD', '1hour', 731, now))
        self.assertEqual(sources, ['Schwab', 'Alpaca'])
        self.assertEqual(len(bars), 5 + 2)  # four 30-minute Schwab bars make two hours
        self.assertEqual(fake.calls[0]['params']['timeframe'], '1Hour')
        sources_reply = asyncio.run(ai.t_get_data_sources(ctx, {}, []))
        self.assertTrue(sources_reply['alpaca']['connected'])
        self.assertNotIn(KEYS['alpaca_secret'], json.dumps(sources_reply))
        self.assertIn('get_data_sources', ai.TOOL_FUNCS)


if __name__ == '__main__':
    unittest.main()
