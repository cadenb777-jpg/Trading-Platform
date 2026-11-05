"""
Finnhub (free tier, optional key set in Settings): analyst recommendation trends and the earnings calendar. They fill
two gaps in the free data: the security view's analyst panel (DES tab) and earnings dates on the Calendar. The key
stays in ~/.trading-platform/settings.json and is sent only to finnhub.io; replies never contain it.
"""
import datetime as dt
import re
import time

from .core import EngineError, handler
from .worldmacro import fetch, masked

BASE = 'https://finnhub.io/api/v1/'
SIGNUP = 'https://finnhub.io/register'
NO_KEY = 'Add your free Finnhub key in Settings > Data connections to see analyst views and earnings dates.'


def _key():
    from . import settings
    return settings.get('finnhub_key')


def _symbol(msg):
    s = re.sub(r'[^A-Z0-9.\-]', '', str(msg.get('symbol') or '').upper())
    if not s or len(s) > 12:
        raise EngineError('Enter a stock ticker, e.g. AAPL.')
    return s


def parse_recommendations(rows):
    """Finnhub /stock/recommendation -> newest first, with the total and a consensus word."""
    if not isinstance(rows, list):
        raise EngineError('Finnhub sent an unexpected reply.')
    out = []
    for r in rows:
        counts = {k: int(r.get(k) or 0) for k in ('strongBuy', 'buy', 'hold', 'sell', 'strongSell')}
        total = sum(counts.values())
        if not total or not r.get('period'):
            continue
        score = (2 * counts['strongBuy'] + counts['buy'] - counts['sell'] - 2 * counts['strongSell']) / total
        word = 'Strong buy' if score >= 1.2 else 'Buy' if score >= 0.5 else 'Hold' if score > -0.5 else 'Sell' if score > -1.2 else 'Strong sell'
        out.append({'period': str(r['period']), **counts, 'total': total, 'score': round(score, 3), 'consensus': word})
    return sorted(out, key=lambda x: x['period'], reverse=True)


def parse_earnings(payload):
    """Finnhub /calendar/earnings -> [{symbol, date, hour, epsEstimate, epsActual, revenueEstimate, revenueActual}]."""
    rows = (payload or {}).get('earningsCalendar') if isinstance(payload, dict) else None
    if rows is None:
        raise EngineError('Finnhub sent an unexpected reply.')
    hours = {'bmo': 'before the open', 'amc': 'after the close', 'dmh': 'during market hours'}
    out = []
    for r in rows:
        if not r.get('symbol') or not r.get('date'):
            continue
        out.append({'symbol': str(r['symbol']), 'date': str(r['date']), 'hour': hours.get(str(r.get('hour') or '').lower(), ''),
                    'quarter': r.get('quarter'), 'year': r.get('year'),
                    **{k: r.get(k) for k in ('epsEstimate', 'epsActual', 'revenueEstimate', 'revenueActual')}})
    return sorted(out, key=lambda x: (x['date'], x['symbol']))


@handler('finnhub.recommendations')
@masked
async def recommendations(ctx, msg):
    symbol = _symbol(msg)
    key = _key()
    if not key:
        return {'needsKey': True, 'note': NO_KEY, 'signup': SIGNUP, 'symbol': symbol}

    async def load():
        rows = await fetch(ctx, 'Finnhub', BASE + 'stock/recommendation', params={'symbol': symbol, 'token': key})
        return {'symbol': symbol, 'trends': parse_recommendations(rows)[:12], 'fetched': time.time()}
    return await ctx.cached(('finnhub', 'rec', symbol), 12 * 3600, load, persist=True, stale_ok=True)


@handler('finnhub.earnings')
@masked
async def earnings(ctx, msg):
    """Earnings dates from `start` (default today) for `days` (default 14, max 31); optional `symbol`."""
    key = _key()
    if not key:
        return {'needsKey': True, 'note': NO_KEY, 'signup': SIGNUP, 'events': []}
    try:
        start = dt.date.fromisoformat(str(msg.get('start') or dt.date.today().isoformat()))
    except ValueError:
        raise EngineError('Bad start date') from None
    days = max(1, min(int(msg.get('days') or 14), 31))
    end = start + dt.timedelta(days=days)
    symbol = _symbol(msg) if msg.get('symbol') else ''

    async def load():
        params = {'from': start.isoformat(), 'to': end.isoformat(), 'token': key}
        if symbol:
            params['symbol'] = symbol
        payload = await fetch(ctx, 'Finnhub', BASE + 'calendar/earnings', params=params)
        return {'events': parse_earnings(payload), 'from': start.isoformat(), 'to': end.isoformat(), 'fetched': time.time()}
    return await ctx.cached(('finnhub', 'earn', start.isoformat(), days, symbol), 6 * 3600, load, persist=True, stale_ok=True)
