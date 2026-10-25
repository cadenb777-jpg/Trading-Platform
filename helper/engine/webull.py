"""
Webull: view and sync the owner's Webull account, and place stock orders. This is the platform's ONLY order placement
(Schwab stays market-data only). Every safety rail lives here in the helper, so the web page can't skip one:

- Test environment by default. Live (real money) is only used after the owner types LIVE in Settings.
- Two steps for every order: webull.preview_order checks it and returns a one-time token valid for 60 seconds;
  webull.place_order takes only that token and places exactly the previewed order, once.
- Limits from Settings: a maximum order value (default $1,000) and a maximum number of orders a day (default 10).
- US stocks only (no options); sells can't be larger than the position (no short selling).
- Every placement attempt, result and cancel is appended to ~/.trading-platform/orders.log (never keys or tokens).
- The AI assistant has no access: engine/ai.py must never mention this module (a test checks).

Webull's OpenAPI is called directly with httpx. The request signing below follows the official Python SDK
(webull-openapi-python-sdk 3.0.4, webull/core/auth/composer/default_signature_composer.py): the SDK itself needs
grpcio/protobuf/paho pins that don't suit this helper's Python, and the signing is ~20 lines of standard library.
A test checks our signatures against values the SDK produced.

Some Webull setups also ask for a one-time approval of the API login in the Webull app (an "access token",
checked with /openapi/config). That token is kept in ~/.trading-platform/webull_token.json, never sent to the browser.
"""
import asyncio
import base64
import datetime as dt
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid
from pathlib import Path
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from . import settings
from .core import EngineError, handler, market_session

DATA_DIR = Path.home() / '.trading-platform'
ORDERS_LOG = DATA_DIR / 'orders.log'
TOKEN_PATH = DATA_DIR / 'webull_token.json'
NEW_YORK = ZoneInfo('America/New_York')

#: Webull's US API hosts. Test is Webull's shared sandbox (no real money).
HOSTS = {'test': 'us-openapi-alb.uat.webullbroker.com', 'live': 'api.webull.com'}
DEFAULT_MAX_ORDER = 1000.0
DEFAULT_MAX_PER_DAY = 10
TOKEN_SECONDS = 60
#: How far a limit/stop price may be from the last Schwab price before the order is refused (a typo guard).
PRICE_BAND = 0.25

SYMBOL = re.compile(r'^[A-Z]{1,5}(\.[A-Z])?$')
ORDER_TYPES = {'MARKET': 'MARKET', 'LIMIT': 'LIMIT', 'STOP': 'STOP_LOSS', 'STOP_LIMIT': 'STOP_LOSS_LIMIT'}
TYPE_NAMES = {'MARKET': 'Market', 'LIMIT': 'Limit', 'STOP': 'Stop', 'STOP_LIMIT': 'Stop-limit'}

NO_KEYS = 'Add your Webull App Key and App Secret in Settings (Webull section) first.'
BAD_KEYS = 'Webull rejected the App Key/Secret. Check them in Settings, and that they match the environment (Test or Live).'
UNCONFIRMED = "We couldn't confirm whether Webull received this order. Check Orders before trying again."
APPROVE = 'Webull asks you to approve this API login: open the Webull app on your phone, approve the request, then try again.'

#: Webull's documented rate limits (developer.webull.com/apis/docs/rate-limits and the Trading API overview), counted
#: per App Key and per endpoint; over the limit Webull answers HTTP 429 and does not process the request. Account list
#: 10 per 30 s; balances, positions, open orders, order history and order detail 2 per 2 s; preview 150 per 10 s;
#: place/cancel 600 per 60 s; token create/check 10 per 10 s. Every call goes through one gate (one request at a time)
#: and waits until the same endpoint was last called at least this many seconds ago (with a little margin).
SPACING = {'/trading/accounts/list': 3.2, '/auth/tokens/create': 1.1, '/auth/tokens/check': 1.1,
           '/trading/orders/preview': 0.1, '/trading/orders/place': 0.1, '/trading/orders/cancel': 0.1}
DEFAULT_SPACING = 1.1
#: Seconds to wait before retrying a read that got 429 (when Webull sends no Retry-After); reads only, never orders.
RETRY_WAITS = (2, 5)
#: How long read results are reused (seconds): the account list rarely changes; balances/positions/orders briefly.
ACCOUNTS_TTL = 600
READ_TTL = 20
#: An order must be on its way to Webull within this many seconds of the place request arriving, or it is refused as
#: not placed (so the browser never gives up while the helper still sends it later).
PLACE_DEADLINE = 10
BUSY = 'Webull is busy (too many requests). It will refresh automatically in a minute.'
NOT_SENT = ('Webull requests were queued, so the order could not be sent within a few seconds and was NOT placed. '
            'Wait a few seconds and preview again.')
BUSY_PLACE = 'Webull was busy and did not take the order; nothing was placed. Wait a few seconds and preview again.'

#: preview token -> the exact order it allows (in memory only: a helper restart cancels every pending preview)
_previews = {}
_config_cache = {}


# ---------- settings ----------

def env():
    return 'live' if settings.get('webull_env') == 'live' else 'test'


def live_enabled():
    return settings.get('webull_env') == 'live' and settings.get('webull_live_ok') is True


def available():
    return bool(settings.get('webull_app_key') and settings.get('webull_app_secret'))


