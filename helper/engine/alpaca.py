"""
Alpaca, used only as a free source of historical price bars (market data, never trading).

The owner pastes an Alpaca API key ID and secret into the Settings window (saved by the helper in
~/.trading-platform/settings.json). Alpaca's free Basic plan has full-market (SIP) bars back to 2016, except the
newest 15 minutes, so requests end at least 16 minutes ago. Schwab stays the main source for charts and quotes;
Alpaca fills in older intraday history Schwab doesn't keep (Schwab: about 48 days of 1-minute bars, about 9 months
of 5-30 minute bars).

Downloaded bars are kept in ~/.trading-platform/cache.db, so the next request only downloads what is missing
(older history before the saved range, or the newest bars after it).

Only the market-data host below is ever contacted. Alpaca's trading/account/order API is never called: this module
must not contain those hosts or paths (a test checks that).
"""
import asyncio
import datetime as dt
import logging
import time

from . import settings
from .core import EngineError, handler

log = logging.getLogger('engine.alpaca')

DATA_URL = 'https://data.alpaca.markets/v2/stocks/bars'
#: The platform's bar sizes -> Alpaca's names for them. Alpaca also takes '1h' style hours.
TIMEFRAMES = {
    '1m': '1Min', '5m': '5Min', '10m': '10Min', '15m': '15Min', '30m': '30Min',
    '1h': '1Hour', '1D': '1Day', '1W': '1Week',
}
BAR_SECONDS = {'1m': 60, '5m': 300, '10m': 600, '15m': 900, '30m': 1800, '1h': 3600, '1D': 86400, '1W': 7 * 86400}
#: Alpaca's full-market history starts in 2016.
EARLIEST = int(dt.datetime(2016, 1, 1, tzinfo=dt.timezone.utc).timestamp())
#: The free plan can't see the newest 15 minutes of full-market data.
SIP_DELAY = 16 * 60
#: 1-minute bars are huge (about 1,000 a day with extended hours): keep at most this many days of them.
MAX_SPAN_DAYS = {'1m': 400}
PAGE_LIMIT = 10000
#: Alpaca allows 200 history calls a minute on the free plan; stay a little under it.
MIN_CALL_GAP = 60 / 180
#: How long a saved range counts as up to date before the newest bars are checked again (seconds).
RECHECK = {'1m': 60, '5m': 120, '10m': 300, '15m': 300, '30m': 600, '1h': 900, '1D': 3600, '1W': 6 * 3600}
#: How far back Schwab keeps intraday bars (days, approximate). Older parts can come from Alpaca.
SCHWAB_INTRADAY_DAYS = {'1m': 48, '5m': 270, '10m': 270, '15m': 270, '30m': 270}

NO_KEYS = 'Add your Alpaca keys in Settings (free account at alpaca.markets) to use long price history.'
BAD_KEYS = 'Alpaca rejected the keys. Check the key ID and secret in Settings (copy them again from alpaca.markets).'

_pace_lock = None
_last_call = 0.0


def available():
    """True when both Alpaca keys are saved."""
    return bool(settings.get('alpaca_key_id') and settings.get('alpaca_secret'))


def _headers():
    if not available():
        raise EngineError(NO_KEYS)
    return {'APCA-API-KEY-ID': settings.get('alpaca_key_id'), 'APCA-API-SECRET-KEY': settings.get('alpaca_secret')}


def _seconds(value, default=None):
    """Unix seconds from a datetime, date, number or None."""
    if value is None:
        return default
    if isinstance(value, dt.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt.timezone.utc)
        return int(value.timestamp())
    if isinstance(value, dt.date):
        return int(dt.datetime(value.year, value.month, value.day, tzinfo=dt.timezone.utc).timestamp())
    return int(value)


