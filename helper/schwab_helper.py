"""
Schwab market-data helper for the Trading Platform.

Logs into Schwab with your own API app, then serves live, all-exchange US stock data to the
charts in your browser over a private connection on this computer (ws://127.0.0.1:8765).

It only reads market data. It contains no code that can place, change or cancel orders.

Start it with start-windows.bat or start-mac.command, which install what's needed first.
Run with --reset to enter new Schwab keys.
"""

import argparse
import asyncio
import datetime as dt
import getpass
import json
import logging
import re
import sys
import warnings
from pathlib import Path

# Libraries print harmless deprecation notices while loading; hide them so the window stays clear.
_show_warning = warnings.showwarning
warnings.showwarning = lambda *args, **kwargs: None
from schwab.auth import easy_client  # noqa: E402
from schwab.streaming import StreamClient  # noqa: E402
from websockets.asyncio.server import broadcast, serve  # noqa: E402
warnings.showwarning = _show_warning

HOST = '127.0.0.1'
PORT = 8765
CALLBACK_URL = 'https://127.0.0.1:8182'
PLATFORM_URL = 'https://cadenb777-jpg.github.io/trading-platform/'

# Keys and login tokens live in your home folder, never inside the project folder.
DATA_DIR = Path.home() / '.trading-platform'
CONFIG_PATH = DATA_DIR / 'schwab_config.json'
TOKEN_PATH = DATA_DIR / 'schwab_token.json'

# Only these web pages may connect to the helper.
ALLOWED_ORIGINS = [
    'https://cadenb777-jpg.github.io',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
]

SYMBOL_PATTERN = re.compile(r'^[A-Z0-9.\-/$^]{1,15}$')

# timeframe -> (Schwab history method, days of history, seconds to regroup bars into)
HISTORY = {
    '1m': ('get_price_history_every_minute', 5, None),
    '5m': ('get_price_history_every_five_minutes', 20, None),
    '15m': ('get_price_history_every_fifteen_minutes', 60, None),
    '1h': ('get_price_history_every_thirty_minutes', 180, 3600),
    '1D': ('get_price_history_every_day', 365 * 5, None),
}

QUOTE_FIELDS = [
    StreamClient.LevelOneEquityFields.SYMBOL,
    StreamClient.LevelOneEquityFields.LAST_PRICE,
    StreamClient.LevelOneEquityFields.LAST_SIZE,
    StreamClient.LevelOneEquityFields.TOTAL_VOLUME,
    StreamClient.LevelOneEquityFields.TRADE_TIME_MILLIS,
]

log = logging.getLogger('helper')


class HelperError(Exception):
    pass


def load_config(reset):
    if CONFIG_PATH.exists() and not reset:
        return json.loads(CONFIG_PATH.read_text())

    print()
    print('First-time setup: enter your Schwab app details.')
    print('Find them at developer.schwab.com > Dashboard > Apps > your app.')
    print('Tip: in this window, right-click to paste.')
    print()
    app_key = input('Paste your Client ID (also called App Key) and press Enter: ').strip()
    print('Paste your Client Secret and press Enter. (It stays hidden while you paste. That is normal.)')
    app_secret = getpass.getpass('Client Secret: ').strip()
    if not app_key or not app_secret:
        sys.exit('Both the Client ID and Client Secret are needed. Run the helper again to retry.')

    DATA_DIR.mkdir(exist_ok=True)
    config = {'app_key': app_key, 'app_secret': app_secret, 'callback_url': CALLBACK_URL}
    CONFIG_PATH.write_text(json.dumps(config, indent=2))
    try:
        CONFIG_PATH.chmod(0o600)
    except OSError:
        pass
    # New keys need a fresh login.
    TOKEN_PATH.unlink(missing_ok=True)
    print(f'Saved to {CONFIG_PATH}')
    return config


def regroup_bars(bars, seconds):
    grouped = []
    for bar in bars:
        start = bar['time'] // seconds * seconds
        last = grouped[-1] if grouped else None
        if last and last['time'] == start:
            last['high'] = max(last['high'], bar['high'])
            last['low'] = min(last['low'], bar['low'])
            last['close'] = bar['close']
            last['volume'] += bar['volume']
        else:
            grouped.append({**bar, 'time': start})
    return grouped


