"""
Schwab market-data helper for the Trading Platform.

Logs into Schwab with your own API app, then serves live, all-exchange US stock data and
market news to the charts in your browser over a private connection on this computer
(ws://127.0.0.1:8765).

It only reads market data. It contains no code that can place, change or cancel orders.

Start it with start-windows.bat or start-mac.command, which install what's needed first.
Run with --reset to enter new Schwab keys.
"""

import argparse
import asyncio
import datetime as dt
import email.utils
import getpass
import html
import json
import logging
import re
import sys
import time
import warnings
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo
from pathlib import Path

# Libraries print harmless deprecation notices while loading; hide them so the window stays clear.
_show_warning = warnings.showwarning
warnings.showwarning = lambda *args, **kwargs: None
import httpx  # noqa: E402
from schwab.auth import easy_client  # noqa: E402
from schwab.streaming import StreamClient  # noqa: E402
from websockets.asyncio.server import broadcast, serve  # noqa: E402
warnings.showwarning = _show_warning

# Bump when the browser needs new helper features, so it can ask you to download the new copy.
HELPER_VERSION = 3

HOST = '127.0.0.1'
PORT = 8765
CALLBACK_URL = 'https://127.0.0.1:8182'
PLATFORM_URL = 'https://cadenb777-jpg.github.io/Trading-Platform/'

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

# Bar sizes Schwab provides directly. The charts build other timeframes (2m, 4h, 1M...) from these.
RESOLUTIONS = {
    '1m': 'get_price_history_every_minute',
    '5m': 'get_price_history_every_five_minutes',
    '10m': 'get_price_history_every_ten_minutes',
    '15m': 'get_price_history_every_fifteen_minutes',
    '30m': 'get_price_history_every_thirty_minutes',
    '1D': 'get_price_history_every_day',
    '1W': 'get_price_history_every_week',
}
MAX_HISTORY_DAYS = 365 * 20

QUOTE_FIELDS = [
    StreamClient.LevelOneEquityFields.SYMBOL,
    StreamClient.LevelOneEquityFields.LAST_PRICE,
    StreamClient.LevelOneEquityFields.LAST_SIZE,
    StreamClient.LevelOneEquityFields.TOTAL_VOLUME,
    StreamClient.LevelOneEquityFields.TRADE_TIME_MILLIS,
    StreamClient.LevelOneEquityFields.CLOSE_PRICE,
]

# Free public news feeds. Add or remove lines to change where headlines come from.
# Google News is where Google Finance's headlines come from; each item names its publisher.
GOOGLE_NEWS = 'https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en'
# (source, section, url). Sections: economy, markets, companies, crypto.
NEWS_FEEDS = [
    ('Google News', 'markets', GOOGLE_NEWS.format(query='stock+market+when:1d')),
    ('Google News', 'economy', GOOGLE_NEWS.format(query='economy+OR+inflation+OR+%22federal+reserve%22+OR+%22jobs+report%22+when:1d')),
    ('Google News', 'companies', GOOGLE_NEWS.format(query='earnings+OR+guidance+OR+%22shares+of%22+when:1d')),
    ('CNBC', 'markets', 'https://www.cnbc.com/id/100003114/device/rss/rss.html'),
    ('CNBC', 'economy', 'https://www.cnbc.com/id/20910258/device/rss/rss.html'),
    ('CNBC', 'markets', 'https://www.cnbc.com/id/10000664/device/rss/rss.html'),
    ('CoinDesk', 'crypto', 'https://www.coindesk.com/arc/outboundfeeds/rss/'),
]

