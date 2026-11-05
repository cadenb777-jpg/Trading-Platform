"""
Prediction-market odds, read only: Polymarket's public Gamma API and Kalshi's public market data (no key, no
account). Covers Fed decisions, macro releases (CPI, jobs, GDP, recession) and politics: question, yes probability,
volume, last update and a link to the market. This module only reads public prices; it never bets or trades and
holds no keys (a test checks it makes GET requests only).
"""
import asyncio
import datetime as dt
import json
import re
import time

from .core import EngineError, handler
from .worldmacro import fetch

POLY_EVENTS = 'https://gamma-api.polymarket.com/events'
KALSHI_EVENTS = 'https://api.elections.kalshi.com/trade-api/v2/events'

#: Polymarket tag -> our category
POLY_TAGS = [('fed', 'fed'), ('economy', 'macro'), ('politics', 'politics')]
#: Kalshi series -> our category
KALSHI_SERIES = [('KXFEDDECISION', 'fed'), ('KXFED', 'fed'), ('KXCPIYOY', 'macro'), ('KXCPI', 'macro'), ('KXPAYROLLS', 'macro'),
                 ('KXU3', 'macro'), ('KXGDP', 'macro'), ('KXRECSSNBER', 'macro')]
KALSHI_CATEGORIES = {'politics': 'politics', 'elections': 'politics', 'economics': 'macro', 'financials': 'macro'}
CACHE_SECONDS = 300