async def fetch_history(client, symbol, timeframe):
    if timeframe not in HISTORY:
        raise HelperError(f'Unsupported timeframe {timeframe}')
    method, days, regroup = HISTORY[timeframe]
    now = dt.datetime.now(dt.timezone.utc)
    kwargs = {'start_datetime': now - dt.timedelta(days=days), 'end_datetime': now}
    if timeframe != '1D':
        kwargs['need_extended_hours_data'] = True
    response = await getattr(client, method)(symbol, **kwargs)
    if response.status_code == 401:
        raise HelperError('Schwab login expired. Close the helper and start it again to log in.')
    if response.status_code != 200:
        raise HelperError(f'Schwab returned {response.status_code}: {response.text[:200]}')
    candles = response.json().get('candles', [])
    bars = [
        {
            'time': c['datetime'] // 1000,
            'open': c['open'],
            'high': c['high'],
            'low': c['low'],
            'close': c['close'],
            'volume': c.get('volume', 0),
        }
        for c in candles
    ]
    if regroup:
        bars = regroup_bars(bars, regroup)
    if not bars:
        raise HelperError(f'No data found for "{symbol}". Check the ticker symbol.')
    return bars


class Market:
    """Shares one Schwab stream between every browser tab connected to the helper."""

    def __init__(self, client, stream_factory=StreamClient):
        self.client = client
        self.stream_factory = stream_factory
        self.browsers = set()
        self.listeners = {}  # symbol -> set of browser connections
        self.status = {'type': 'status', 'status': 'connecting', 'message': 'Connecting to Schwab'}
        self.last_price = {}
        self.last_volume = {}
        self.seen = set()

    def set_status(self, status, message):
        self.status = {'type': 'status', 'status': status, 'message': message}
        broadcast(self.browsers, json.dumps(self.status))

    # ----- Browser side -----

    async def handle_browser(self, ws):
        self.browsers.add(ws)
        await ws.send(json.dumps(self.status))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                kind = msg.get('type')
                symbol = str(msg.get('symbol', '')).strip().upper()
                if kind in ('history', 'subscribe', 'unsubscribe') and not SYMBOL_PATTERN.match(symbol):
                    await ws.send(json.dumps({'type': 'error', 'id': msg.get('id'), 'message': f'Invalid symbol "{symbol}"'}))
                elif kind == 'history':
                    asyncio.create_task(self.reply_history(ws, msg.get('id'), symbol, msg.get('timeframe')))
                elif kind == 'subscribe':
                    self.listeners.setdefault(symbol, set()).add(ws)
                elif kind == 'unsubscribe':
                    self.remove_listener(ws, symbol)
        finally:
            self.browsers.discard(ws)
            for symbol in list(self.listeners):
                self.remove_listener(ws, symbol)

    def remove_listener(self, ws, symbol):
        listeners = self.listeners.get(symbol)
        if listeners is None:
            return
        listeners.discard(ws)
        if not listeners:
            del self.listeners[symbol]

    async def reply_history(self, ws, request_id, symbol, timeframe):
        try:
            bars = await fetch_history(self.client, symbol, timeframe)
            reply = {'type': 'history', 'id': request_id, 'bars': bars}
            log.info('Sent %d %s bars for %s', len(bars), timeframe, symbol)
        except Exception as err:  # Report every failure to the browser instead of crashing.
            log.warning('History for %s failed: %s', symbol, err)
            reply = {'type': 'error', 'id': request_id, 'message': str(err)}
        try:
            await ws.send(json.dumps(reply))
        except Exception:
            pass

    # ----- Schwab side -----

    def on_quote(self, msg):
        default_time = msg.get('timestamp')
        for item in msg.get('content', []):
            symbol = item.get('key')
            if not symbol:
                continue
            price = item.get('LAST_PRICE')
            total = item.get('TOTAL_VOLUME')
            if price is not None:
                self.last_price[symbol] = price
            size = 0
            if total is not None:
                if symbol in self.last_volume:
                    size = max(0, total - self.last_volume[symbol])
                self.last_volume[symbol] = total
            # The first message for a symbol is a snapshot of the latest values, not a new trade.
            if symbol not in self.seen:
                self.seen.add(symbol)
                continue
            if price is None and size == 0:
                continue
            trade_time = item.get('TRADE_TIME_MILLIS') or default_time
            if symbol not in self.last_price or trade_time is None:
                continue
            trade = {'type': 'trade', 'symbol': symbol, 'price': self.last_price[symbol], 'size': size, 'time': trade_time / 1000}
            broadcast(self.listeners.get(symbol, set()), json.dumps(trade))

    async def run_stream(self):
        attempt = 0
        while True:
            stream = self.stream_factory(self.client)
            subscribed = set()
            self.last_volume.clear()
            self.seen.clear()
            try:
                self.set_status('connecting', 'Connecting to Schwab')
                await stream.login()
                stream.add_level_one_equity_handler(self.on_quote)
                self.set_status('live', 'Streaming from Schwab')
                log.info('Connected to the Schwab live stream')
                attempt = 0
                while True:
                    wanted = set(self.listeners)
                    to_add = sorted(wanted - subscribed)
                    to_remove = sorted(subscribed - wanted)
                    if to_add:
                        if subscribed:
                            await stream.level_one_equity_add(to_add, fields=list(QUOTE_FIELDS))
                        else:
                            await stream.level_one_equity_subs(to_add, fields=list(QUOTE_FIELDS))
                        subscribed.update(to_add)
                        log.info('Streaming %s', ', '.join(to_add))
                    if to_remove:
                        await stream.level_one_equity_unsubs(to_remove)
                        subscribed.difference_update(to_remove)
                        for symbol in to_remove:
                            self.last_volume.pop(symbol, None)
                            self.seen.discard(symbol)
                    # Wait briefly for data, then loop round to pick up subscription changes.
                    try:
                        await asyncio.wait_for(stream.handle_message(), timeout=0.5)
                    except asyncio.TimeoutError:
                        pass
            except Exception as err:
                delay = min(60, 2 ** attempt)
                attempt += 1
                log.warning('Schwab stream problem: %s. Retrying in %ss', err, delay)
                self.set_status('error', f'Schwab stream disconnected, retrying in {delay}s')
                await asyncio.sleep(delay)