def limits():
    try:
        max_order = float(settings.get('webull_max_order') or DEFAULT_MAX_ORDER)
    except (TypeError, ValueError):
        max_order = DEFAULT_MAX_ORDER
    try:
        per_day = int(settings.get('webull_max_per_day') or DEFAULT_MAX_PER_DAY)
    except (TypeError, ValueError):
        per_day = DEFAULT_MAX_PER_DAY
    return {'maxOrder': max_order, 'maxPerDay': per_day}


def _fingerprint():
    """Identifies the current keys + environment without storing the secret anywhere new."""
    raw = f"{env()}|{settings.get('webull_app_key')}|{settings.get('webull_app_secret')}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ---------- signing (from the official SDK) ----------

def sign(host, path, query, body_text, app_key, app_secret, timestamp=None, nonce=None):
    """The x-* signing headers for one request. body_text is the exact JSON sent (or None for no body)."""
    headers = {
        'x-app-key': app_key,
        'x-timestamp': timestamp or dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'x-signature-version': '1.0',
        'x-signature-algorithm': 'HMAC-SHA256',
        'x-signature-nonce': nonce or uuid.uuid4().hex,
    }
    params = {**headers, 'host': host}
    for k, v in (query or {}).items():
        params[k] = f'{params[k]}&{v}' if k in params else str(v)
    text = path + '&' + '&'.join(f'{k}={v}' for k, v in sorted(params.items()))
    if body_text is not None:
        text += '&' + hashlib.sha256(body_text.encode()).hexdigest().upper()
    digest = hmac.new((app_secret + '&').encode(), quote(text, safe='').encode(), hashlib.sha256).digest()
    headers['x-signature'] = base64.b64encode(digest).decode()
    return headers


# ---------- HTTP ----------

class Busy(EngineError):
    """HTTP 429: Webull rejected the request before processing it (its docs: no partial processing)."""


class NotSent(EngineError):
    """The request was never sent: its deadline passed while it waited for its turn."""


_locks = {}
_last_call = {}   # path -> monotonic time of the last request to it
_reads = {}       # cache key -> (expires, value, fetched at (unix time))
_gen = {}         # account id (or '*') -> generation, bumped by forget(): older reads are not stored


def _lock(name):
    """One asyncio.Lock per name and event loop (tests run a new loop each time)."""
    loop = asyncio.get_running_loop()
    held = _locks.get(name)
    if held is None or held[0] is not loop:
        held = _locks[name] = (loop, asyncio.Lock())
    return held[1]


async def _cached(key, ttl, fetch, fresh=False):
    """A read result reused for ttl seconds. Callers asking for the same thing at once share one Webull call.
    fresh=True skips the stored value (and stores the new one). Failures are never stored."""
    key = (_fingerprint(),) + tuple(key)
    async with _lock(('read',) + key):
        hit = _reads.get(key)
        if not fresh and hit and hit[0] > time.monotonic():
            return hit[1]
        before = _generation(key)
        value = await fetch()
        if _generation(key) == before:  # an order/cancel since the read started: its result may be old, don't keep it
            _reads[key] = (time.monotonic() + ttl, value, time.time())
        return value


def _generation(key):
    return _gen.get('*', 0), _gen.get(key[2] if len(key) > 2 else None, 0)


def fetched_at(key):
    """When a cached read was fetched from Webull (unix time), or None."""
    hit = _reads.get((_fingerprint(),) + tuple(key))
    return hit[2] if hit else None


def forget(account_id=None):
    """Drops cached reads for one account (after an order, a cancel or a sync), or all of them, and makes reads that
    are already on their way not store their (possibly older) result."""
    name = '*' if account_id is None else account_id
    _gen[name] = _gen.get(name, 0) + 1
    for key in list(_reads):
        if account_id is None or account_id in key:
            _reads.pop(key, None)


def _retry_after(response, attempt):
    headers = getattr(response, 'headers', None) or {}
    for name in ('Retry-After', 'retry-after', 'X-RateLimit-Reset', 'x-ratelimit-reset'):
        v = _num(headers.get(name)) if hasattr(headers, 'get') else None
        if v is not None and v >= 0:
            if v > 1e9:  # an epoch time, not a number of seconds
                v -= time.time()
            return min(max(v, 0), 30)
    return RETRY_WAITS[min(attempt, len(RETRY_WAITS) - 1)]


class Uncertain(EngineError):
    """No clear answer from Webull (network failure, timeout or a server error): the request may or may not have
    been carried out. For an order this must never be read as "not placed"."""


def _message(data, status):
    if isinstance(data, dict):
        for k in ('message', 'msg', 'error_msg', 'error'):
            if isinstance(data.get(k), str) and data[k]:
                return data[k]
    return f'Webull returned an error ({status}).'


