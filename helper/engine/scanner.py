"""
Market scanner: a background job inside the helper that scans every Nasdaq-100 stock (plus your watchlist) every 5
minutes for swing-trade setups, using the strategies in strategies.py:

- Weekly swing (the primary strategy): enter on the daily chart, exit on a one-week horizon, with Larry Williams'
  COT index for commercial hedgers, the z-score, Williams %R and Williams Accumulation/Distribution lined up.
- Mean reversion and trend breakouts as alternatives you can switch to.

Every setup comes with its exact plan (when to buy, the stop, the target, when to get out), the strategy's tested
record on all Nasdaq-100 stocks and on this stock, a random-entry and a random-walk test (could luck explain it?),
earnings dates inside the holding period, news, insider buying and big options trades. Signals, not certainties.
"""
import asyncio
import datetime as dt
import logging
import time
from zoneinfo import ZoneInfo

from . import flow, positioning, sec
from . import strategies as st
from .core import EngineError, handler, market_session

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
UNIVERSE = NASDAQ_100
CONTEXT = ['QQQ']  # read for the market regime, not traded
MAX_EXTRA = 25  # watchlist symbols added on top of the Nasdaq-100
NDX_COT = '209742'  # Nasdaq-100 E-mini futures: the COT market for Nasdaq stocks
# Schwab allows about 120 requests a minute for the whole app, and the charts share it: the scanner sends one
# request at a time, at most one every 0.7 s (about 85 a minute), so the owner's own charts always have room.
REQUEST_GAP = 0.7
_pace = asyncio.Lock()
_last_request = [0.0]
BAD_SYMBOL_RETRY = 24 * 3600
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

