"""
YCharts (paid API, the owner's own key in Settings > Data connections). Market-data only: read requests, never orders.

The API, as YCharts' own sample clients show it (github.com/ycharts/ycharts-api-php-client, -r-client):
  base      https://ycharts.com/api/v3/
  key       header X-YCHARTSAUTHORIZATION: <key>
  info      /{kind}/{ids}/info/{fields}                  e.g. companies/AAPL,MSFT/info/exchange,industry
  points    /{kind}/{ids}/points/{metrics}[?date=Y-M-D]  latest (or dated) value of each metric
  series    /{kind}/{ids}/series/{metrics}?start_date&end_date
kind: companies (stocks and ETFs, by ticker), mutual_funds (M:VFIAX), indices (^SPX), indicators (I:USCPI ...).
YCharts' full list of metric codes is in its own documentation (ycharts.com/api/docs, behind the login); any code can
be asked for here, and a code the plan doesn't include comes back as a per-metric error, shown as such, never guessed.

Requests: ycharts.status (is the key accepted?), ycharts.points, ycharts.series, ycharts.info. The key is read from
settings each call and sent only to ycharts.com.
"""
import datetime as dt
import re

from . import settings
from .core import EngineError, handler

BASE = 'https://ycharts.com/api/v3/'
HEADER = 'X-YCHARTSAUTHORIZATION'
KINDS = {'companies', 'mutual_funds', 'indices', 'indicators'}
ID = re.compile(r'^[A-Za-z0-9^:._\-]{1,24}$')
CODE = re.compile(r'^[a-z0-9_]{1,64}$')


def _key():
    key = settings.load().get('ycharts_key') or ''
    if not key:
        raise EngineError('Add your YCharts API key in Settings > Data connections > YCharts.')
    return key


def _clean(kind, ids, codes, what='metric'):
    if kind not in KINDS:
        raise EngineError(f'Unknown YCharts kind "{kind}".')
    ids = [str(i).strip() for i in (ids if isinstance(ids, list) else [ids]) if str(i).strip()]
    codes = [str(c).strip().lower() for c in (codes if isinstance(codes, list) else [codes]) if str(c).strip()]
    if not ids or len(ids) > 25 or not all(ID.match(i) for i in ids):
        raise EngineError('Give 1 to 25 YCharts ids (tickers, M:FUND, ^INDEX or I:INDICATOR).')
    if not codes or len(codes) > 40 or not all(CODE.match(c) for c in codes):
        raise EngineError(f'Give 1 to 40 YCharts {what} codes (lower case, e.g. pe_ratio).')
    return ids, codes


async def _get(ctx, path, params=None):
    response = await ctx.http.get(BASE + path, params=params or {}, headers={HEADER: _key(), 'Accept': 'application/json'}, timeout=30)
    if response.status_code in (401, 403):
        raise EngineError('YCharts refused the key (check it in Settings, and that your YCharts plan includes the API).')
    if response.status_code == 429:
        raise EngineError('YCharts says too many requests: wait a minute.')
    if response.status_code == 404:
        raise EngineError('YCharts has no such security or data (404).')
    if response.status_code >= 400:
        raise EngineError(f'YCharts answered {response.status_code}.')
    try:
        return response.json()
    except ValueError as err:
        raise EngineError('YCharts sent something that isn’t JSON.') from err


def _status_error(meta):
    """A per-security or per-metric problem YCharts reports in its meta block, as plain words (None when fine)."""
    if not isinstance(meta, dict):
        return None
    status = str(meta.get('status') or '').lower()
    if status in ('', 'ok', 'success'):
        return None
    return str(meta.get('error_message') or meta.get('message') or meta.get('error_code') or status)


