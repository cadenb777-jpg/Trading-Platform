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
import shutil
import subprocess
import datetime as dt
import email.utils
import getpass
import html
import html.parser
import json
import logging
import logging.handlers
import os
import re
import sys
import time
import urllib.parse
import warnings
import webbrowser
from zoneinfo import ZoneInfo
from pathlib import Path

# Libraries print harmless deprecation notices while loading; hide them so the window stays clear.
_show_warning = warnings.showwarning
if os.environ.get('TP_SPLASH'):
    # Started from the launcher's start screen: keep start-up notices off the screen (main() logs them to the file).
    logging.getLogger().addHandler(logging.NullHandler())
warnings.showwarning = lambda *args, **kwargs: None
import httpx  # noqa: E402
from schwab.auth import RedirectTimeoutError, client_from_token_file, easy_client  # noqa: E402
from schwab.streaming import StreamClient  # noqa: E402
from websockets.asyncio.server import broadcast, serve  # noqa: E402
import updater  # noqa: E402  (standard library only)
import codeupdate  # noqa: E402  (standard library only: git pull for a copy made with git)
import engine  # noqa: E402  (light: its big modules load in the background, see engine.start_loading)
from engine import diagnostics  # noqa: E402  (standard library only: records requests for the diagnostics file)
from engine.core import is_safe_url  # noqa: E402
from engine.safexml import fromstring as safe_fromstring  # noqa: E402  (refuses XML entity bombs)
warnings.showwarning = _show_warning

# Bump when the browser needs new helper features, so it can ask you to download the new copy.
HELPER_VERSION = 92

HOST = '127.0.0.1'
PORT = 8765
CALLBACK_URL = 'https://127.0.0.1:8182'
#: The platform's address: the published website, or the copy on this computer in private mode (the desktop launcher's
#: --private sets TP_PLATFORM_URL; only an address on this computer is taken from it).
PLATFORM_URL = 'https://cadenb777-jpg.github.io/Trading-Platform/'
if os.environ.get('TP_PLATFORM_URL', '').startswith(('http://127.0.0.1:', 'http://localhost:')):
    PLATFORM_URL = os.environ['TP_PLATFORM_URL']

# Keys and login tokens live in your home folder, never inside the project folder.
DATA_DIR = Path.home() / '.trading-platform'
CONFIG_PATH = DATA_DIR / 'schwab_config.json'
LOG_PATH = DATA_DIR / 'helper.log'
TOKEN_PATH = DATA_DIR / 'schwab_token.json'

# Only these web pages may connect to the helper.
ALLOWED_ORIGINS = [
    'https://cadenb777-jpg.github.io',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
]

# The desktop app (desktop/) runs its own copy of this helper with --desktop: its own port, only the app may connect
# (a web page can't send this Origin), no browser, no background scanner or updater (the website's helper does those).
DESKTOP_PORT = 8766
DESKTOP_ORIGIN = 'tp-desktop://app'
DESKTOP = False
# Orders never go through the desktop helper (the website's Trade page keeps preview + confirm): every Webull
# request whose name ends in _order (preview, place, cancel) is refused in desktop mode.


def desktop_blocked(kind):
    return kind.startswith('webull.') and kind.endswith('_order')


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
    ('Growth', 4, 'economy', r'\b(gdp|recession|economic growth|retail sales|consumer spending|pmi|ism|housing|home sales|home ?builders?)\b'),
    ('Trade', 4, 'economy', r'\b(tariffs?|trade war|trade deal|sanctions)\b'),
    ('Bonds', 3, 'economy', r'\b(treasur(y|ies)|bond yields?|10-year|yield curve)\b'),
    ('Earnings', 3, 'companies', r'\b(earnings|quarterly results|guidance|revenue|profit|beats?|miss(es)?|deliveries|delivery)\b'),
    ('Mega-cap', 3, 'companies', r'\b(apple|microsoft|nvidia|amazon|alphabet|google|meta|tesla|broadcom|berkshire|jpmorgan)\b'),
    ('Deals', 2, 'companies', r'\b(mergers?|acquisitions?|acquires?|buyout|ipo|bankruptcy)\b'),
    ('Market move', 3, 'markets', r'\b(s&p 500|dow|nasdaq|sell-?off|rally|plunges?|surges?|record high|correction|volatility|vix|soars?|tumbles?|slides?|sinks?|jumps?)\b'),
    ('Oil', 3, 'markets', r'\b(oil|opec|crude|brent)\b'),
    ('Metals', 2, 'markets', r'\b(gold|silver|copper)\b'),
    ('Crypto', 3, 'crypto', r'\b(bitcoin|crypto|ethereum|stablecoins?)\b'),
    ('Geopolitics', 2, None, r'\b(war|missiles?|invasion|election|shutdown|debt ceiling)\b'),
]
NEWS_TOPIC_PATTERNS = [(label, weight, section, re.compile(rx, re.I)) for label, weight, section, rx in NEWS_TOPICS]
STOPWORDS = set('the and for with from that this will after over into amid says said than more what about their have been stocks stock market'.split())

# Economic calendar: Forex Factory's free weekly feed (forecast and previous; it has no actual numbers, so US
# actuals come from FRED after each release: engine/actuals.py). Forex Factory only publishes the current week.
CALENDAR_FEEDS = ['https://nfs.faireconomy.media/ff_calendar_thisweek.json']
CALENDAR_CACHE_SECONDS = 3600
# Fed rate decision days (2:00 PM ET). Check https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
FOMC_DECISIONS = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
                  # 2027: the Fed's tentative schedule (announced Sept 5, 2025)
                  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08']
EASTERN = ZoneInfo('America/New_York')
STARTED = time.time()
# Headlines for one ticker, e.g. from your watchlist.
TICKER_NEWS_QUERY = '{symbol}+stock+when:3d'
MAX_TICKER_FEEDS = 12
NEWS_CACHE_SECONDS = 90
NEWS_CACHE_MAX = 400  # feeds + article summaries kept in memory
NEWS_LIMIT = 80
# Only articles the helper can actually summarise are shown (owner's request): each is opened and summarised before
# the list goes out. A news request waits at most this long; articles still being checked appear on the next refresh.
READ_CHECK_SECONDS = 12
READ_CHECK_SLOTS = 6
UNREADABLE_RETRY_SECONDS = 6 * 3600
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

log = logging.getLogger('helper')

# The start screen (splash.py) when the launcher started us: it keeps the banner up and shows one live status
# line instead of log messages. None when run directly, which keeps the plain text output.
SCREEN = None


class HelperError(Exception):
    pass


def ask_sec_contact(config):
    """Older versions asked for the SEC contact email here; it now lives in the platform's Settings window."""
    return config


def load_config(reset):
    if CONFIG_PATH.exists() and not reset:
        return ask_sec_contact(json.loads(CONFIG_PATH.read_text()))

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
    return ask_sec_contact(config)


# ---------- Price history ----------


