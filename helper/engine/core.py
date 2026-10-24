"""Shared pieces for engine modules: the handler registry, errors, caching and price history."""
import asyncio
import datetime as dt
import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger('engine')
CACHE_PATH = Path.home() / '.trading-platform' / 'cache.db'

HANDLERS = {}

#: Background tasks started without anyone awaiting them. asyncio only keeps a weak reference to running tasks,
#: so a task nobody holds can be garbage-collected before it finishes; holding them here prevents that.
_BACKGROUND = set()


def background(coro):
    """Starts `coro` as a task that runs to the end even though nobody awaits it."""
    task = asyncio.get_running_loop().create_task(coro)
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)
    return task

BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'



def market_session(now=None):
    """US stock market session in New York time: 'open' (9:30-16:00), 'extended' (4:00-20:00) or 'closed'.
    Holidays are not known here, so a holiday reads as a normal weekday."""
    now = now or dt.datetime.now(ZoneInfo('America/New_York'))
    if now.weekday() >= 5:
        return 'closed'
    minutes = now.hour * 60 + now.minute
    if 570 <= minutes < 960:
        return 'open'
    if 240 <= minutes < 1200:
        return 'extended'
    return 'closed'

class EngineError(Exception):
    """A problem worth showing to the user as-is (e.g. "No data for XYZ")."""


def handler(name):
    """Registers an async function(ctx, msg) -> dict as the handler for browser requests of type `name`."""
    def register(fn):
        HANDLERS[name] = fn
        return fn
    return register


class DiskCache:
    """Keeps downloaded data between helper restarts so pages open instantly (~/.trading-platform/cache.db)."""

    def __init__(self, path=CACHE_PATH):
        self.path = path
        self._db = None
        # One connection shared by the event loop and the writer thread; the lock keeps their calls apart.
        self._lock = threading.Lock()

    def db(self):
        if self._db is None:
            self.path.parent.mkdir(exist_ok=True)
            self._db = sqlite3.connect(self.path, check_same_thread=False)
            self._db.execute('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, saved REAL, data TEXT)')
            self._db.commit()
        return self._db

    def get(self, key):
        try:
            with self._lock:
                row = self.db().execute('SELECT saved, data FROM cache WHERE key = ?', (key,)).fetchone()
        except sqlite3.Error:
            return None
        return (row[0], json.loads(row[1])) if row else None

    def put(self, key, saved, value):
        data = self.encode(key, value)
        if data is not None:
            self.write(key, saved, data)

    @staticmethod
    def encode(key, value):
        """The value as JSON text, or None (logged) when it can't be saved."""
        try:
            return json.dumps(value)
        except (TypeError, ValueError) as err:
            log.debug('Not cached %s: %s', key, err)
            return None

    def write(self, key, saved, data):
        """Saves already-encoded JSON text. Safe to call from a worker thread."""
        try:
            with self._lock:
                self.db().execute('INSERT OR REPLACE INTO cache VALUES (?, ?, ?)', (key, saved, data))
                self.db().commit()
        except sqlite3.Error as err:
            log.debug('Not cached %s: %s', key, err)


class EngineContext:
    def __init__(self, schwab_client, sec_contact='', news=None, disk=None):
        from . import settings
        self.schwab = schwab_client
        self.news = news
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(12, connect=6), follow_redirects=True, headers={'User-Agent': BROWSER_UA})
        # An email entered at the old terminal prompt moves into the Settings window's storage.
        if sec_contact and not settings.get('sec_contact'):
            settings.save({'sec_contact': sec_contact})
        self.sec_http = None
        self.sec_contact = ''
        self._sec_ua = None
        self.apply_settings()
        self.disk = disk or DiskCache()
        self._cache = {}
        self._locks = {}
        self._refreshing = set()

    def apply_settings(self):
        """(Re)reads settings that change how requests are made."""
        from . import settings
        self.sec_contact = settings.get('sec_contact')
        # The SEC asks automated tools to identify themselves with a contact email.
        sec_ua = f'TradingPlatform personal research {self.sec_contact}'.strip()
        if self.sec_http is not None and sec_ua == self._sec_ua:
            return  # same identity: keep the open client (and its connections) instead of leaking a new one
        self._sec_ua = sec_ua
        self.sec_http = httpx.AsyncClient(timeout=httpx.Timeout(20, connect=6), follow_redirects=True,
                                          headers={'User-Agent': sec_ua, 'Accept-Encoding': 'gzip, deflate'})

    async def cached(self, key, max_age, load, persist=False, stale_ok=False):
        """Returns a cached value younger than max_age seconds, otherwise awaits load() and caches it.

        persist keeps the value on disk across restarts. stale_ok returns an older saved value straight
        away and refreshes it in the background, so pages never wait on a slow website twice."""
        hit = self._cache.get(key)
        if hit is None and persist:
            hit = self.disk.get(repr(key))
            if hit:
                self._cache[key] = hit
        if hit and time.time() - hit[0] < max_age:
            return hit[1]
        if hit and stale_ok and time.time() - hit[0] < max_age + 7 * 86400:
            if key not in self._refreshing:
                self._refreshing.add(key)
                background(self._refresh(key, load, persist))
            return hit[1]
        return await self._load(key, load, persist, max_age)

    async def _load(self, key, load, persist, max_age=0):
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit and time.time() - hit[0] < max_age:
                return hit[1]
            value = await load()
            now = time.time()
            self._cache[key] = (now, value)
            if persist:
                # Writing (JSON + commit) can take tens of milliseconds for long histories: do it off the event
                # loop so live quotes and other requests keep flowing.
                # The JSON is made here, on the loop, so the value can't change while it's being written.
                data = self.disk.encode(repr(key), value)
                if data is not None:
                    await asyncio.to_thread(self.disk.write, repr(key), now, data)
            return value

    async def _refresh(self, key, load, persist):
        try:
            await self._load(key, load, persist)
        except Exception as err:
            log.info('Background refresh of %s failed: %s', key, err)
        finally:
            self._refreshing.discard(key)

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
