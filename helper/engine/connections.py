"""
Data connections (Settings > Data connections): one cheap, real call per saved key to say "connected" or why not.
The keys come from ~/.trading-platform/settings.json and go only to their own site; replies carry a yes/no and a
plain message, never a key (tests check every reply).
"""
import json

import httpx

from . import settings
from .core import EngineError, handler
from .worldmacro import mask_secrets

TIMEOUT = httpx.Timeout(12, connect=6)


def _clean(message, *secrets):
    """The shared masker (worldmacro.mask_secrets): saved keys, URL queries and key=value pairs."""
    return mask_secrets(message, *secrets)


async def _get(ctx, url, params=None, headers=None, client=None):
    try:
        return await (client or ctx.http).get(url, params=params, headers=headers, timeout=TIMEOUT)
    except httpx.HTTPError as err:
        raise EngineError(f'could not be reached ({type(err).__name__}). Check the internet connection.') from None


def _json(response):
    try:
        return response.json()
    except ValueError:
        return None


async def t_fred(ctx, key):
    r = await _get(ctx, 'https://api.stlouisfed.org/fred/series', {'series_id': 'GDP', 'api_key': key, 'file_type': 'json'})
    data = _json(r) or {}
    if r.status_code == 200 and data.get('seriess'):
        return 'Connected. Economic data loads through the faster FRED API.'
    raise EngineError(data.get('error_message') or f'FRED answered HTTP {r.status_code}')


async def t_bea(ctx, key):
    r = await _get(ctx, 'https://apps.bea.gov/api/data/', {'UserID': key, 'method': 'GETDATASETLIST', 'ResultFormat': 'JSON'})
    api = (_json(r) or {}).get('BEAAPI') or {}
    results = api.get('Results') or {}
    err = api.get('Error') or results.get('Error')
    if err:
        err = err[0] if isinstance(err, list) else err
        raise EngineError(err.get('APIErrorDescription') or 'BEA refused the key')
    if r.status_code == 200 and results.get('Dataset'):
        return 'Connected. GDP by component and PCE prices appear on Macro > World.'
    raise EngineError(f'BEA answered HTTP {r.status_code}')


async def t_bls(ctx, key):
    try:
        r = await ctx.http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', timeout=TIMEOUT,
                                json={'seriesid': ['CUUR0000SA0'], 'latest': True, 'registrationkey': key})
    except httpx.HTTPError as err:
        raise EngineError(f'could not be reached ({type(err).__name__}).') from None
    data = _json(r) or {}
    messages = ' '.join(str(m) for m in data.get('message') or [])
    if data.get('status') == 'REQUEST_SUCCEEDED' and 'key' not in messages.lower():
        return 'Connected. More BLS series and a higher daily limit are on.'
    raise EngineError(messages or f'BLS answered HTTP {r.status_code}')


async def t_eia(ctx, key):
    r = await _get(ctx, 'https://api.eia.gov/v2/', {'api_key': key})
    data = _json(r) or {}
    if r.status_code == 200 and data.get('response'):
        return 'Connected. Oil and gasoline inventories and prices appear on Macro > World.'
    err = data.get('error')
    raise EngineError((err.get('message') if isinstance(err, dict) else err) or f'EIA answered HTTP {r.status_code}')


async def t_census(ctx, key):
    r = await _get(ctx, 'https://api.census.gov/data/timeseries/eits/marts',
                   {'get': 'cell_value', 'for': 'us:*', 'time': '2024-01', 'category_code': '44X72', 'data_type_code': 'SM',
                    'seasonally_adj': 'yes', 'key': key})
    data = _json(r)
    if r.status_code == 200 and isinstance(data, list):
        return 'Connected. Retail sales load without the no-key daily limit.'
    if 'invalid key' in r.text.lower():
        raise EngineError('Census says the key is not valid (it can take a few minutes to activate after the email link).')
    raise EngineError(f'Census answered HTTP {r.status_code}')


async def t_finnhub(ctx, key):
    r = await _get(ctx, 'https://finnhub.io/api/v1/stock/recommendation', {'symbol': 'AAPL', 'token': key})
    if r.status_code == 200 and isinstance(_json(r), list):
        return 'Connected. Analyst views (security view) and earnings dates (Calendar) are on.'
    if r.status_code in (401, 403):
        raise EngineError('Finnhub says the key is not valid.')
    raise EngineError(f'Finnhub answered HTTP {r.status_code}')


async def t_anthropic(ctx, key):
    # Listing models costs nothing (no tokens) and proves the key works.
    r = await _get(ctx, 'https://api.anthropic.com/v1/models', {'limit': 1}, {'x-api-key': key, 'anthropic-version': '2023-06-01'})
    if r.status_code == 200:
        return 'Connected. The AI assistant and AI summary buttons are on.'
    if r.status_code in (401, 403):
        raise EngineError('Anthropic says the key is not valid.')
    raise EngineError(f'Anthropic answered HTTP {r.status_code}')


async def t_sec(ctx, email):
    r = await _get(ctx, 'https://data.sec.gov/submissions/CIK0000320193.json', client=ctx.sec_http)
    if r.status_code == 200:
        return 'Connected. Company financials, insider trades and fund filings load from sec.gov.'
    if r.status_code == 403:
        raise EngineError('The SEC refused the request: check the email address.')
    raise EngineError(f'The SEC answered HTTP {r.status_code}')


#: connection id -> (settings key, test, label)
TESTS = {
    'fred': ('fred_key', t_fred, 'FRED'),
    'bea': ('bea_key', t_bea, 'BEA'),
    'bls': ('bls_key', t_bls, 'BLS'),
    'eia': ('eia_key', t_eia, 'EIA'),
    'census': ('census_key', t_census, 'Census'),
    'finnhub': ('finnhub_key', t_finnhub, 'Finnhub'),
    'ai': ('anthropic_key', t_anthropic, 'Anthropic'),
    'sec': ('sec_contact', t_sec, 'SEC'),
}


@handler('connections.test')
async def test_connection(ctx, msg):
    """{ok, keySet, message} for one connection. Alpaca keeps its own alpaca.status test."""
    name = str(msg.get('connection') or '')
    if name == 'alpaca':
        from . import alpaca
        out = await alpaca.status(ctx, {})
        return {'ok': out['ok'], 'keySet': out['keysSet'], 'message': out['message']}
    if name not in TESTS:
        raise EngineError('Unknown connection')
    field, test, label = TESTS[name]
    key = settings.get(field)
    if not key:
        return {'ok': False, 'keySet': False, 'message': f'No {label} key saved yet.' if name != 'sec' else 'No email saved yet.'}
    try:
        message = await test(ctx, key)
        return {'ok': True, 'keySet': True, 'message': _clean(message, key)}
    except EngineError as err:
        return {'ok': False, 'keySet': True, 'message': _clean(f'{label}: {err}', key)}
    except Exception as err:  # never crash the Settings window over a test
        return {'ok': False, 'keySet': True, 'message': _clean(f'{label} test failed ({type(err).__name__}).', key)}


def leaks(reply, secrets):
    """True when any secret appears anywhere in `reply` (used by tests)."""
    text = json.dumps(reply, default=str)
    return any(s and s in text for s in secrets)