def _rfc3339(seconds):
    return dt.datetime.fromtimestamp(seconds, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _parse_time(text):
    return int(dt.datetime.fromisoformat(str(text).replace('Z', '+00:00')).timestamp())


def parse_bar(raw):
    """One Alpaca bar ({t, o, h, l, c, v, ...}) -> the helper's bar shape, or None if unusable."""
    try:
        o, h, l, c = (float(raw[k]) for k in ('o', 'h', 'l', 'c'))
        t = _parse_time(raw['t'])
    except (KeyError, TypeError, ValueError):
        return None
    return {'time': t, 'open': o, 'high': max(h, o, c), 'low': min(l, o, c), 'close': c, 'volume': float(raw.get('v') or 0)}


def merge(*lists):
    """Bars from several lists in time order, one per time; a later list wins where times repeat."""
    by_time = {}
    for bars in lists:
        for b in bars or ():
            by_time[b['time']] = b
    return [by_time[t] for t in sorted(by_time)]


def merge_with_schwab(schwab_bars, alpaca_bars):
    """Schwab's bars, with Alpaca's filling only the time before Schwab's first bar (Schwab wins in the overlap)."""
    if not schwab_bars:
        return merge(alpaca_bars)
    first = schwab_bars[0]['time']
    older = [b for b in alpaca_bars or () if b['time'] < first]
    return merge(older, schwab_bars)


async def _pace():
    global _pace_lock, _last_call
    if _pace_lock is None:
        _pace_lock = asyncio.Lock()
    async with _pace_lock:
        wait = _last_call + MIN_CALL_GAP - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call = time.monotonic()


def _error_message(response):
    try:
        return str(response.json().get('message') or '')[:200]
    except Exception:
        return response.text[:200]


async def _get(ctx, params):
    """One market-data call, paced, with a single retry after a rate-limit reply."""
    headers = _headers()
    for attempt in range(2):
        await _pace()
        response = await ctx.http.get(DATA_URL, params=params, headers=headers)
        if response.status_code == 200:
            return response.json()
        if response.status_code in (401, 403):
            message = _error_message(response)
            if response.status_code == 403 and 'subscription' in message.lower():
                raise EngineError(f'Alpaca: your plan doesn’t include this data ({message}).')
            raise EngineError(BAD_KEYS)
        if response.status_code == 429 and attempt == 0:
            try:
                delay = min(30.0, float(response.headers.get('Retry-After') or 5))
            except ValueError:
                delay = 5.0
            await asyncio.sleep(delay)
            continue
        raise EngineError(f'Alpaca returned {response.status_code}: {_error_message(response)}')
    raise EngineError('Alpaca is busy (too many requests). Try again in a minute.')


async def _download(ctx, symbol, timeframe, start, end):
    """Every bar from start to end (unix seconds), following Alpaca's pages."""
    params = {
        'symbols': symbol, 'timeframe': TIMEFRAMES[timeframe], 'start': _rfc3339(start), 'end': _rfc3339(end),
        'limit': PAGE_LIMIT, 'adjustment': 'all', 'feed': 'sip', 'sort': 'asc',
    }
    out = []
    for _ in range(1000):  # a hard stop in case pages never end
        data = await _get(ctx, params)
        raw = data.get('bars') or []
        if isinstance(raw, dict):  # multi-symbol reply: {"bars": {"AAPL": [...]}}
            raw = raw.get(symbol) or []
        out.extend(b for b in (parse_bar(r) for r in raw) if b)
        token = data.get('next_page_token')
        if not token:
            break
        params = {**params, 'page_token': token}
    return out


_locks = {}


async def bars(ctx, symbol, timeframe, start, end=None):
    """Split- and dividend-adjusted bars for `symbol` from Alpaca (full market, back to 2016).

    timeframe: '1m', '5m', '10m', '15m', '30m', '1h', '1D' or '1W'. start/end: datetime, date or unix seconds
    (end defaults to now; it is moved back to 16 minutes ago, the free plan's limit). Returns a list of
    {time (UTC unix seconds), open, high, low, close, volume} in time order. Daily and weekly bars are stamped at
    midnight New York time (Alpaca's convention).

    Saved bars are reused: only the part before the saved range and the newest bars are downloaded."""
    symbol = str(symbol or '').strip().upper()
    if timeframe not in TIMEFRAMES:
        raise EngineError(f'Unsupported bar size {timeframe}')
    if not symbol:
        raise EngineError('No symbol given')
    if not available():
        raise EngineError(NO_KEYS)
    now = int(time.time())
    end = min(_seconds(end, now), now - SIP_DELAY)
    start = max(_seconds(start), EARLIEST)
    if timeframe in MAX_SPAN_DAYS:
        start = max(start, end - MAX_SPAN_DAYS[timeframe] * 86400)
    if start >= end:
        return []
    key = ('alpaca', symbol, timeframe)
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        saved = None
        hit = ctx._cache.get(key) or ctx.disk.get(repr(key))
        if hit:
            saved = hit[1]
        if saved:
            saved_bars = [_from_row(r) for r in saved['bars']]
            frm, to, checked = saved['from'], saved['to'], saved.get('checked', 0)
            parts = []
            if start < frm:
                parts.append(await _download(ctx, symbol, timeframe, start, frm))
                frm = start
            if end > to and now - checked >= RECHECK[timeframe]:
                # Download again from the newest saved bar: it may have been unfinished when saved.
                since = saved_bars[-1]['time'] if saved_bars else to
                parts.append(await _download(ctx, symbol, timeframe, min(since, to), end))
                to, checked = end, now
            if parts:
                saved_bars = merge(saved_bars, *parts)
                _store(ctx, key, frm, to, checked, saved_bars)
        else:
            saved_bars = await _download(ctx, symbol, timeframe, start, end)
            _store(ctx, key, start, end, now, saved_bars)
    return [b for b in saved_bars if start <= b['time'] <= end]


def _row(b):
    return [b['time'], b['open'], b['high'], b['low'], b['close'], b['volume']]


def _from_row(r):
    return {'time': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]}


