"""Shared pieces for engine modules: the handler registry, errors, caching and price history."""
import asyncio
import datetime as dt
import time

import httpx

HANDLERS = {}

BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'


class EngineError(Exception):
    """A problem worth showing to the user as-is (e.g. "No data for XYZ")."""


def handler(name):
    """Registers an async function(ctx, msg) -> dict as the handler for browser requests of type `name`."""
    def register(fn):
        HANDLERS[name] = fn
        return fn
    return register


class EngineContext:
    def __init__(self, schwab_client, sec_contact=''):
        self.schwab = schwab_client
        self.http = httpx.AsyncClient(timeout=20, follow_redirects=True, headers={'User-Agent': BROWSER_UA})
        # The SEC asks automated tools to identify themselves with a contact email.
        sec_ua = f'TradingPlatform personal research {sec_contact}'.strip()
        self.sec_http = httpx.AsyncClient(timeout=20, follow_redirects=True, headers={'User-Agent': sec_ua, 'Accept-Encoding': 'gzip, deflate'})
        self.sec_contact = sec_contact
        self._cache = {}
        self._locks = {}

    async def cached(self, key, max_age, load):
        """Returns a cached value younger than max_age seconds, otherwise awaits load() and caches it."""
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < max_age:
            return hit[1]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit and time.time() - hit[0] < max_age:
                return hit[1]
            value = await load()
            self._cache[key] = (time.time(), value)
            return value

    async def dividends(self, symbol):
        """Cash dividends per share by ex-date ({date: amount}) from Yahoo Finance's free chart data; {} if unavailable."""
        async def load():
            yahoo = symbol.replace('.', '-').replace('/', '-')
            response = await self.http.get(f'https://query1.finance.yahoo.com/v8/finance/chart/{yahoo}',
                                           params={'range': 'max', 'interval': '1mo', 'events': 'div'})
            response.raise_for_status()
            result = (response.json().get('chart', {}).get('result') or [{}])[0]
            out = {}
            for d in (result.get('events') or {}).get('dividends', {}).values():
                day = dt.datetime.fromtimestamp(d['date'], dt.timezone.utc).date()
                out[day] = out.get(day, 0.0) + float(d['amount'])
            return out
        try:
            return await self.cached(('dividends', symbol), 86400, load)
        except Exception:
            return None

    async def daily_bars(self, symbol, years=20):
        """Daily bars (split-adjusted) for up to `years` years: list of dicts with time (unix s) and OHLCV."""
        async def load():
            now = dt.datetime.now(dt.timezone.utc)
            response = await self.schwab.get_price_history_every_day(
                symbol, start_datetime=now - dt.timedelta(days=int(365.25 * years)), end_datetime=now)
            if response.status_code == 401:
                raise EngineError('Schwab login expired. Close the helper and start it again to log in.')
            if response.status_code != 200:
                raise EngineError(f'Schwab returned {response.status_code} for {symbol}')
            candles = response.json().get('candles', [])
            if not candles:
                raise EngineError(f'No price history for "{symbol}". Check the ticker.')
            return [{'time': c['datetime'] // 1000, 'open': c['open'], 'high': c['high'], 'low': c['low'],
                     'close': c['close'], 'volume': c.get('volume', 0)} for c in candles]
        return await self.cached(('daily', symbol, years), 6 * 3600, load)
