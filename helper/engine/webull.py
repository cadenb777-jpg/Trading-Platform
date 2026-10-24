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
APPROVE = 'Webull asks you to approve this API login: open the Webull app on your phone, approve the request, then try again.'

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

def _message(data, status):
    if isinstance(data, dict):
        for k in ('message', 'msg', 'error_msg', 'error'):
            if isinstance(data.get(k), str) and data[k]:
                return data[k]
    return f'Webull returned an error ({status}).'


async def _call(ctx, method, path, query=None, body=None, version='v3', extra=None, use_token=True):
    if not available():
        raise EngineError(NO_KEYS)
    host = HOSTS[env()]
    query = {k: str(v) for k, v in (query or {}).items() if v is not None}
    body_text = json.dumps(body, ensure_ascii=False, separators=(',', ':')) if body is not None else None
    headers = sign(host, path, query, body_text, settings.get('webull_app_key'), settings.get('webull_app_secret'))
    headers.update({'x-version': version, 'Content-Type': 'application/json', 'Accept': 'application/json', **(extra or {})})
    if use_token:
        token = await _access_token(ctx)
        if token:
            headers['x-access-token'] = token
    url = f'https://{host}{path}' + (f'?{urlencode(query)}' if query else '')
    try:
        response = await ctx.http.request(method, url, headers=headers, content=body_text.encode() if body_text is not None else None)
    except EngineError:
        raise
    except Exception as err:
        raise EngineError(f'Could not reach Webull ({type(err).__name__}). Check your internet connection.') from err
    try:
        data = response.json()
    except Exception:
        data = None
    if response.status_code in (401, 403):
        if use_token:
            _forget_token()
        raise EngineError(f'{BAD_KEYS} ({_message(data, response.status_code)})')
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