# Market-moving topics: (label, importance, section, pattern). Headlines matching heavier topics,
# and stories covered by several outlets at once, rank higher in "Top stories".
NEWS_TOPICS = [
    ('Fed', 6, 'economy', r'\b(fed|fomc|powell|federal reserve|rate cuts?|rate hikes?|interest rates?)\b'),
    ('Inflation', 5, 'economy', r'\b(inflation|cpi|pce|consumer prices|producer prices|ppi)\b'),
    ('Jobs', 4, 'economy', r'\b(jobs report|payrolls|unemployment|jobless claims|labor market)\b'),
    ('Growth', 4, 'economy', r'\b(gdp|recession|economic growth|retail sales|consumer spending|pmi|ism)\b'),
    ('Trade', 4, 'economy', r'\b(tariffs?|trade war|trade deal|sanctions)\b'),
    ('Bonds', 3, 'economy', r'\b(treasur(y|ies)|bond yields?|10-year|yield curve)\b'),
    ('Earnings', 3, 'companies', r'\b(earnings|quarterly results|guidance|revenue|profit|beats?|miss(es)?|deliveries|delivery)\b'),
    ('Mega-cap', 3, 'companies', r'\b(apple|microsoft|nvidia|amazon|alphabet|google|meta|tesla|broadcom|berkshire|jpmorgan)\b'),
    ('Deals', 2, 'companies', r'\b(mergers?|acquisitions?|acquires?|buyout|ipo|bankruptcy)\b'),
    ('Market move', 3, 'markets', r'\b(s&p 500|dow|nasdaq|sell-?off|rally|plunges?|surges?|record high|correction|volatility|vix|soars?|tumbles?|slides?|sinks?|jumps?)\b'),
    ('Oil', 3, 'markets', r'\b(oil|opec|crude|brent)\b'),
    ('Crypto', 3, 'crypto', r'\b(bitcoin|crypto|ethereum|stablecoins?)\b'),
    ('Geopolitics', 2, None, r'\b(war|missiles?|invasion|election|shutdown|debt ceiling)\b'),
]
NEWS_TOPIC_PATTERNS = [(label, weight, section, re.compile(rx, re.I)) for label, weight, section, rx in NEWS_TOPICS]
STOPWORDS = set('the and for with from that this will after over into amid says said than more what about their have been stocks stock market'.split())

# Economic calendar: Forex Factory's free weekly feeds (forecast, previous, and actual when published).
CALENDAR_FEEDS = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
]
CALENDAR_CACHE_SECONDS = 3600
# Fed rate decision days (2:00 PM ET). Check https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
FOMC_DECISIONS = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09']
EASTERN = ZoneInfo('America/New_York')
# Headlines for one ticker, e.g. from your watchlist.
TICKER_NEWS_QUERY = '{symbol}+stock+when:3d'
MAX_TICKER_FEEDS = 12
NEWS_CACHE_SECONDS = 90
NEWS_LIMIT = 80
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

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


# ---------- Price history ----------


async def fetch_history(client, symbol, resolution, days):
    if resolution not in RESOLUTIONS:
        raise HelperError(f'Unsupported bar size {resolution}')
    days = max(1, min(int(days or 30), MAX_HISTORY_DAYS))
    now = dt.datetime.now(dt.timezone.utc)
    kwargs = {'start_datetime': now - dt.timedelta(days=days), 'end_datetime': now}
    if resolution not in ('1D', '1W'):
        kwargs['need_extended_hours_data'] = True
    response = await getattr(client, RESOLUTIONS[resolution])(symbol, **kwargs)
    if response.status_code == 401:
        raise HelperError('Schwab login expired. Close the helper and start it again to log in.')
    if response.status_code != 200:
        raise HelperError(f'Schwab returned {response.status_code}: {response.text[:200]}')
    bars = [
        {
            'time': c['datetime'] // 1000,
            'open': c['open'],
            'high': c['high'],
            'low': c['low'],
            'close': c['close'],
            'volume': c.get('volume', 0),
        }
        for c in response.json().get('candles', [])
    ]
    if not bars:
        raise HelperError(f'No data found for "{symbol}". Check the ticker symbol.')
    return bars


# ---------- News ----------


def _local(tag):
    return tag.rsplit('}', 1)[-1]


def _child_text(node, *names):
    for child in node:
        if _local(child.tag) in names and child.text and child.text.strip():
            return child.text.strip()
    return ''