def parse_points(data):
    """{id: {metric: {'value', 'date', 'error'}}} from a points reply (pure, tested). Unknown shapes give errors."""
    out = {}
    resp = (data or {}).get('response') or {}
    for sec, block in resp.items():
        row = {}
        sec_err = _status_error((block or {}).get('meta'))
        for metric, item in ((block or {}).get('results') or {}).items():
            err = _status_error((item or {}).get('meta')) or sec_err
            raw = (item or {}).get('data')
            date, value = None, None
            if isinstance(raw, list) and len(raw) == 2 and not isinstance(raw[0], list):
                date, value = raw
            elif isinstance(raw, list) and raw and isinstance(raw[-1], list) and len(raw[-1]) == 2:
                date, value = raw[-1]
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                value = value if isinstance(value, str) and value.strip() else None
            row[metric] = {'value': value, 'date': date, 'error': None if value is not None else (err or 'no value')}
        if not row and sec_err:
            row['_error'] = {'value': None, 'date': None, 'error': sec_err}
        out[sec] = row
    return out


def parse_series(data):
    """{id: {metric: {'points': [[date, value], ...], 'error'}}} from a series reply (pure, tested)."""
    out = {}
    for sec, block in ((data or {}).get('response') or {}).items():
        row = {}
        for metric, item in ((block or {}).get('results') or {}).items():
            raw = (item or {}).get('data') or []
            pts = [[d, v] for d, v in (p for p in raw if isinstance(p, list) and len(p) == 2) if isinstance(v, (int, float)) and not isinstance(v, bool)]
            row[metric] = {'points': pts, 'error': None if pts else (_status_error((item or {}).get('meta')) or 'no data')}
        out[sec] = row
    return out


def parse_info(data):
    """{id: {field: value}} from an info reply (pure, tested)."""
    out = {}
    for sec, block in ((data or {}).get('response') or {}).items():
        res = (block or {}).get('results') or {}
        out[sec] = {k: (v.get('data') if isinstance(v, dict) else v) for k, v in res.items()}
    return out


def _date(v):
    s = str(v or '').strip()[:10]
    return s if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s) else None


@handler('ycharts.status')
async def status(ctx, msg):
    """Is the key there and accepted? One cheap request (Apple's price)."""
    try:
        data = await _get(ctx, 'companies/AAPL/points/price')
    except EngineError as err:
        return {'ok': False, 'message': str(err)}
    p = parse_points(data).get('AAPL', {}).get('price') or {}
    return {'ok': p.get('value') is not None, 'message': 'YCharts key works.' if p.get('value') is not None else f"YCharts answered, but without a price ({p.get('error') or 'empty'}).",
            'checked': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}


@handler('ycharts.points')
async def points(ctx, msg):
    kind = str(msg.get('kind') or 'companies')
    ids, codes = _clean(kind, msg.get('ids'), msg.get('metrics'))
    date = _date(msg.get('date'))

    async def load():
        data = await _get(ctx, f"{kind}/{','.join(ids)}/points/{','.join(codes)}", {'date': date} if date else None)
        return {'kind': kind, 'results': parse_points(data), 'fetched': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    return await ctx.cached(('ycharts', 'points', kind, tuple(ids), tuple(codes), date), 3600, load, persist=True, stale_ok=True)


@handler('ycharts.series')
async def series(ctx, msg):
    kind = str(msg.get('kind') or 'companies')
    ids, codes = _clean(kind, msg.get('ids'), msg.get('metrics'))
    start, end = _date(msg.get('start')), _date(msg.get('end'))
    params = {k: v for k, v in (('start_date', start), ('end_date', end)) if v}

    async def load():
        data = await _get(ctx, f"{kind}/{','.join(ids)}/series/{','.join(codes)}", params)
        return {'kind': kind, 'results': parse_series(data), 'fetched': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    return await ctx.cached(('ycharts', 'series', kind, tuple(ids), tuple(codes), start, end), 6 * 3600, load, persist=True, stale_ok=True)


@handler('ycharts.info')
async def info(ctx, msg):
    kind = str(msg.get('kind') or 'companies')
    ids, fields = _clean(kind, msg.get('ids'), msg.get('fields'), 'info field')

    async def load():
        data = await _get(ctx, f"{kind}/{','.join(ids)}/info/{','.join(fields)}")
        return {'kind': kind, 'results': parse_info(data)}
    return await ctx.cached(('ycharts', 'info', kind, tuple(ids), tuple(fields)), 86400, load, persist=True, stale_ok=True)