async def _call(ctx, method, path, query=None, body=None, version='v3', extra=None, use_token=True, deadline=None):
    """One Webull request through the gate. deadline (time.monotonic()) = the latest moment it may be sent; if it
    can't be sent by then it raises NotSent and nothing reached Webull. Once sent, no deadline applies."""
    if not available():
        raise EngineError(NO_KEYS)
    host = HOSTS[env()]
    query = {k: str(v) for k, v in (query or {}).items() if v is not None}
    body_text = json.dumps(body, ensure_ascii=False, separators=(',', ':')) if body is not None else None
    headers = sign(host, path, query, body_text, settings.get('webull_app_key'), settings.get('webull_app_secret'))
    headers.update({'x-version': version, 'Content-Type': 'application/json', 'Accept': 'application/json', **(extra or {})})
    def left():
        return None if deadline is None else deadline - time.monotonic()

    # Never wrap a lock in a wait_for timeout: on Python < 3.12 a timeout firing just as the lock is taken can leave it
    # locked for good. Locks are taken normally and the deadline is checked once held.
    if use_token:
        token = await _access_token(ctx)
        if deadline is not None and left() <= 0:
            raise NotSent(NOT_SENT)
        if token:
            headers['x-access-token'] = token
    url = f'https://{host}{path}' + (f'?{urlencode(query)}' if query else '')
    attempt = 0
    gate = _lock('gate')
    while True:
        # One Webull request at a time, spaced per endpoint. Nobody sleeps while holding the gate: a request that
        # must wait for its endpoint lets go, sleeps and queues again, so it can't hold up an order.
        response = None
        while response is None:
            await gate.acquire()  # the deadline is checked below, once held (and the gate released if it passed)
            try:
                wait = _last_call.get(path, -1e9) + SPACING.get(path, DEFAULT_SPACING) - time.monotonic()
                if wait <= 0:
                    if deadline is not None and left() <= 0:
                        raise NotSent(NOT_SENT)
                    try:
                        response = await ctx.http.request(method, url, headers=headers, content=body_text.encode() if body_text is not None else None)
                    except EngineError:
                        raise
                    except Exception as err:
                        raise Uncertain(f'Could not reach Webull ({type(err).__name__}). Check your internet connection.') from err
                    finally:
                        _last_call[path] = time.monotonic()
            finally:
                gate.release()
            if response is None:
                if deadline is not None and wait > left():
                    raise NotSent(NOT_SENT)
                await asyncio.sleep(wait)
        if response.status_code != 429:
            break
        if method != 'GET' or attempt >= len(RETRY_WAITS):
            raise Busy(BUSY)  # orders, previews and tokens are never retried here
        pause = _retry_after(response, attempt)
        _last_call[path] = time.monotonic() + pause  # others asking for this endpoint wait too
        await asyncio.sleep(pause)
        attempt += 1
        # a retry is a new request: fresh timestamp and nonce
        headers.update(sign(host, path, query, body_text, settings.get('webull_app_key'), settings.get('webull_app_secret')))
    try:
        data = response.json()
    except Exception:
        data = None
    if response.status_code in (401, 403):
        if use_token:
            _forget_token()
        raise EngineError(f'{BAD_KEYS} ({_message(data, response.status_code)})')
    if response.status_code >= 500:
        raise Uncertain(_message(data, response.status_code))
    if response.status_code != 200:
        raise EngineError(_message(data, response.status_code))
    return data


# ---------- access token (one-time approval in the Webull app, when Webull asks for it) ----------

def _read_token():
    try:
        saved = json.loads(TOKEN_PATH.read_text())
    except (OSError, ValueError):
        return None
    return saved if isinstance(saved, dict) and saved.get('for') == _fingerprint() else None


def _save_token(data):
    DATA_DIR.mkdir(exist_ok=True)
    TOKEN_PATH.write_text(json.dumps({'for': _fingerprint(), 'token': data.get('token'), 'expires': data.get('expires'), 'status': data.get('status')}))
    try:
        TOKEN_PATH.chmod(0o600)
    except OSError:
        pass


def _forget_token():
    try:
        TOKEN_PATH.unlink()
    except OSError:
        pass


def _expired(expires):
    try:
        value = float(expires)
    except (TypeError, ValueError):
        return False  # unknown format: let Webull say when it has expired (401 -> forgotten)
    if value > 1e12:
        value /= 1000
    return value < time.time() + 60


async def _access_token(ctx):
    async with _lock('token'):  # one token check/create at a time, so parallel requests never make several tokens
        return await _access_token_locked(ctx)


async def _access_token_locked(ctx):
    fp = _fingerprint()
    if fp not in _config_cache:
        try:
            cfg = await _call(ctx, 'GET', '/openapi/config', use_token=False)
        except EngineError as err:
            if str(err).startswith(BAD_KEYS):
                raise
            return None  # config unavailable: try without; the real request reports any problem
        _config_cache[fp] = bool(isinstance(cfg, dict) and cfg.get('token_check_enabled'))
    if not _config_cache[fp]:
        return None
    saved = _read_token()
    if saved and saved.get('token') and not _expired(saved.get('expires')):
        if saved.get('status') == 'NORMAL':
            return saved['token']
        if saved.get('status') == 'PENDING':
            checked = await _call(ctx, 'POST', '/auth/tokens/check', body={'token': saved['token']}, use_token=False) or {}
            if checked.get('status') == 'NORMAL':
                _save_token({**saved, **checked, 'token': checked.get('token') or saved['token']})
                return checked.get('token') or saved['token']
            if checked.get('status') == 'PENDING':
                raise EngineError(APPROVE)
    body = {'token': saved['token']} if saved and saved.get('token') else {}
    created = await _call(ctx, 'POST', '/auth/tokens/create', body=body, use_token=False) or {}
    if not created.get('token'):
        raise EngineError('Webull did not return an access token. Try Test connection again in a minute.')
    _save_token(created)
    if created.get('status') == 'NORMAL':
        return created['token']
    raise EngineError(APPROVE)


# ---------- reading the account ----------

# Field names used below are the documented ones (Webull OpenAPI reference: accounts account_id/account_number/
# account_type; balance total_cash_balance and account_currency_assets[] {currency, cash_balance, buying_power},
# total_asset; positions symbol, quantity, cost_price, instrument_type, unrealized_profit_loss, items[]; orders
# {has_next, orders[]} with client_order_id, symbol, side, quantity, filled_quantity, order_type, limit_price,
# stop_price, time_in_force, status). Nothing is guessed: a missing required field is an error, never a default.