def _parse_date(value):
    if not value:
        return 0
    try:
        return int(email.utils.parsedate_to_datetime(value).timestamp())
    except (TypeError, ValueError):
        pass
    try:
        return int(dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp())
    except ValueError:
        return 0


def _clean(text, limit):
    text = html.unescape(re.sub(r'<[^>]+>', ' ', text or ''))
    text = re.sub(r'\s+', ' ', text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + '…'


def parse_feed(xml_text, source):
    """Reads headlines from an RSS or Atom feed."""
    items = []
    root = ET.fromstring(xml_text)
    for node in root.iter():
        if _local(node.tag) not in ('item', 'entry'):
            continue
        link = _child_text(node, 'link')
        if not link:
            for child in node:
                if _local(child.tag) == 'link' and child.get('rel', 'alternate') == 'alternate' and child.get('href'):
                    link = child.get('href')
                    break
        title = _clean(_child_text(node, 'title'), 200)
        if not title or not link.startswith(('https://', 'http://')):
            continue
        # Google News names the original publisher and appends it to the title ("... - Reuters").
        publisher = _clean(_child_text(node, 'source'), 60)
        if publisher and title.endswith(f' - {publisher}'):
            title = title[: -len(publisher) - 3]
        items.append({
            'title': title,
            'link': link,
            'source': publisher or source,
            'published': _parse_date(_child_text(node, 'pubDate', 'published', 'updated', 'date')),
            'summary': _clean(_child_text(node, 'description', 'summary'), 240),
        })
    return items


def _title_words(title):
    return {w for w in re.findall(r'[a-z0-9&]+', title.lower()) if len(w) > 3 and w not in STOPWORDS}


def rank_news(items, now=None):
    """Groups the same story from different outlets, sorts each into a section, and scores how
    likely it is to move the market (topic importance + how many outlets cover it + freshness)."""
    now = now or time.time()
    clusters = []  # [lead item, words, [other sources]]
    for item in sorted(items, key=lambda i: i['published'], reverse=True):
        words = _title_words(item['title'])
        for cluster in clusters:
            overlap = len(words & cluster[1]) / max(1, len(words | cluster[1]))
            if overlap >= 0.4:
                if item['source'] not in cluster[2] and item['source'] != cluster[0]['source']:
                    cluster[2].append(item['source'])
                break
        else:
            clusters.append([item, words, []])

    ranked = []
    for lead, _words, others in clusters:
        text_title = lead['title']
        score, tags, best = 0.0, [], (0, None)
        for label, weight, section, pattern in NEWS_TOPIC_PATTERNS:
            if pattern.search(text_title):
                score += weight
            elif pattern.search(lead['summary']):
                score += weight / 2
            else:
                continue
            tags.append(label)
            if section and weight > best[0]:
                best = (weight, section)
        score += min(6, 2 * len(others))
        if lead['published']:
            score -= 0.15 * max(0, now - lead['published']) / 3600
        section = 'crypto' if lead.get('section') == 'crypto' else (best[1] or lead.get('section') or 'markets')
        ranked.append({
            **lead,
            'section': section,
            'tags': tags[:3],
            'alsoReportedBy': others[:4],
            'score': round(score, 1),
            'impact': 'high' if score >= 8 else 'medium' if score >= 2.5 else 'low',
        })
    return ranked


class NewsFetcher:
    def __init__(self):
        self.cache = {}  # url -> (fetched_at, data)
        self.http = httpx.AsyncClient(timeout=10, follow_redirects=True, headers={'User-Agent': USER_AGENT})

    async def _cached(self, url, max_age, parse):
        cached = self.cache.get(url)
        if cached and time.time() - cached[0] < max_age:
            return cached[1]
        response = await self.http.get(url)
        response.raise_for_status()
        data = parse(response)
        self.cache[url] = (time.time(), data)
        return data

    async def _feed(self, source, section, url):
        items = await self._cached(url, NEWS_CACHE_SECONDS, lambda r: parse_feed(r.text, source))
        return [{**i, 'section': section} for i in items]

    async def get(self, symbols):
        feeds = list(NEWS_FEEDS)
        tickers = [s for s in symbols if re.match(r'^[A-Z][A-Z.]{0,5}$', s)][:MAX_TICKER_FEEDS]
        if tickers:
            feeds = [('Google News', 'companies', GOOGLE_NEWS.format(query=TICKER_NEWS_QUERY.format(symbol=t))) for t in tickers]
        results = await asyncio.gather(*(self._feed(*feed) for feed in feeds), return_exceptions=True)
        items, failed = [], []
        for (source, _section, _url), result in zip(feeds, results):
            if isinstance(result, Exception):
                log.warning('News from %s failed: %s', source, result)
                if source not in failed:
                    failed.append(source)
            else:
                items.extend(result)
        return rank_news(items)[:NEWS_LIMIT], failed

    async def calendar(self):
        results = await asyncio.gather(*(self._cached(url, CALENDAR_CACHE_SECONDS, lambda r: r.json()) for url in CALENDAR_FEEDS), return_exceptions=True)
        events, failed = [], []
        for url, result in zip(CALENDAR_FEEDS, results):
            if isinstance(result, Exception):
                log.warning('Calendar feed failed: %s', result)
                failed.append('Forex Factory')
            else:
                events.extend(parse_calendar(result))
        return merge_fomc(events), sorted(set(failed))


def _text(value):
    return str(value).strip() if value not in (None, '') else ''


def parse_calendar(rows):
    """Reads Forex Factory calendar rows into simple events."""
    events = []
    for row in rows if isinstance(rows, list) else []:
        try:
            when = dt.datetime.fromisoformat(str(row['date']).replace('Z', '+00:00'))
        except (KeyError, ValueError):
            continue
        impact = _text(row.get('impact')).lower()
        events.append({
            'title': _text(row.get('title')),
            'country': _text(row.get('country')).upper(),
            'time': int(when.timestamp()),
            'impact': impact if impact in ('high', 'medium', 'low', 'holiday') else 'low',
            'forecast': _text(row.get('forecast')),
            'previous': _text(row.get('previous')),
            'actual': _text(row.get('actual')),
        })
    return events


def merge_fomc(events):
    """Adds Fed rate decision days the weekly feeds don't reach yet."""
    out = list(events)
    covered = {dt.datetime.fromtimestamp(e['time'], EASTERN).date() for e in events if e['country'] == 'USD' and 'federal funds' in e['title'].lower()}
    now = time.time()
    for day in FOMC_DECISIONS:
        when = dt.datetime.fromisoformat(f'{day}T14:00:00').replace(tzinfo=EASTERN)
        if when.date() in covered or when.timestamp() < now - 86400 * 7:
            continue
        out.append({'title': 'FOMC Rate Decision (Federal Funds Rate)', 'country': 'USD', 'time': int(when.timestamp()),
                    'impact': 'high', 'forecast': '', 'previous': '', 'actual': ''})
    seen, unique = set(), []
    for e in sorted(out, key=lambda e: e['time']):
        key = (e['title'], e['country'], e['time'])
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique


# ---------- Live data ----------


class Market:
    """Shares one Schwab stream between every browser tab connected to the helper."""

    def __init__(self, client, stream_factory=StreamClient, news=None):
        self.client = client
        self.stream_factory = stream_factory
        self.news = news or NewsFetcher()
        self.browsers = set()
        self.listeners = {}  # symbol -> set of browser connections
        self.status = {'type': 'status', 'status': 'connecting', 'message': 'Connecting to Schwab', 'version': HELPER_VERSION}
        self.quotes = {}  # symbol -> {'last': ..., 'prevClose': ...}
        self.dirty_quotes = set()
        self.last_volume = {}
        self.seen = set()

    def set_status(self, status, message):
        self.status = {'type': 'status', 'status': status, 'message': message, 'version': HELPER_VERSION}
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
                    asyncio.create_task(self.reply(ws, msg.get('id'), self.history_reply(symbol, msg.get('resolution'), msg.get('days'))))
                elif kind == 'calendar':
                    asyncio.create_task(self.reply(ws, msg.get('id'), self.calendar_reply()))
                elif kind == 'news':
                    symbols = [str(s).upper() for s in msg.get('symbols') or [] if isinstance(s, str)]
                    asyncio.create_task(self.reply(ws, msg.get('id'), self.news_reply(symbols)))
                elif kind == 'subscribe':
                    self.listeners.setdefault(symbol, set()).add(ws)
                    if symbol in self.quotes:
                        await ws.send(json.dumps(self.quote_message(symbol)))
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

    async def history_reply(self, symbol, resolution, days):
        bars = await fetch_history(self.client, symbol, resolution, days)
        log.info('Sent %d %s bars for %s', len(bars), resolution, symbol)
        return {'type': 'history', 'bars': bars}

    async def calendar_reply(self):
        events, failed = await self.news.calendar()
        return {'type': 'calendar', 'events': events, 'failed': failed}

    async def news_reply(self, symbols):
        items, failed = await self.news.get(symbols)
        return {'type': 'news', 'items': items, 'failed': failed}

    async def reply(self, ws, request_id, work):
        try:
            reply = await work
        except Exception as err:  # Report every failure to the browser instead of crashing.
            log.warning('Request failed: %s', err)
            reply = {'type': 'error', 'message': str(err)}
        reply['id'] = request_id
        try:
            await ws.send(json.dumps(reply))
        except Exception:
            pass

    # ----- Schwab side -----

    def quote_message(self, symbol):
        return {'type': 'quote', 'symbol': symbol, **self.quotes[symbol]}

    def on_quote(self, msg):
        default_time = msg.get('timestamp')
        for item in msg.get('content', []):
            symbol = item.get('key')
            if not symbol:
                continue
            price = item.get('LAST_PRICE')
            total = item.get('TOTAL_VOLUME')
            if price is not None or item.get('CLOSE_PRICE') is not None:
                quote = self.quotes.setdefault(symbol, {'last': None, 'prevClose': None})
                if price is not None:
                    quote['last'] = price
                if item.get('CLOSE_PRICE') is not None:
                    quote['prevClose'] = item['CLOSE_PRICE']
                self.dirty_quotes.add(symbol)
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
            last = self.quotes.get(symbol, {}).get('last')
            trade_time = item.get('TRADE_TIME_MILLIS') or default_time
            if last is None or trade_time is None:
                continue
            trade = {'type': 'trade', 'symbol': symbol, 'price': last, 'size': size, 'time': trade_time / 1000}
            broadcast(self.listeners.get(symbol, set()), json.dumps(trade))

    async def send_quotes(self):
        """Sends price changes for the watchlist and index cards a few times a second."""
        while True:
            await asyncio.sleep(0.3)
            for symbol in list(self.dirty_quotes):
                if symbol in self.quotes:
                    broadcast(self.listeners.get(symbol, set()), json.dumps(self.quote_message(symbol)))
            self.dirty_quotes.clear()

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
                            self.quotes.pop(symbol, None)
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
        print(f'  Schwab helper (version {HELPER_VERSION}) is running.')
        print(f'  Open {PLATFORM_URL}')
        print('  Keep this window open while you use the platform.')
        print('  To stop the helper, press Ctrl+C or close this window.')
        print('=' * 64)
        print()
        await asyncio.gather(market.run_stream(), market.send_quotes())


def main():
    parser = argparse.ArgumentParser(description='Serve Schwab market data to the Trading Platform charts.')
    parser.add_argument('--reset', action='store_true', help='enter new Schwab keys and log in again')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s  %(message)s', datefmt='%H:%M:%S')
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('websockets').setLevel(logging.WARNING)

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
