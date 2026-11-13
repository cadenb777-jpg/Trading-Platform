"""
Crypto prices and candles through the helper: the backup route when the browser can't reach Coinbase directly (a
blocked or failing request, a firewall, Coinbase refusing the page's origin). Free public data, no keys:

1. Coinbase Exchange public REST (the same data the page asks for, fetched from this computer by the helper).
2. Alpaca crypto market data (v1beta3, public: no keys needed for crypto).
3. Kraken public OHLC.

Candles come back in Coinbase's own format ([time, low, high, open, close, volume], newest first), so the page treats
every source the same. Each reply says which source answered. Market data only: no exchange accounts, no orders.

Requests: crypto.candles {symbol, granularity, start, end}, crypto.stats {symbols}
"""
import datetime as dt

from . import datahub
from .core import EngineError, handler

COINBASE = 'https://api.exchange.coinbase.com'
ALPACA_CRYPTO = 'https://data.alpaca.markets/v1beta3/crypto/us'
KRAKEN = 'https://api.kraken.com/0/public'
ALPACA_TF = {60: '1Min', 300: '5Min', 900: '15Min', 3600: '1Hour', 21600: '6Hour', 86400: '1Day'}
KRAKEN_TF = {60: 1, 300: 5, 900: 15, 3600: 60, 21600: 240, 86400: 1440}
HEADERS = {'Accept': 'application/json', 'User-Agent': 'trading-platform-helper'}


# ---------- pure (tested) ----------

def clean_symbol(symbol):
    s = str(symbol or '').upper().strip()
    if not s or len(s) > 20 or not all(c.isalnum() or c == '-' for c in s) or '-' not in s:
        raise EngineError('Give a crypto pair like BTC-USD.')
    return s


def iso(seconds):
    return dt.datetime.fromtimestamp(int(seconds), dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def alpaca_candles(data, symbol):
    """Alpaca crypto bars JSON -> Coinbase candles (newest first)."""
    rows = ((data or {}).get('bars') or {}).get(symbol.replace('-', '/')) or []
    out = []
    for b in rows:
        try:
            t = int(dt.datetime.fromisoformat(str(b['t']).replace('Z', '+00:00')).timestamp())
            out.append([t, float(b['l']), float(b['h']), float(b['o']), float(b['c']), float(b.get('v') or 0)])
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(out, key=lambda c: -c[0])


def kraken_pair(symbol):
    base, quote = symbol.split('-', 1)
    return ('XBT' if base == 'BTC' else base) + ('XBT' if quote == 'BTC' else quote)


def kraken_candles(data, start, end):
    """Kraken OHLC JSON -> Coinbase candles between start and end (newest first)."""
    if (data or {}).get('error'):
        raise EngineError('; '.join(data['error'])[:200])
    result = (data or {}).get('result') or {}
    rows = next((v for k, v in result.items() if k != 'last' and isinstance(v, list)), [])
    out = []
    for r in rows:
        try:
            t = int(r[0])
            if start <= t <= end:
                out.append([t, float(r[3]), float(r[2]), float(r[1]), float(r[4]), float(r[6])])
        except (IndexError, TypeError, ValueError):
            continue
    return sorted(out, key=lambda c: -c[0])


def alpaca_stats(data):
    """Alpaca crypto snapshots JSON -> {BTC-USD: {last, open}} (24-hour change measured from the daily bar's open)."""
    out = {}
    for sym, snap in ((data or {}).get('snapshots') or {}).items():
        try:
            last = float((snap.get('latestTrade') or {}).get('p') or (snap.get('minuteBar') or {}).get('c'))
            day = snap.get('dailyBar') or {}
            prev = snap.get('prevDailyBar') or {}
            out[sym.replace('/', '-')] = {'last': last, 'open': float(day.get('o') or prev.get('c') or last)}
        except (TypeError, ValueError):
            continue
    return out


# ---------- fetching ----------

async def _get(ctx, source, url, params=None):
    response = await datahub.get(ctx.http, source, url, params=params, headers=HEADERS)
    if response.status_code != 200:
        raise EngineError(f'{source} answered {response.status_code}')
    return response.json()


@handler('crypto.candles')
async def candles(ctx, msg):
    symbol = clean_symbol(msg.get('symbol'))
    granularity = int(msg.get('granularity') or 3600)
    if granularity not in ALPACA_TF:
        raise EngineError('Unsupported candle size.')
    end = int(msg.get('end') or dt.datetime.now(dt.timezone.utc).timestamp())
    start = int(msg.get('start') or end - 300 * granularity)
    errors = []

    async def load():
        try:
            data = await _get(ctx, 'coinbase', f'{COINBASE}/products/{symbol}/candles',
                              {'granularity': granularity, 'start': iso(start), 'end': iso(end)})
            if isinstance(data, list):
                return {'candles': data, 'source': 'Coinbase'}
            errors.append(f"Coinbase: {data.get('message') if isinstance(data, dict) else 'bad reply'}")
        except Exception as err:
            errors.append(f'Coinbase: {err}')
        try:
            data = await _get(ctx, 'alpaca', f'{ALPACA_CRYPTO}/bars',
                              {'symbols': symbol.replace('-', '/'), 'timeframe': ALPACA_TF[granularity], 'start': iso(start), 'end': iso(end), 'limit': 10000})
            rows = alpaca_candles(data, symbol)
            if rows:
                return {'candles': rows, 'source': 'Alpaca'}
            errors.append('Alpaca: no bars')
        except Exception as err:
            errors.append(f'Alpaca: {err}')
        try:
            data = await _get(ctx, 'kraken', f'{KRAKEN}/OHLC', {'pair': kraken_pair(symbol), 'interval': KRAKEN_TF[granularity], 'since': start})
            rows = kraken_candles(data, start, end)
            if rows:
                return {'candles': rows, 'source': 'Kraken'}
            errors.append('Kraken: no candles')
        except Exception as err:
            errors.append(f'Kraken: {err}')
        raise EngineError('No crypto source answered. ' + ' · '.join(errors))
    recent = end > dt.datetime.now(dt.timezone.utc).timestamp() - 2 * granularity
    return await ctx.cached(('crypto-candles', symbol, granularity, start // granularity, end // granularity), 30 if recent else 3600, load)


@handler('crypto.stats')
async def stats(ctx, msg):
    symbols = [clean_symbol(s) for s in (msg.get('symbols') or [])][:30]
    if not symbols:
        return {'quotes': {}, 'source': ''}

    async def load():
        try:
            data = await _get(ctx, 'alpaca', f'{ALPACA_CRYPTO}/snapshots', {'symbols': ','.join(s.replace('-', '/') for s in symbols)})
            quotes = alpaca_stats(data)
            if quotes:
                return {'quotes': quotes, 'source': 'Alpaca'}
        except Exception:
            pass
        quotes = {}
        for s in symbols:
            try:
                d = await _get(ctx, 'coinbase', f'{COINBASE}/products/{s}/stats')
                quotes[s] = {'last': float(d['last']), 'open': float(d['open'])}
            except Exception:
                continue
        if not quotes:
            raise EngineError('No crypto source answered for prices.')
        return {'quotes': quotes, 'source': 'Coinbase'}
    return await ctx.cached(('crypto-stats', tuple(sorted(symbols))), 10, load)
