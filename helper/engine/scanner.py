"""
Market scanner: a background job inside the helper that scans every Nasdaq-100 stock every 5 minutes for swing-trade
setups on three time frames, using the strategies in strategies.py (pullback, mean reversion, 52-week-high breakout)
and the survivors of the strategy lab (lab.py).

Every setup comes with its exact plan (when to buy, the stop, the target, when to get out), the strategy's tested
record on all Nasdaq-100 stocks (after costs) and on this stock, a clustered random-entry test corrected for how many
strategies are tested (Holm), a robustness check (double costs, both halves of history), earnings dates inside the
holding period, news, insider buying and big options trades. Signals, not certainties; it never places orders.

The heavy maths (backtests, simulations, the lab, the weekly rule tests) runs in separate worker processes, so the
helper keeps sending live quotes while a scan is running.
"""
import asyncio
import concurrent.futures
import datetime as dt
import json
import logging
import math
import multiprocessing
import time
from collections import OrderedDict
from pathlib import Path
from zoneinfo import ZoneInfo

from . import alpaca, flow, lab, positioning, ruletests, sec
from . import strategies as st
from .core import EngineError, background, handler, market_session

log = logging.getLogger('engine.scanner')
EASTERN = ZoneInfo('America/New_York')

# Nasdaq-100 members (2025-26 list; the index is rebalanced every December, so edit this when it changes).
# GOOG is left out because GOOGL is the same company.
NASDAQ_100 = [
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'AVGO', 'TSLA', 'COST', 'NFLX', 'TMUS', 'ASML', 'CSCO', 'AMD', 'PEP',
    'LIN', 'AZN', 'ADBE', 'INTU', 'QCOM', 'TXN', 'ISRG', 'BKNG', 'AMGN', 'AMAT', 'PDD', 'HON', 'CMCSA', 'ARM', 'GILD',
    'ADP', 'PANW', 'LRCX', 'VRTX', 'MU', 'SBUX', 'ADI', 'MELI', 'KLAC', 'INTC', 'APP', 'CRWD', 'PLTR', 'MSTR', 'CTAS',
    'MDLZ', 'CEG', 'SNPS', 'CDNS', 'ORLY', 'MAR', 'FTNT', 'PYPL', 'DASH', 'REGN', 'ABNB', 'ADSK', 'WDAY', 'CSX', 'ROP',
    'CHTR', 'MRVL', 'NXPI', 'PCAR', 'AEP', 'CPRT', 'PAYX', 'TTD', 'FANG', 'ROST', 'KDP', 'MNST', 'AXON', 'FAST', 'TEAM',
    'ODFL', 'EA', 'XEL', 'DDOG', 'BKR', 'VRSK', 'CTSH', 'EXC', 'KHC', 'IDXX', 'CCEP', 'GEHC', 'ZS', 'CSGP', 'TTWO',
    'LULU', 'DXCM', 'ON', 'MCHP', 'CDW', 'WBD', 'BIIB', 'GFS', 'MDB', 'SHOP', 'TRI',
]
# A plain sector for each member (fixed like the list itself; edit at the December rebalance). Used only to show the
# total open risk per sector: the Nasdaq-100 is mostly tech, so several setups can be one sector bet.
_SECTOR_LISTS = {
    'Semiconductors': 'NVDA AVGO AMD ASML QCOM TXN AMAT LRCX MU ADI KLAC INTC ARM MRVL NXPI MCHP ON GFS',
    'Software': 'MSFT ADBE INTU PANW CRWD SNPS CDNS FTNT ADSK WDAY ROP TEAM DDOG ZS MDB PLTR APP TTD MSTR SHOP',
    'Hardware & IT services': 'AAPL CSCO CTSH CDW',
    'Communication': 'GOOGL META NFLX TMUS CMCSA CHTR EA TTWO WBD',
    'Consumer': 'AMZN TSLA COST PEP BKNG SBUX MELI PDD ABNB MAR ORLY ROST LULU DASH MDLZ KDP MNST KHC CCEP',
    'Health care': 'AZN ISRG AMGN GILD VRTX REGN IDXX DXCM BIIB GEHC',
    'Industrials': 'HON ADP CTAS CSX PCAR CPRT PAYX FAST ODFL VRSK AXON TRI',
    'Utilities, energy & materials': 'CEG AEP XEL EXC FANG BKR LIN',
    'Financials & real estate': 'PYPL CSGP',
}
SECTORS = {sym: name for name, syms in _SECTOR_LISTS.items() for sym in syms.split()}
UNIVERSE = NASDAQ_100
CONTEXT = ['QQQ']  # read for the market regime, not traded
NDX_COT = '209742'  # Nasdaq-100 E-mini futures: the COT market for Nasdaq stocks
# Schwab allows about 120 requests a minute for the whole app, and the charts share it: the scanner sends one
# request at a time, at most one every 0.7 s (about 85 a minute), so the owner's own charts always have room.
REQUEST_GAP = 0.7
_pace = asyncio.Lock()
_last_request = [0.0]
BAD_SYMBOL_RETRY = 24 * 3600
DAILY_DAYS = 15 * 366  # swing time frame: about 15 years of daily bars
SCHWAB_30M_DAYS = 270  # Schwab keeps about 9 months of 30-minute bars
ALPACA_30M_YEARS = 3  # Alpaca's free plan: 30-minute bars for about 3 years (alpaca.MAX_SPAN_DAYS)
HOURLY_FULL_DAYS = 730  # hourly setups are capped at B until the hourly record covers 2 years
DATA_DIR = Path.home() / '.trading-platform'
GRAVEYARD_PATH = DATA_DIR / 'lab_graveyard.json'
LAB_STATE_PATH = DATA_DIR / 'lab_survivors.json'
RULES_PATH = DATA_DIR / 'rule_tests.json'
RESULT_PATH = DATA_DIR / 'scan_result.json'  # the last finished scan, shown at once after a restart
_state = {'result': None, 'running': None, 'extra': set(), 'bad': {}}  # bad: symbol -> when Schwab rejected it


class SymbolError(Exception):
    """Schwab says it doesn't know this symbol (400/404: unknown, delisted, futures): skip it for a day."""


class TemporaryError(Exception):
    """Schwab couldn't answer right now (rate limit, server error): skip the symbol this scan only."""


class _PacedClient:
    """The Schwab client with every call going through the scanner's pacer."""

    def __init__(self, client):
        self._client = client

    def __getattr__(self, name):
        attr = getattr(self._client, name)
        if not callable(attr):
            return attr

        async def call(*args, **kwargs):
            return await _paced(lambda: attr(*args, **kwargs))
        return call


class _PacedContext:
    """The engine context as other modules see it (cache, http, settings), but with a paced Schwab client, so the
    scanner's options and quote requests share the same one-at-a-time limit as its price history."""

    def __init__(self, ctx):
        self._ctx = ctx
        self.schwab = _PacedClient(ctx.schwab)

    def __getattr__(self, name):
        return getattr(self._ctx, name)


def bad_symbols(now=None):
    """Watchlist symbols Schwab rejected in the last day (they are tried again after that)."""
    now = now or time.time()
    for sym, when in list(_state['bad'].items()):
        if now - when > BAD_SYMBOL_RETRY:
            del _state['bad'][sym]
    return set(_state['bad'])


async def _paced(call):
    async with _pace:
        wait = _last_request[0] + REQUEST_GAP - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            return await call()
        finally:
            _last_request[0] = time.monotonic()


def _remember(cache, key, value, limit):
    """Puts a value in a bounded cache, dropping the oldest entries (not everything) when it's full."""
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > limit:
        cache.popitem(last=False)
    return value


# ---------- Worker processes (so heavy maths never stalls live quotes) ----------

USE_PROCESSES = True  # tests switch this off to run everything in the same process
_pools = {}


def _worker_init():
    """Workers ignore Ctrl+C: the helper stops them itself (scanner.shutdown) when it exits."""
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)


def _pool(name):
    if name not in _pools:
        # 'spawn' on every system: a fresh interpreter, never a copy of the helper's threads and open sockets.
        _pools[name] = concurrent.futures.ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context('spawn'), initializer=_worker_init)
    return _pools[name]


async def _offload(name, fn_name, *args):
    """Runs scanner function `fn_name` in worker process `name` ('scan' or 'background'), with the lab's saved
    survivors registered there too. Falls back to a thread if the worker can't start or dies."""
    survivors = _lab_state()
    if USE_PROCESSES:
        try:
            return await asyncio.get_running_loop().run_in_executor(_pool(name), _job, survivors, fn_name, args)
        except concurrent.futures.process.BrokenProcessPool as err:
            log.info('Scanner worker %s stopped (%s): running in the helper instead', name, err)
            _pools.pop(name, None)
    return await asyncio.to_thread(_job, None, fn_name, args)


def _job(survivors, fn_name, args):
    if survivors is not None:
        lab.install(survivors)
    return globals()[fn_name](*args)


def shutdown():
    """Stops the worker processes (called when the helper exits)."""
    for p in list(_pools.values()):
        procs = list((getattr(p, '_processes', None) or {}).values())
        p.shutdown(wait=False, cancel_futures=True)
        for proc in procs:
            try:
                proc.terminate()
            except Exception:
                pass
    _pools.clear()


POSITIVE_WORDS = ('beat', 'beats', 'upgrade', 'upgraded', 'raises', 'raised', 'record', 'surge', 'surges', 'soar', 'jumps', 'rally', 'buyback', 'approval', 'wins', 'strong')
NEGATIVE_WORDS = ('miss', 'misses', 'downgrade', 'downgraded', 'cuts', 'cut', 'plunge', 'plunges', 'falls', 'slides', 'probe', 'lawsuit', 'recall', 'weak', 'warning', 'tumbles', 'sinks')


# ---------- Indicator maths (plain Python, so the scanner works even without numpy) ----------