FORMAT = 'Webull’s reply was not in the expected format, so nothing was guessed. Try again; if it keeps happening, send me the helper log.'
STOCK_TYPES = {'EQUITY', 'STOCK', 'ETF'}


def _list(data, key):
    """The list in a reply: the reply itself, or data[key]. Anything else is refused."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get(key), list):
        return data[key]
    raise EngineError(FORMAT)


def _num(value):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out and out not in (float('inf'), float('-inf')) else None


def _need(row, key):
    """A required number from a reply row; missing or not a number -> refuse, never a default."""
    v = _num(row.get(key)) if isinstance(row, dict) else None
    if v is None:
        raise EngineError(FORMAT)
    return v


def _mask(account_id):
    s = str(account_id or '')
    return f'…{s[-4:]}' if len(s) > 4 else s


async def accounts(ctx, fresh=False):
    """The owner's accounts [{id, label}], reused for 10 minutes (Webull allows 10 account-list calls per 30 s)."""
    return await _cached(('accounts',), ACCOUNTS_TTL, lambda: _fetch_accounts(ctx), fresh)


async def _fetch_accounts(ctx):
    data = await _call(ctx, 'GET', '/trading/accounts/list')
    out = []
    for a in _list(data, 'accounts'):
        if not isinstance(a, dict) or not a.get('account_id'):
            raise EngineError(FORMAT)
        number = a.get('account_number') or a.get('account_id')
        kind = str(a.get('account_type') or '')
        out.append({'id': str(a['account_id']), 'label': f"{_mask(number)}{f' ({kind.title()})' if kind else ''}"})
    return out


async def _account(ctx, msg):
    """The chosen account ({id, label}); the first one when none is named. Refuses an id that isn't the owner's."""
    found = await accounts(ctx)
    if not found:
        raise EngineError('Webull returned no accounts for these keys.')
    wanted = str(msg.get('accountId') or '')
    if not wanted:
        return found[0]
    for a in found:
        if a['id'] == wanted:
            return a
    raise EngineError('That account is not one of yours on Webull.')


async def _account_id(ctx, msg):
    return (await _account(ctx, msg))['id']


async def balances(ctx, account_id):
    d = await _call(ctx, 'GET', '/trading/assets/balances/get', {'account_id': account_id, 'total_asset_currency': 'USD'})
    if not isinstance(d, dict):
        raise EngineError(FORMAT)
    usd = next((c for c in d.get('account_currency_assets') or [] if isinstance(c, dict) and c.get('currency') == 'USD'), {})
    cash = _num(d.get('total_cash_balance'))
    if cash is None:
        cash = _num(usd.get('cash_balance'))
    if cash is None:
        raise EngineError('Webull’s balance reply has no cash balance, so nothing is shown rather than a guess.')
    return {'value': _num(d.get('total_asset')), 'cash': cash, 'buyingPower': _num(usd.get('buying_power'))}


def _first_item(row):
    items = row.get('items')
    return items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else {}


async def positions(ctx, account_id):
    """Positions as {symbol, qty, avgCost, cost, gain, type}. A row without a symbol or quantity is refused."""
    data = await _call(ctx, 'GET', '/trading/assets/positions/list', {'account_id': account_id})
    out = []
    for p in _list(data, 'positions'):
        if not isinstance(p, dict):
            raise EngineError(FORMAT)
        item = _first_item(p)
        symbol = p.get('symbol') or item.get('symbol')
        if not isinstance(symbol, str) or not symbol:
            raise EngineError(FORMAT)
        qty = _need(p, 'quantity')
        avg = _num(p.get('cost_price'))
        out.append({'symbol': symbol.upper(), 'qty': qty, 'avgCost': avg, 'cost': avg * qty if avg is not None else None,
                    'gain': _num(p.get('unrealized_profit_loss')),
                    # unknown type -> not a stock: it can't back a sell (fail closed) or be synced as shares
                    'type': str(p.get('instrument_type') or item.get('instrument_type') or 'UNKNOWN').upper()})
    return out


def _order_rows(data):
    out = []
    for o in _list(data, 'orders'):
        if not isinstance(o, dict):
            raise EngineError(FORMAT)
        subs = o['orders'] if isinstance(o.get('orders'), list) else [o]  # combo orders hold their legs in 'orders'
        for s in subs:
            if not isinstance(s, dict):
                raise EngineError(FORMAT)
            order_id = s.get('client_order_id') or o.get('client_order_id')
            symbol, side, status = s.get('symbol'), s.get('side'), s.get('status') or o.get('status')
            if not all(isinstance(v, str) and v for v in (order_id, symbol, side, status)):
                raise EngineError(FORMAT)
            out.append({
                'orderId': order_id,
                'symbol': symbol.upper(),
                'side': side.upper(),
                'qty': _need(s, 'quantity'),
                'filled': _num(s.get('filled_quantity')) or 0,  # missing = nothing filled: the cautious reading
                'type': str(s.get('order_type') or '').upper(),
                'limitPrice': _num(s.get('limit_price')),
                'stopPrice': _num(s.get('stop_price')),
                'tif': str(s.get('time_in_force') or '').upper(),
                'status': status.upper(),
                'placedAt': s.get('place_time') or '',
            })
    return out