async def run(client):
    market = Market(client)
    try:
        server = await serve(market.handle_browser, HOST, PORT, origins=ALLOWED_ORIGINS)
    except OSError:
        sys.exit(f'Port {PORT} is already in use. Is the helper already running in another window?')
    async with server:
        print()
        print('=' * 64)
        print('  Schwab helper is running.')
        print(f'  Open {PLATFORM_URL}')
        print('  and choose "Stocks (Schwab)" in the market dropdown.')
        print('  Keep this window open while you use the charts.')
        print('  To stop the helper, press Ctrl+C or close this window.')
        print('=' * 64)
        print()
        await market.run_stream()


def main():
    parser = argparse.ArgumentParser(description='Serve Schwab market data to the Trading Platform charts.')
    parser.add_argument('--reset', action='store_true', help='enter new Schwab keys and log in again')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s  %(message)s', datefmt='%H:%M:%S')
    logging.getLogger('httpx').setLevel(logging.WARNING)

    config = load_config(args.reset)
    print()
    print('Logging in to Schwab...')
    print('If a browser opens: log in, approve access, and if you see a "connection is not private"')
    print('warning, click Advanced, then Proceed. That warning is expected for this local login.')
    print()
    client = easy_client(
        config['app_key'],
        config['app_secret'],
        config.get('callback_url', CALLBACK_URL),
        str(TOKEN_PATH),
        asyncio=True,
    )
    try:
        asyncio.run(run(client))
    except KeyboardInterrupt:
        print('\nHelper stopped.')


if __name__ == '__main__':
    main()