def intraday_bias(bars5):
    """Next-30-minute lean from 5-minute bars (trend, VWAP, momentum, RSI) and how often it was right recently."""
    if len(bars5) < 60:
        return None
    closes = [b['close'] for b in bars5]
    e9, e21, r = st.ema(closes, 9), st.ema(closes, 21), st.rsi(closes)
    day = lambda t: dt.datetime.fromtimestamp(t, EASTERN).date()  # noqa: E731
    vwap, pv, vv, cur = [], 0.0, 0.0, None
    for b in bars5:
        if day(b['time']) != cur:
            cur, pv, vv = day(b['time']), 0.0, 0.0
        typical = (b['high'] + b['low'] + b['close']) / 3
        pv += typical * b['volume']
        vv += b['volume']
        vwap.append(pv / vv if vv else typical)

    def bias(i):
        s = (1 if e9[i] > e21[i] else -1) + (1 if closes[i] > vwap[i] else -1) + (1 if closes[i] > closes[i - 6] else -1)
        if r[i] is not None:
            s += 1 if r[i] > 55 else -1 if r[i] < 45 else 0
        return s

    right = n = 0
    for i in range(30, len(bars5) - 6):
        b = bias(i)
        if abs(b) >= 3:
            n += 1
            right += 1 if (closes[i + 6] - closes[i]) * b > 0 else 0
    now = bias(len(bars5) - 1)
    return {'score': now, 'direction': 'up' if now >= 3 else 'down' if now <= -3 else 'flat', 'winRate': right / n if n else None,
            'samples': n, 'vwap': vwap[-1], 'asOf': bars5[-1]['time']}


def headline_tone(items):
    score = 0
    for it in items:
        t = it.get('title', '').lower()
        score += sum(1 for w in POSITIVE_WORDS if f' {w} ' in f' {t} ') - sum(1 for w in NEGATIVE_WORDS if f' {w} ' in f' {t} ')
    return score


# ---------- Data ----------