async def _history(ctx, symbol, method, days, key, max_age):
    async def load():
        now = dt.datetime.now(dt.timezone.utc)
        response = await _paced(lambda: getattr(ctx.schwab, method)(symbol, start_datetime=now - dt.timedelta(days=days), end_datetime=now))
        if response.status_code == 401:
            raise EngineError('Schwab login expired. Close the helper and start it again to log in.')
        if response.status_code in (400, 404):
            raise SymbolError(f'Schwab has no price history for {symbol}')
        if response.status_code != 200:
            raise TemporaryError(f'Schwab returned {response.status_code} for {symbol}')
        return [{'time': c['datetime'] // 1000, 'open': c['open'], 'high': c['high'], 'low': c['low'], 'close': c['close'], 'volume': c.get('volume', 0)}
                for c in response.json().get('candles', []) if c.get('close')]
    # No stale_ok: signals must use fresh bars (a stale hit would also start uncounted background requests).
    return await ctx.cached((key, symbol), max_age, load, persist=True)



async def smart_money(ctx, r):  # ctx is the scanner's paced context
    """Institutional flow for a top setup: insiders' open-market buying and big options trades paid at the ask.
    (Commercial hedgers' COT positioning is already part of every setup.)"""
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


async def daily_history(ctx, symbol):
    """About 3 years of daily bars, fetched once per day (the live quote supplies today's bar during the day)."""
    return await _history(ctx, symbol, 'get_price_history_every_day', 1100, ('scan-daily', str(ny_today())), 20 * 3600)


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


async def cot_for(ctx, code):
    rows = await positioning.cot_rows(ctx, code)
    return st.cot_index(rows) if rows else []


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


# ---------- Analysis (pure, runs in a worker thread) ----------

_bt_cache = {}  # (symbol, strategy, last completed day) -> trades


def stock_trades(symbol, key, ind):
    day = bar_day(ind['bars'][-1]['time']) if ind['bars'] else None
    ck = (symbol, key, day)
    if len(_bt_cache) > 5000:
        _bt_cache.clear()  # a new day: yesterday's results are no longer used
    if ck not in _bt_cache:
        _bt_cache[ck] = st.trades_for(ind, key)
    return _bt_cache[ck]


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
    return ('in trade', t) if still_open else None


def analyse_symbol(symbol, done, live, cot, strategy_keys):
    """All current setups for one stock, plus its backtests. `done` = completed daily bars, `live` = with today."""
    if len(done) < 260:
        return {'symbol': symbol, 'setups': [], 'trades': {}}
    ind_done = st.prepare(done, cot)
    ind_live = st.prepare(live, cot) if live else None
    ind_now = ind_live or ind_done
    found, trades = [], {}
    for key in strategy_keys:
        strat = st.STRATEGIES[key]
        trades[key] = stock_trades(symbol, key, ind_done)
        candidates = []
        n = len(done)
        for s in (n - 1, n - 2, n - 3):  # signals from the last few completed days may still be valid or open
            sig = strat['signal'](ind_done, s)
            if sig:
                candidates.append((s, sig, None))
                break
        if ind_live:  # forming today: only final at the close
            sig = strat['signal'](ind_live, len(live) - 1)
            if sig:
                candidates.append((len(live) - 1, sig, 'forming'))
        for s, sig, forced in candidates:
            src = ind_live if forced else ind_done
            plan = strat['plan'](src, s, sig['dir'])
            if not plan:
                continue
            if forced:
                state, trade = 'forming', None
            else:
                res = setup_state(ind_now, s, plan, sig['dir'])
                if res is None:
                    continue
                state, trade = res
            found.append(build_setup(symbol, key, src, s, sig, plan, state, trade, ind_now))
            break
    return {'symbol': symbol, 'setups': found, 'trades': trades,
            'closes': ind_done['closes'], 'opens': [b['open'] for b in done]}


def build_setup(symbol, key, ind, s, sig, plan, state, trade, ind_now):
    d = sig['dir']
    bars = ind['bars']
    now_bars = ind_now['bars']
    price = now_bars[-1]['close']
    a = ind['atr'][s]
    entry = plan['trigger'] if plan['entry'] == 'stop' else bars[s]['close']
    risk = abs(entry - plan['stop'])
    rr = abs(plan['target'] - entry) / risk if plan['target'] is not None and risk else None
    signal_day = bar_day(bars[s]['time'])
    valid_until = add_sessions(signal_day, plan['validDays'])
    exit_by = add_sessions(signal_day, plan['validDays'] + plan['maxHold'] - 1)
    z, wr, cot = ind['z20'][s], ind['willr'][s], ind['cot'][s]
    week_ago = now_bars[-6]['close'] if len(now_bars) > 6 else None
    status_text = {
        'forming': 'Forming today: only confirmed if it still holds at the 4 PM close',
        'ready': (f"Ready: {'buy' if d > 0 else 'sell short'} if price trades {'above' if d > 0 else 'below'} {entry:.2f} by {valid_until:%a %b %d}"
                  if plan['entry'] == 'stop' else f"Ready: {'buy' if d > 0 else 'sell short'} at the next open"),
        'waiting': f"Waiting for the trigger: {'above' if d > 0 else 'below'} {entry:.2f}, valid through {valid_until:%a %b %d}",
        'in trade': 'Triggered: the trade is on',
    }[state]
    out = {
        'symbol': symbol, 'strategy': key, 'strategyName': st.STRATEGIES[key]['short'], 'direction': d,
        'status': state, 'statusText': status_text, 'signalDate': signal_day.isoformat(),
        'price': price, 'day': None, 'week': price / week_ago - 1 if week_ago else None,
        'reasons': sig['reasons'], 'score': 0, 'tier': None,
        'plan': {
            'entryType': plan['entry'], 'trigger': entry, 'validUntil': valid_until.isoformat(), 'stop': plan['stop'],
            'target': plan['target'], 'targetNote': plan['targetNote'], 'maxHold': plan['maxHold'], 'exitBy': exit_by.isoformat(),
            'exitRule': plan['exitRule'], 'riskReward': rr, 'riskPct': risk / entry if entry else None, 'atr': a,
            'horizon': st.STRATEGIES[key]['horizon'],
        },
        'indicators': {'z': z, 'willr': wr, 'cot': cot, 'cotView': st.cot_view(cot, d), 'weekly': ind['weekly'][s],
                       'wadRising': ind['wad'][s] >= ind['wad_ema'][s] if ind['wad_ema'][s] is not None else None,
                       'rsi2': ind['rsi2'][s], 'adx': ind['adx'][s]},
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
    extra = [{'price': ind['sma50'][-1], 'label': '50-day average'}, {'price': ind['sma200'][-1], 'label': '200-day average'},
             {'price': ind['sma20'][-1], 'label': '20-day average'}]
    pts = [{'price': x['price'], 'label': f"Swing level ({x['touches']} touch{'' if x['touches'] == 1 else 'es'})"} for x in lv]
    pts += [x for x in extra if x['price']]
    return {'supports': sorted((x for x in pts if x['price'] < price), key=lambda x: price - x['price'])[:4],
            'resistances': sorted((x for x in pts if x['price'] > price), key=lambda x: x['price'] - price)[:4]}


def strategy_stats(per_symbol):
    """Each strategy's pooled record across all scanned stocks, with the random-entry test."""
    out = {}
    for key, strat in st.STRATEGIES.items():
        by_sym = {r['symbol']: r['trades'].get(key, []) for r in per_symbol if r.get('trades')}
        pooled = [t for ts in by_sym.values() for t in ts]
        closes = {r['symbol']: r['closes'] for r in per_symbol if r.get('closes')}
        opens = {r['symbol']: r['opens'] for r in per_symbol if r.get('opens')}
        test = st.random_entry_test({k: v for k, v in by_sym.items() if k in closes}, closes, opens)
        out[key] = {'name': strat['name'], 'short': strat['short'], 'horizon': strat['horizon'], 'stats': st.summarise(pooled),
                    'randomEntry': test, 'stocks': len(by_sym)}
    return out


def grade(setup, stock, strat, earnings):
    """Tier A: the strategy beats random entries across the Nasdaq-100 (profit factor 1.2+, p <= 0.10), this stock's
    own record isn't losing, commercials (COT) aren't against it, no earnings inside the holding period, and (for the
    weekly swing) the target is at least 1.5x the risk. B: the strategy makes money and none of this setup's checks is
    against it (only the strict random-entry test may be unproven). C: the rest; `why` says in plain words what's missing."""
    s, d = setup, setup['direction']
    ps, re = strat['stats'], strat['randomEntry'] or {}
    edge = (ps['expectancy'] or 0) > 0 and (ps['profitFactor'] or 0) >= 1.2 and (re.get('p') or 1) <= 0.10
    positive = (ps['expectancy'] or 0) > 0
    stock_ok = stock['grade'] != 'failed'
    cot_ok = s['indicators']['cotView'] != 'against'
    e = (earnings or {}).get(s['symbol'])
    in_window = bool(e and s['signalDate'] <= e['date'] <= s['plan']['exitBy'])
    rr_ok = s['strategy'] != 'weekly_swing' or (s['plan']['riskReward'] or 0) >= 1.5
    s['earnings'] = {'date': e['date'], 'time': e.get('time', ''), 'inWindow': in_window} if e else ({'unknown': True} if earnings is None else None)
    z = s['indicators']['z']
    checks = [
        {'label': 'Strategy edge on the Nasdaq-100', 'ok': edge if ps['trades'] else None,
         'detail': (f"{ps['trades']} past trades, {round((ps['winRate'] or 0) * 100)}% winners, profit factor {ps['profitFactor']}, "
                    f"random-entry p = {re['p']:.2f}" if re else f"{ps['trades']} past trades (too few for the random test)") if ps['trades'] else 'No past trades to judge'},
        {'label': "This stock's record", 'ok': None if stock['grade'] == 'unproven' else stock_ok,
         'detail': f"{stock['trades']} trades, {round((stock['winRate'] or 0) * 100)}% winners ({stock['grade']})" if stock['trades'] else 'No past trades on this stock'},
        {'label': 'COT: commercial hedgers', 'ok': None if s['indicators']['cotView'] in (None, 'neutral') else s['indicators']['cotView'] == 'agree',
         'detail': f"Williams COT index {s['indicators']['cot']:.0f}/100 ({s['indicators']['cotView']})" if s['indicators']['cot'] is not None else 'No COT data for this market'},
        {'label': 'Z-score', 'ok': None if z is None else ((z <= -1) if d > 0 else (z >= 1)) if s['strategy'] != 'breakout' else abs(z) < 2.5,
         'detail': f"{z:+.2f} standard deviations from the 20-day average" if z is not None else '—'},
        {'label': 'Earnings', 'ok': None if s['earnings'] is None or s['earnings'].get('unknown') else not in_window,
         'detail': (f"Reports {e['date']} {'(inside the holding period: skip or size down)' if in_window else '(after the planned exit)'}" if e
                    else 'Earnings calendar unavailable' if earnings is None else 'No earnings in the next two weeks')},
    ]
    if s['plan']['riskReward'] is not None:
        checks.append({'label': 'Reward:risk', 'ok': (s['plan']['riskReward'] >= 1.5) if s['strategy'] == 'weekly_swing' else None,
                       'detail': f"{s['plan']['riskReward']:.1f}x to the target"})
    s['checks'] = checks
    # Plain reasons this setup is not an A grade, so a C card says why instead of leaving the owner guessing.
    why = []
    if not ps['trades']:
        why.append('This strategy has no past trades yet to prove it works')
    elif not positive:
        why.append(f"This strategy lost money over 3 years of Nasdaq-100 history ({(ps['expectancy'] or 0) * 100:+.2f}% per trade after costs)")
    elif not edge:
        why.append(f"This strategy's past results don't clearly beat random entries (profit factor {ps['profitFactor']}, "
                   f"p = {re['p']:.2f})" if re.get('p') is not None else "Too few past trades to test against random entries")
    if not cot_ok:
        why.append(f"Commercial hedgers (COT) lean against this direction (index {s['indicators']['cot']:.0f}/100)")
    if in_window:
        why.append(f"Earnings on {e['date']} fall inside the holding period")
    if not rr_ok:
        why.append(f"Target is only {(s['plan']['riskReward'] or 0):.1f}x the risk (needs 1.5x)")
    if s['status'] == 'forming':
        why.append('The signal is still forming: it only counts once today\'s bar closes')
    if not stock_ok:
        why.append(f"This strategy has lost money on {s['symbol']} itself ({stock['trades']} past trades)")
    if z is not None and next(c for c in checks if c['label'] == 'Z-score')['ok'] is False:
        why.append(f"Price isn't stretched enough for this setup (z-score {z:+.2f})" if s['strategy'] != 'breakout'
                   else f"Price is already very stretched (z-score {z:+.2f})")
    s['why'] = why
    s['score'] += sum(2 if c['ok'] else -2 if c['ok'] is False else 0 for c in checks)
    if not stock_ok:
        s['tier'] = None
    elif edge and cot_ok and not in_window and rr_ok and s['status'] != 'forming':
        s['tier'] = 'A'
    elif positive and not any(c['ok'] is False for c in checks[1:]):
        s['tier'] = 'B'  # the strategy makes money and none of this setup's own checks is against it
    else:
        s['tier'] = 'C'
    s['stock'] = stock
    s['strategyStats'] = {'trades': ps['trades'], 'winRate': ps['winRate'], 'profitFactor': ps['profitFactor'],
                          'expectancy': ps['expectancy'], 'randomEntryP': re.get('p')}


def compute(rows, strategy_keys, earnings):
    """CPU part of a scan: analyse every stock, pool the backtests, grade the setups."""
    per_symbol = [analyse_symbol(sym, done, live, cot, strategy_keys) for sym, done, live, cot in rows]
    stats = strategy_stats(per_symbol)
    setups, filtered = [], []
    for r in per_symbol:
        for s in r['setups']:
            stock = st.summarise(r['trades'].get(s['strategy'], []))
            grade(s, stock, stats[s['strategy']], earnings)
            (setups if s['tier'] else filtered).append(s)
    return per_symbol, stats, setups, filtered


_rw_cache = {}


def random_walk_for(symbol, key, done, cot):
    """Per-stock random-walk test for a current setup (cached for the day; needs 5+ past trades to mean anything)."""
    ck = (symbol, key, bar_day(done[-1]['time']))
    if len(_rw_cache) > 500:
        _rw_cache.clear()
    if ck not in _rw_cache:
        _rw_cache[ck] = st.random_walk_test(done, cot, key, runs=100)
    return _rw_cache[ck]


# ---------- The scan ----------

SCAN_EVERY = 300  # the owner wants a fresh scan every 5 minutes


async def scan(ctx, news=None):
    session = market_session()
    pctx = _PacedContext(ctx)
    bad = bad_symbols()
    extras = [s for s in sorted(_state['extra'] - bad) if s not in UNIVERSE][:MAX_EXTRA]
    symbols = list(dict.fromkeys(UNIVERSE + extras))
    quotes = await live_quotes(pctx, symbols + CONTEXT + ['$VIX'])
    cot_cache, histories, skipped = {}, {}, []
    for sym in symbols + CONTEXT:
        try:
            histories[sym] = await daily_history(ctx, sym)
        except EngineError:
            raise  # expired login: nothing else will work either
        except Exception as err:
            log.info('Scanner skipped %s: %s', sym, err)
            if sym in CONTEXT:
                continue
            if isinstance(err, SymbolError):
                skipped.append({'symbol': sym, 'reason': 'unknown'})
                if sym in _state['extra']:
                    _state['bad'][sym] = time.time()
            else:
                skipped.append({'symbol': sym, 'reason': 'temporary'})
    rows = []
    for sym in symbols:
        if sym not in histories:
            continue
        code = await market_for(pctx, sym)
        if code and code not in cot_cache:
            try:
                cot_cache[code] = await cot_for(ctx, code)
            except Exception as err:
                log.info('Scanner COT %s failed: %s', code, err)
                cot_cache[code] = []
        done, live = split_bars(histories[sym], quotes.get(sym))
        rows.append((sym, done, live, cot_cache.get(code) or None))
    if not rows:
        raise EngineError('The scanner could not load price history from Schwab.')
    earnings = await earnings_dates(ctx)
    keys = list(st.STRATEGIES)
    per_symbol, stats, setups, filtered = await asyncio.to_thread(compute, rows, keys, earnings)

    # Day change from the live quote (same as the rest of the platform).
    for s in setups:
        q = (quotes.get(s['symbol']) or {}).get('quote') or {}
        last, net = q.get('lastPrice'), q.get('netChange')
        if isinstance(last, (int, float)) and isinstance(net, (int, float)) and last - net > 0:
            s['day'] = net / (last - net)
    tier_rank = {'A': 0, 'B': 1, 'C': 2}
    setups.sort(key=lambda s: (tier_rank[s['tier']], s['status'] == 'forming', -s['score']))

    # Extra checks for the best few per strategy: random-walk test, news, insiders and big options trades, 30-minute lean.
    top = []
    for key in keys:
        top += [s for s in setups if s['strategy'] == key][:4]
    by_sym = {sym: (done, cot) for sym, done, _, cot in rows}
    for s in top:
        done, cot = by_sym[s['symbol']]
        if s['stock']['trades'] >= 5:
            s['randomWalk'] = await asyncio.to_thread(random_walk_for, s['symbol'], s['strategy'], done, cot)
        await smart_money(pctx, s)
        if session != 'closed':
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

    # Market regime: Nasdaq-100 trend, breadth, VIX and where commercials sit in Nasdaq futures.
    regime = {'qqqWeekly': None, 'qqqWeek': None, 'above50': None, 'vix': None, 'ndxCot': None}
    if 'QQQ' in histories:
        done, live = split_bars(histories['QQQ'], quotes.get('QQQ'))
        q_ind = st.prepare(live or done, cot_cache.get(NDX_COT))
        regime['qqqWeekly'] = q_ind['weekly'][-1]
        regime['qqqWeek'] = q_ind['closes'][-1] / q_ind['closes'][-6] - 1 if len(q_ind['closes']) > 6 else None
        regime['ndxCot'] = q_ind['cot'][-1]
    above = [r for r in per_symbol if r.get('closes') and len(r['closes']) > 50]
    if above:
        regime['above50'] = sum(1 for r in above if r['closes'][-1] > sum(r['closes'][-50:]) / 50) / len(above)
    vq = (quotes.get('$VIX') or {}).get('quote') or {}
    regime['vix'] = vq.get('lastPrice') or vq.get('closePrice')
    return {
        'updated': time.time(), 'session': session, 'universe': 'Nasdaq-100', 'scanned': len(rows),
        'skipped': skipped + [{'symbol': b, 'reason': 'unknown'} for b in sorted(bad) if b in _state['extra']],
        'regime': regime, 'strategies': stats, 'primary': 'weekly_swing',
        'setups': setups[:60], 'filteredOut': [{'symbol': s['symbol'], 'strategy': s['strategy'], 'stock': s['stock']} for s in filtered][:30],
    }


def next_interval():
    return SCAN_EVERY


async def background(ctx, news=None, first_delay=15):
    """Runs forever inside the helper: scans, waits 5 minutes, scans again."""
    await asyncio.sleep(first_delay)
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
    task = asyncio.ensure_future(scan(ctx, news))
    _state['running'] = task
    try:
        _state['result'] = await task
        return _state['result']
    finally:
        _state['running'] = None


@handler('scanner.results')
async def results(ctx, msg):
    """The latest scan (runs one first if there isn't one yet). `symbols` adds your watchlist to the scan."""
    extra = {str(s).upper() for s in msg.get('symbols') or [] if isinstance(s, str) and s and '-' not in s and not s.startswith('$')}
    new = extra - _state['extra'] - set(UNIVERSE)
    _state['extra'] |= extra
    if msg.get('refresh'):
        _state['bad'].clear()  # "Scan again" retries symbols Schwab rejected earlier
    if _state['result'] is None or msg.get('refresh'):
        await run_once(ctx, ctx.news)
    elif new and not _state['running']:
        # Answer now with the last scan; the watchlist additions show up on the next refresh.
        _state['refresh'] = asyncio.ensure_future(run_once(ctx, ctx.news))  # keep a reference so it isn't garbage-collected
    return {**_state['result'], 'nextScan': _state.get('next'), 'scanning': bool(_state['running'])}