async def open_orders(ctx, account_id):
    return _order_rows(await _call(ctx, 'GET', '/trading/orders/open-orders/list', {'account_id': account_id, 'page_size': 100}, version='v2'))


async def orders(ctx, account_id):
    open_rows = await open_orders(ctx, account_id)
    start = (dt.datetime.now(NEW_YORK).date() - dt.timedelta(days=7)).isoformat()
    try:
        recent_data = await _call(ctx, 'GET', '/trading/orders/historical-orders/list', {'account_id': account_id, 'page_size': 50, 'start_date': start}, version='v2')
        recent = _order_rows(recent_data)
    except EngineError:
        recent = []
    open_ids = {r['orderId'] for r in open_rows}
    return {'open': open_rows, 'recent': [r for r in recent if r['orderId'] not in open_ids][:50]}


# ---------- order log and limits ----------

def _log(entry):
    """Appends one line to orders.log. Only order facts: never keys, secrets or tokens."""
    DATA_DIR.mkdir(exist_ok=True)
    line = {'time': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'env': env(), **entry}
    with ORDERS_LOG.open('a', encoding='utf-8') as f:
        f.write(json.dumps(line) + '\n')


LOG_UNREADABLE = 'The order log (~/.trading-platform/orders.log) can’t be read, so today’s order count is unknown and no order is placed. Fix or move that file, then try again.'


def placed_today(environment=None):
    """Orders sent (or attempted) through the platform today, New York date, in this environment, from orders.log.
    Every attempt counts, whatever its result, so two confirm windows can't both get under the daily limit.
    An unreadable log refuses (EngineError): the count must never silently read as 0."""
    environment = environment or env()
    today = dt.datetime.now(NEW_YORK).date()
    try:
        lines = ORDERS_LOG.read_text(encoding='utf-8').splitlines()
    except FileNotFoundError:
        return 0
    except (OSError, UnicodeDecodeError) as err:
        raise EngineError(LOG_UNREADABLE) from err
    count = 0
    for line in lines:
        if not line.strip():
            continue
        try:
            e = json.loads(line)
            when = dt.datetime.fromisoformat(e['time']).astimezone(NEW_YORK).date()
        except (ValueError, KeyError, TypeError, AttributeError) as err:
            raise EngineError(LOG_UNREADABLE) from err
        if e.get('action') == 'place' and e.get('result') == 'attempt' and e.get('env') == environment and when == today:
            count += 1
    return count


# ---------- checking an order ----------

def _price(value, label):
    v = _num(value)
    if v is None or v <= 0 or v > 1_000_000:
        raise EngineError(f'Enter a {label} above $0.')
    places = 2 if v >= 1 else 4
    if abs(round(v, places) - v) > 1e-9:
        raise EngineError(f'The {label} can have at most {places} decimals.')
    return round(v, places)


def normalise(msg):
    """The order fields from a request, checked for shape. Raises EngineError with a plain reason."""
    symbol = str(msg.get('symbol') or '').strip().upper()
    if not SYMBOL.match(symbol):
        raise EngineError('Enter a US stock symbol (letters only, e.g. AAPL or BRK.B). Options and other assets are not supported.')
    side = str(msg.get('side') or '').upper()
    if side not in ('BUY', 'SELL'):
        raise EngineError('Choose Buy or Sell.')
    qty = msg.get('qty')
    if isinstance(qty, bool) or not isinstance(qty, (int, float, str)):
        raise EngineError('Enter a whole number of shares.')
    try:
        qty_f = float(qty)
    except ValueError:
        raise EngineError('Enter a whole number of shares.') from None
    if qty_f <= 0 or qty_f != int(qty_f) or qty_f > 1_000_000:
        raise EngineError('Enter a whole number of shares above 0.')
    kind = str(msg.get('orderType') or '').upper().replace('-', '_')
    if kind not in ORDER_TYPES:
        raise EngineError('Choose Market, Limit, Stop or Stop-limit.')
    tif = str(msg.get('tif') or 'DAY').upper()
    if tif not in ('DAY', 'GTC'):
        raise EngineError('Choose Day or GTC.')
    if kind == 'MARKET' and tif != 'DAY':
        raise EngineError('Market orders are Day only.')
    order = {'symbol': symbol, 'side': side, 'qty': int(qty_f), 'orderType': kind, 'tif': tif, 'limitPrice': None, 'stopPrice': None}
    if kind in ('LIMIT', 'STOP_LIMIT'):
        order['limitPrice'] = _price(msg.get('limitPrice'), 'limit price')
    if kind in ('STOP', 'STOP_LIMIT'):
        order['stopPrice'] = _price(msg.get('stopPrice'), 'stop price')
    return order


def describe(order):
    """The order in plain words, e.g. "Buy 3 AAPL at a limit of $228.50, day only"."""
    head = f"{'Buy' if order['side'] == 'BUY' else 'Sell'} {order['qty']} {order['symbol']}"
    lp, sp = order['limitPrice'], order['stopPrice']
    kind = order['orderType']
    if kind == 'MARKET':
        how = 'at market'
    elif kind == 'LIMIT':
        how = f'at a limit of ${lp:,.2f}'
    elif kind == 'STOP':
        how = f'with a stop at ${sp:,.2f} (then market)'
    else:
        how = f'with a stop at ${sp:,.2f}, then a limit of ${lp:,.2f}'
    return f"{head} {how}, {'good till cancelled' if order['tif'] == 'GTC' else 'day only'}"