def _price(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if v == v and v not in (float('inf'), float('-inf')) else None


def clean_candles(candles):
    """Schwab candles -> chart bars in time order, one per time, without missing prices. Returns (bars, skipped)."""
    by_time = {}
    skipped = 0
    for c in candles:
        o, h, l, cl = (_price(c.get(k)) for k in ('open', 'high', 'low', 'close'))
        t = c.get('datetime')
        if None in (o, h, l, cl) or not isinstance(t, (int, float)) or t <= 0:
            skipped += 1
            continue
        time_s = int(t // 1000)
        bar = {'time': time_s, 'open': o, 'high': max(h, o, cl), 'low': min(l, o, cl), 'close': cl, 'volume': _price(c.get('volume')) or 0}
        if time_s in by_time:
            skipped += 1
            prev = by_time[time_s]
            bar = {**prev, 'high': max(prev['high'], bar['high']), 'low': min(prev['low'], bar['low']), 'close': cl, 'volume': prev['volume'] + bar['volume']}
        by_time[time_s] = bar
    return [by_time[t] for t in sorted(by_time)], skipped


async def fetch_history(client, symbol, resolution, days):
    if resolution not in RESOLUTIONS:
        raise HelperError(f'Unsupported bar size {resolution}')
    days = max(1, min(int(days or 30), MAX_HISTORY_DAYS))
    now = dt.datetime.now(dt.timezone.utc)
    kwargs = {'start_datetime': now - dt.timedelta(days=days), 'end_datetime': now}
    if resolution not in ('1D', '1W'):
        kwargs['need_extended_hours_data'] = True
    # Through the data hub: Schwab's shared per-minute budget, a retry on 429/5xx, and two tabs asking for the same
    # chart at once share one request.
    from engine import datahub
    method = getattr(datahub.raw(client), RESOLUTIONS[resolution])
    response = await datahub.call('schwab', lambda: method(symbol, **kwargs), key=('history', symbol, resolution, days))
    if response.status_code == 401:
        raise HelperError('Schwab login expired (401)')  # Market.history_reply turns this into the login page
    if response.status_code != 200:
        raise HelperError(f'Schwab returned {response.status_code}: {response.text[:200]}')
    bars, dropped = clean_candles(response.json().get('candles', []))
    if dropped:
        log.warning('%s %s: skipped %d unusable candle(s) from Schwab (missing prices or duplicates)', symbol, resolution, dropped)
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
    root = safe_fromstring(xml_text)  # refuses entity bombs (engine/safexml.py)
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
            # Share of the shorter headline's key words that also appear in the other one.
            overlap = len(words & cluster[1]) / max(1, min(len(words), len(cluster[1])))
            if overlap >= 0.5 and len(words & cluster[1]) >= 2:
                if item['source'] not in cluster[2] and item['source'] != cluster[0]['source']:
                    cluster[2].append(item['source'])
                    cluster[3].append(item['link'])
                break
        else:
            clusters.append([item, words, [], []])

    ranked = []
    for lead, _words, others, other_links in clusters:
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
            'otherLinks': other_links[:4],
            'score': round(score, 1),
        })
    # Impact is relative to today's news: the strongest stories are "high" even on quiet days.
    scores = sorted((r['score'] for r in ranked), reverse=True)
    top_cut = scores[max(0, len(scores) // 6 - 1)] if scores else 0
    for r in ranked:
        high = r['score'] >= 7 or (r['score'] >= 4.5 and r['score'] >= top_cut)
        r['impact'] = 'high' if high else 'medium' if r['score'] >= 2.5 else 'low'
    return ranked


class _ArticleParser(html.parser.HTMLParser):
    """Collects paragraph text from an article page, skipping menus, scripts and footers."""
    SKIP = {'script', 'style', 'nav', 'footer', 'aside', 'header', 'form', 'noscript', 'figcaption', 'button'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.paragraphs, self.description = [], ''
        self._skip, self._in_p, self._buf = 0, False, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and (a.get('property') == 'og:description' or a.get('name') == 'description') and not self.description:
            self.description = _clean(a.get('content', ''), 400)
        if tag in self.SKIP:
            self._skip += 1
        elif tag == 'p' and not self._skip:
            self._in_p, self._buf = True, []

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag == 'p' and self._in_p:
            self._in_p = False
            text = _clean(''.join(self._buf), 2000)
            if len(text) > 60:
                self.paragraphs.append(text)

    def handle_data(self, data):
        if self._in_p and not self._skip:
            self._buf.append(data)


def parse_article(page_html):
    parser = _ArticleParser()
    try:
        parser.feed(page_html)
    except Exception:
        pass
    return {'paragraphs': parser.paragraphs, 'description': parser.description,
            'words': sum(len(p.split()) for p in parser.paragraphs)}


def summarize_text(paragraphs, title, count=4):
    """Picks the most informative sentences: ones that share the article's most common words,
    mention the headline's subject, or contain numbers (prices, percentages, dates)."""
    text = ' '.join(paragraphs[:40])
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+(?=[A-Z0-9"\u201c])', text) if 40 <= len(s.strip()) <= 400]
    if not sentences:
        return []
    freq = {}
    for word in re.findall(r'[a-z]{4,}', text.lower()):
        if word not in STOPWORDS:
            freq[word] = freq.get(word, 0) + 1
    title_words = _title_words(title)
    scored = []
    for i, sentence in enumerate(sentences[:60]):
        words = re.findall(r'[a-z]{4,}', sentence.lower())
        if not words:
            continue
        score = sum(freq.get(w, 0) for w in words) / len(words) ** 0.6
        score += 2 * len(title_words & set(words))
        if re.search(r'\d[\d,.]*\s?(%|percent|billion|million|basis points)|\$\d', sentence):
            score += 3
        score *= 1.2 if i < 5 else 1
        scored.append((score, i, sentence))
    best = sorted(scored, reverse=True)[:count]
    return [s for _score, _i, s in sorted(best, key=lambda x: x[1])]


class NewsFetcher:
    def __init__(self):
        self.cache = {}  # url (or ('summary', link)) -> (fetched_at, data)
        self.unreadable = {}  # article link -> when it couldn't be summarised (tried again after a few hours)
        self.checking = {}  # article link -> the running readability check
        self.http = httpx.AsyncClient(timeout=10, follow_redirects=True, headers={'User-Agent': USER_AGENT})

    async def _cached(self, url, max_age, parse):
        cached = self.cache.get(url)
        if cached and time.time() - cached[0] < max_age:
            return cached[1]
        from engine import datahub
        response = await datahub.get(self.http, None, url)  # news/calendar gate: retries, joined requests, health
        response.raise_for_status()
        data = parse(response)
        self._remember(url, data)
        return data

    def _remember(self, key, data):
        """Caches a reply. Article summaries and search feeds pile up over a long session, so once the cache is
        large the oldest entries are dropped (they are simply fetched again if asked for)."""
        self.cache[key] = (time.time(), data)
        if len(self.cache) > NEWS_CACHE_MAX:
            for old in sorted(self.cache, key=lambda k: self.cache[k][0])[:len(self.cache) - NEWS_CACHE_MAX // 2]:
                del self.cache[old]

    async def _feed(self, source, section, url):
        items = await self._cached(url, NEWS_CACHE_SECONDS, lambda r: parse_feed(r.text, source))
        return [{**i, 'section': section} for i in items]

    async def get(self, symbols, query=''):
        feeds = list(NEWS_FEEDS)
        tickers = [s for s in symbols if re.match(r'^[A-Z][A-Z.]{0,5}$', s)][:MAX_TICKER_FEEDS]
        if query:
            feeds = [('Google News', 'markets', GOOGLE_NEWS.format(query=urllib.parse.quote_plus(query[:120]) + '+when:7d'))]
        elif tickers:
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

    async def readable(self, item):
        """True when the article can be opened and summarised (its summary is then cached, so opening it is instant)."""
        link = item.get('link') or ''
        failed_at = self.unreadable.get(link)
        if failed_at and time.time() - failed_at < UNREADABLE_RETRY_SECONDS:
            return False
        try:
            result = await self.summary([link, *(item.get('otherLinks') or [])], item.get('title') or '')
            ok = bool(result.get('points'))
        except Exception:
            ok = False
        if not ok:
            self.unreadable[link] = time.time()
            if len(self.unreadable) > NEWS_CACHE_MAX:
                for old in sorted(self.unreadable, key=self.unreadable.get)[:len(self.unreadable) // 2]:
                    del self.unreadable[old]
        return ok

    async def get_readable(self, symbols, query='', budget=READ_CHECK_SECONDS):
        """The news list with only the articles that can be summarised. Checks run a few at a time; any not finished
        within `budget` seconds keep running (and are cached) and show up on the next refresh."""
        items, failed = await self.get(symbols, query)
        slots = asyncio.Semaphore(READ_CHECK_SLOTS)

        async def check(item):
            async with slots:
                return await self.readable(item)
        tasks = []
        for item in items:
            link = item.get('link') or ''
            task = self.checking.get(link)
            # a running check, or one that found the article readable, is reused; a failed one asks again (and
            # readable() answers at once from `unreadable` until the retry time)
            if task is None or (task.done() and (task.cancelled() or task.exception() is not None or not task.result())):
                task = asyncio.ensure_future(check(item))
                self.checking[link] = task
                task.add_done_callback(lambda _t, k=link: self.checking.pop(k, None) if len(self.checking) > NEWS_CACHE_MAX else None)
            tasks.append(task)
        if tasks:
            await asyncio.wait(tasks, timeout=budget)
        keep = [i for i, t in zip(items, tasks) if t.done() and not t.cancelled() and t.exception() is None and t.result()]
        return keep, failed

    async def summary(self, links, title):
        """Opens the article (trying each outlet that ran the story) and pulls out its key sentences."""
        cached = self.cache.get(('summary', links[0]))
        if cached:
            return cached[1]
        # Prefer direct publisher links; Google News links have to be decoded first.
        ordered = sorted(links, key=lambda u: 'news.google.com' in u)
        last_error = 'No link to open'
        for link in ordered[:4]:
            try:
                url = await self._resolve_google(link) if 'news.google.com' in link else link
                if not url:
                    continue
                response = await self._get_public(url)
                page = parse_article(response.text)
                points = summarize_text(page['paragraphs'], title)
                if points or page['description']:
                    result = {'points': points, 'description': page['description'], 'url': str(response.url), 'words': page['words']}
                    self._remember(('summary', links[0]), result)
                    return result
                last_error = 'The article text could not be read (it may be behind a paywall).'
            except Exception as err:
                last_error = str(err)
        raise HelperError(f'Could not open the article: {last_error}')

    async def _get_public(self, url, max_hops=5):
        """Fetches an article link, checking it and every redirect is a public http(s) address first, so a
        crafted link cannot reach the owner's own computer or home network (SSRF)."""
        for _hop in range(max_hops + 1):
            if not await asyncio.to_thread(is_safe_url, url):
                raise HelperError('That link points to a private or unsupported address.')
            response = await self.http.get(url, follow_redirects=False)
            if response.is_redirect and response.next_request is not None:
                url = str(response.next_request.url)
                continue
            response.raise_for_status()
            return response
        raise HelperError('Too many redirects.')

    async def _resolve_google(self, link):
        """Google News hides the publisher's address behind its own link; ask Google for the real one."""
        match = re.search(r'/articles/([^?/]+)', link)
        if not match:
            return None
        article_id = match.group(1)
        page = await self.http.get(f'https://news.google.com/articles/{article_id}')
        sig = re.search(r'data-n-a-sg="([^"]+)"', page.text)
        ts = re.search(r'data-n-a-ts="([^"]+)"', page.text)
        if not sig or not ts:
            return None
        inner = ('["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],'
                 f'"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{article_id}",{ts.group(1)},"{sig.group(1)}"]')
        body = 'f.req=' + urllib.parse.quote(json.dumps([[['Fbv4je', inner, None, 'generic']]]))
        response = await self.http.post('https://news.google.com/_/DotsSplashUi/data/batchexecute', content=body,
                                        headers={'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'})
        response.raise_for_status()
        data = json.loads(response.text.split('\n\n')[1])[:-2]
        return json.loads(data[0][2])[1]

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


def unknown_request_message(kind):
    """Why a request can't be answered: a feature that failed to start, or a request this helper doesn't know."""
    if engine.LOAD_ERRORS:
        failed = ', '.join(engine.LOAD_ERRORS)
        return (f'That feature isn\'t available because part of the helper couldn\'t start ({failed}). '
                'Close the helper and start it again; if it keeps happening, download the helper again. Details are in helper.log.')
    return f'This helper doesn\'t know "{kind}". Download the latest helper from GitHub and restart it.'


# ---------- Live data ----------


class Market:
    """Shares one Schwab stream between every browser tab connected to the helper."""

    def __init__(self, client, stream_factory=StreamClient, news=None, engine_ctx=None):
        self.client = client
        self.news = news or NewsFetcher()
        self.engine = engine_ctx or engine.EngineContext(client)
        self.fred_cache = {}  # series -> (fetched_at, rows) for calendar actuals
        if self.engine.news is None:
            self.engine.news = self.news
        self.stream_factory = stream_factory
        self.browsers = set()
        self.inflight = 0  # requests being answered now (an automatic update waits for 0)
        self.auto_failed = {}  # version -> time an automatic install of it failed
        self.listeners = {}  # symbol -> set of browser connections
        self.quotes = {}  # symbol -> {'last': ..., 'prevClose': ...}
        # Schwab's official quote (REST) per symbol: the previous close it measures the day's change from. The stream's
        # CLOSE_PRICE turns into today's close once the session ends, which made changes read 0%, so it's only a fallback.
        self.official = {}
        self.official_wake = asyncio.Event()
        self.dirty_quotes = set()
        self.last_volume = {}
        self.seen = set()
        # Self-update from GitHub (updater.py); `restart` is set once new files are in place.
        self.updater = updater.Updater(HELPER_VERSION, on_change=self.update_changed, token=github_key)
        self.restart = asyncio.Event()
        self.offered = None
        # A copy of the code made with git (or the desktop app's private mode): git pull is the update (codeupdate.py).
        self.git_mode = bool(os.environ.get('TP_PRIVATE')) or codeupdate.is_git_copy()
        self.git_state = {}  # the last check: behind / reason / fix
        # Logging in to Schwab again while running (the saved login was refused): see relogin().
        self.config = None  # set by run(): the Schwab app key/secret the login page needs
        self.login_task = None
        self.login_wake = asyncio.Event()  # set when a fresh login is in use
        self.stream_live = False  # the Schwab stream is connected right now
        self.auto_login_at = 0.0  # last time the login page opened by itself (at most every 30 minutes)
        self.status = {**self._status('connecting', 'Connecting to Schwab'), 'update': self.updater.public()}
        # The diagnostics file (Settings > Send diagnostics): outside calls' status/latency and this helper's state.
        diagnostics.watch_http(getattr(self.news, 'http', None))
        diagnostics.watch_http(getattr(client, 'session', None))
        diagnostics.SECTIONS['helper'] = self.diagnostics_section

    @staticmethod
    def _status(status, message):
        # `problems` lists features that couldn't start, shown in the platform's Settings window.
        problems = [f'{name}: {err}' for name, err in engine.LOAD_ERRORS.items()]
        return {'type': 'status', 'status': status, 'message': message, 'version': HELPER_VERSION, 'problems': problems, 'log': str(LOG_PATH)}

    def diagnostics_section(self):
        """This helper's state for the diagnostics file (counts only, no prices or holdings)."""
        now = time.time()
        return {'version': HELPER_VERSION, 'status': self.status.get('status'), 'message': self.status.get('message'),
                'tabsOpen': len(self.browsers), 'symbolsWatched': len(self.listeners), 'quotesLive': len(self.quotes),
                'officialQuotes': len(self.official), 'update': self.updater.public(), 'uptimeSeconds': round(now - STARTED)}

    def set_status(self, status, message):
        self.status = {**self._status(status, message), 'update': self.update_public()}
        broadcast(self.browsers, json.dumps(self.status))
        if SCREEN:
            SCREEN.status(status, message)

    # ----- Browser side -----

    async def handle_browser(self, ws):
        self.browsers.add(ws)
        if SCREEN:
            SCREEN.status(browsers=len(self.browsers))
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
                    engine.background(self.reply(ws, msg.get('id'), self.history_reply(symbol, msg.get('resolution'), msg.get('days')), 'history'))
                elif kind == 'calendar':
                    engine.background(self.reply(ws, msg.get('id'), self.calendar_reply(), 'calendar'))
                elif kind == 'update':
                    engine.background(self.reply(ws, msg.get('id'), self.update_reply(), 'update'))
                elif kind == 'update.check':
                    engine.background(self.reply(ws, msg.get('id'), self.check_reply(), 'update'))
                elif kind == 'schwab_login':
                    engine.background(self.reply(ws, msg.get('id'), self.login_reply(), 'schwab_login'))
                elif kind == 'summary':
                    links = [str(u) for u in msg.get('links') or [] if str(u).startswith(('https://', 'http://'))]
                    engine.background(self.reply(ws, msg.get('id'), self.summary_reply(links, str(msg.get('title', ''))), 'summary'))
                elif kind == 'news':
                    symbols = [str(s).upper() for s in msg.get('symbols') or [] if isinstance(s, str)]
                    engine.background(self.reply(ws, msg.get('id'), self.news_reply(symbols, str(msg.get('query') or '')), 'news'))
                elif DESKTOP and desktop_blocked(kind):
                    await ws.send(json.dumps({'type': 'error', 'id': msg.get('id'), 'message': 'The desktop app is read-only: place orders on the website Trade page.'}))
                elif kind in engine.HANDLERS:
                    msg['_emit'] = self.emitter(ws, msg.get('id'))
                    engine.background(self.reply(ws, msg.get('id'), self.engine_reply(kind, msg), kind))
                elif kind == 'subscribe':
                    if symbol not in self.official:
                        self.official_wake.set()
                    self.listeners.setdefault(symbol, set()).add(ws)
                    if symbol in self.quotes:
                        await ws.send(json.dumps(self.quote_message(symbol)))
                elif kind == 'unsubscribe':
                    self.remove_listener(ws, symbol)
                elif not engine.READY.is_set():
                    # The analysis engine is still loading in the background: answer once it's ready.
                    engine.background(self.after_engine_loads(ws, msg))
                else:
                    diagnostics.record_request(kind, time.time(), False, 'unknown request')
                    await ws.send(json.dumps({'type': 'error', 'id': msg.get('id'), 'message': unknown_request_message(kind)}))
        finally:
            self.browsers.discard(ws)
            if SCREEN:
                SCREEN.status(browsers=len(self.browsers))
            for symbol in list(self.listeners):
                self.remove_listener(ws, symbol)

    async def after_engine_loads(self, ws, msg):
        await engine.wait_loaded()
        kind = msg.get('type')
        if kind in engine.HANDLERS:
            msg['_emit'] = self.emitter(ws, msg.get('id'))
            await self.reply(ws, msg.get('id'), self.engine_reply(kind, msg), kind)
        else:
            try:
                await ws.send(json.dumps({'type': 'error', 'id': msg.get('id'), 'message': unknown_request_message(kind)}))
            except Exception:
                pass

    @staticmethod
    def alert_monitor():
        """The helper's alerts (engine/alerts.py) once the engine has loaded it, else None."""
        return sys.modules.get('engine.alerts')

    def watched(self):
        """Symbols to stream and poll: those open in a tab plus those the helper's alerts need (even with no tab open)."""
        wanted = set(self.listeners)
        mod = self.alert_monitor()
        if mod:
            try:
                wanted |= mod.MONITOR.symbols()
            except Exception as err:
                log.debug('Alert symbols unavailable: %s', err)
        return wanted

    def push_alert(self, event):
        """Shows a fired alert as a desktop notification in every open tab; returns how many tabs got it."""
        broadcast(self.browsers, json.dumps({'type': 'alert', **event}))
        return len(self.browsers)

    def remove_listener(self, ws, symbol):
        listeners = self.listeners.get(symbol)
        if listeners is None:
            return
        listeners.discard(ws)
        if not listeners:
            del self.listeners[symbol]

    async def history_reply(self, symbol, resolution, days):
        # Intraday history older than Schwab keeps comes from Alpaca when its keys are saved (Schwab wins where both exist).
        from engine import alpaca
        days = max(1, min(int(days or 30), MAX_HISTORY_DAYS))
        try:
            bars = await fetch_history(self.client, symbol, resolution, alpaca.schwab_days(resolution, days))
        except Exception as err:
            if not schwab_login_refused(err):
                raise
            opened = self.start_login('chart history')  # opens the login page (at most every 30 minutes)
            raise HelperError(LOGIN_OPENED if opened else LOGIN_NEEDED)
        bars = await alpaca.fill_older(self.engine, symbol, resolution, days, bars)
        log.info('Sent %d %s bars for %s', len(bars), resolution, symbol)
        return {'type': 'history', 'bars': bars}

    def emitter(self, ws, request_id):
        """Lets a long-running engine request (like an AI answer) send progress before its final reply."""
        async def emit(event):
            try:
                await ws.send(json.dumps({'type': 'engine_event', 'id': request_id, 'event': event}))
            except Exception:
                pass
        return emit

    async def engine_reply(self, kind, msg):
        from engine import datahub
        record = datahub.track()  # which cached values (and how old) this reply is built from
        try:
            data = await engine.HANDLERS[kind](self.engine, msg)
        except engine.EngineError as err:
            raise HelperError(str(err)) from err
        prov = datahub.provenance(record)
        if prov and isinstance(data, dict) and 'provenance' not in data:
            data = {**data, 'provenance': prov}  # a copy: the handler's dict may be a cached value
        return {'type': 'engine', 'data': data}

    async def calendar_reply(self):
        events, failed = await self.news.calendar()
        await self.fill_actuals(events)
        return {'type': 'calendar', 'events': events, 'failed': failed}

    async def fill_actuals(self, events):
        """Forex Factory's feed has no actual numbers: read US releases' official figures from FRED (free)."""
        from engine import actuals
        needed = actuals.series_needed(events, time.time())
        if not needed:
            return
        try:
            await asyncio.wait_for(engine.wait_loaded(), 20)
            from engine import macro
        except Exception as err:
            log.info('Calendar actuals skipped: %s', err)
            return

        async def load(series):
            # FRED updates within minutes of a release, so re-check every 10 minutes while an actual is missing.
            cached = self.fred_cache.get(series)
            if cached and time.time() - cached[0] < 600:
                return cached[1]
            rows = await macro._fred_download(self.engine, series)
            self.fred_cache[series] = (time.time(), rows)
            return rows

        results = await asyncio.gather(*(load(s) for s in needed), return_exceptions=True)
        data = {s: r for s, r in zip(needed, results) if not isinstance(r, Exception)}
        for s, r in zip(needed, results):
            if isinstance(r, Exception):
                log.info('FRED %s for the calendar failed: %s', s, r)
        actuals.fill(events, data, EASTERN)

    async def update_reply(self):
        """Installs the newest helper from GitHub (the owner clicked Update now), then restarts."""
        await self.updater.update(self.news.http)
        asyncio.get_running_loop().call_later(1.5, self.restart.set)  # lets this reply reach the browser first
        return {'type': 'update', 'version': self.updater.latest}

    def update_public(self):
        """What the page shows about updates: the newest version, progress, and how this copy is updated."""
        mode = {'mode': 'git', 'git': self.git_state} if self.git_mode else {'mode': 'download'}
        return {**self.updater.public(), 'auto': auto_update_on(), **mode}

    async def check_reply(self):
        """Check for updates (the owner clicked it): looks now, installs what it finds and restarts when the helper
        itself changed. Works for both kinds of copy; a failure comes back in plain words with the fix."""
        if self.git_mode:
            return await self.git_update(asked=True)
        await self.updater.check(self.news.http)
        base = {'type': 'update', 'check': True, 'mode': 'download', 'current': HELPER_VERSION, 'latest': self.updater.latest}
        if self.updater.state == 'failed':
            return {**base, 'ok': False, 'message': self.updater.message, 'fix': ''}
        if self.updater.latest is None:
            return {**base, 'ok': False, 'message': 'GitHub could not be reached.', 'fix': 'Check the internet connection and try again.'}
        if not self.updater.available:
            return {**base, 'ok': True, 'message': f'Up to date: version {HELPER_VERSION} is the newest.'}
        await self.update_reply()
        return {**base, 'ok': True, 'restarting': True, 'message': f'Installing version {self.updater.latest}; the helper restarts in a moment.'}

    async def git_update(self, asked=False):
        """git pull for a copy made with git: checks GitHub, pulls (fast-forward only) and restarts when the helper's
        version changed. Automatic runs wait for a safe moment; Check for updates goes straight away."""
        token = github_key()
        st = await asyncio.to_thread(codeupdate.status, codeupdate.ROOT, token)
        self.git_state = {'behind': st.get('behind'), 'reason': st.get('reason', ''), 'fix': st.get('fix', ''), 'checked': time.time()}
        base = {'type': 'update', 'check': True, 'mode': 'git', 'current': HELPER_VERSION}
        if not st['ok']:
            self.update_changed()
            return {**base, 'ok': False, 'message': st['reason'], 'fix': st['fix']}
        if not st['behind']:
            self.update_changed()
            return {**base, 'ok': True, 'latest': HELPER_VERSION, 'message': f'Up to date: version {HELPER_VERSION}, nothing new on GitHub.'}
        while not asked and not self.safe_to_restart():
            await asyncio.sleep(30)
        res = await asyncio.to_thread(codeupdate.pull, codeupdate.ROOT, token)
        if not res['ok']:
            self.git_state = {**self.git_state, 'reason': res['reason'], 'fix': res['fix']}
            self.update_changed()
            return {**base, 'ok': False, 'message': res['reason'], 'fix': res['fix']}
        new = codeupdate.version_on_disk() or HELPER_VERSION
        self.git_state = {'behind': 0, 'reason': '', 'fix': '', 'checked': time.time()}
        site = ' Close and reopen the app to rebuild the website from it.' if os.environ.get('TP_PRIVATE') else ''
        if new != HELPER_VERSION:
            log.info('git pull brought helper version %s: restarting', new)
            self.updater.latest = new
            self.updater._set('restarting', f'Updated to version {new}. Restarting...')
            asyncio.get_running_loop().call_later(1.5, self.restart.set)
            return {**base, 'ok': True, 'latest': new, 'changed': True, 'restarting': True,
                    'message': f'Got {st["behind"]} new change(s): helper version {new}. The helper restarts in a moment.{site}'}
        self.update_changed()
        return {**base, 'ok': True, 'latest': HELPER_VERSION, 'changed': True,
                'message': f'Got {st["behind"]} new change(s); the helper itself is unchanged (version {HELPER_VERSION}).{site}'}

    def update_changed(self):
        """Tells open tabs (and the start screen) about a newer version or update progress."""
        self.set_status(self.status['status'], self.status['message'])
        if not SCREEN:
            return
        up = self.updater
        if up.available and up.state == 'idle' and self.offered != up.latest:
            self.offered = up.latest
            SCREEN.message(f'Update available (v{HELPER_VERSION} → v{up.latest}): ' + ('it installs by itself in a moment.' if auto_update_on() else 'click Update now in the platform.'), tone='ok')
        elif up.state == 'failed':
            SCREEN.message(up.message, tone='bad')
        elif up.state in ('updating', 'restarting') and up.message:
            SCREEN.message(up.message, tone='ok')

    def safe_to_restart(self):
        """True when restarting loses nothing: no request is being answered and no order preview is waiting for its
        Confirm (the one-time token lives in memory and would be gone after the restart)."""
        try:
            from engine import webull
            waiting = webull.preview_waiting()
        except Exception:
            waiting = False
        logging_in = self.login_task is not None and not self.login_task.done()  # the login page is open
        return self.inflight == 0 and not waiting and not logging_in

    @staticmethod
    def hold_orders(on):
        """While an update installs: new previews, orders and cancels are refused (so none is ever cut off)."""
        try:
            from engine import webull
            webull.UPDATING = on
        except Exception:
            pass

    async def update_loop(self):
        """Checks GitHub for a newer helper at start and every 2 minutes and installs it by itself (on unless
        Settings turns it off), also with the platform open: only at a safe moment (checked every 30 s), then
        restarts; open tabs reconnect and say which version is now running.
        Not in private mode (the desktop launcher's --private, or a git clone): there `git pull` is the update, and an
        online update would overwrite your copy of the code."""
        if self.git_mode:
            # a copy made with git: the same automatic updates, by git pull (fast-forward only) every 10 minutes
            log.info('Copy of the code made with git: updates come from git pull')
            await asyncio.sleep(20)
            while True:
                if auto_update_on():
                    try:
                        res = await self.git_update()
                        if res.get('restarting'):
                            return
                        if not res['ok']:
                            log.warning('Automatic git update: %s', res['message'])
                    except Exception as err:
                        log.warning('Automatic git update failed: %s', err)
                await asyncio.sleep(600)
        await asyncio.sleep(5)
        while True:
            await self.updater.check(self.news.http)
            failed_at = self.auto_failed.get(self.updater.latest, 0)
            while (self.updater.available and self.updater.state == 'idle' and auto_update_on()
                   and time.time() - failed_at > 3600):  # a release that failed to install is retried after an hour
                if not self.safe_to_restart():
                    await asyncio.sleep(30)
                    continue
                self.hold_orders(True)  # set with no await since the check above: no order can start in between
                try:
                    await self.updater.update(self.news.http)
                except updater.UpdateError as err:
                    self.hold_orders(False)
                    self.auto_failed[self.updater.latest] = time.time()
                    log.warning('Automatic update failed: %s', err)
                    break  # the page shows the error and an Update now button
                while self.inflight:  # requests that began before the hold finish first
                    await asyncio.sleep(1)
                await asyncio.sleep(1.5)  # lets tabs hear "restarting" first
                self.restart.set()
                return
            await asyncio.sleep(updater.CHECK_EVERY_SECONDS)

    async def summary_reply(self, links, title):
        if not links:
            raise HelperError('No article link')
        return {'type': 'summary', **(await self.news.summary(links, title))}

    async def news_reply(self, symbols, query=''):
        # only articles the helper can summarise (getters without the check, e.g. in tests, fall back to all)
        getter = getattr(self.news, 'get_readable', None) or self.news.get
        items, failed = await getter(symbols, query)
        return {'type': 'news', 'items': items, 'failed': failed}

    async def reply(self, ws, request_id, work, kind=None):
        started = time.time()
        counted = kind != 'update'  # the update request itself restarts on purpose
        self.inflight += counted
        try:
            await self._answer(ws, request_id, work, kind, started)
        finally:
            self.inflight -= counted  # after the reply was sent, so a restart never swallows it

    async def _answer(self, ws, request_id, work, kind, started):
        try:
            reply = await work
        except Exception as err:  # Report every failure to the browser instead of crashing.
            log.warning('Request failed: %s', err)
            reply = {'type': 'error', 'message': str(err)}
        reply['id'] = request_id
        text = json.dumps(reply)
        failed = reply.get('type') == 'error'
        diagnostics.record_request(kind or reply.get('type'), started, not failed, reply.get('message', '') if failed else '', len(text))
        try:
            await ws.send(text)
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
                quote = self.quotes.setdefault(symbol, {'last': None, 'prevClose': (self.official.get(symbol) or {}).get('prevClose')})
                if price is not None and self.take_price(symbol, price, item.get('TRADE_TIME_MILLIS') or default_time, 'stream'):
                    quote['last'] = price
                if item.get('CLOSE_PRICE') is not None and symbol not in self.official:
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

    def price_hub(self):
        """engine/pricehub.py once the engine has loaded it, else None (prices then work as before)."""
        return sys.modules.get('engine.pricehub')

    def take_price(self, symbol, price, at, source):
        """True when `price` should be shown: the newest trade from any source that isn't a stray print. Records its
        source and trade time on the quote. Without the hub (engine still loading, or no trade time) it is taken."""
        hub = self.price_hub()
        if not hub or not at:
            return True
        if not hub.HUB.offer(symbol, price, at, source):
            return False
        quote = self.quotes.get(symbol)
        if quote is not None:
            quote['src'] = hub.NAMES.get(source, source)
            quote['at'] = round(float(at) / (1000 if float(at) > 1e11 else 1), 3)
        return True

    async def fresh_prices(self):
        """Every 10 s in market hours: asks backups (Alpaca, then Yahoo) about watched symbols that have gone quiet and
        shows any newer trade the hub holds (also from option chains). No requests while every symbol is fresh."""
        while True:
            await asyncio.sleep(10)
            hub = self.price_hub()
            if not hub or not self.engine:
                continue
            now_ny = dt.datetime.now(EASTERN)
            if now_ny.weekday() >= 5 or not (4 <= now_ny.hour < 20):
                continue
            symbols = [s for s in self.watched() if SYMBOL_PATTERN.match(s) and not s.startswith(('$', '/'))]
            try:
                await hub.backups(self.engine, symbols)
            except Exception as err:
                log.debug('Backup prices failed: %s', err)
            for symbol in symbols:
                best = hub.HUB.best.get(symbol)
                quote = self.quotes.get(symbol)
                if best and quote is not None and best[1] > (quote.get('at') or 0) and best[0] != quote.get('last'):
                    quote['last'], quote['at'], quote['src'] = best[0], round(best[1], 3), hub.NAMES.get(best[2], best[2])
                    self.dirty_quotes.add(symbol)

    @staticmethod
    def official_quote(item):
        """Last price and previous close from a Schwab REST quote, using Schwab's own net change so the day's change
        matches what Schwab shows (also after the close and on weekends, when it's the latest session's move)."""
        q = item.get('quote') or {}
        def num(key):
            v = q.get(key)
            return float(v) if isinstance(v, (int, float)) and v == v else None
        last = num('lastPrice') or num('mark') or num('closePrice')
        net = num('netChange')
        prev = last - net if last is not None and net is not None else num('closePrice')
        if not last or not prev:
            return None
        return {'last': last, 'prevClose': prev}

    async def refresh_official(self):
        """Refreshes the official quote of every watched symbol every 30 seconds (and soon after a new one)."""
        while True:
            symbols = sorted(s for s in self.watched() if SYMBOL_PATTERN.match(s))
            for i in range(0, len(symbols), 100):
                chunk = symbols[i:i + 100]
                try:
                    response = await (getattr(self.engine, 'schwab', None) or self.client).get_quotes(chunk)  # paced and recorded by the data hub
                    data = response.json() if response.status_code == 200 else {}
                except Exception as err:
                    log.debug('Official quotes failed: %s', err)
                    continue
                for symbol in chunk:
                    item = data.get(symbol)
                    official = self.official_quote(item) if isinstance(item, dict) else None
                    if not official:
                        continue
                    self.official[symbol] = official
                    quote = self.quotes.setdefault(symbol, {'last': None, 'prevClose': None})
                    quote['prevClose'] = official['prevClose']
                    q = item.get('quote') or {}
                    traded = q.get('tradeTime') or q.get('quoteTime')
                    # the newest trade wins: the official quote replaces the stream's price when the stream has stalled
                    if self.take_price(symbol, official['last'], traded, 'schwab') or quote['last'] is None or symbol not in self.seen:
                        quote['last'] = official['last']
                    self.dirty_quotes.add(symbol)
            self.official_wake.clear()
            try:
                await asyncio.wait_for(self.official_wake.wait(), timeout=30)
                await asyncio.sleep(0.3)  # gather a burst of new subscriptions into one request
            except asyncio.TimeoutError:
                pass

    async def send_quotes(self):
        """Sends price changes for the watchlist and index cards a few times a second."""
        while True:
            await asyncio.sleep(0.3)
            dirty = bool(self.dirty_quotes)
            for symbol in list(self.dirty_quotes):
                if symbol in self.quotes:
                    broadcast(self.listeners.get(symbol, set()), json.dumps(self.quote_message(symbol)))
            self.dirty_quotes.clear()
            mod = self.alert_monitor()
            if dirty and mod:
                mod.MONITOR.push, mod.MONITOR.http, mod.MONITOR.quotes = self.push_alert, self.engine.http, self.quotes
                try:
                    mod.MONITOR.check(self.quotes)
                except Exception as err:  # alerts must never stop the quotes
                    log.warning('Alert check failed: %s', err)

    async def relogin(self, reason='', manual=False):
        """Schwab refused the saved login: opens the Schwab login page and, once you approve, uses the new login
        straight away (no restart; everything else keeps running meanwhile). One login page at a time; opened by
        itself at most every 30 minutes, any time from the "Log in to Schwab" button."""
        task = self.start_login(reason, manual)
        if task is None:
            raise HelperError(LOGIN_NEEDED)
        return await asyncio.shield(task)

    def start_login(self, reason='', manual=False):
        """The running login (or a new one); None when one opened by itself less than 30 minutes ago."""
        if self.login_task and not self.login_task.done():
            return self.login_task
        if not manual and time.time() - self.auto_login_at < 1800:
            return None
        self.auto_login_at = time.time()
        self.login_task = asyncio.ensure_future(self._relogin(reason))
        self.login_task.add_done_callback(lambda t: t.cancelled() or t.exception())  # failures are reported, not raised here
        return self.login_task

    async def _relogin(self, reason):
        if not self.config:
            raise HelperError(LOGIN_NEEDED)
        # the other helper (desktop app / website) may already have logged in again: use its newer login, no page
        fresh = await asyncio.to_thread(newer_saved_login, self.client, self.config)
        if fresh is None:
            log.warning('Schwab refused the saved login (%s): opening the Schwab login page', reason or 'asked')
            self.set_status('error', LOGIN_OPENED)
            if SCREEN:
                SCREEN.pause()  # schwab-py prints its login steps; the start screen comes back afterwards
            try:
                TOKEN_PATH.unlink()  # the refused login; the login page writes the new one here
            except FileNotFoundError:
                pass
            try:
                fresh = await asyncio.to_thread(schwab_login, self.config)
            except Exception as err:
                log.warning('Schwab login not finished: %s', err)
                self.set_status(*(('live', 'Streaming from Schwab') if self.stream_live else ('error', LOGIN_NEEDED)))
                raise HelperError('The Schwab login wasn\u2019t finished. Press "Log in to Schwab" to try again.')
            finally:
                if SCREEN:
                    SCREEN.resume()
        # the same client object everywhere (stream, quotes, charts, engine) now uses the new login
        old = self.client.session
        self.client.session, self.client.token_metadata = fresh.session, fresh.token_metadata
        try:
            await old.aclose()
        except Exception:
            pass
        self.set_status(*(('live', 'Streaming from Schwab') if self.stream_live else ('connecting', 'Logged in to Schwab again; connecting')))
        self.auto_login_at = 0.0
        self.login_wake.set()
        self.login_wake = asyncio.Event()
        log.info('Logged in to Schwab again')
        if SCREEN:
            SCREEN.message('Logged in to Schwab again.', tone='ok')
        return {'type': 'schwab_login', 'ok': True}

    async def login_reply(self):
        return await self.relogin('the Log in to Schwab button', manual=True)

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
                self.stream_live = True
                log.info('Connected to the Schwab live stream')
                attempt = 0
                while True:
                    wanted = self.watched()
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
                self.stream_live = False
                if schwab_login_refused(err):
                    wake = self.login_wake
                    try:
                        await self.relogin('live stream')
                        attempt = 0
                        continue
                    except Exception:
                        self.set_status('error', LOGIN_NEEDED)
                        try:  # wait for the button (or try the login page again in 30 minutes)
                            await asyncio.wait_for(wake.wait(), timeout=1800)
                        except asyncio.TimeoutError:
                            pass
                        continue
                delay = min(60, 2 ** attempt)
                attempt += 1
                log.warning('Schwab stream problem: %s. Retrying in %ss', err, delay)
                self.set_status('error', f'Schwab stream disconnected, retrying in {delay}s')
                await asyncio.sleep(delay)


def github_key():
    """The owner's GitHub key for updates while the repository is private (Settings), or ''. Stays on this computer."""
    try:
        from engine import settings
        return settings.get('github_token')
    except Exception:
        return ''


def auto_update_on():
    """Automatic helper updates: on unless the owner turned them off in Settings."""
    try:
        from engine import settings
        return settings.load().get('auto_update') is not False
    except Exception:
        return True


async def screen_clock():
    """Keeps the start screen's status line ticking (clock and live dot)."""
    while True:
        await asyncio.sleep(1)
        SCREEN.tick()


LOGIN_OPENED = ('Schwab needs you to log in again: the Schwab login page opened in your browser. Log in and approve '
                '(if you see "connection is not private", click Advanced, then Proceed). Prices come back by themselves.')
LOGIN_NEEDED = 'Schwab needs you to log in again. Press "Log in to Schwab" (Settings, or the Schwab dot at the bottom).'


def newer_saved_login(client, config):
    """A client for the saved login when it is newer than the one this helper uses (the other helper, website or
    desktop app, already logged in again: they share the file), else None."""
    try:
        saved = json.loads(TOKEN_PATH.read_text())
        mine = getattr(getattr(client, 'token_metadata', None), 'creation_timestamp', None) or 0
        if float(saved.get('creation_timestamp', 0)) <= float(mine):
            return None
        return client_from_token_file(str(TOKEN_PATH), config['app_key'], config['app_secret'], asyncio=True)
    except Exception:
        return None


def schwab_login_refused(err):
    """True when Schwab turned the saved login down (expired or cancelled), not a network hiccup."""
    text = f'{type(err).__name__} {err}'.lower()
    return any(k in text for k in ('invalid_grant', 'refresh_token_authentication_error', 'invalid_client', 'invalid_token',
                                   'unauthorized', "'401", ' 401 ', 'status code 401', 'schwab login expired'))


def needs_login():
    """True when Schwab will ask you to log in in the browser (no saved login, or it's about to expire)."""
    try:
        saved = json.loads(TOKEN_PATH.read_text())
        return time.time() - float(saved.get('creation_timestamp', 0)) > 6.5 * 86400
    except (OSError, ValueError, TypeError):
        return True


async def engine_ready(market):
    """Once the background engine load finishes: log any feature that failed and tell open tabs."""
    await engine.wait_loaded()
    for name, err in engine.LOAD_ERRORS.items():
        log.warning('Feature unavailable: %s (%s)', name, err)
    mod = market.alert_monitor()
    if mod:  # alerts can reach open tabs (and the phone) from now on, even before the first quote
        mod.MONITOR.push, mod.MONITOR.http, mod.MONITOR.quotes = market.push_alert, market.engine.http, market.quotes
    market.set_status(market.status['status'], market.status['message'])


# Warmed up after start, so the platform's first pages open instantly (each is cached on disk afterwards).
WARM_UP = [
    ('invest.board', {'symbols': ['$SPX', '$COMPX', 'VTI', 'AGG', 'PSP', 'IBIT', 'GLD']}),
    ('macro.curve', {}),
    ('bonds.market', {}),
    ('bonds.curvefit', {}),  # Home's Edge today line; the first fit of the day takes a while
    # Markets > Monitor (src/pages/monitorPage.ts): world markets and sectors, futures with positioning, the Fed path,
    # movers and the correlation set, so the screen opens from a fresh copy
    ('invest.board', {'symbols': ['SPY', 'QQQ', 'DIA', 'IWM', 'EWC', 'EWZ', 'EWW', 'EZU', 'EWU', 'EWG', 'EWQ', 'EWL', 'EWI', 'EWP', 'KSA', 'EWJ', 'FXI', 'EWH', 'EWY', 'EWT', 'INDA', 'EWA', 'XLK', 'XLC', 'XLY', 'XLF', 'XLI', 'XLV', 'XLP', 'XLE', 'XLB', 'XLRE', 'XLU']}),
    ('futures.board', {}),
    ('macro.fedodds', {}),
    ('invest.movers', {'index': '$SPX'}),
    *[('invest.history', {'symbol': s}) for s in ('SPY', 'TLT', 'UUP', 'GLD', 'USO')],
]
WARM_EVERY_SECONDS = 15 * 60  # kept warm all day: a screen opened later still answers from a recent copy


async def warm_up(market):
    await asyncio.sleep(2)
    try:
        await market.news.get([])
    except Exception as err:
        log.info('News warm-up failed: %s', err)
    await engine.wait_loaded()
    while True:
        for kind, params in WARM_UP:
            if kind in engine.HANDLERS:
                try:
                    await engine.HANDLERS[kind](market.engine, dict(params))
                except Exception as err:
                    log.info('Warm-up of %s failed: %s', kind, err)
        await asyncio.sleep(WARM_EVERY_SECONDS)


async def market_scanner(market):
    """The background market scanner (engine/scanner.py): rescans every 10 minutes."""
    await engine.wait_loaded()
    if 'scanner' in engine.LOAD_ERRORS:
        return
    from engine import scanner
    await scanner.background_loop(market.engine, market.news)


async def selfcheck_schedule(market):
    """The self-check (engine/selfcheck.py) every 30 minutes: security, data, accuracy and speed."""
    await engine.wait_loaded()
    if 'selfcheck' in engine.LOAD_ERRORS:
        return
    from engine import selfcheck
    selfcheck.HELPER.update(host=HOST, origins=list(ALLOWED_ORIGINS),
                            files=[p for p in (CONFIG_PATH, TOKEN_PATH, DATA_DIR / 'settings.json', DATA_DIR / 'platform.db') if p.exists()])
    await selfcheck.loop(market.engine)


async def liveflow_schedule(market):
    """Live flow (engine/liveflow.py): big off-exchange prints (Alpaca) and big options trades (Schwab) on the owner's
    chosen symbols, with alerts even when no tab is open."""
    await engine.wait_loaded()
    if 'liveflow' in engine.LOAD_ERRORS:
        return
    from engine import liveflow
    await liveflow.loop(market.engine)


async def prospect_schedule(market):
    """Keeps the prospecting data (engine/prospect.py) fresh, only for sources the owner has downloaded once."""
    await engine.wait_loaded()
    if 'prospect' in engine.LOAD_ERRORS:
        return
    from engine import prospect
    await prospect.schedule_loop(market.engine)


def chrome_command(url):
    """The command that opens `url` in Google Chrome on this computer, or None if Chrome isn't installed."""
    if sys.platform == 'win32':
        roots = [os.environ.get(k, '') for k in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA')]
        for root in filter(None, roots):
            exe = Path(root) / 'Google' / 'Chrome' / 'Application' / 'chrome.exe'
            if exe.exists():
                return [str(exe), url]
    elif sys.platform == 'darwin':
        if Path('/Applications/Google Chrome.app').exists() or (Path.home() / 'Applications' / 'Google Chrome.app').exists():
            return ['open', '-a', 'Google Chrome', url]
    else:
        exe = shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium')
        if exe:
            return [exe, url]
    return None


def open_platform(url=PLATFORM_URL):
    """Opens the platform in Chrome (or the default browser if Chrome isn't installed)."""
    cmd = chrome_command(url)
    try:
        if cmd:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return 'Chrome'
        webbrowser.open(url)
        return 'your browser'
    except Exception as err:
        log.warning('Could not open the browser: %s', err)
        return None


async def open_when_ready(market, enabled):
    """Opens the platform once the helper is ready, unless a platform tab connects by itself (it reconnects
    automatically when it was already open), so you don't get a second tab."""
    if not enabled:
        return
    from engine import settings
    if settings.load().get('open_browser') is False:
        return
    await asyncio.sleep(3)
    if market.browsers:
        return
    where = await asyncio.to_thread(open_platform)
    if where and SCREEN:
        SCREEN.message(f'Opened the platform in {where}.', tone='ok')
    elif where:
        print(f'Opened the platform in {where}.')


async def run(client, sec_contact='', open_browser=True, config=None):
    diagnostics.PERSIST = True  # remember account ids between runs so the diagnostics file masks them from the start
    market = Market(client, engine_ctx=engine.EngineContext(client, sec_contact))
    market.config = config
    try:
        # Room for files attached to AI questions (spreadsheets, PDFs, images).
        server = await serve(market.handle_browser, HOST, PORT, origins=ALLOWED_ORIGINS, max_size=40 * 2**20)
    except OSError:
        if SCREEN:
            SCREEN.pause()
        sys.exit(f'Port {PORT} is already in use. Is the helper already running in another window?')
    if not DESKTOP:
        codeupdate.note_running(HELPER_VERSION, PORT)  # the desktop launcher replaces an older helper instead of reusing it
    async with server:
        jobs = [market.run_stream(), market.send_quotes(), market.refresh_official(), engine_ready(market), warm_up(market),
                open_when_ready(market, open_browser), market_scanner(market), prospect_schedule(market), market.update_loop(),
                selfcheck_schedule(market), liveflow_schedule(market), market.fresh_prices()]
        if DESKTOP:  # the website's helper runs the scanner, prospecting and updates; this one only answers the app
            jobs = [market.run_stream(), market.send_quotes(), market.refresh_official(), engine_ready(market), market.fresh_prices()]
        if SCREEN:
            SCREEN.ready(PLATFORM_URL, LOG_PATH, os.environ.get('TP_LAUNCH_WARNING', ''))
            return await until_restart(market, [*jobs, screen_clock()])
        print()
        print('=' * 64)
        print(f'  Schwab helper (version {HELPER_VERSION}) is running.')
        print(f'  Open {PLATFORM_URL}')
        print('  Keep this window open while you use the platform.')
        print('  To stop the helper, press Ctrl+C or close this window.')
        print('=' * 64)
        print()
        return await until_restart(market, jobs)


async def until_restart(market, jobs):
    """Runs the helper's jobs until one fails or an update asks for a restart (returns True then)."""
    work = asyncio.gather(*jobs)
    restart = asyncio.ensure_future(market.restart.wait())
    await asyncio.wait([work, restart], return_when=asyncio.FIRST_COMPLETED)
    if restart.done():
        work.cancel()
        try:
            await work
        except (asyncio.CancelledError, Exception):
            pass
        return True
    restart.cancel()
    work.result()
    return False


def restart_helper():
    """After an update: under the launcher, a special exit code makes splash.py install any new parts and start the
    new version (rolling back if it won't start). Run directly, it asks you to start it again with the start file."""
    log.info('Restarting after the update')
    if os.environ.get('TP_LAUNCHER'):
        if SCREEN:
            SCREEN.close('Restarting with the new version...')
        sys.exit(updater.RESTART_CODE)
    print('\nUpdated. Start the helper again with start-windows.bat or start-mac.command (it installs any new parts).')
    sys.exit(0)


def start_screen():
    """Uses the launcher's start screen when it started us (TP_SPLASH holds the screen's random seed)."""
    global SCREEN
    seed = os.environ.get('TP_SPLASH')
    if not seed:
        return
    try:
        import splash
        SCREEN = splash.HelperScreen(int(seed), splash.take_over_screen())
    except Exception:
        SCREEN = None


def make_private(data_dir=None):
    """Your keys, login tokens, client database, order log and caches are readable by you alone (Mac/Linux; Windows
    keeps your user folder private already): files the helper creates from now on are owner-only, and existing files
    and folders in ~/.trading-platform are tightened (folders 700, files 600). Never fails the start."""
    if os.name == 'nt':
        return 0
    data_dir = Path(data_dir or DATA_DIR)
    os.umask(0o077)
    fixed = 0
    try:
        data_dir.mkdir(exist_ok=True)
        for path in [data_dir, *data_dir.rglob('*')]:
            if path.is_symlink():
                continue  # never follow a link out of the folder
            mode = path.stat().st_mode & 0o777
            if mode & 0o077:
                path.chmod(mode & ~0o077)  # take away group and other access; your own access stays as it was
                fixed += 1
    except OSError as err:
        log.warning('Could not tighten file permissions in %s: %s', data_dir, err)
    return fixed


def main():
    parser = argparse.ArgumentParser(description='Serve Schwab market data to the Trading Platform charts.')
    parser.add_argument('--reset', action='store_true', help='enter new Schwab keys and log in again')
    parser.add_argument('--no-browser', action='store_true', help="don't open the platform in the browser when ready")
    parser.add_argument('--desktop', action='store_true', help="run as the desktop app's own helper (port 8766, app only)")
    args = parser.parse_args()
    make_private()
    if not args.desktop:  # a pending update belongs to the website's helper
        updater.confirm_started()
    if args.desktop:
        global PORT, DESKTOP
        PORT, DESKTOP = DESKTOP_PORT, True
        ALLOWED_ORIGINS[:] = [DESKTOP_ORIGIN]
        args.no_browser = True
    # The new version imported fine and is starting (confirmed above): from here on a problem (login, busy port) isn't
    # the update's fault.
    # Big libraries (AI, numpy, scipy) load while we log in and start the server.
    engine.start_loading()
    start_screen()
    if SCREEN:
        # Messages go to the log file only; the start screen shows what matters.
        logging.getLogger().setLevel(logging.INFO)
        logging.captureWarnings(True)
    else:
        logging.basicConfig(level=logging.INFO, format='%(asctime)s  %(message)s', datefmt='%H:%M:%S')
    # Also keep a log file, so problems can be looked at after the window is closed.
    try:
        DATA_DIR.mkdir(exist_ok=True)
        file_log = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=1, encoding='utf-8')
        file_log.setFormatter(logging.Formatter('%(asctime)s  %(levelname)s  %(name)s  %(message)s'))
        logging.getLogger().addHandler(file_log)
    except OSError:
        pass
    log.info('Helper version %s starting (Python %s)', HELPER_VERSION, sys.version.split()[0])
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('websockets').setLevel(logging.WARNING)
    try:
        serve_forever(args)
    except KeyboardInterrupt:
        if SCREEN:
            SCREEN.close('Helper stopped.')
        else:
            print('\nHelper stopped.')
    except SystemExit:
        if SCREEN:
            SCREEN.pause()
        raise
    except Exception as err:
        log.exception('The helper stopped because of an error')
        if SCREEN:
            SCREEN.pause()
        sys.exit(f'The helper stopped because of an error: {err}\nDetails are in {LOG_PATH}')


def schwab_login(config):
    """Saved Schwab login, or the browser login when it's missing or a week old (opens by itself, no Enter needed)."""
    return easy_client(
        config['app_key'],
        config['app_secret'],
        config.get('callback_url', CALLBACK_URL),
        str(TOKEN_PATH),
        asyncio=True,
        interactive=False,  # open the Schwab login page straight away instead of waiting for Enter
        callback_timeout=900.0,  # 15 minutes to log in and approve
    )


def serve_forever(args):
    if SCREEN:
        SCREEN.step('Getting ready...', 91, 0.3)
        if args.reset or not CONFIG_PATH.exists():
            SCREEN.pause()  # first-time setup asks for your Schwab keys
    config = load_config(args.reset)
    login = needs_login()
    if SCREEN and login:
        SCREEN.pause()
    if not SCREEN or login:
        print()
        print('Logging in to Schwab (Schwab asks for this about once a week)...')
        print('Your browser opens the Schwab login page by itself. Log in and approve access.')
        print('If you then see a "connection is not private" warning, click Advanced, then Proceed:')
        print('that warning is expected for this local login. You have 15 minutes; nothing to type here.')
        print()
    else:
        SCREEN.step('Logging in to Schwab...', 96, 2)
    try:
        client = schwab_login(config)
    except RedirectTimeoutError:
        sys.exit('The Schwab login wasn\'t finished within 15 minutes. Close this window and start the helper again '
                 'to get a fresh login page.')
    if SCREEN:
        SCREEN.resume()  # puts the start screen back after the login steps
        SCREEN.step('Starting the live data server...', 99, 1)
    try:
        restart = asyncio.run(run(client, config.get('sec_contact', ''), open_browser=not args.no_browser, config=config))
    finally:
        scanner = sys.modules.get('engine.scanner')
        if scanner is not None:
            scanner.shutdown()  # stop the scanner's worker processes too
        quant = sys.modules.get('engine.quant')
        if quant is not None:
            quant.shutdown()  # and the optimiser's
        prospect = sys.modules.get('engine.prospect')
        if prospect is not None:
            prospect.shutdown()  # and the prospect data worker
        if not DESKTOP:
            codeupdate.clear_running()
    if restart:
        restart_helper()


if __name__ == '__main__':
    main()