def _store(ctx, key, frm, to, checked, saved_bars):
    value = {'from': frm, 'to': to, 'checked': checked, 'bars': [_row(b) for b in saved_bars]}
    now = time.time()
    ctx._cache[key] = (now, value)
    ctx.disk.put(repr(key), now, value)


async def fill_older(ctx, symbol, resolution, days, schwab_bars):
    """The chart's `history` reply, with intraday history older than Schwab keeps filled in from Alpaca.

    Only when Alpaca keys are saved and the request reaches further back than Schwab's bars. Any Alpaca problem
    is logged and Schwab's bars are returned unchanged, so charts never break because of it."""
    if resolution not in SCHWAB_INTRADAY_DAYS or not available() or not schwab_bars:
        return schwab_bars
    start = int(time.time()) - int(days) * 86400
    first = schwab_bars[0]['time']
    if first - start < 4 * 86400:  # Schwab already covers (nearly) the whole range: weekends/holidays aside
        return schwab_bars
    try:
        older = await bars(ctx, symbol, resolution, start, first)
    except Exception as err:
        log.info('Alpaca history for %s %s not added: %s', symbol, resolution, err)
        return schwab_bars
    merged = merge_with_schwab(schwab_bars, older)
    if len(merged) > len(schwab_bars):
        log.info('%s %s: added %d older bars from Alpaca', symbol, resolution, len(merged) - len(schwab_bars))
    return merged


@handler('alpaca.status')
async def status(ctx, msg):
    """Tests the saved keys with one tiny request. Never returns the keys."""
    if not available():
        return {'ok': False, 'keysSet': False, 'message': NO_KEYS, 'earliest': None}
    probe = 'SPY'
    params = {'symbols': probe, 'timeframe': '1Day', 'start': _rfc3339(EARLIEST), 'end': _rfc3339(EARLIEST + 10 * 86400),
              'limit': 1, 'adjustment': 'all', 'feed': 'sip'}
    try:
        data = await _get(ctx, params)
    except EngineError as err:
        return {'ok': False, 'keysSet': True, 'message': str(err), 'earliest': None}
    except Exception as err:  # network problems
        return {'ok': False, 'keysSet': True, 'message': f'Couldn’t reach Alpaca ({type(err).__name__}). Check the internet connection.', 'earliest': None}
    raw = data.get('bars') or []
    if isinstance(raw, dict):
        raw = raw.get(probe) or []
    first = parse_bar(raw[0]) if raw else None
    earliest = dt.datetime.fromtimestamp(first['time'], dt.timezone.utc).date().isoformat() if first else None
    return {'ok': True, 'keysSet': True, 'earliest': earliest,
            'message': 'Connected. Price history back to 2016 (minute, hourly, daily) is available.'}


def describe():
    """For the AI: whether Alpaca is connected and what it adds (no keys)."""
    return {'connected': available(), 'provides': 'Full-market price bars (1-minute to weekly) back to 2016, adjusted for splits and dividends; newest 15 minutes not included.',
            'use': 'Historical prices only. Never trading.'}
