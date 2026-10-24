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
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo
from pathlib import Path

# Libraries print harmless deprecation notices while loading; hide them so the window stays clear.
_show_warning = warnings.showwarning
if os.environ.get('TP_SPLASH'):
    # Started from the launcher's start screen: keep start-up notices off the screen (main() logs them to the file).
    logging.getLogger().addHandler(logging.NullHandler())
warnings.showwarning = lambda *args, **kwargs: None
import httpx  # noqa: E402
from schwab.auth import easy_client  # noqa: E402
from schwab.streaming import StreamClient  # noqa: E402
from websockets.asyncio.server import broadcast, serve  # noqa: E402
import engine  # noqa: E402  (light: its big modules load in the background, see engine.start_loading)
from engine.core import is_safe_url  # noqa: E402
warnings.showwarning = _show_warning

# Bump when the browser needs new helper features, so it can ask you to download the new copy.
HELPER_VERSION = 22

HOST = '127.0.0.1'
PORT = 8765
CALLBACK_URL = 'https://127.0.0.1:8182'
PLATFORM_URL = 'https://cadenb777-jpg.github.io/Trading-Platform/'

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
FOMC_DECISIONS = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09']
EASTERN = ZoneInfo('America/New_York')
# Headlines for one ticker, e.g. from your watchlist.
TICKER_NEWS_QUERY = '{symbol}+stock+when:3d'
MAX_TICKER_FEEDS = 12
NEWS_CACHE_SECONDS = 90
NEWS_CACHE_MAX = 400  # feeds + article summaries kept in memory
NEWS_LIMIT = 80
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
    response = await getattr(client, RESOLUTIONS[resolution])(symbol, **kwargs)
    if response.status_code == 401:
        raise HelperError('Schwab login expired. Close the helper and start it again to log in.')
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
        self.http = httpx.AsyncClient(timeout=10, follow_redirects=True, headers={'User-Agent': USER_AGENT})

    async def _cached(self, url, max_age, parse):
        cached = self.cache.get(url)
        if cached and time.time() - cached[0] < max_age:
            return cached[1]
        response = await self.http.get(url)
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
        self.listeners = {}  # symbol -> set of browser connections
        self.status = self._status('connecting', 'Connecting to Schwab')
        self.quotes = {}  # symbol -> {'last': ..., 'prevClose': ...}
        # Schwab's official quote (REST) per symbol: the previous close it measures the day's change from. The stream's
        # CLOSE_PRICE turns into today's close once the session ends, which made changes read 0%, so it's only a fallback.
        self.official = {}
        self.official_wake = asyncio.Event()
        self.dirty_quotes = set()
        self.last_volume = {}
        self.seen = set()

    @staticmethod
    def _status(status, message):
        # `problems` lists features that couldn't start, shown in the platform's Settings window.
        problems = [f'{name}: {err}' for name, err in engine.LOAD_ERRORS.items()]
        return {'type': 'status', 'status': status, 'message': message, 'version': HELPER_VERSION, 'problems': problems, 'log': str(LOG_PATH)}

    def set_status(self, status, message):
        self.status = self._status(status, message)
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
                    engine.background(self.reply(ws, msg.get('id'), self.history_reply(symbol, msg.get('resolution'), msg.get('days'))))
                elif kind == 'calendar':
                    engine.background(self.reply(ws, msg.get('id'), self.calendar_reply()))
                elif kind == 'summary':
                    links = [str(u) for u in msg.get('links') or [] if str(u).startswith(('https://', 'http://'))]
                    engine.background(self.reply(ws, msg.get('id'), self.summary_reply(links, str(msg.get('title', '')))))
                elif kind == 'news':
                    symbols = [str(s).upper() for s in msg.get('symbols') or [] if isinstance(s, str)]
                    engine.background(self.reply(ws, msg.get('id'), self.news_reply(symbols, str(msg.get('query') or ''))))
                elif kind in engine.HANDLERS:
                    msg['_emit'] = self.emitter(ws, msg.get('id'))
                    engine.background(self.reply(ws, msg.get('id'), self.engine_reply(kind, msg)))
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
            await self.reply(ws, msg.get('id'), self.engine_reply(kind, msg))
        else:
            try:
                await ws.send(json.dumps({'type': 'error', 'id': msg.get('id'), 'message': unknown_request_message(kind)}))
            except Exception:
                pass

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
        bars = await fetch_history(self.client, symbol, resolution, alpaca.schwab_days(resolution, days))
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
        try:
            data = await engine.HANDLERS[kind](self.engine, msg)
        except engine.EngineError as err:
            raise HelperError(str(err)) from err
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

    async def summary_reply(self, links, title):
        if not links:
            raise HelperError('No article link')
        return {'type': 'summary', **(await self.news.summary(links, title))}

    async def news_reply(self, symbols, query=''):
        items, failed = await self.news.get(symbols, query)
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
                quote = self.quotes.setdefault(symbol, {'last': None, 'prevClose': (self.official.get(symbol) or {}).get('prevClose')})
                if price is not None:
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
            symbols = sorted(s for s in self.listeners if SYMBOL_PATTERN.match(s))
            for i in range(0, len(symbols), 100):
                chunk = symbols[i:i + 100]
                try:
                    response = await self.client.get_quotes(chunk)
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
                    if quote['last'] is None or symbol not in self.seen:
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