def webull_order(order, client_order_id):
    """The order in Webull's format (POST /trading/orders/preview and /place, new_orders[0])."""
    out = {
        'combo_type': 'NORMAL',
        'client_order_id': client_order_id,
        'symbol': order['symbol'],
        'instrument_type': 'EQUITY',
        'market': 'US',
        'order_type': ORDER_TYPES[order['orderType']],
        'quantity': str(order['qty']),
        'support_trading_session': 'CORE',
        'side': order['side'],
        'time_in_force': order['tif'],
        'entrust_type': 'QTY',
    }
    if order['limitPrice'] is not None:
        out['limit_price'] = f"{order['limitPrice']}"
    if order['stopPrice'] is not None:
        out['stop_price'] = f"{order['stopPrice']}"
    return out


async def last_price(ctx, symbol):
    """The last Schwab price, used to sanity-check prices and estimate a market order's value."""
    from . import invest
    try:
        row = (await invest.quotes(ctx, [symbol])).get(symbol) or {}
    except Exception:
        row = {}
    return _num(row.get('price'))


def check(order, last, held, today_count, lim):
    """The safety checks that don't need Webull. Returns (estimated value, warnings); raises EngineError to refuse."""
    if last is None or last <= 0:
        raise EngineError(f"Couldn't get a current price for {order['symbol']} from Schwab to check the order. Make sure the helper is logged in to Schwab and the symbol is right.")
    for key, label in (('limitPrice', 'limit'), ('stopPrice', 'stop')):
        p = order[key]
        if p is not None and abs(p / last - 1) > PRICE_BAND:
            raise EngineError(f"The {label} price ${p:,.2f} is more than {PRICE_BAND:.0%} away from the last price ${last:,.2f}. Check for a typo.")
    basis = order['limitPrice'] if order['limitPrice'] is not None else order['stopPrice'] if order['stopPrice'] is not None else last
    value = round(order['qty'] * basis, 2)
    if value > lim['maxOrder']:
        raise EngineError(f"This order is about ${value:,.0f}, above your maximum order value of ${lim['maxOrder']:,.0f} (change it in Settings).")
    if today_count >= lim['maxPerDay']:
        raise EngineError(f"You've placed {today_count} orders today, your daily maximum (change it in Settings).")
    if order['side'] == 'SELL' and order['qty'] > max(held or 0, 0):
        raise EngineError(f"You can sell at most {max(held or 0, 0):g} {order['symbol']} (shares you hold minus open sell orders); "
                          f"selling {order['qty']} would be a short sale, which is blocked.")
    warnings = []
    kind, side = order['orderType'], order['side']
    lp, sp = order['limitPrice'], order['stopPrice']
    if kind == 'LIMIT' and ((side == 'BUY' and lp > last * 1.01) or (side == 'SELL' and lp < last * 0.99)):
        warnings.append('The limit is past the current price, so it will probably fill straight away like a market order.')
    if kind in ('STOP', 'STOP_LIMIT') and ((side == 'BUY' and sp <= last) or (side == 'SELL' and sp >= last)):
        warnings.append('The stop is already past the current price, so it would trigger straight away.')
    if kind == 'MARKET':
        warnings.append('A market order fills at whatever the price is when it reaches the market; the value shown is an estimate.')
    session = market_session()
    note = {'open': 'The market is open.', 'extended': 'The market is closed (extended hours). This order is for the regular session and will wait for the next open.',
            'closed': 'The market is closed. The order will wait for the next regular session.'}[session]
    return value, warnings, note


# ---------- handlers ----------

def _unavailable(message):
    return {'ok': False, 'env': env(), 'liveEnabled': live_enabled(), 'keysSet': available(), 'limits': limits(), 'message': message, 'accounts': []}


@handler('webull.status')
async def status(ctx, msg):
    if not available():
        return _unavailable(NO_KEYS)
    try:
        found = await accounts(ctx)
    except EngineError as err:
        return {**_unavailable(str(err)), 'busy': isinstance(err, Busy)}
    try:
        today = placed_today()
    except EngineError:
        today = None  # shown as unknown here; placing an order refuses until the log is readable
    return {'ok': True, 'env': env(), 'liveEnabled': live_enabled(), 'keysSet': True, 'limits': limits(), 'accounts': found,
            'placedToday': today,
            'message': f"Connected to Webull {'LIVE (real money)' if env() == 'live' else 'Test (no real money)'}: {len(found)} account{'s' if len(found) != 1 else ''}."}


def cached_balances(ctx, account_id, fresh=False):
    return _cached(('balances', account_id), READ_TTL, lambda: balances(ctx, account_id), fresh)


def cached_positions(ctx, account_id, fresh=False):
    return _cached(('positions', account_id), READ_TTL, lambda: positions(ctx, account_id), fresh)


def cached_orders(ctx, account_id, fresh=False):
    return _cached(('orders', account_id), READ_TTL, lambda: orders(ctx, account_id), fresh)


async def priced_positions(ctx, account_id, fresh=False):
    """Positions with Schwab prices for display (Webull's positions reply carries no price): price, value, gain and
    today's gain (dayGain = shares x Schwab's net change; None when Schwab has no figure)."""
    from . import invest
    rows = [dict(r) for r in await cached_positions(ctx, account_id, fresh)]
    try:
        quotes = await invest.quotes(ctx, sorted({r['symbol'] for r in rows})) if rows else {}
    except Exception:
        quotes = {}
    for r in rows:
        q = quotes.get(r['symbol']) or {}
        price, change = _num(q.get('price')), _num(q.get('netChange'))
        r['price'] = price
        r['value'] = price * r['qty'] if price is not None else None
        r['dayGain'] = change * r['qty'] if change is not None else None
        if r['gain'] is None and r['value'] is not None and r['cost'] is not None:
            r['gain'] = r['value'] - r['cost']
    return rows