def _rows(data, *keys):
    """The list inside a Webull reply (it is either the list itself or under one of a few keys)."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in (*keys, 'data', 'items', 'list', 'result'):
            if isinstance(data.get(k), list):
                return data[k]
            if isinstance(data.get(k), dict):
                inner = _rows(data[k], *keys)
                if inner:
                    return inner
    return []


def _num(value):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None


def _pick(d, *names):
    """First number found under any of the names, in d or in the first item of a nested list (e.g. per-currency assets)."""
    if not isinstance(d, dict):
        return None
    for n in names:
        if _num(d.get(n)) is not None:
            return _num(d[n])
    for v in d.values():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            found = _pick(v[0], *names)
            if found is not None:
                return found
    return None


def _mask(account_id):
    s = str(account_id or '')
    return f'…{s[-4:]}' if len(s) > 4 else s


async def accounts(ctx):
    data = await _call(ctx, 'GET', '/trading/accounts/list')
    out = []
    for a in _rows(data, 'accounts'):
        if not isinstance(a, dict) or not a.get('account_id'):
            continue
        number = a.get('account_number') or a.get('account_id')
        kind = ' '.join(str(a.get(k)) for k in ('account_type', 'account_class') if a.get(k))
        out.append({'id': str(a['account_id']), 'label': f"{_mask(number)}{f' ({kind.title()})' if kind else ''}"})
    return out


async def _account_id(ctx, msg):
    found = await accounts(ctx)
    if not found:
        raise EngineError('Webull returned no accounts for these keys.')
    wanted = str(msg.get('accountId') or '')
    if not wanted:
        return found[0]['id']
    if wanted not in {a['id'] for a in found}:
        raise EngineError('That account is not one of yours on Webull.')
    return wanted


async def balances(ctx, account_id):
    data = await _call(ctx, 'GET', '/trading/assets/balances/get', {'account_id': account_id})
    d = data.get('data') if isinstance(data, dict) and isinstance(data.get('data'), dict) else data
    return {
        'value': _pick(d, 'total_asset', 'total_assets', 'net_liquidation_value', 'net_liquidation', 'total_net_asset'),
        'cash': _pick(d, 'total_cash_balance', 'cash_balance', 'settled_cash', 'cash'),
        'buyingPower': _pick(d, 'buying_power', 'day_buying_power', 'cash_power', 'overnight_buying_power', 'margin_power'),
        'marketValue': _pick(d, 'total_market_value', 'market_value'),
    }


def _symbol(item):
    for k in ('symbol', 'ticker'):
        v = item.get(k)
        if isinstance(v, dict):
            v = v.get('symbol')
        if isinstance(v, str) and v:
            return v.upper()
    inst = item.get('instrument') or item.get('items')
    if isinstance(inst, dict):
        return _symbol(inst)
    if isinstance(inst, list) and inst and isinstance(inst[0], dict):
        return _symbol(inst[0])
    return ''


async def positions(ctx, account_id):
    data = await _call(ctx, 'GET', '/trading/assets/positions/list', {'account_id': account_id})
    out = []
    for p in _rows(data, 'positions', 'holdings'):
        if not isinstance(p, dict):
            continue
        qty = _pick(p, 'quantity', 'qty', 'position', 'total_quantity')
        symbol = _symbol(p)
        if not symbol or not qty:
            continue
        avg = _pick(p, 'cost_price', 'average_cost', 'avg_cost', 'avg_price')
        cost = _pick(p, 'total_cost', 'cost')
        if cost is None and avg is not None:
            cost = avg * qty
        price = _pick(p, 'last_price', 'market_price', 'price')
        value = _pick(p, 'market_value')
        if value is None and price is not None:
            value = price * qty
        gain = _pick(p, 'unrealized_profit_loss', 'unrealized_pl')
        if gain is None and value is not None and cost is not None:
            gain = value - cost
        out.append({'symbol': symbol, 'qty': qty, 'avgCost': avg if avg is not None else (cost / qty if cost is not None else None),
                    'cost': cost, 'price': price, 'value': value, 'gain': gain,
                    'type': str(p.get('instrument_type') or 'EQUITY').upper()})
    return out


def _order_rows(data):
    out = []
    for o in _rows(data, 'orders'):
        if not isinstance(o, dict):
            continue
        subs = o.get('orders') if isinstance(o.get('orders'), list) else [o]
        for s in subs:
            if not isinstance(s, dict):
                continue
            out.append({
                'orderId': str(s.get('client_order_id') or o.get('client_order_id') or s.get('order_id') or ''),
                'symbol': _symbol(s),
                'side': str(s.get('side') or '').upper(),
                'qty': _pick(s, 'total_quantity', 'quantity', 'qty'),
                'filled': _pick(s, 'filled_quantity', 'filled_qty') or 0,
                'type': str(s.get('order_type') or '').upper(),
                'limitPrice': _pick(s, 'limit_price'),
                'stopPrice': _pick(s, 'stop_price'),
                'tif': str(s.get('time_in_force') or '').upper(),
                'status': str(s.get('status') or s.get('order_status') or o.get('status') or '').upper(),
                'placedAt': s.get('place_time') or s.get('create_time') or o.get('place_time') or s.get('place_time_at') or '',
            })
    return out


OPEN_STATES = {'SUBMITTED', 'PARTIAL_FILLED', 'PENDING', 'WORKING', 'NEW', 'PARTIALLY_FILLED'}


async def orders(ctx, account_id):
    open_data = await _call(ctx, 'GET', '/trading/orders/open-orders/list', {'account_id': account_id, 'page_size': 100}, version='v2')
    start = (dt.datetime.now(NEW_YORK).date() - dt.timedelta(days=7)).isoformat()
    try:
        recent_data = await _call(ctx, 'GET', '/trading/orders/historical-orders/list', {'account_id': account_id, 'page_size': 50, 'start_date': start}, version='v2')
    except EngineError:
        recent_data = []
    open_rows = _order_rows(open_data)
    open_ids = {r['orderId'] for r in open_rows}
    recent = [r for r in _order_rows(recent_data) if r['orderId'] not in open_ids]
    return {'open': open_rows, 'recent': recent[:50]}


# ---------- order log and limits ----------

def _log(entry):
    """Appends one line to orders.log. Only order facts: never keys, secrets or tokens."""
    DATA_DIR.mkdir(exist_ok=True)
    line = {'time': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'env': env(), **entry}
    with ORDERS_LOG.open('a', encoding='utf-8') as f:
        f.write(json.dumps(line) + '\n')


def placed_today(environment=None):
    """Orders placed through the platform today (New York date) in this environment, from orders.log."""
    environment = environment or env()
    today = dt.datetime.now(NEW_YORK).date()
    count = 0
    try:
        lines = ORDERS_LOG.read_text(encoding='utf-8').splitlines()
    except OSError:
        return 0
    for line in lines:
        try:
            e = json.loads(line)
            when = dt.datetime.fromisoformat(e['time']).astimezone(NEW_YORK).date()
        except (ValueError, KeyError, TypeError):
            continue
        if e.get('action') == 'place' and e.get('result') == 'placed' and e.get('env') == environment and when == today:
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
    words = f"{'Buy' if order['side'] == 'BUY' else 'Sell'} {order['qty']} {order['symbol']} {TYPE_NAMES[order['orderType']].lower()}"
    if order['stopPrice'] is not None:
        words += f" stop ${order['stopPrice']:,.2f}"
    if order['limitPrice'] is not None:
        words += f" limit ${order['limitPrice']:,.2f}"
    return f"{words}, {'good till cancelled' if order['tif'] == 'GTC' else 'day only'}"


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
    if order['side'] == 'SELL' and order['qty'] > (held or 0):
        raise EngineError(f"You hold {held or 0:g} {order['symbol']}; selling {order['qty']} would be a short sale, which is blocked.")
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
        return _unavailable(str(err))
    return {'ok': True, 'env': env(), 'liveEnabled': live_enabled(), 'keysSet': True, 'limits': limits(), 'accounts': found,
            'placedToday': placed_today(),
            'message': f"Connected to Webull {'LIVE (real money)' if env() == 'live' else 'Test (no real money)'}: {len(found)} account{'s' if len(found) != 1 else ''}."}


@handler('webull.account')
async def account(ctx, msg):
    account_id = await _account_id(ctx, msg)
    return {'accountId': account_id, 'env': env(), **(await balances(ctx, account_id))}


@handler('webull.positions')
async def positions_handler(ctx, msg):
    account_id = await _account_id(ctx, msg)
    return {'accountId': account_id, 'env': env(), 'positions': await positions(ctx, account_id)}


@handler('webull.orders')
async def orders_handler(ctx, msg):
    account_id = await _account_id(ctx, msg)
    return {'accountId': account_id, 'env': env(), **(await orders(ctx, account_id))}


@handler('webull.sync')
async def sync(ctx, msg):
    """Saves (or updates) the portfolio "Webull <account>" with the account's stocks (shares + total cost) and cash."""
    from . import store
    account_id = await _account_id(ctx, msg)
    held = await positions(ctx, account_id)
    try:
        cash = (await balances(ctx, account_id)).get('cash')
    except EngineError:
        cash = None
    holdings = [{'symbol': p['symbol'], 'weight': 0, 'assetClass': 'US stocks', 'kind': 'security', 'shares': p['qty'],
                 **({'cost': round(p['cost'], 2)} if p['cost'] is not None else {})}
                for p in held if p['qty'] > 0 and p['type'] in ('EQUITY', 'STOCK', 'ETF')]
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
    account_id = await _account_id(ctx, msg)
    lim = limits()
    held = None
    if order['side'] == 'SELL':
        held = sum(p['qty'] for p in await positions(ctx, account_id) if p['symbol'] == order['symbol'])
    last = await last_price(ctx, order['symbol'])
    value, warnings, note = check(order, last, held, placed_today(), lim)
    client_order_id = uuid.uuid4().hex
    body = {'account_id': account_id, 'new_orders': [webull_order(order, client_order_id)]}
    reply = await _call(ctx, 'POST', '/trading/orders/preview', body=body, extra={'category': 'US_EQUITY'})
    estimate = {'value': value, 'last': last,
                'webullAmount': _pick(reply, 'estimated_cost', 'estimated_amount', 'amount', 'estimate_amount'),
                'fees': _pick(reply, 'estimated_transaction_fee', 'transaction_fee', 'fee', 'commission')}
    for k in [k for k, v in _previews.items() if v['expires'] < time.monotonic()]:
        _previews.pop(k, None)
    token = secrets.token_urlsafe(24)
    _previews[token] = {'order': order, 'body': body, 'env': env(), 'fp': _fingerprint(), 'expires': time.monotonic() + TOKEN_SECONDS,
                        'value': value, 'account': account_id}
    return {'token': token, 'expiresIn': TOKEN_SECONDS, 'order': order, 'summary': describe(order), 'estimate': estimate,
            'env': env(), 'account': _mask(account_id), 'warnings': warnings, 'marketNote': note,
            'limits': lim, 'placedToday': placed_today()}