async def screen_clock():
    """Keeps the start screen's status line ticking (clock and live dot)."""
    while True:
        await asyncio.sleep(1)
        SCREEN.tick()


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
    market.set_status(market.status['status'], market.status['message'])


# Warmed up after start, so the platform's first pages open instantly (each is cached on disk afterwards).
WARM_UP = [
    ('invest.board', {'symbols': ['$SPX', '$COMPX', 'VTI', 'AGG', 'PSP', 'IBIT', 'GLD']}),
    ('macro.curve', {}),
    ('bonds.market', {}),
]


async def warm_up(market):
    await asyncio.sleep(2)
    try:
        await market.news.get([])
    except Exception as err:
        log.info('News warm-up failed: %s', err)
    await engine.wait_loaded()
    for kind, params in WARM_UP:
        if kind in engine.HANDLERS:
            try:
                await engine.HANDLERS[kind](market.engine, dict(params))
            except Exception as err:
                log.info('Warm-up of %s failed: %s', kind, err)


async def market_scanner(market):
    """The background market scanner (engine/scanner.py): rescans every 10 minutes."""
    await engine.wait_loaded()
    if 'scanner' in engine.LOAD_ERRORS:
        return
    from engine import scanner
    await scanner.background_loop(market.engine, market.news)


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


async def run(client, sec_contact='', open_browser=True):
    market = Market(client, engine_ctx=engine.EngineContext(client, sec_contact))
    try:
        # Room for files attached to AI questions (spreadsheets, PDFs, images).
        server = await serve(market.handle_browser, HOST, PORT, origins=ALLOWED_ORIGINS, max_size=40 * 2**20)
    except OSError:
        if SCREEN:
            SCREEN.pause()
        sys.exit(f'Port {PORT} is already in use. Is the helper already running in another window?')
    async with server:
        background = [engine_ready(market), warm_up(market), open_when_ready(market, open_browser), market_scanner(market)]
        if SCREEN:
            SCREEN.ready(PLATFORM_URL, LOG_PATH, os.environ.get('TP_LAUNCH_WARNING', ''))
            await asyncio.gather(market.run_stream(), market.send_quotes(), market.refresh_official(), screen_clock(), *background)
            return
        print()
        print('=' * 64)
        print(f'  Schwab helper (version {HELPER_VERSION}) is running.')
        print(f'  Open {PLATFORM_URL}')
        print('  Keep this window open while you use the platform.')
        print('  To stop the helper, press Ctrl+C or close this window.')
        print('=' * 64)
        print()
        await asyncio.gather(market.run_stream(), market.send_quotes(), market.refresh_official(), *background)


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


def main():
    parser = argparse.ArgumentParser(description='Serve Schwab market data to the Trading Platform charts.')
    parser.add_argument('--reset', action='store_true', help='enter new Schwab keys and log in again')
    parser.add_argument('--no-browser', action='store_true', help="don't open the platform in the browser when ready")
    args = parser.parse_args()
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
        print('Logging in to Schwab...')
        print('If a browser opens: log in, approve access, and if you see a "connection is not private"')
        print('warning, click Advanced, then Proceed. That warning is expected for this local login.')
        print()
    else:
        SCREEN.step('Logging in to Schwab...', 96, 2)
    client = easy_client(
        config['app_key'],
        config['app_secret'],
        config.get('callback_url', CALLBACK_URL),
        str(TOKEN_PATH),
        asyncio=True,
    )
    if SCREEN:
        SCREEN.resume()  # puts the start screen back after the login steps
        SCREEN.step('Starting the live data server...', 99, 1)
    try:
        asyncio.run(run(client, config.get('sec_contact', ''), open_browser=not args.no_browser))
    finally:
        scanner = sys.modules.get('engine.scanner')
        if scanner is not None:
            scanner.shutdown()  # stop the scanner's worker processes too


if __name__ == '__main__':
    main()