def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _iso(v):
    """An ISO time string or unix seconds -> 'YYYY-MM-DDTHH:MM:SSZ' (or '')."""
    if v in (None, ''):
        return ''
    if isinstance(v, (int, float)):
        return dt.datetime.fromtimestamp(v, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    s = str(v).strip()
    try:
        return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        return s


def _json_list(v):
    if isinstance(v, list):
        return v
    try:
        out = json.loads(v or '[]')
    except (TypeError, ValueError):
        return []
    return out if isinstance(out, list) else []


def bucket(text):
    """'cut', 'hold' or 'hike' for a Fed-decision outcome label, else None."""
    t = str(text or '').lower()
    if re.search(r'\b(cut|cuts|decrease|lower|reduce)\b', t):
        return 'cut'
    if re.search(r'\b(hike|hikes|increase|raise|higher)\b', t):
        return 'hike'
    if re.search(r'\b(hold|no change|unchanged|maintain|pause|steady)\b', t):
        return 'hold'
    return None


# ---------- Polymarket ----------

def parse_polymarket(events, category):
    """Gamma /events -> (markets, fed groups)."""
    if not isinstance(events, list):
        raise EngineError('Polymarket sent an unexpected reply.')
    markets, groups = [], []
    for ev in events:
        if ev.get('closed'):
            continue
        url = f"https://polymarket.com/event/{ev.get('slug')}" if ev.get('slug') else 'https://polymarket.com/'
        rows = []
        for m in ev.get('markets') or []:
            if m.get('closed') or m.get('active') is False:
                continue
            outcomes = [str(o) for o in _json_list(m.get('outcomes'))]
            prices = [_num(p) for p in _json_list(m.get('outcomePrices'))]
            yes = None
            if outcomes and prices and len(outcomes) == len(prices):
                idx = next((i for i, o in enumerate(outcomes) if o.lower() == 'yes'), 0)
                yes = prices[idx]
            if yes is None:
                yes = _num(m.get('lastTradePrice'))
            if yes is None:
                continue
            rows.append({
                'source': 'Polymarket', 'id': f"pm:{m.get('id') or m.get('slug')}", 'question': str(m.get('question') or ev.get('title') or ''),
                'event': str(ev.get('title') or ''), 'outcome': str(m.get('groupItemTitle') or ''), 'category': category,
                'yes': round(yes, 4), 'volume': _num(m.get('volumeNum')) or _num(m.get('volume')) or 0,
                'updated': _iso(m.get('updatedAt') or ev.get('updatedAt')), 'closes': _iso(m.get('endDate') or ev.get('endDate')), 'url': url,
            })
        markets += rows
        if category == 'fed' or re.search(r'\bfed\b|fomc', str(ev.get('title') or ''), re.I):
            g = fed_group('Polymarket', str(ev.get('title') or ''), url, rows, lambda r: r['outcome'] or r['question'])
            if g:
                groups.append(g)
    return markets, groups


# ---------- Kalshi ----------

def _kalshi_price(m, name):
    """A Kalshi price as a 0-1 probability: the *_dollars field ("0.6200") or the older cents field (62)."""
    d = _num(m.get(f'{name}_dollars'))
    if d is not None:
        return d
    c = _num(m.get(name))
    return c / 100 if c is not None else None


def kalshi_yes(m):
    """Mid of the yes bid and ask when both are quoted (and not wider than 20 cents), else the last trade."""
    bid, ask, last = _kalshi_price(m, 'yes_bid'), _kalshi_price(m, 'yes_ask'), _kalshi_price(m, 'last_price')
    if bid is not None and ask and ask > 0 and ask >= bid and ask - bid <= 0.2:
        return (bid + ask) / 2
    return last if last is not None else None


def parse_kalshi(payload, category=None):
    """Kalshi /events (with nested markets) -> (markets, fed groups)."""
    events = (payload or {}).get('events') if isinstance(payload, dict) else None
    if events is None:
        raise EngineError('Kalshi sent an unexpected reply.')
    markets, groups = [], []
    for ev in events:
        cat = category or KALSHI_CATEGORIES.get(str(ev.get('category') or '').lower())
        if not cat:
            continue
        series = str(ev.get('series_ticker') or str(ev.get('event_ticker') or '').split('-')[0])
        url = f'https://kalshi.com/markets/{series.lower()}' if series else 'https://kalshi.com/'
        rows = []
        for m in ev.get('markets') or []:
            if str(m.get('status') or 'active').lower() not in ('active', 'open', 'initialized'):
                continue
            yes = kalshi_yes(m)
            if yes is None:
                continue
            title = str(m.get('title') or ev.get('title') or '')
            sub = str(m.get('yes_sub_title') or m.get('subtitle') or '')
            rows.append({
                'source': 'Kalshi', 'id': f"ks:{m.get('ticker')}", 'question': f'{title}: {sub}' if sub and sub.lower() not in title.lower() else title,
                'event': str(ev.get('title') or ''), 'outcome': sub, 'category': cat, 'yes': round(yes, 4),
                'volume': _num(m.get('volume_fp')) or _num(m.get('volume')) or 0,
                'updated': _iso(m.get('updated_time') or m.get('last_updated_time') or ''), 'closes': _iso(m.get('close_time')), 'url': url,
            })
        markets += rows
        if series.upper() == 'KXFEDDECISION':
            g = fed_group('Kalshi', str(ev.get('title') or ''), url, rows, lambda r: r['outcome'] or r['question'])
            if g:
                groups.append(g)
    return markets, groups


# ---------- Fed decision odds ----------

def fed_group(source, title, url, rows, label):
    """One meeting's cut / hold / hike odds from its outcome markets (normalised to add up to 100%)."""
    sums, outcomes = {'cut': 0.0, 'hold': 0.0, 'hike': 0.0}, []
    for r in rows:
        b = bucket(label(r))
        if b:
            sums[b] += r['yes']
            outcomes.append({'label': label(r), 'bucket': b, 'yes': r['yes']})
    total = sum(sums.values())
    # A decision market lists at least two of cut / hold / hike; a lone "Will the Fed cut in 2026?" is not one.
    if len({o['bucket'] for o in outcomes}) < 2 or total <= 0:
        return None
    closes = min((r['closes'] for r in rows if r['closes']), default='')
    return {'source': source, 'title': title, 'url': url, 'meeting': closes[:10], 'outcomes': outcomes,
            'odds': {k: round(v / total, 4) for k, v in sums.items()}, 'raw': round(total, 4),
            'volume': sum(r['volume'] for r in rows), 'updated': max((r['updated'] for r in rows if r['updated']), default='')}


# ---------- Request ----------

async def _polymarket(ctx, slots, tag, category):
    async with slots:
        events = await fetch(ctx, 'Polymarket', POLY_EVENTS, params={'tag_slug': tag, 'closed': 'false', 'active': 'true',
                                                                       'order': 'volume', 'ascending': 'false', 'limit': 40})
    return parse_polymarket(events, category)


async def _kalshi(ctx, slots, series=None, category=None):
    params = {'status': 'open', 'with_nested_markets': 'true', 'limit': 100 if series else 200}
    if series:
        params['series_ticker'] = series
    async with slots:
        payload = await fetch(ctx, 'Kalshi', KALSHI_EVENTS, params=params)
    return parse_kalshi(payload, category)


async def load_all(ctx):
    poly, kalshi = asyncio.Semaphore(3), asyncio.Semaphore(3)  # be polite: at most three requests at a time per site
    jobs = [('Polymarket', _polymarket(ctx, poly, tag, cat)) for tag, cat in POLY_TAGS]
    jobs += [('Kalshi', _kalshi(ctx, kalshi, s, cat)) for s, cat in KALSHI_SERIES]
    jobs.append(('Kalshi', _kalshi(ctx, kalshi)))
    results = await asyncio.gather(*(j for _, j in jobs), return_exceptions=True)
    markets, groups, errors, ok = {}, [], {}, set()
    for (source, _), r in zip(jobs, results):
        if isinstance(r, Exception):
            errors.setdefault(source, str(r) if isinstance(r, EngineError) else f'{source} failed ({type(r).__name__}).')
            continue
        ok.add(source)
        for m in r[0]:
            markets.setdefault(m['id'], m)  # the first (most specific) category wins
        groups += r[1]
    for source in ok:
        errors.pop(source, None)  # some requests worked: the source is up (a missing series is not an outage)
    if not markets and errors:
        raise EngineError(' '.join(errors.values()))
    rows = sorted(markets.values(), key=lambda m: -m['volume'])
    groups.sort(key=lambda g: (g['meeting'] or '9999', -g['volume']))
    return {'markets': rows, 'fed': groups, 'errors': errors, 'fetched': time.time()}


@handler('predictions.markets')
async def markets(ctx, msg):
    """Open prediction markets (Polymarket + Kalshi) with Fed-meeting odds. Optional filters: category
    ('fed', 'macro', 'politics'), source and a search text."""
    data = await ctx.cached(('predictions', 'all'), CACHE_SECONDS, lambda: load_all(ctx), persist=True, stale_ok=True)
    rows = data['markets']
    if msg.get('category') in ('fed', 'macro', 'politics'):
        rows = [m for m in rows if m['category'] == msg['category']]
    if msg.get('source') in ('Polymarket', 'Kalshi'):
        rows = [m for m in rows if m['source'] == msg['source']]
    query = str(msg.get('query') or '').strip().lower()
    if query:
        rows = [m for m in rows if query in m['question'].lower() or query in m['event'].lower()]
    limit = max(1, min(int(msg.get('limit') or 300), 500))
    return {**data, 'markets': rows[:limit], 'total': len(rows), 'stale': time.time() - data['fetched'] > CACHE_SECONDS * 2}