def _candles(response, symbol):
    if response.status_code == 401:
        raise EngineError('Schwab login expired. Close the helper and start it again to log in.')
    if response.status_code in (400, 404):
        raise SymbolError(f'Schwab has no price history for {symbol}')
    if response.status_code != 200:
        raise TemporaryError(f'Schwab returned {response.status_code} for {symbol}')
    return [{'time': c['datetime'] // 1000, 'open': c['open'], 'high': c['high'], 'low': c['low'], 'close': c['close'], 'volume': c.get('volume', 0)}
            for c in response.json().get('candles', []) if c.get('close')]


async def _fetch(ctx, symbol, method, days):
    now = dt.datetime.now(dt.timezone.utc)
    response = await _paced(lambda: getattr(ctx.schwab, method)(symbol, start_datetime=now - dt.timedelta(days=days), end_datetime=now))
    return _candles(response, symbol)


async def _history(ctx, symbol, method, days, key, max_age):
    async def load():
        return await _fetch(ctx, symbol, method, days)
    # No stale_ok: signals must use fresh bars (a stale hit would also start uncounted background requests).
    return await ctx.cached((key, symbol), max_age, load, persist=True)


async def smart_money(ctx, r):  # ctx is the scanner's paced context
    """Institutional flow for a top setup: insiders' open-market buying and big options trades paid at the ask."""
    d = r['direction']

    def add(points, text):
        r['score'] += points
        r.setdefault('smartMoney', []).append({'text': text, 'points': points})

    try:
        ins = await sec.insiders(ctx, {'symbol': r['symbol']})
        buys = ins['summary']['buyValue']
        if buys > 100000:
            r['insiders'] = {'buyValue': buys, 'sellValue': ins['summary']['sellValue']}
            add(1 if d > 0 else 0, f"Insiders bought ${buys / 1e6:.1f}M on the open market recently")
    except Exception as err:
        log.info('Scanner insiders for %s failed: %s', r['symbol'], err)
    try:
        o = await flow.options(ctx, {'symbol': r['symbol']})
        calls = sum(u['premium'] for u in o['unusual'] if u['type'] == 'call' and u['side'] == 'at ask')
        puts = sum(u['premium'] for u in o['unusual'] if u['type'] == 'put' and u['side'] == 'at ask')
        if calls + puts > 250000:
            r['bigTrades'] = {'callsAtAsk': calls, 'putsAtAsk': puts}
            if calls > 2 * puts:
                add(1 if d > 0 else 0, f'Big call buying at the ask (${calls / 1e6:.1f}M vs ${puts / 1e6:.1f}M puts)')
            elif puts > 2 * calls:
                add(-1 if d < 0 else 0, f'Big put buying at the ask (${puts / 1e6:.1f}M vs ${calls / 1e6:.1f}M calls)')
    except Exception as err:
        log.info('Scanner big trades for %s failed: %s', r['symbol'], err)


def ny_today(now=None):
    return (now or dt.datetime.now(EASTERN)).date()


def bar_day(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).date()  # daily bars are stamped at US midnight (04-07 UTC)


def session_finished(now=None):
    """Has today's regular session ended (so today's daily bar is final)?"""
    now = now or dt.datetime.now(EASTERN)
    return now.weekday() >= 5 or now.hour * 60 + now.minute >= 16 * 60


def _until_tomorrow(now=None):
    """Cache age limit that makes a saved history expire at the next New York midnight (one saved row per symbol,
    replaced each day, instead of a new row per day that is never deleted)."""
    now = now or dt.datetime.now(EASTERN)
    nxt = dt.datetime.combine(now.date() + dt.timedelta(days=1), dt.time(), EASTERN)
    return max(60, min(20 * 3600, (nxt - now).total_seconds()))


OLD_KEY_PREFIXES = ("(('scan-daily-15y', '", "(('scan-daily', '", "(('scan-weekly', '")


def prune_old_cache(disk):
    """Deletes the dated history rows earlier versions saved once a day and never removed (about 45 MB a day)."""
    try:
        n = 0
        with disk._lock:  # (no VACUUM: it would hold the lock for long; SQLite reuses the freed space)
            con = disk.db()
            for prefix in OLD_KEY_PREFIXES:
                n += con.execute('DELETE FROM cache WHERE substr(key, 1, ?) = ?', (len(prefix), prefix)).rowcount
            con.commit()
        return n
    except Exception as err:
        log.info('Old scanner cache rows not removed: %s', err)
        return 0


async def daily_history(ctx, symbol):
    """About 15 years of daily bars, fetched once per day (the live quote supplies today's bar during the day)."""
    return await _history(ctx, symbol, 'get_price_history_every_day', DAILY_DAYS, 'scan-daily-15y', _until_tomorrow())


async def live_quotes(ctx, symbols):
    """Schwab's quotes for many symbols at once (one request per 100)."""
    out = {}
    for k in range(0, len(symbols), 100):
        try:
            resp = await ctx.schwab.get_quotes(symbols[k:k + 100])
            if resp.status_code == 200:
                out.update(resp.json() or {})
        except Exception as err:
            log.info('Scanner quotes failed: %s', err)
    return out


def today_bar(quote, template_time):
    """Today's (forming or final) daily bar from a Schwab quote, or None when the stock hasn't traded today."""
    q = (quote or {}).get('quote') or {}
    o, hi, lo, last = q.get('openPrice'), q.get('highPrice'), q.get('lowPrice'), q.get('lastPrice')
    when = q.get('tradeTime') or q.get('quoteTime')
    if not all(isinstance(x, (int, float)) and x > 0 for x in (o, hi, lo, last)) or not when:
        return None
    if dt.datetime.fromtimestamp(when / 1000, EASTERN).date() != ny_today():
        return None
    # Same time-of-day stamp as Schwab's daily bars (US midnight), on today's date.
    stamp = dt.datetime.combine(ny_today(), dt.datetime.fromtimestamp(template_time, dt.timezone.utc).time(), dt.timezone.utc)
    return {'time': int(stamp.timestamp()), 'open': o, 'high': max(hi, last), 'low': min(lo, last), 'close': last, 'volume': q.get('totalVolume') or 0}


def split_bars(history, quote):
    """(completed bars, bars including today's forming bar or None). Today's bar counts as completed only after 4 PM."""
    if not history:
        return [], None
    done = [b for b in history if bar_day(b['time']) < ny_today()]
    tb = today_bar(quote, history[-1]['time'])
    if tb is None:
        history_today = [b for b in history if bar_day(b['time']) == ny_today()]
        tb = history_today[-1] if history_today else None
    if tb is None:
        return done, None
    if session_finished():
        return done + [tb], None
    return done, done + [tb]


# ---------- Other time frames: hourly bars (short swing) and weekly bars (position) ----------

OPEN_MIN, CLOSE_MIN = 9 * 60 + 30, 16 * 60  # regular session, New York time


def _regular(t):
    t = dt.datetime.fromtimestamp(t, EASTERN)
    m = t.hour * 60 + t.minute
    return t.weekday() < 5 and OPEN_MIN <= m < CLOSE_MIN


def hourly_bars(bars30):
    """60-minute bars for the regular session (9:30, 10:30 ... 15:30, the last one half an hour) from 30-minute bars.
    Pre- and after-market bars are left out so every day has the same 7 bars."""
    out, key = [], None
    for b in bars30:
        t = dt.datetime.fromtimestamp(b['time'], EASTERN)
        m = t.hour * 60 + t.minute
        if t.weekday() >= 5 or not OPEN_MIN <= m < CLOSE_MIN:
            continue
        start_m = OPEN_MIN + (m - OPEN_MIN) // 60 * 60
        start = t.replace(hour=start_m // 60, minute=start_m % 60, second=0, microsecond=0)
        if (t.date(), start_m) != key:
            key = (t.date(), start_m)
            out.append({'time': int(start.timestamp()), 'open': b['open'], 'high': b['high'], 'low': b['low'], 'close': b['close'], 'volume': b.get('volume', 0)})
        else:
            cur = out[-1]
            cur['high'], cur['low'], cur['close'] = max(cur['high'], b['high']), min(cur['low'], b['low']), b['close']
            cur['volume'] += b.get('volume', 0)
    return out


def _live_price(quote):
    q = (quote or {}).get('quote') or {}
    last, when = q.get('lastPrice'), q.get('tradeTime') or q.get('quoteTime')
    return (last, when / 1000) if isinstance(last, (int, float)) and last > 0 and when else (None, None)


def split_hourly(hours, quote, now=None):
    """(finished hourly bars, bars with this hour still forming or None). During the session the forming hour is
    brought up to date with the live price, so every 5-minute scan sees where it stands now."""
    now = now or dt.datetime.now(EASTERN)
    if not hours:
        return [], None
    m = now.hour * 60 + now.minute
    if now.weekday() >= 5 or not OPEN_MIN <= m < CLOSE_MIN:
        return hours, None
    start_m = OPEN_MIN + (m - OPEN_MIN) // 60 * 60
    start = int(now.replace(hour=start_m // 60, minute=start_m % 60, second=0, microsecond=0).timestamp())
    done = [b for b in hours if b['time'] < start]
    cur = dict(hours[-1]) if hours[-1]['time'] == start else None
    last, when = _live_price(quote)
    if last and when and when >= start:
        cur = cur or {'time': start, 'open': last, 'high': last, 'low': last, 'close': last, 'volume': 0}
        cur['high'], cur['low'], cur['close'] = max(cur['high'], last), min(cur['low'], last), last
    return done, (done + [cur] if cur else None)


def _week(t):
    return bar_day(t + 12 * 3600).isocalendar()[:2]


def split_weekly(weeks, quote, now=None):
    """(finished weekly bars, bars with this week still forming or None). This week's bar is updated with today's
    live high, low and price; it counts as finished after Friday's close."""
    now = now or dt.datetime.now(EASTERN)
    if not weeks:
        return [], None
    this_week = now.date().isocalendar()[:2]
    done = [w for w in weeks if _week(w['time']) < this_week]
    cur = dict(weeks[-1]) if _week(weeks[-1]['time']) == this_week else None
    tb = today_bar(quote, weeks[-1]['time'])
    if tb:
        cur = cur or {'time': tb['time'], 'open': tb['open'], 'high': tb['high'], 'low': tb['low'], 'close': tb['close'], 'volume': 0}
        cur['high'], cur['low'], cur['close'] = max(cur['high'], tb['high']), min(cur['low'], tb['low']), tb['close']
    if not cur:
        return done, None
    if now.weekday() >= 5 or (now.weekday() == 4 and session_finished(now)):
        return done + [cur], None
    return done, done + [cur]


_thirty = {}  # symbol -> {'rows': [(time, o, h, l, c, v), ...], 'hourly': [...], 'months': set, 'bucket': str, 'alpacaTried': date}


def _month(t):
    return dt.datetime.fromtimestamp(t, EASTERN).strftime('%Y-%m')


def _row(b):
    return (b['time'], b['open'], b['high'], b['low'], b['close'], b['volume'])


def _bar(r):
    return {'time': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]}


async def thirty_minute_bars(ctx, symbol):
    """Every regular-session 30-minute bar ever seen for `symbol` (refreshed every 30 minutes). Schwab only keeps
    about 9 months, so each bar is saved for good in ~/.trading-platform/cache.db, in one entry per month (only the
    current month is rewritten). With Alpaca keys in Settings, about 3 years of older bars are added once (Alpaca's
    free plan limit). Disk: about 15 KB per stock per month, i.e. about 20 MB a year for the Nasdaq-100 (plus
    Alpaca's own copy of its download, about 1.2 MB per stock). In memory the bars are kept as compact tuples and the
    hourly bars built from them are kept ready, so a scan doesn't rebuild them."""
    mem = _thirty.get(symbol)
    if mem is None:
        stored = await asyncio.to_thread(ctx.disk.get, repr(('scan-30m-months', symbol)))
        months = set(stored[1]) if stored else set()
        rows = []
        for m in sorted(months):
            chunk = await asyncio.to_thread(ctx.disk.get, repr(('scan-30m', symbol, m)))
            if chunk:
                rows += [tuple(r) for r in chunk[1]]
        mem = _thirty[symbol] = {'rows': rows, 'hourly': None, 'months': months, 'bucket': None, 'alpacaTried': None}
    now = dt.datetime.now(EASTERN)
    bucket = f"{now:%Y-%m-%d %H}:{now.minute // 30}"
    if mem['bucket'] == bucket:
        return mem
    old = [_bar(r) for r in mem['rows']]
    days = SCHWAB_30M_DAYS if not old else min(SCHWAB_30M_DAYS, max(3, (time.time() - old[-1]['time']) / 86400 + 2))
    fresh = [b for b in await _fetch(ctx, symbol, 'get_price_history_every_thirty_minutes', days) if _regular(b['time'])]
    merged = alpaca.merge(old, fresh)  # newer download wins where times repeat
    if alpaca.available() and mem['alpacaTried'] != ny_today():
        mem['alpacaTried'] = ny_today()
        start = time.time() - ALPACA_30M_YEARS * 365 * 86400 + 86400
        if not merged or merged[0]['time'] > start + 7 * 86400:
            try:
                older = alpaca.regular_session(await alpaca.bars(ctx, symbol, '30m', start, merged[0]['time'] if merged else None))
                merged = alpaca.merge_with_schwab(merged, older)
            except Exception as err:
                log.info('Alpaca 30-minute history for %s not added: %s', symbol, err)
    changed = {_month(b['time']) for b in fresh} | ({_month(b['time']) for b in merged} - mem['months'])
    mem.update(rows=[_row(b) for b in merged], hourly=hourly_bars(merged), bucket=bucket)
    if changed:
        by_month = {}
        for b in merged:
            m = _month(b['time'])
            if m in changed:
                by_month.setdefault(m, []).append(list(_row(b)))
        stamp = time.time()
        for m, rows in by_month.items():
            await asyncio.to_thread(ctx.disk.put, repr(('scan-30m', symbol, m)), stamp, rows)
        mem['months'] |= set(by_month)
        await asyncio.to_thread(ctx.disk.put, repr(('scan-30m-months', symbol)), stamp, sorted(mem['months']))
    return mem


async def hourly_history(ctx, symbol):
    """Regular-session hourly bars from every 30-minute bar kept so far (refreshed every 30 minutes; the live price
    fills in between)."""
    return (await thirty_minute_bars(ctx, symbol))['hourly'] or []


async def weekly_history(ctx, symbol):
    """About 15 years of weekly bars, fetched once a day."""
    return await _history(ctx, symbol, 'get_price_history_every_week', 15 * 366, 'scan-weekly', _until_tomorrow())


async def dark_pool(ctx, s):
    """FINRA's daily short-sale volume for off-exchange trades (dark pools and internalisers): the 5-day share
    against its 40-day norm. Shown as a reading, not scored."""
    try:
        sv = await positioning.short_volume(ctx, {'symbol': s['symbol'], 'days': 40})
    except Exception as err:
        log.info('Scanner dark-pool data for %s failed: %s', s['symbol'], err)
        return
    a5, a40 = sv['avg5'], sv['avgAll']
    diff = a5 - a40
    s['darkPool'] = {'avg5': a5, 'avg40': a40, 'date': sv['latest']['date']}
    s['checks'].append({'label': 'Dark pool (FINRA off-exchange short volume)', 'ok': None,
                        'detail': f"5-day {a5:.0%} vs 40-day {a40:.0%} ({'unusually high: often heavy buying being filled' if diff > 0.05 else 'unusually low' if diff < -0.05 else 'normal'})"})


async def cot_rows_for(ctx, code):
    """COT report rows for a futures market, oldest first ([] if the CFTC can't be reached)."""
    try:
        return await positioning.cot_rows(ctx, code) or []
    except Exception as err:
        log.info('Scanner COT %s failed: %s', code, err)
        return []


async def market_for(ctx, symbol):
    if symbol in NASDAQ_100 and symbol not in positioning.SYMBOL_MARKET:
        return NDX_COT
    try:
        code, _ = await positioning.related_market(ctx, symbol)
        return code
    except Exception:
        return None


async def earnings_dates(ctx):
    """{symbol: 'YYYY-MM-DD'} for companies reporting in the next two weeks (Nasdaq's public earnings calendar)."""
    async def load():
        out, ok, failed = {}, 0, 0
        day = ny_today()
        for _ in range(16):
            if day.weekday() < 5:
                try:
                    resp = await ctx.http.get('https://api.nasdaq.com/api/calendar/earnings', params={'date': day.isoformat()},
                                              headers={'User-Agent': 'Mozilla/5.0 (trading-platform)', 'Accept': 'application/json'}, timeout=15)
                    if resp.status_code != 200:
                        raise ValueError(f'HTTP {resp.status_code}')
                    rows = ((resp.json() or {}).get('data') or {}).get('rows') or []
                    ok += 1
                    for r in rows:
                        sym = str(r.get('symbol', '')).upper()
                        if sym:
                            out.setdefault(sym, {'date': day.isoformat(), 'time': r.get('time', '')})
                except Exception as err:
                    failed += 1
                    log.info('Earnings calendar for %s failed: %s', day, err)
            day += dt.timedelta(days=1)
        if failed:
            # A day we couldn't read could hide an earnings date: report the calendar as unavailable, never as "none".
            raise ValueError(f'earnings calendar incomplete ({ok} days read, {failed} failed)')
        return out
    if time.time() - _state.get('earningsFailed', 0) < 3600:
        return None  # it failed recently: try again in an hour, not every scan
    try:
        return await ctx.cached(('earnings-2w', str(ny_today())), 12 * 3600, load, persist=True)
    except Exception as err:
        log.info('Earnings calendar unavailable: %s', err)
        _state['earningsFailed'] = time.time()
        return None


def add_sessions(day, n):
    """The date n trading days (weekdays) after `day`."""
    while n > 0:
        day += dt.timedelta(days=1)
        if day.weekday() < 5:
            n -= 1
    return day


# ---------- Analysis (pure; runs in a worker process) ----------

_bt_cache = OrderedDict()  # (symbol, strategy, horizon, last bar, costs) -> trades


def stock_trades(symbol, key, ind, hard=False):
    """A strategy's backtest trades on one stock (hard = double costs and stop slippage, for the robustness check)."""
    ck = (symbol, key, ind.get('horizon'), ind['bars'][-1]['time'] if ind['bars'] else None, hard)
    if ck in _bt_cache:
        _bt_cache.move_to_end(ck)
        return _bt_cache[ck]
    trades = st.trades_for(ind, key, costs=2 * st.COSTS, slip=st.STOP_SLIP) if hard else st.trades_for(ind, key)
    return _remember(_bt_cache, ck, trades, 6000)


def setup_state(ind_all, s, plan, d):
    """Where a signal from bar s stands now: ('ready' | 'waiting' | 'in trade', detail) or None if done/expired."""
    bars = ind_all['bars']
    last = len(bars) - 1
    if s == last:
        return 'ready', None
    t = st.simulate(ind_all, s, plan, d)
    if t is None:
        return ('waiting', None) if last - s < plan['validDays'] else None
    still_open = t['exit'] == last and t['reason'] == 'time' and t['bars'] < plan['maxHold']
    still_open = still_open or (t['exit'] == last and t['reason'] == 'time' and plan.get('exit') == 'chandelier' and t['bars'] < plan['maxHold'])
    return ('in trade', t) if still_open else None


SIGNAL_LOOKBACK = 25  # bars, for strategies without a time-frame entry (each real one uses its entry window + hold + 1)


def _lookback(key, strat, horizon):
    H = st.HORIZONS[horizon]
    if strat.get('lookback'):
        return strat['lookback']
    return H['valid'].get(key, 2) + H['maxHold'].get(key, SIGNAL_LOOKBACK) + 1 if key in H['valid'] else SIGNAL_LOOKBACK


def analyse_symbol(symbol, done, live, cot, strategy_keys, horizon='swing', daily=None):
    """All current setups for one stock, plus its backtests. `done` = completed bars of the time frame, `live` = with
    the bar still forming (today's daily bar, this hour's bar, this week's bar)."""
    if len(done) < 260:
        return {'symbol': symbol, 'setups': [], 'trades': {}}
    ind_done = st.prepare(done, cot, horizon, daily)
    ind_live = st.prepare(live, cot, horizon, daily) if live else None
    ind_now = ind_live or ind_done
    found, trades, hard = [], {}, {}
    n = len(done)
    for key in strategy_keys:
        strat = st.STRATEGIES[key]
        trades[key] = stock_trades(symbol, key, ind_done)
        hard[key] = stock_trades(symbol, key, ind_done, hard=True)
        picked = None
        # The newest signal whose trade is still waiting to trigger or still open (breakouts can run for months).
        for s in range(n - 1, max(0, n - 1 - _lookback(key, strat, horizon)), -1):
            if picked:
                break
            sig = strat['signal'](ind_done, s)
            plan = sig and strat['plan'](ind_done, s, sig['dir'])
            if not plan:
                continue
            res = setup_state(ind_now, s, plan, sig['dir'])
            if res is not None:
                picked = (ind_done, s, sig, plan, *res)
        if not picked and ind_live:  # otherwise one forming today: only final at the close
            sig = strat['signal'](ind_live, len(live) - 1)
            plan = sig and strat['plan'](ind_live, len(live) - 1, sig['dir'])
            if plan:
                picked = (ind_live, len(live) - 1, sig, plan, 'forming', None)
        if picked:
            src, s, sig, plan, state, trade = picked
            setup = build_setup(symbol, key, src, s, sig, plan, state, trade, ind_now)
            setup['new'] = state != 'forming' and s == n - 1  # signalled at the latest close
            found.append(setup)
    edge = st.cot_z_events(ind_done, st.HORIZONS[horizon]['maxHold']['weekly_swing'])
    return {'symbol': symbol, 'setups': found, 'trades': trades, 'hard': hard, 'edge': edge, 'len': n, 'series': st.series_of(done),
            'span': (done[-1]['time'] - done[0]['time']) / 86400}


def build_setup(symbol, key, ind, s, sig, plan, state, trade, ind_now):
    d = sig['dir']
    bars = ind['bars']
    now_bars = ind_now['bars']
    price = now_bars[-1]['close']
    a = ind['atr'][s]
    entry = plan['trigger'] if plan['entry'] == 'stop' else bars[s]['close']
    risk = abs(entry - plan['stop'])
    rr = abs(plan['target'] - entry) / risk if plan['target'] is not None and risk else None
    H = st.HORIZONS[ind.get('horizon', 'swing')]
    u, spb = H['unit'], H['sessionsPerBar']
    signal_day = bar_day(bars[s]['time']) + dt.timedelta(days=4 if u == 'week' else 0)  # a weekly bar is final on Friday
    valid_until = add_sessions(signal_day, max(0 if u == 'hour' else 1, math.ceil(plan['validDays'] * spb)))
    exit_by = add_sessions(signal_day, max(1, math.ceil((plan['validDays'] + plan['maxHold'] - 1) * spb)))
    hold_sessions = max(1, math.ceil(plan['maxHold'] * spb))
    z, cot = ind['z20'][s], ind['cot'][s]
    week_ago = now_bars[-6]['close'] if len(now_bars) > 6 else None
    status_text = {
        'forming': {'hour': 'Forming this hour: only confirmed if it still holds when the hour closes',
                    'day': 'Forming today: only confirmed if it still holds at the 4 PM close',
                    'week': "Forming this week: only confirmed if it still holds at Friday's close"}[u],
        'ready': (f"Ready: {'buy' if d > 0 else 'sell short'} if price trades {'above' if d > 0 else 'below'} {entry:.2f} by {valid_until:%a %b %d}"
                  if plan['entry'] == 'stop' else f"Ready: {'buy' if d > 0 else 'sell short'} at the next {u}'s open"),
        'waiting': f"Waiting for the trigger: {'above' if d > 0 else 'below'} {entry:.2f}, valid through {valid_until:%a %b %d}",
        'in trade': 'Triggered: the trade is on',
    }[state]
    strat = st.STRATEGIES[key]
    out = {
        'symbol': symbol, 'strategy': key, 'strategyName': H['names'].get(key, strat['name']), 'horizon': ind.get('horizon', 'swing'), 'unit': u, 'direction': d,
        'status': state, 'statusText': status_text, 'signalDate': signal_day.isoformat(), 'sector': SECTORS.get(symbol, 'Other'),
        'price': price, 'day': None, 'week': price / week_ago - 1 if week_ago else None,
        'reasons': sig['reasons'], 'score': 0, 'tier': None, 'lab': bool(strat.get('lab')),
        'plan': {
            'entryType': plan['entry'], 'trigger': entry, 'validUntil': valid_until.isoformat(), 'stop': plan['stop'],
            'target': plan['target'], 'targetNote': plan['targetNote'], 'maxHold': plan['maxHold'], 'exitBy': exit_by.isoformat(),
            'exitRule': plan['exitRule'], 'riskReward': rr, 'riskPct': risk / entry if entry else None, 'atr': a,
            'horizon': H['hold'], 'holdSessions': hold_sessions, 'trail': plan.get('exit') == 'chandelier' or bool(plan.get('trailAfterR')),
            'holdText': f"up to {plan['maxHold']} {u}{'s' if plan['maxHold'] != 1 else ''} (about {hold_sessions} trading day{'s' if hold_sessions != 1 else ''})",
        },
        'indicators': {'z': z, 'cot': cot, 'cotView': st.cot_view(cot, d), 'weekly': ind['weekly'][s], 'trendRule': st.TREND,
                       'trendText': st.TREND_RULES.get(st.TREND), 'rsi2': ind['rsi2'][s]},
        'levels': levels_around(ind_now, price),
    }
    if trade:
        out['trade'] = {'entry': trade['entry'], 'filled': bar_day(now_bars[trade['fill']]['time']).isoformat(),
                        'pnl': (price / trade['entry'] - 1) * d, 'daysHeld': trade['bars']}
    return out


def levels_around(ind, price):
    a = next((x for x in reversed(ind['atr']) if x), None)
    if not a:
        return {'supports': [], 'resistances': []}
    lv = st.swing_levels(ind['bars'], a)
    u = st.HORIZONS[ind.get('horizon', 'swing')]['unit']
    extra = [{'price': ind['sma50'][-1], 'label': f'50-{u} average'}, {'price': ind['sma200'][-1], 'label': f'200-{u} average'},
             {'price': ind['sma20'][-1], 'label': f'20-{u} average'}]
    pts = [{'price': x['price'], 'label': f"Swing level ({x['touches']} touch{'' if x['touches'] == 1 else 'es'})"} for x in lv]
    pts += [x for x in extra if x['price']]
    return {'supports': sorted((x for x in pts if x['price'] < price), key=lambda x: price - x['price'])[:4],
            'resistances': sorted((x for x in pts if x['price'] > price), key=lambda x: x['price'] - price)[:4]}


_random_entry_cache = OrderedDict()


def _cached(key, fn, limit=400):
    if key in _random_entry_cache:
        _random_entry_cache.move_to_end(key)
        return _random_entry_cache[key]
    return _remember(_random_entry_cache, key, fn(), limit)


def _robust(per_symbol, key, d, cluster, since=None):
    """The two robustness ticks from the stored backtests: still profitable at double costs plus stop slippage, and
    profitable in both halves of each stock's history (neither half's t below -1)."""
    keep = lambda t: t['dir'] == d and (since is None or t['time'] > since)  # noqa: E731
    hard = [t for r in per_symbol for t in r.get('hard', {}).get(key, []) if keep(t)]
    if since is None:  # each stock's history split at its midpoint
        first = [t for r in per_symbol if r.get('len') for t in r['trades'].get(key, []) if keep(t) and t['signal'] < r['len'] / 2]
        second = [t for r in per_symbol if r.get('len') for t in r['trades'].get(key, []) if keep(t) and t['signal'] >= r['len'] / 2]
    else:  # a lab strategy's forward record (all in the newest bars): split it at its median signal time
        fwd = sorted((t for r in per_symbol for t in r.get('trades', {}).get(key, []) if keep(t)), key=lambda t: t['time'])
        first, second = fwd[: len(fwd) // 2], fwd[len(fwd) // 2:]
    h, a, b = st.summarise(hard, cluster), st.summarise(first, cluster), st.summarise(second, cluster)
    return {'costs': bool(h['trades']) and (h['expectancy'] or 0) > 0, 'costsExpectancy': h['expectancy'],
            'halves': bool(a['trades'] and b['trades']) and (a['expectancy'] or 0) > 0 and (b['expectancy'] or 0) > 0
            and (a['tStat'] is None or a['tStat'] >= -1) and (b['tStat'] is None or b['tStat'] >= -1),
            'firstHalf': {k: a[k] for k in ('trades', 'expectancy', 'tStat')}, 'secondHalf': {k: b[k] for k in ('trades', 'expectancy', 'tStat')}}


def _record(key, horizon, by_sym, series, per_symbol, d, since=None):
    """One strategy side's pooled record: stats (after costs), a 1,000-run clustered random-entry test (cached for
    the day), Monte Carlo of the next 20 trades in % and in R, and the robustness ticks."""
    cluster = st.HORIZONS[horizon]['cluster']
    pooled = [t for ts in by_sym.values() for t in ts]
    ck = (key, horizon, d, str(ny_today()), len(pooled), round(sum(t['ret'] for t in pooled), 6))
    re = _cached(('re',) + ck, lambda: st.random_entry_test(by_sym, series))
    rob = _cached(('rob',) + ck, lambda: _robust(per_symbol, key, d, cluster, since))
    return {'stats': st.summarise(pooled, cluster), 'randomEntry': re, 'robust': rob,
            'monteCarlo': st.monte_carlo(pooled), 'monteCarloR': st.monte_carlo(pooled, key='r')}


def strategy_stats(per_symbol, horizon='swing'):
    """Each strategy's pooled record across all scanned stocks, separately for buys and sells (stocks drift upward,
    so sells face a headwind buys don't). Lab strategies count only trades signalled after they were first shown."""
    out = {}
    H = st.HORIZONS[horizon]
    series = {r['symbol']: r['series'] for r in per_symbol if r.get('series')}
    for key, strat in st.STRATEGIES.items():
        if strat.get('horizon_only') not in (None, horizon):
            continue
        since = strat.get('since')
        by_sym = {r['symbol']: [t for t in r['trades'].get(key, []) if since is None or t['time'] > since] for r in per_symbol if r.get('trades')}
        sides = {}
        for side, d in (('long', 1), ('short', -1)):
            if d in strat.get('sides', (1, -1)):
                sides[side] = _record(key, horizon, {k: [t for t in v if t['dir'] == d] for k, v in by_sym.items()}, series, per_symbol, d, since)
        name = H['names'].get(key, strat['name'])
        main = max(sides.values(), key=lambda r: r['stats']['trades'])
        out[key] = {'name': name, 'short': name if strat.get('lab') else name.split(' (')[0], 'horizon': H['hold'], 'stocks': len(by_sym), 'sides': sides,
                    'lab': bool(strat.get('lab')), 'description': strat.get('description'), 'spec': strat.get('spec'),
                    'forward': {'since': strat.get('sinceDate'), 'needed': lab.MIN_FORWARD_TRADES} if strat.get('lab') else None,
                    'stats': main['stats'], 'randomEntry': main['randomEntry'], 'monteCarlo': main['monteCarlo']}
    return out


def holm_family(family, horizon_stats, horizon):
    """Holm-adjusts every strategy side's random-entry p-value across ALL time frames (Tier A tests ~18 core records
    plus lab strategies at once; luck would pass about 1 in 10 of them at p <= 0.10 otherwise). `family` holds the
    latest p-values of the other time frames; core records not yet tested count as p = 1 (conservative)."""
    fam = {k: v for k, v in (family or {}).items() if k[0] != horizon}
    for key, info in horizon_stats.items():
        for side, rec in info['sides'].items():
            fam[(horizon, key, side)] = (rec['randomEntry'] or {}).get('p', 1.0)
    for h in HORIZON_ORDER:
        for key in st.SPEC:
            for side, d in (('long', 1), ('short', -1)):
                if d in st.STRATEGIES[key]['sides']:
                    fam.setdefault((h, key, side), 1.0)
    keys = list(fam)
    adj = dict(zip(keys, st.holm([fam[k] for k in keys])))
    for key, info in horizon_stats.items():
        for side, rec in info['sides'].items():
            if rec['randomEntry']:
                rec['randomEntry'] = {**rec['randomEntry'], 'pAdjusted': adj[(horizon, key, side)], 'family': len(keys)}
    return fam


def _cot_value_at(cot, day):
    k = -1
    for k2, (d, _) in enumerate(cot):
        if dt.date.fromisoformat(d) + dt.timedelta(days=3) <= day:
            k = k2
        else:
            break
    return cot[k][1] if k >= 0 else None


def grade(setup, stock, strat, earnings, context=None):
    """Tier A: the strategy side beats random entries across the Nasdaq-100 after the Holm correction for every
    strategy tested (profit factor 1.2+, adjusted p <= 0.10), it survives double costs and works in both halves of
    history, this stock's own record isn't losing, no earnings inside the holding period, the target is at least 1.5x
    the risk (pullbacks with a target), and COT agrees IF the COT edge study on your data passed (a missing COT
    reading then never counts as a pass). Lab strategies need 30 trades after they were first shown, and hourly
    setups 2 years of hourly history (or the same strategy passing on daily bars), before they can be A.
    B: the strategy side makes money and none of this setup's own checks is against it. C: the rest; `why` says in
    plain words what's missing."""
    ctx = context or {}
    s, d = setup, setup['direction']
    side = (strat.get('sides') or {}).get('long' if d > 0 else 'short') or strat  # judged on its own side's record
    ps, re = side['stats'], side.get('randomEntry') or {}
    rob = side.get('robust')
    word = 'buys' if d > 0 else 'sells'
    p_adj = re.get('pAdjusted', re.get('p'))
    edge = (ps['expectancy'] or 0) > 0 and (ps['profitFactor'] or 0) >= 1.2 and (p_adj if p_adj is not None else 1) <= 0.10
    positive = (ps['expectancy'] or 0) > 0
    stock_ok = stock['grade'] != 'failed'
    gate = ctx.get('cot')  # {'weeks', 'hi', 'lo', 'sign', 'series'} when the edge study passed, else None (reading only)
    cot_value, cot_view = s['indicators'].get('cot'), s['indicators'].get('cotView')
    if gate:
        cot_value = _cot_value_at(gate['series'], dt.date.fromisoformat(s['signalDate'])) if gate.get('series') else cot_value
        cot_view = st.cot_view(cot_value, d * gate['sign'], gate['hi'], gate['lo'])
        s['indicators']['cotGate'] = {'weeks': gate['weeks'], 'hi': gate['hi'], 'lo': gate['lo'], 'sign': gate['sign'], 'value': cot_value}
    cot_ok = (cot_view == 'agree') if gate else True
    e = (earnings or {}).get(s['symbol'])
    in_window = bool(e and s['signalDate'] <= e['date'] <= s['plan']['exitBy'])
    rr_ok = s['strategy'] != 'weekly_swing' or s['plan'].get('target', 0) is None or (s['plan']['riskReward'] or 0) >= 1.5
    lab_capped = bool(strat.get('lab')) and ps['trades'] < lab.MIN_FORWARD_TRADES
    short_cap = ctx.get('shortCap')
    s['earnings'] = {'date': e['date'], 'time': e.get('time', ''), 'inWindow': in_window} if e else ({'unknown': True} if earnings is None else None)
    z = s['indicators']['z']
    fam = re.get('family')
    checks = [
        {'label': f'Strategy edge on Nasdaq-100 {word}', 'ok': edge if ps['trades'] else None,
         'detail': (f"{ps['trades']} past trades ({ps.get('effectiveTrades', ps['trades'])} independent weeks), {round((ps['winRate'] or 0) * 100)}% winners, "
                    f"profit factor {ps['profitFactor']}, random-entry p = {re['p']:.2f}" + (f" ({p_adj:.2f} after adjusting for {fam} tests)" if fam else '')
                    if re.get('p') is not None else f"{ps['trades']} past trades (too few for the random test)") if ps['trades'] else 'No past trades to judge'},
        {'label': "This stock's record", 'ok': None if stock['grade'] == 'unproven' else stock_ok,
         'detail': f"{stock['trades']} trades, {round((stock['winRate'] or 0) * 100)}% winners ({stock['grade']})" if stock['trades'] else 'No past trades on this stock'},
        {'label': 'COT: commercial hedgers', 'ok': (None if cot_value is None and not gate else cot_ok) if gate else None,
         'detail': (f"Counts in the grade: your data's edge study passed ({gate['weeks']}-week index, {gate['hi']}/{gate['lo']}). Reading {cot_value:.0f}/100 ({cot_view})"
                    if gate and cot_value is not None else 'Counts in the grade, but there is no COT reading for this date' if gate
                    else f"Reading only (the edge study found no COT edge): Williams COT index {cot_value:.0f}/100" if cot_value is not None else 'Reading only; no COT data')},
        {'label': 'Z-score', 'ok': None if z is None or s['strategy'] == 'weekly_swing' or s.get('lab') else ((z <= -1) if d > 0 else (z >= 1)) if s['strategy'] == 'mean_reversion' else (abs(z) < 2.5 if s['strategy'] == 'breakout' else None),
         'detail': f"{z:+.2f} standard deviations from the 20-bar average" if z is not None else '—'},
        {'label': 'Earnings', 'ok': None if s['earnings'] is None or s['earnings'].get('unknown') else not in_window,
         'detail': (f"Reports {e['date']} {'(inside the holding period: skip or size down)' if in_window else '(after the planned exit)'}" if e
                    else 'Earnings calendar unavailable' if earnings is None else 'No earnings in the next two weeks')},
    ]
    if s['plan']['riskReward'] is not None:
        checks.append({'label': 'Reward:risk', 'ok': (s['plan']['riskReward'] >= 1.5) if s['strategy'] == 'weekly_swing' else None,
                       'detail': f"{s['plan']['riskReward']:.1f}x to the target"})
    if rob:
        checks.append({'label': 'Robust to costs and time', 'ok': rob['costs'] and rob['halves'], 'level': 'strategy',
                       'detail': f"{'still' if rob['costs'] else 'not'} profitable at double costs plus stop slippage; "
                                 f"{'profitable in both halves of history' if rob['halves'] else 'not profitable in both halves of history'}"})
    s['checks'] = checks
    why, why_codes = [], []

    def add(code, text):  # the code lets the Home page count the same reason together whatever its numbers
        why.append(text)
        why_codes.append(code)
    if not ps['trades']:
        add('untested', f"This strategy's {word} have no past trades yet to prove they work" if not strat.get('lab')
            else f"No trades yet since this lab strategy was first shown ({(strat.get('forward') or {}).get('since') or 'recently'}): it is judged only on new trades")
    elif not positive:
        add('losing', f"This strategy's {word} lost money in its Nasdaq-100 backtest ({(ps['expectancy'] or 0) * 100:+.2f}% per trade after costs)")
    elif not edge:
        add('unproven', f"This strategy's {word} don't clearly beat random entries yet (profit factor {ps['profitFactor']}, "
                        f"p = {p_adj:.2f}{' after adjusting for ' + str(fam) + ' tests' if fam else ''})" if p_adj is not None else "Too few past trades to test against random entries")
    if rob and positive and not rob['costs']:
        add('cost_sensitive', 'The edge disappears at double trading costs plus stop slippage')
    if rob and positive and not rob['halves']:
        add('unstable_halves', 'It did not make money in both halves of its history')
    if lab_capped and ps['trades']:
        add('lab_forward', f"Lab strategy: only {ps['trades']} of the {lab.MIN_FORWARD_TRADES} trades needed since it was first shown (capped at B)")
    if short_cap:
        add('short_history', f"Hourly record covers only {short_cap['days']:.0f} days (needs 2 years, or the same strategy passing on daily bars): capped at B")
    if gate and not cot_ok:
        add('cot' if cot_value is not None else 'cot_missing', f"Commercial hedgers (COT) don't confirm this direction (index {cot_value:.0f}/100)" if cot_value is not None
            else 'No COT reading for this date, and COT counts in the grade on your data')
    if in_window:
        add('earnings', f"Earnings on {e['date']} fall inside the holding period")
    if not rr_ok:
        add('rr', f"Target is only {(s['plan']['riskReward'] or 0):.1f}x the risk (needs 1.5x)")
    if s['status'] == 'forming':
        add('forming', 'The signal is still forming: it only counts once the bar closes')
    if not stock_ok:
        add('stock', f"This strategy has lost money on {s['symbol']} itself ({stock['trades']} past trades)")
    z_check = next(c for c in checks if c['label'] == 'Z-score')
    if z is not None and z_check['ok'] is False:
        add('z', f"Price isn't stretched enough for this setup (z-score {z:+.2f})" if s['strategy'] != 'breakout'
            else f"Price is already very stretched (z-score {z:+.2f})")
    s['why'], s['whyCodes'] = why, why_codes
    s['score'] += sum(2 if c['ok'] else -2 if c['ok'] is False else 0 for c in checks)
    robust_ok = rob is None or (rob['costs'] and rob['halves'])
    own_fail = (not stock_ok) or (gate and cot_value is not None and not cot_ok) or z_check['ok'] is False or in_window or not rr_ok
    if not stock_ok:
        s['tier'] = None
    elif edge and robust_ok and cot_ok and not in_window and rr_ok and s['status'] != 'forming' and not lab_capped and not short_cap:
        s['tier'] = 'A'
    elif positive and not own_fail:
        s['tier'] = 'B'  # the strategy makes money and none of this setup's own checks is against it
    else:
        s['tier'] = 'C'
    s['gradeBasis'] = ('forward record since ' + str((strat.get('forward') or {}).get('since'))) if strat.get('lab') else (
        f"{ps['trades']} backtest trades after costs, adjusted for {fam} tests" if fam else f"{ps['trades']} backtest trades after costs")
    s['stock'] = stock
    s['strategyStats'] = {'side': 'long' if d > 0 else 'short', 'trades': ps['trades'], 'effectiveTrades': ps.get('effectiveTrades'), 'winRate': ps['winRate'],
                          'profitFactor': ps['profitFactor'], 'expectancy': ps['expectancy'], 'randomEntryP': re.get('p'), 'randomEntryPAdjusted': p_adj}


def compute(rows, strategy_keys, earnings, horizon='swing', family=None, cot_rows=None, swing_pass=None, history_days=None, daily=None):
    """CPU part of a scan for one time frame: analyse every stock, pool the backtests, grade the setups. Returns
    (summary, stats, setups, filtered); summary carries the Holm family and the COT study for the caller."""
    strategy_keys = [k for k in strategy_keys if k in st.STRATEGIES and st.STRATEGIES[k].get('horizon_only') in (None, horizon)]
    daily = daily or {}
    per_symbol = [analyse_symbol(sym, done, live, cot, strategy_keys, horizon, daily.get(sym)) for sym, done, live, cot in rows]
    stats = strategy_stats(per_symbol, horizon)
    fam = holm_family(family, stats, horizon)
    events = [e for r in per_symbol for e in r.get('edge', [])]
    study = None
    if cot_rows:
        study = _cached(('cot', horizon, str(ny_today()), len(events), len(cot_rows)), lambda: st.cot_study(events, cot_rows))
    gate = None
    if study and study['passed']:
        c = study['chosen']
        gate = {**c, 'series': st.cot_index(cot_rows, c['weeks'])}
    if history_days is None and horizon == 'short':
        spans = sorted(r['span'] for r in per_symbol if r.get('span'))
        history_days = spans[len(spans) // 2] if spans else 0
    setups, filtered = [], []
    for r in per_symbol:
        for s in r['setups']:
            past = [t for t in r['trades'].get(s['strategy'], []) if t['dir'] == s['direction']]  # this side only
            stock = st.summarise(past, st.HORIZONS[horizon]['cluster'])
            short_cap = None
            if horizon == 'short' and (history_days or 0) < HOURLY_FULL_DAYS and not (swing_pass or {}).get((s['strategy'], s['direction'])):
                short_cap = {'days': history_days or 0}
            grade(s, stock, stats[s['strategy']], earnings, {'cot': gate, 'shortCap': short_cap})
            s['monteCarlo'] = st.monte_carlo(past)
        # Two strategies can disagree on one stock. Say so on both cards.
        for s in r['setups']:
            other = next((o for o in r['setups'] if o is not s and o['direction'] != s['direction']), None)
            if other:
                s['conflict'] = {'strategy': other['strategyName'], 'direction': other['direction'], 'tier': other.get('tier')}
                s['checks'].append({'label': 'Other strategies', 'ok': None,
                                    'detail': f"{other['strategyName']} says {'BUY' if other['direction'] > 0 else 'SELL'} on this stock: mixed signals, so use a smaller size or wait"})
            (setups if s['tier'] else filtered).append(s)
    tested = sum(1 for r in per_symbol for k, ts in r.get('trades', {}).items() if len(ts) >= 5)
    summary = {'family': fam, 'edge': study, 'historyDays': history_days, 'stockTests': tested,
               'labForward': {k: v['sides'][next(iter(v['sides']))]['stats'] for k, v in stats.items() if v.get('lab')}}
    return summary, stats, setups, filtered


def swing_passes(stats):
    """(strategy, direction) pairs whose daily record passes the edge test: hourly setups of those may be A even with
    less than 2 years of hourly history."""
    out = {}
    for key, info in (stats or {}).items():
        for side, rec in info['sides'].items():
            re = rec['randomEntry'] or {}
            out[(key, 1 if side == 'long' else -1)] = (rec['stats']['expectancy'] or 0) > 0 and re.get('pAdjusted', re.get('p', 1)) <= 0.10
    return out


RW_RUNS = 1000  # shuffled histories per random-walk test (owner's request)
_rw_cache = OrderedDict()
_rw_jobs = {}  # cache key -> (done, cot) waiting for the worker
_rw_worker = None


def random_walk_for(symbol, key, done, cot, horizon='swing'):
    """Per-stock random-walk test for a current setup: 1,000 shuffled histories (slow), so it runs in the background
    one stock at a time and is cached for the day. Returns the result, or a 'pending' marker the first time; the
    card fills in when it's done (needs 5+ past trades to mean anything)."""
    global _rw_worker
    ck = (symbol, key, horizon, bar_day(done[-1]['time']))
    if ck in _rw_cache:
        return _rw_cache[ck]
    _rw_jobs.setdefault(ck, (done, cot))
    if _rw_worker is None or _rw_worker.done():
        _rw_worker = background(_run_rw_jobs())
    return {'pending': True, 'runs': RW_RUNS}


def rw_work(done, cot, key, runs, horizon):
    return st.random_walk_test(done, cot, key, runs, 11, horizon)


async def _run_rw_jobs():
    while _rw_jobs:
        ck, (done, cot) = next(iter(_rw_jobs.items()))
        try:
            res = await _offload('background', 'rw_work', done, cot, ck[1], RW_RUNS, ck[2])
        except Exception as err:
            log.info('Random-walk test for %s failed: %s', ck[0], err)
            res = None
        _remember(_rw_cache, ck, res, 500)
        _rw_jobs.pop(ck, None)
        # Show it straight away on the last published scan too.
        result = _state.get('result') or {}
        for s in [x for h in (result.get('horizons') or {}).values() for x in h.get('setups', [])] + result.get('setups', []):
            if (s['symbol'], s['strategy'], s.get('horizon', 'swing')) == ck[:3] and (s.get('randomWalk') or {}).get('pending'):
                s['randomWalk'] = res


# ---------- The scan ----------

SCAN_EVERY = 300  # the owner wants a fresh scan every 5 minutes

HORIZON_ORDER = ('swing', 'position', 'short')
_lab = {}  # horizon -> {'week', 'result', 'running', 'task'}
_rules = {}  # horizon -> {'week', 'running', 'task'}
_family = {}  # (horizon, strategy, side) -> latest random-entry p (for the Holm correction across time frames)
MARKET_MA = 200


def market_trend_by_date(qqq_bars):
    """The Nasdaq-100's trend for each date, known before that date's session: +1 if the PREVIOUS close was above
    its 200-day average, -1 if below (so hourly bars of a day never see that day's close)."""
    closes = [b['close'] for b in qqq_bars]
    sma = st.sma(closes, MARKET_MA)
    out = {}
    for i in range(1, len(qqq_bars)):
        if sma[i - 1] is not None:
            out[bar_day(qqq_bars[i]['time'])] = 1 if closes[i - 1] > sma[i - 1] else -1
    return out


def _lab_state():
    if '_survivors' not in _state:
        _state['_survivors'] = lab.load_state(LAB_STATE_PATH)
        lab.install(_state['_survivors'])
    return _state['_survivors']


def _save_lab_state():
    try:
        lab.save_json_atomic(LAB_STATE_PATH, _state['_survivors'])
    except OSError as err:
        log.info('Lab survivors not saved: %s', err)


def _save_graveyard(horizon, result):
    """Keeps every rejected hypothesis (latest verdict per rule combination) so the record of what was tried and
    failed survives restarts. Written to a temporary file first, then renamed (a crash never corrupts it)."""
    try:
        try:
            data = json.loads(GRAVEYARD_PATH.read_text()) if GRAVEYARD_PATH.exists() else {}
        except ValueError:
            data = {}
        dead = data.setdefault(horizon, {})
        for r in result['results']:
            if not r['validated']:
                dead[r['id']] = {'name': r['name'], 'date': str(ny_today()), 'reasons': r['rejected'], 'test': r['test']['expectancy'], 'p': r['pAdjusted']}
        if len(dead) > 500:
            for k in sorted(dead, key=lambda k: dead[k]['date'])[: len(dead) - 500]:
                del dead[k]
        lab.save_json_atomic(GRAVEYARD_PATH, data)
        return len(dead)
    except Exception as err:
        log.info('Lab graveyard not saved: %s', err)
        return None


def lab_work(rows, horizon, market, daily):
    inds = {sym: st.prepare(done, cot, horizon, (daily or {}).get(sym)) for sym, done, _, cot in rows if len(done) >= 260}
    return lab.run(inds, market, horizon)


def rules_work(rows, horizon, regimes, cot_rows, daily):
    inds = {sym: st.prepare(done, None, horizon, (daily or {}).get(sym)) for sym, done, _, cot in rows if len(done) >= 260}
    return ruletests.run(inds, horizon, regimes, cot_rows)


def week_of(t):
    y, w, _ = bar_day(t).isocalendar()
    return f'{y}-W{w:02d}'


async def _run_lab(horizon, rows, stamp, market, daily):
    """The strategy lab for one time frame, once a week, in a worker process. New survivors are added with today's
    newest bar as their first-shown time; existing ones stay as they are."""
    state = _lab.setdefault(horizon, {})
    try:
        result = await _offload('background', 'lab_work', rows, horizon, market, daily)
        survivors = _lab_state()
        result['added'] = lab.add_survivors(survivors, horizon, result, stamp)
        survivors.setdefault('_runs', {})[horizon] = week_of(stamp)
        _save_lab_state()
        lab.install(survivors)
        result['graveyard'] = _save_graveyard(horizon, result)
        result['ran'] = time.time()
        state['result'] = result
        latest = (_state.get('result') or {}).get('horizons', {}).get(horizon)
        if latest is not None:
            latest['lab'], latest['labRunning'] = _lab_summary(horizon), False
    except Exception as err:
        log.info('Strategy lab (%s) failed: %s', horizon, err)
        try:  # don't try again every 5 minutes: next week
            _lab_state().setdefault('_runs', {})[horizon] = week_of(stamp)
            _save_lab_state()
        except Exception:
            pass
    finally:
        state['running'] = False


def _lab_summary(horizon):
    """The latest lab run plus the saved survivors of this time frame (with their forward records filled in by the
    scan)."""
    res = dict(_lab.get(horizon, {}).get('result') or {})
    survivors = [v for v in (_lab_state().get(horizon) or {}).values()]
    if not res and not survivors:
        return None
    res['survivors'] = survivors
    res['minForward'] = lab.MIN_FORWARD_TRADES
    return res


def _load_rules():
    if '_rules' not in _state:
        try:
            _state['_rules'] = json.loads(RULES_PATH.read_text()) if RULES_PATH.exists() else {}
        except (OSError, ValueError):
            _state['_rules'] = {}
    return _state['_rules']


async def _run_rule_tests(horizon, rows, regimes, cot_rows, daily, week):
    """The rule tests (ruletests.py) on your own data, once a week per time frame, saved for the Setups page."""
    state = _rules.setdefault(horizon, {})
    try:
        report = await _offload('background', 'rules_work', rows, horizon, regimes, cot_rows, daily)
        report.update(source='your data', ran=time.time(), week=week)
        saved = _load_rules()
        saved[horizon] = report
        lab.save_json_atomic(RULES_PATH, saved)
        latest = (_state.get('result') or {}).get('horizons', {}).get(horizon)
        if latest is not None:
            latest['ruleTests'] = report
    except Exception as err:
        log.info('Rule tests (%s) failed: %s', horizon, err)
        saved = _load_rules()  # remember the week so a failing run isn't repeated every 5 minutes
        saved[horizon] = {**(saved.get(horizon) or {}), 'week': week, 'failed': str(err)[:200]}
    finally:
        state['running'] = False


async def _horizon_rows(ctx, horizon, symbols, histories, quotes, cot_of):
    """(symbol, finished bars, bars with the forming one, COT) for one time frame."""
    rows = []
    for sym in symbols:
        if sym not in histories:
            continue  # no daily history: Schwab doesn't know it or it failed this time
        try:
            if horizon == 'swing':
                done, live = split_bars(histories[sym], quotes.get(sym))
            elif horizon == 'position':
                done, live = split_weekly(await weekly_history(ctx, sym), quotes.get(sym))
            else:
                done, live = split_hourly(await hourly_history(ctx, sym), quotes.get(sym))
        except EngineError:
            raise
        except Exception as err:
            log.info('Scanner %s bars for %s failed: %s', horizon, sym, err)
            continue
        rows.append((sym, done, live, cot_of.get(sym)))
        await asyncio.sleep(0)  # let quotes through between stocks
    return rows


async def _enrich(ctx, pctx, horizon, setups, rows, session, news, keys):
    """Extra checks for the best few per strategy: 1,000-run random-walk test, dark-pool volume, insiders and big
    options trades, the 30-minute lean and news."""
    top = []
    for key in keys:
        top += [s for s in setups if s['strategy'] == key][:3 if horizon != 'swing' else 4]
    by_sym = {sym: (done, cot) for sym, done, _, cot in rows}
    for s in top:
        done, cot = by_sym[s['symbol']]
        if s['stock']['trades'] >= 5:
            s['randomWalk'] = random_walk_for(s['symbol'], s['strategy'], done, cot, horizon)
        await dark_pool(ctx, s)
        if s['tier'] in ('A', 'B'):
            await smart_money(pctx, s)
        if session != 'closed' and horizon == 'short':
            try:
                m5 = await _history(ctx, s['symbol'], 'get_price_history_every_five_minutes', 5, 'scan-5m', 240)
                s['bias'] = intraday_bias(m5)
            except EngineError:
                raise
            except Exception as err:
                log.info('Scanner 5-minute bars for %s failed: %s', s['symbol'], err)
    if news is not None and top:
        try:
            items, _ = await news.get(list(dict.fromkeys(s['symbol'] for s in top))[:12])
            for s in top:
                mine = [it for it in items if s['symbol'] in it.get('title', '').upper().split() or f"{s['symbol']} stock" in it.get('title', '')]
                if mine:
                    tone = headline_tone(mine)
                    s['news'] = {'headline': mine[0]['title'], 'link': mine[0].get('link'), 'source': mine[0].get('source'), 'count': len(mine), 'tone': tone}
                    agrees = tone * s['direction'] > 0
                    s['checks'].append({'label': 'News tone', 'ok': None if tone == 0 else agrees,
                                        'detail': f"{len(mine)} recent headline{'s' if len(mine) != 1 else ''}, {'positive' if tone > 0 else 'negative' if tone < 0 else 'neutral'}"})
        except Exception as err:
            log.info('Scanner news failed: %s', err)


def _retire_failed(horizon, lab_forward):
    """Drops a lab survivor whose own forward record failed (30+ trades and losing, or t below -1)."""
    survivors = _lab_state()
    mine = survivors.get(horizon) or {}
    gone = [sid for sid in mine if lab.forward_failed(lab_forward.get(lab.strategy_key(horizon, sid)) or {'trades': 0, 'expectancy': None, 'tStat': None})]
    for sid in gone:
        log.info('Lab strategy %s (%s) retired: its forward record failed', sid, horizon)
        survivors.setdefault('_retired', {}).setdefault(horizon, {})[sid] = {**mine.pop(sid), 'retired': str(ny_today())}
    if gone:
        _save_lab_state()
        lab.install(survivors)


async def scan(ctx, news=None, publish=None):
    """One full scan of the Nasdaq-100 on every time frame. `publish` receives the results after each time frame,
    so the page fills in while the slower ones (hourly bars) are still loading."""
    session = market_session()
    pctx = _PacedContext(ctx)
    _lab_state()
    bad = bad_symbols()  # symbols Schwab didn't know earlier today (e.g. a ticker change) wait a day
    symbols = [s for s in UNIVERSE if s not in bad]
    quotes = await live_quotes(pctx, symbols + CONTEXT + ['$VIX'])
    cot_rows, cot_of, histories = {}, {}, {}
    skipped = [{'symbol': b, 'reason': 'unknown'} for b in sorted(bad) if b in UNIVERSE]
    for sym in symbols + CONTEXT:
        try:
            histories[sym] = await daily_history(ctx, sym)
        except EngineError:
            raise  # expired login: nothing else will work either
        except Exception as err:
            log.info('Scanner skipped %s: %s', sym, err)
            if sym not in CONTEXT:
                skipped.append({'symbol': sym, 'reason': 'unknown' if isinstance(err, SymbolError) else 'temporary'})
                if isinstance(err, SymbolError):
                    _state['bad'][sym] = time.time()
    for sym in symbols:
        code = await market_for(pctx, sym)
        if code and code not in cot_rows:
            cot_rows[code] = await cot_rows_for(ctx, code)
        cot_of[sym] = st.cot_index(cot_rows[code], st.COT_DEFAULT['weeks']) if code and cot_rows.get(code) else None
    if not any(sym in histories for sym in symbols):
        raise EngineError('The scanner could not load price history from Schwab.')
    earnings = await earnings_dates(ctx)
    keys = list(st.STRATEGIES)
    ndx_rows = cot_rows.get(NDX_COT) or []

    # Day and week change from the daily bars and live quotes (the same on every time frame).
    moves = {}
    for sym in symbols:
        q = (quotes.get(sym) or {}).get('quote') or {}
        last, net = q.get('lastPrice'), q.get('netChange')
        day = net / (last - net) if isinstance(last, (int, float)) and isinstance(net, (int, float)) and last - net > 0 else None
        closes = [b['close'] for b in histories.get(sym, [])]
        week = (last or closes[-1]) / closes[-6] - 1 if len(closes) > 6 and (last or closes[-1]) else None
        moves[sym] = (day, week)

    regime = market_regime(histories, quotes, cot_rows.get(NDX_COT), symbols)
    horizons = {}
    rules_saved = _load_rules()
    market = market_trend_by_date(histories['QQQ']) if 'QQQ' in histories else {}
    regimes = st.market_regimes(histories['QQQ']) if 'QQQ' in histories else {}
    daily_done = {sym: [{'time': b['time'], 'close': b['close']} for b in split_bars(histories[sym], None)[0][-400:]] for sym in symbols if sym in histories}

    def assemble():
        swing = horizons.get('swing') or {}
        return {
            'updated': time.time(), 'session': session, 'universe': 'Nasdaq-100', 'scanned': swing.get('scanned', 0),
            'skipped': skipped, 'regime': regime, 'primary': 'weekly_swing', 'version': 22,
            'alpaca': alpaca.available(),
            'horizons': horizons, 'horizonInfo': {h: {k: st.HORIZONS[h][k] for k in ('label', 'hold', 'bar', 'unit', 'higher')} for h in HORIZON_ORDER},
            # Swing setups at the top level too, for pages older than v19 (the strategy records only live in horizons).
            'setups': swing.get('setups', []), 'filteredOut': swing.get('filteredOut', []),
        }

    tier_rank = {'A': 0, 'B': 1, 'C': 2}
    swing_pass = None
    for horizon in HORIZON_ORDER:
        rows = await _horizon_rows(ctx, horizon, symbols, histories, quotes, cot_of)
        if not rows:
            horizons[horizon] = {'scanned': 0, 'strategies': {}, 'setups': [], 'filteredOut': [], 'updated': time.time(),
                                 'error': 'No price history for this time frame yet'}
            continue
        enough = [r for r in rows if len(r[1]) >= 260]
        if not enough:
            longest = max(len(r[1]) for r in rows)
            horizons[horizon] = {'scanned': len(rows), 'strategies': {}, 'setups': [], 'filteredOut': [], 'updated': time.time(),
                                 'error': f"Only {longest} {st.HORIZONS[horizon]['unit']} bars per stock so far; this time frame needs at least 260 to test the strategies. It fills in as more history is kept."}
            if publish:
                publish(assemble())
            continue
        daily = daily_done if horizon == 'short' else None
        summary, stats, setups, filtered = await _offload('scan', 'compute', rows, keys, earnings, horizon, dict(_family), ndx_rows, swing_pass, None, daily)
        _family.clear()
        _family.update(summary['family'])
        if horizon == 'swing':
            swing_pass = swing_passes(stats)
        _retire_failed(horizon, summary['labForward'])
        for s in setups:
            s['day'], s['week'] = moves.get(s['symbol'], (None, None))
        setups.sort(key=lambda s: (tier_rank[s['tier']], s['status'] == 'forming', -s['score']))
        await _enrich(ctx, pctx, horizon, setups, rows, session, news, keys)
        # Per-stock random-walk p-values get Benjamini-Hochberg q-values over every stock x strategy tested.
        tested = [s for s in setups if s.get('randomWalk') and 'p' in s['randomWalk']]
        for s, q in zip(tested, st.bh_qvalues([s['randomWalk']['p'] for s in tested], summary['stockTests'])):
            s['randomWalk'] = {**s['randomWalk'], 'q': q, 'tests': max(len(tested), summary['stockTests'])}
        stamp = max((r[1][-1]['time'] for r in rows if r[1]), default=None)  # newest finished bar of this time frame
        week = week_of(stamp) if stamp else None
        ls = _lab.setdefault(horizon, {})
        if week and _lab_state().get('_runs', {}).get(horizon) != week and not ls.get('running'):
            ls['running'] = True
            ls['task'] = background(_run_lab(horizon, rows, stamp, market, daily))
        rs = _rules.setdefault(horizon, {})
        if week and (rules_saved.get(horizon) or {}).get('week') != week and not rs.get('running'):
            rs['running'] = True
            rs['task'] = background(_run_rule_tests(horizon, rows, regimes, ndx_rows if horizon != 'short' else ndx_rows, daily, week))
        horizons[horizon] = {
            'lab': _lab_summary(horizon), 'labRunning': bool(ls.get('running')), 'ruleTests': rules_saved.get(horizon), 'rulesRunning': bool(rs.get('running')),
            'scanned': len(rows), 'updated': time.time(), 'strategies': stats, 'setups': setups[:60], 'edge': summary['edge'],
            'historyDays': summary['historyDays'], 'fullHistoryDays': HOURLY_FULL_DAYS if horizon == 'short' else None,
            'filteredOut': [{'symbol': s['symbol'], 'strategy': s['strategy'], 'stock': s['stock']} for s in filtered][:30],
        }
        if publish:
            publish(assemble())
    return assemble()


def market_regime(histories, quotes, ndx_rows, symbols):
    """Nasdaq-100 trend, breadth, VIX and where commercials sit in Nasdaq futures."""
    regime = {'qqqWeekly': None, 'qqqWeek': None, 'above50': None, 'vix': None, 'ndxCot': None, 'qqqAbove200': None}
    if 'QQQ' in histories:
        done, live = split_bars(histories['QQQ'], quotes.get('QQQ'))
        bars = live or done
        q_ind = st.prepare(bars, st.cot_index(ndx_rows, st.COT_DEFAULT['weeks']) if ndx_rows else None)
        regime['qqqWeekly'] = st.weekly_trend(bars)[-1]
        regime['qqqAbove200'] = st.trend_array(q_ind, 'ma200')[-1]
        regime['qqqWeek'] = q_ind['closes'][-1] / q_ind['closes'][-6] - 1 if len(q_ind['closes']) > 6 else None
        regime['ndxCot'] = q_ind['cot'][-1]
    closes = [[b['close'] for b in histories[s]] for s in symbols if s in histories]
    closes = [c for c in closes if len(c) > 50]
    if closes:
        regime['above50'] = sum(1 for c in closes if c[-1] > sum(c[-50:]) / 50) / len(closes)
    vq = (quotes.get('$VIX') or {}).get('quote') or {}
    regime['vix'] = vq.get('lastPrice') or vq.get('closePrice')
    return regime


def next_interval():
    return SCAN_EVERY


async def background_loop(ctx, news=None, first_delay=15):
    """Runs forever inside the helper: scans, waits 5 minutes, scans again."""
    await asyncio.sleep(first_delay)
    removed = await asyncio.to_thread(prune_old_cache, ctx.disk)
    if removed:
        log.info('Removed %d old dated scanner history rows from cache.db', removed)
    while True:
        try:
            await run_once(ctx, news)
        except Exception as err:
            log.info('Background scan failed: %s', err)
        wait = next_interval()
        _state['next'] = time.time() + wait
        await asyncio.sleep(wait)


async def run_once(ctx, news=None):
    if _state['running']:
        return await _state['running']
    # Each finished time frame is shown straight away while the others are still loading.
    task = background(scan(ctx, news, publish=lambda r: _state.__setitem__('result', {**r, 'partial': True})))
    _state['running'] = task
    try:
        _state['result'] = await task
        try:  # keep it for the next start, so the page has something to show at once
            await asyncio.to_thread(lab.save_json_atomic, RESULT_PATH, _state['result'])
        except Exception as err:
            log.info('Scan result not saved: %s', err)
        return _state['result']
    finally:
        _state['running'] = None


def _start_scan(ctx, news):
    """Starts a scan in the background unless one is running (the browser never waits for it)."""
    if not _state['running'] and not _state.get('starting'):
        _state['starting'] = True
        background(_guarded_scan(ctx, news))


async def _guarded_scan(ctx, news):
    try:
        _state['lastError'] = None
        await run_once(ctx, news)
    except Exception as err:
        _state['lastError'] = str(err)
        log.info('Scan failed: %s', err)
    finally:
        _state['starting'] = False


def _load_saved_result():
    try:
        data = json.loads(RESULT_PATH.read_text())
        return {**data, 'stale': True} if isinstance(data, dict) and data.get('horizons') else None
    except (OSError, ValueError):
        return None


FIRST_WAIT = 2  # seconds the very first request waits for any result before replying "still loading"


@handler('scanner.results')
async def results(ctx, msg):
    """The latest scan of the Nasdaq-100. Replies at once: the newest results (complete or partly done), or after a
    restart the last saved scan marked `stale` while a fresh one runs. It never waits for a scan to finish (only up to
    FIRST_WAIT seconds when there is nothing at all yet), nor for the lab, rule tests or random-walk jobs."""
    if msg.get('refresh'):
        _state['bad'].clear()  # "Scan again" retries symbols Schwab rejected earlier
        _start_scan(ctx, ctx.news)
    if _state['result'] is None:
        saved = await asyncio.to_thread(_load_saved_result)
        if saved and _state['result'] is None:
            _state['result'] = saved
        _start_scan(ctx, ctx.news)
    waited = 0.0
    while _state['result'] is None and waited < FIRST_WAIT and (_state['running'] or _state.get('starting')):
        await asyncio.sleep(0.25)
        waited += 0.25
    busy = bool(_state['running'] or _state.get('starting'))
    status = {'nextScan': _state.get('next'), 'scanning': busy, 'error': None if busy else _state.get('lastError')}
    if _state['result'] is None:
        return {'loading': True, 'horizons': {}, 'setups': [], 'regime': {}, 'updated': None, **status}
    return {**_state['result'], **status}