@handler('webull.account')
async def account(ctx, msg):
    account_id = await _account_id(ctx, msg)
    return {'accountId': account_id, 'env': env(), **(await cached_balances(ctx, account_id))}


@handler('webull.positions')
async def positions_handler(ctx, msg):
    account_id = await _account_id(ctx, msg)
    return {'accountId': account_id, 'env': env(), 'positions': await priced_positions(ctx, account_id)}


@handler('webull.orders')
async def orders_handler(ctx, msg):
    account_id = await _account_id(ctx, msg)
    return {'accountId': account_id, 'env': env(), **(await cached_orders(ctx, account_id))}


@handler('webull.snapshot')
async def snapshot(ctx, msg):
    """Everything a Webull view shows in one request, read one after another through the gate: the status fields
    (ok, env, accounts, limits, placedToday, message), balances, positions (with Schwab prices), open and recent
    orders. A section that fails is None with its reason in errors[section]; the others still show."""
    head = await status(ctx, msg)
    if not head['ok']:
        return head
    chosen = await _account(ctx, msg)
    account_id = chosen['id']
    out = {**head, 'accountId': account_id, 'account': chosen['label'], 'balances': None, 'positions': None, 'open': None, 'recent': None, 'errors': {},
           'asOf': None}
    for section, read in (('balances', lambda: cached_balances(ctx, account_id)), ('positions', lambda: priced_positions(ctx, account_id)),
                          ('orders', lambda: cached_orders(ctx, account_id))):
        try:
            value = await read()
        except EngineError as err:
            out['errors'][section] = str(err)
            continue
        if section == 'orders':
            out['open'], out['recent'] = value['open'], value['recent']
        else:
            out[section] = value
    # when the oldest shown section was fetched from Webull (unix time); now if a result wasn't kept
    stamps = [fetched_at((k, account_id)) or time.time() for k in ('balances', 'positions', 'orders') if k not in out['errors']]
    out['asOf'] = min(stamps) if stamps else None
    return out