@handler('webull.place_order')
async def place_order(ctx, msg):
    extra = set(msg) - {'id', 'type', 'token'}
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
    _log({**base, 'result': 'attempt'})
    try:
        reply = await _call(ctx, 'POST', '/trading/orders/place', body=preview['body'], extra={'category': 'US_EQUITY'})
    except EngineError as err:
        _log({**base, 'result': 'failed', 'reason': str(err)[:300]})
        raise
    client_order_id = preview['body']['new_orders'][0]['client_order_id']
    rows = _rows(reply, 'orders')
    order_id = str((rows[0] if rows and isinstance(rows[0], dict) else reply if isinstance(reply, dict) else {}).get('client_order_id') or client_order_id)
    _log({**base, 'result': 'placed', 'orderId': order_id})
    return {'placed': True, 'orderId': order_id, 'env': env(), 'summary': describe(order)}


@handler('webull.cancel_order')
async def cancel_order(ctx, msg):
    order_id = str(msg.get('orderId') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_\-]{1,64}', order_id):
        raise EngineError('Unknown order.')
    account_id = await _account_id(ctx, msg)
    base = {'action': 'cancel', 'orderId': order_id, 'account': _mask(account_id)}
    try:
        await _call(ctx, 'POST', '/trading/orders/cancel', body={'account_id': account_id, 'client_order_id': order_id})
    except EngineError as err:
        _log({**base, 'result': 'failed', 'reason': str(err)[:300]})
        raise
    _log({**base, 'result': 'cancel requested'})
    return {'cancelled': True, 'orderId': order_id}