@handler('webull.sync')
async def sync(ctx, msg):
    """Saves (or updates) the portfolio "Webull <account>" with the account's stocks (shares + total cost) and cash."""
    from . import store
    account_id = await _account_id(ctx, msg)
    held = await cached_positions(ctx, account_id, fresh=True)  # a sync always reads Webull now (still through the gate)
    try:
        cash = (await cached_balances(ctx, account_id, fresh=True)).get('cash')
    except EngineError:
        cash = None
    holdings = [{'symbol': p['symbol'], 'weight': 0, 'assetClass': 'US stocks', 'kind': 'security', 'shares': p['qty'],
                 **({'cost': round(p['cost'], 2)} if p['cost'] is not None else {})}
                for p in held if p['qty'] > 0 and p['type'] in STOCK_TYPES]
    if cash:
        holdings.append({'symbol': 'CASH', 'name': 'Webull cash', 'weight': 0, 'assetClass': 'Cash', 'kind': 'cash', 'amount': round(cash, 2)})
    name = f"Webull {_mask(account_id)}{' (Test)' if env() == 'test' else ''}"
    existing = next((p for p in store.list_docs('portfolios') if p.get('webullAccount') == account_id and p.get('webullEnv', 'live') == env()), None)
    doc = {**(existing or {'benchmark': 'SPY', 'rebalance': 'none'}), 'name': (existing or {}).get('name') or name, 'mode': 'shares',
           'holdings': holdings, 'webullAccount': account_id, 'webullEnv': env(), 'syncedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    saved = store.save_doc('portfolios', doc)
    skipped = len(held) - len([h for h in holdings if h['kind'] == 'security'])
    return {'portfolio': saved, 'skipped': skipped}


@handler('webull.preview_order')
async def preview_order(ctx, msg):
    order = normalise(msg)
    chosen = await _account(ctx, msg)
    account_id = chosen['id']
    lim = limits()
    held = None
    if order['side'] == 'SELL':
        # Only stock positions back a sell, and shares already in open sell orders aren't available again.
        held = sum(p['qty'] for p in await positions(ctx, account_id) if p['symbol'] == order['symbol'] and p['type'] in STOCK_TYPES)
        held -= sum(max(o['qty'] - o['filled'], 0) for o in await open_orders(ctx, account_id) if o['symbol'] == order['symbol'] and o['side'] == 'SELL')
    last = await last_price(ctx, order['symbol'])
    value, warnings, note = check(order, last, held, placed_today(), lim)
    client_order_id = uuid.uuid4().hex
    body = {'account_id': account_id, 'new_orders': [webull_order(order, client_order_id)]}
    try:
        await _call(ctx, 'POST', '/trading/orders/preview', body=body, extra={'category': 'US_EQUITY'})  # Webull's own check
    except Busy:
        raise EngineError('Webull is busy (too many requests). Wait a few seconds and preview again.') from None
    estimate = {'value': value, 'last': last}
    for k in [k for k, v in _previews.items() if v['expires'] < time.monotonic()]:
        _previews.pop(k, None)
    token = secrets.token_urlsafe(24)
    _previews[token] = {'order': order, 'body': body, 'env': env(), 'fp': _fingerprint(), 'expires': time.monotonic() + TOKEN_SECONDS,
                        'value': value, 'account': account_id}
    return {'token': token, 'expiresIn': TOKEN_SECONDS, 'order': order, 'summary': describe(order), 'estimate': estimate,
            'env': env(), 'account': chosen['label'], 'warnings': warnings, 'marketNote': note,
            'limits': lim, 'placedToday': placed_today()}


@handler('webull.place_order')
async def place_order(ctx, msg):
    deadline = time.monotonic() + PLACE_DEADLINE  # the order must be sent by then, or it is refused as not placed
    extra = {k for k in msg if k not in ('id', 'type', 'token') and not str(k).startswith('_')}  # '_emit' is added by the helper
    token = msg.get('token')
    preview = _previews.pop(token, None) if isinstance(token, str) else None  # one use: gone even if placing fails
    if extra:
        _log({'action': 'place', 'result': 'refused', 'reason': 'order fields sent with the token'})
        raise EngineError('Placing takes only the preview token. Preview the order again.')
    if preview is None:
        _log({'action': 'place', 'result': 'refused', 'reason': 'missing or already used token'})
        raise EngineError('This preview was already used or is unknown. Preview the order again.')
    order = preview['order']
    base = {'action': 'place', 'order': describe(order), 'account': _mask(preview['account']), 'value': preview['value']}
    if preview['expires'] < time.monotonic():
        _log({**base, 'result': 'refused', 'reason': 'preview expired'})
        raise EngineError(f'The preview expired (it is valid for {TOKEN_SECONDS} seconds). Preview the order again.')
    if preview['env'] != env() or preview['fp'] != _fingerprint():
        _log({**base, 'result': 'refused', 'reason': 'settings changed since preview'})
        raise EngineError('Your Webull settings changed since the preview. Preview the order again.')
    if env() == 'live' and not live_enabled():
        _log({**base, 'result': 'refused', 'reason': 'live not enabled'})
        raise EngineError('Live trading is not switched on. Turn it on in Settings (type LIVE) or use Test.')
    lim = limits()
    if preview['value'] > lim['maxOrder']:
        _log({**base, 'result': 'refused', 'reason': 'above max order value'})
        raise EngineError('This order is above your maximum order value. Preview it again.')
    if placed_today() >= lim['maxPerDay']:
        _log({**base, 'result': 'refused', 'reason': 'daily order limit'})
        raise EngineError(f"You've reached your daily maximum of {lim['maxPerDay']} orders.")
    # The checks above and this line run with no await in between, so two confirm windows can't both pass the
    # daily limit: the first attempt is counted before the second is checked.
    _log({**base, 'result': 'attempt'})
    client_order_id = preview['body']['new_orders'][0]['client_order_id']
    done = {'placed': True, 'orderId': client_order_id, 'env': env(), 'summary': describe(order)}
    forget(preview['account'])  # whatever happens next, the account's cached balances/positions/orders are old
    try:
        await _call(ctx, 'POST', '/trading/orders/place', body=preview['body'], extra={'category': 'US_EQUITY'}, deadline=deadline)
    except NotSent as err:
        # Never sent: it waited too long for its turn. Logged and counted as an attempt, reported as not placed.
        _log({**base, 'result': 'failed', 'reason': 'not sent: waited past the deadline'})
        raise EngineError(NOT_SENT) from err
    except Busy as err:
        # 429: Webull rejected it before processing (documented), so it was not placed. Still counted as an attempt.
        _log({**base, 'result': 'failed', 'reason': 'webull busy (429)'})
        raise EngineError(BUSY_PLACE) from err
    except Uncertain as err:
        # Timeout, network failure or server error: Webull may have the order. Never report "not placed".
        _log({**base, 'result': 'unknown', 'orderId': client_order_id, 'reason': str(err)[:300]})
        if await order_exists(ctx, preview['account'], client_order_id):
            _log({**base, 'result': 'placed', 'orderId': client_order_id, 'note': 'confirmed by looking it up'})
            return done
        raise EngineError(UNCONFIRMED) from err
    except EngineError as err:
        _log({**base, 'result': 'failed', 'reason': str(err)[:300]})
        raise
    _log({**base, 'result': 'placed', 'orderId': client_order_id})
    return done


async def order_exists(ctx, account_id, client_order_id):
    """Looks an order up once by its client order id (GET /trading/orders/get). False also when the lookup fails."""
    try:
        reply = await _call(ctx, 'GET', '/trading/orders/get', {'account_id': account_id, 'client_order_id': client_order_id})
    except EngineError:
        return False
    if not isinstance(reply, dict):
        return False
    ids = {reply.get('client_order_id')} | {o.get('client_order_id') for o in reply.get('orders') or [] if isinstance(o, dict)}
    return client_order_id in ids


@handler('webull.cancel_order')
async def cancel_order(ctx, msg):
    order_id = str(msg.get('orderId') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_\-]{1,64}', order_id):
        raise EngineError('Unknown order.')
    account_id = await _account_id(ctx, msg)
    base = {'action': 'cancel', 'orderId': order_id, 'account': _mask(account_id)}
    forget(account_id)
    try:
        await _call(ctx, 'POST', '/trading/orders/cancel', body={'account_id': account_id, 'client_order_id': order_id})
    except EngineError as err:
        _log({**base, 'result': 'failed', 'reason': str(err)[:300]})
        raise
    _log({**base, 'result': 'cancel requested'})
    return {'cancelled': True, 'orderId': order_id}
