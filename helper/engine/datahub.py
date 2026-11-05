"""
The data hub: one way to ask any outside data source, so every source gets the same politeness, retries, error
messages and health record. Ideas (not code) from Fincept Terminal's DataHub: per-source rate caps, last-known-good
values on failure, in-flight de-duplication and an inspector of each source's state.

    response = await datahub.get(ctx.http, 'fred', url, params=...)        # an HTTP GET
    response = await datahub.call('schwab', lambda: client.get_quotes(s))  # any call returning a response
    ctx.schwab                                                             # already routed through call('schwab')

What every call gets:
  pacing     one gate per source (SOURCES): a minimum gap between requests, a per-minute budget shared by every
             caller (Schwab: 120 a minute for the whole app, of which background work such as the scanner may use
             only `per_minute - reserve`, so charts always have room) and a cap on requests at once. Nobody sleeps
             while holding the gate.
  coalescing calls with the same `key` while one is in flight share that one request (`get` keys on the URL,
             params and headers automatically).
  retries    429, 5xx and network errors are retried `retries` times with exponential backoff (Retry-After is
             honoured, capped at 30 s); a 429 also pauses the whole source until then. Only GETs retry.
  errors     the final failure is a DataError (an EngineError, so pages show it) naming the source, never a URL
             with its query string (keys can hide there).
  health     HEALTH[source]: calls, failures, last success/failure, latency, rate-limit pauses, coalesced calls and
             cache hits (ctx.cached reports those). `snapshot()` feeds the Data window and the diagnostics file.
  provenance `envelope(value, source, as_of)` = {value, source, sourceName, asOf, fetchedAt, stale}; every engine reply
             also carries `provenance` ({fetchedAt, stale, sources}) built from the cached values it used.

Times: everything is stored as UTC unix seconds; `ny_date`/`ny_session_close` convert for US market sessions.
Units: `fraction`, `percent`, `bp_to_fraction`, `from_thousands` say what they do, so a reply never mixes 4.2 (%) and
0.042 (fraction).
"""
import asyncio
import collections
import contextvars
import datetime as dt
import email.utils
import hashlib
import logging
import random
import re
import time
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from .core import EngineError

log = logging.getLogger('engine.datahub')
NY = ZoneInfo('America/New_York')


# ---------- the clock (tests swap in a fake one) ----------

class Clock:
    def now(self):
        return time.monotonic()

    def wall(self):
        return time.time()

    async def sleep(self, seconds):
        await asyncio.sleep(seconds)


CLOCK = Clock()


# ---------- sources ----------

@dataclass
class Source:
    name: str
    label: str
    #: minimum seconds between two requests (0 = none); `gap_from` = measured from the previous request's 'start' or 'end'
    gap: float = 0.0
    gap_from: str = 'start'
    #: requests allowed in any 60 seconds for the whole helper (None = no budget)
    per_minute: int = None
    #: part of the budget background callers leave for interactive ones
    reserve: int = 0
    #: requests at once
    concurrency: int = 6
    #: background requests at once
    background_concurrency: int = 1
    retries: int = 2
    backoff: float = 1.0
    #: what the owner should know about this source (shown in the Sources table)
    about: str = ''


SOURCES = {s.name: s for s in (
    Source('schwab', 'Schwab', per_minute=120, reserve=30, concurrency=4, retries=1,
           about='Quotes, price history, options (market data only). 120 requests a minute for the whole app.'),
    Source('sec', 'SEC EDGAR', gap=0.125, concurrency=5, about='Filings, XBRL facts, Form 4/D/13F. At most 8 a second (the SEC allows 10).'),
    Source('yahoo', 'Yahoo Finance', gap=0.25, concurrency=2, about='Dividends and splits (total return); cross-check prices.'),
    Source('nasdaq', 'Nasdaq.com', gap=1.0, gap_from='end', concurrency=1, about='Cross-check quotes.'),
    Source('alpaca', 'Alpaca', gap=60 / 180, concurrency=2, retries=1, about='Older intraday history (optional free keys).'),
    Source('fred', 'FRED', concurrency=8, about='Economic series and Treasury yields.'),
    Source('treasury', 'US Treasury', concurrency=3, about='Yield curve backup, auctions (Fiscal Data).'),
    Source('cftc', 'CFTC', concurrency=3, about='Commitments of Traders (weekly).'),
    Source('finra', 'FINRA', concurrency=4, about='Daily short-sale volume.'),
    Source('census', 'Census geocoder', concurrency=1, retries=1, about='Address lookups for prospecting.'),
    Source('news', 'News and calendar feeds', concurrency=6, retries=1, about='Google News and CNBC RSS; Forex Factory calendar.'),
    Source('webull', 'Webull', retries=0, about='Your Webull account (its own gate and limits in webull.py).'),
    Source('other', 'Other sites', concurrency=6, retries=1),
)}

#: host -> source, for calls made by URL
HOSTS = {
    'www.sec.gov': 'sec', 'data.sec.gov': 'sec', 'efts.sec.gov': 'sec',
    'query1.finance.yahoo.com': 'yahoo', 'query2.finance.yahoo.com': 'yahoo', 'fc.yahoo.com': 'yahoo',
    'api.nasdaq.com': 'nasdaq', 'data.alpaca.markets': 'alpaca',
    'fred.stlouisfed.org': 'fred', 'api.stlouisfed.org': 'fred',
    'home.treasury.gov': 'treasury', 'api.fiscaldata.treasury.gov': 'treasury',
    'publicreporting.cftc.gov': 'cftc', 'cdn.finra.org': 'finra',
    'geocoding.geo.census.gov': 'census', 'news.google.com': 'news', 'www.cnbc.com': 'news', 'search.cnbc.com': 'news',
    'nfs.faireconomy.media': 'news',
}


def source_of_url(url):
    m = re.match(r'https?://([^/:?#]+)', str(url))
    return HOSTS.get(m.group(1).lower(), 'other') if m else 'other'


# ---------- errors ----------

RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
_QUERY = re.compile(r'(https?://[^\s?#"\']+)\?[^\s"\']*')


def clean_message(text):
    """An error text without query strings (API keys travel there) and capped in length."""
    return _QUERY.sub(r'\1', str(text or ''))[:300]


class DataError(EngineError):
    """A source couldn't answer after its retries. `source`, `status` (HTTP status or None) and `retryable`."""

    def __init__(self, message, source='other', status=None, retryable=False):
        super().__init__(clean_message(message))
        self.source, self.status, self.retryable = source, status, retryable


def _network_errors():
    try:
        import httpx
        return (httpx.TransportError, asyncio.TimeoutError, ConnectionError, OSError)
    except ImportError:  # pragma: no cover - httpx is a core dependency
        return (asyncio.TimeoutError, ConnectionError, OSError)


# ---------- health ----------

@dataclass
class Health:
    calls: int = 0
    ok: int = 0
    failed: int = 0
    retried: int = 0
    coalesced: int = 0
    consecutive_failures: int = 0
    last_ok: float = None
    last_error: str = ''
    last_error_at: float = None
    last_status: int = None
    avg_ms: float = None
    rate_limited: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    stale_served: int = 0
    notes: collections.deque = field(default_factory=lambda: collections.deque(maxlen=5))


HEALTH = collections.defaultdict(Health)


def record_ok(source, ms=None, status=None):
    h = HEALTH[source]
    h.ok += 1
    h.consecutive_failures = 0
    h.last_ok = CLOCK.wall()
    h.last_status = status
    if ms is not None:
        h.avg_ms = ms if h.avg_ms is None else 0.8 * h.avg_ms + 0.2 * ms


def record_failure(source, message, status=None):
    h = HEALTH[source]
    h.failed += 1
    h.consecutive_failures += 1
    h.last_error = clean_message(message)
    h.last_error_at = CLOCK.wall()
    h.last_status = status


def record_cache(source, hit, stale=False):
    """ctx.cached reports each lookup: a hit (fresh), a stale value served while it refreshes, or a miss."""
    h = HEALTH[source]
    if stale:
        h.stale_served += 1
        h.cache_hits += 1
    elif hit:
        h.cache_hits += 1
    else:
        h.cache_misses += 1


def note(source, text):
    """A short fact worth showing beside a source (e.g. 'rescaled Alpaca bars to Schwab at the seam')."""
    HEALTH[source].notes.append({'at': round(CLOCK.wall()), 'text': clean_message(text)})


def state(source, now=None):
    """'ok', 'failing', 'rate-limited' or 'idle' (not used this run)."""
    now = CLOCK.now() if now is None else now
    h = HEALTH.get(source)
    if gate(source).blocked_until > now:
        return 'rate-limited'
    if not h or (not h.calls and not h.cache_hits):
        return 'idle'
    if h.consecutive_failures and (h.last_ok is None or (h.last_error_at or 0) >= h.last_ok):
        return 'failing'
    return 'ok'


def snapshot():
    """Every source's health for the Data window and the diagnostics file (no URLs, no keys)."""
    wall, now = CLOCK.wall(), CLOCK.now()
    rows = []
    for name, src in SOURCES.items():
        h = HEALTH.get(name) or Health()
        g = _GATES.get(name)
        looked = h.cache_hits + h.cache_misses
        rows.append({
            'source': name, 'label': src.label, 'about': src.about, 'state': state(name, now),
            'calls': h.calls, 'ok': h.ok, 'failed': h.failed, 'retried': h.retried, 'coalesced': h.coalesced,
            'lastOk': h.last_ok, 'ageSeconds': round(wall - h.last_ok) if h.last_ok else None,
            'lastError': h.last_error or None, 'lastErrorAt': h.last_error_at, 'lastStatus': h.last_status,
            'avgMs': round(h.avg_ms) if h.avg_ms is not None else None,
            'rateLimited': h.rate_limited,
            'rateLimitedFor': round(g.blocked_until - now) if g and g.blocked_until > now else 0,
            'usedLastMinute': g.used_last_minute(now) if g else 0, 'perMinute': src.per_minute,
            'cacheHits': h.cache_hits, 'cacheMisses': h.cache_misses, 'staleServed': h.stale_served,
            'cacheHitRate': round(h.cache_hits / looked, 3) if looked else None,
            'notes': list(h.notes),
        })
    return {'at': round(wall), 'sources': rows}


# ---------- pacing ----------

class Gate:
    """One source's pacing: minimum gap, per-minute budget (with a reserve for interactive callers) and caps on
    requests at once. Waiters work out their wait and sleep without holding anything."""

    def __init__(self, src):
        self.src = src
        self.last_start = -1e18
        self.last_end = -1e18
        self.sent = collections.deque()
        self.blocked_until = 0.0
        self.active = 0
        self.active_background = 0

    def used_last_minute(self, now):
        while self.sent and self.sent[0] <= now - 60:
            self.sent.popleft()
        return len(self.sent)

    def _wait(self, now, background, gap, gap_from=None):
        src = self.src
        wait = self.blocked_until - now
        gap = src.gap if gap is None else gap
        gap_from = gap_from or src.gap_from
        if gap:
            base = self.last_end if gap_from == 'end' else self.last_start
            wait = max(wait, base + gap - now)
            if gap_from == 'end' and self.active:
                wait = max(wait, 0.01)  # the previous one hasn't finished
        if src.per_minute:
            limit = src.per_minute - (src.reserve if background else 0)
            used = self.used_last_minute(now)
            if used >= limit:
                wait = max(wait, self.sent[used - limit] + 60 - now)
        if self.active >= src.concurrency or (background and self.active_background >= src.background_concurrency):
            wait = max(wait, 0.01)
        return wait

    async def acquire(self, background=False, gap=None, gap_from=None):
        while True:  # no await between the check and the booking, so no lock is needed (one event loop)
            now = CLOCK.now()
            wait = self._wait(now, background, gap, gap_from)
            if wait <= 0:
                self.last_start = now
                if self.src.per_minute:  # only a budgeted source needs the times (trimmed in used_last_minute)
                    self.sent.append(now)
                    self.used_last_minute(now)
                self.active += 1
                self.active_background += background
                return
            await CLOCK.sleep(min(wait, 5.0))

    def release(self, background=False):
        self.active -= 1
        self.active_background -= background
        self.last_end = CLOCK.now()

    def block(self, seconds):
        self.blocked_until = max(self.blocked_until, CLOCK.now() + seconds)


_GATES = {}


def gate(source):
    g = _GATES.get(source)
    if g is None:
        g = _GATES[source] = Gate(SOURCES.get(source) or SOURCES['other'])
    return g


class Turn:
    """`async with datahub.Turn('sec'):` for code that sends its own request (a streamed download) but must share
    the source's pacing."""

    def __init__(self, source, background=False, gap=None, gap_from=None):
        self.source, self.background, self.gap, self.gap_from = source, background, gap, gap_from

    async def __aenter__(self):
        await gate(self.source).acquire(self.background, self.gap, self.gap_from)
        HEALTH[self.source].calls += 1
        return self

    async def __aexit__(self, *exc):
        gate(self.source).release(self.background)
        return False


# ---------- calls ----------

_INFLIGHT = {}


#: the longest wait taken for one retry (a longer Retry-After is capped, and logged)
MAX_RETRY_WAIT = 30.0


def retry_after_seconds(value, now=None):
    """Seconds from a Retry-After header: delta-seconds ('7') or an HTTP-date ('Wed, 21 Oct 2026 07:28:00 GMT').
    None when absent or unreadable."""
    if value is None or str(value).strip() == '':
        return None
    text = str(value).strip()
    try:
        return max(0.0, float(text))
    except ValueError:
        pass
    try:
        when = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        return None
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.timezone.utc)
    now = CLOCK.wall() if now is None else now
    return max(0.0, when.timestamp() - now)


def _retry_after(response, attempt, base):
    headers = getattr(response, 'headers', None) or {}
    asked = retry_after_seconds(headers.get('Retry-After'))
    if asked is None:
        return min(MAX_RETRY_WAIT, base * (2 ** attempt)) * (0.75 + 0.5 * random.random())
    if asked > MAX_RETRY_WAIT:
        log.info('Retry-After of %.0f s capped at %.0f s', asked, MAX_RETRY_WAIT)
    return min(MAX_RETRY_WAIT, asked)


async def call(source, fn, *, key=None, background=False, gap=None, gap_from=None, retries=None, retry=True, timeout=None,
               passthrough=False):
    """Runs `fn()` (returning a response-like object with `status_code`, or any value) through the source's gate.

    Retries 429/5xx/network errors (when `retry`), raises DataError after the last try, returns every other reply
    (404, 403...) to the caller, whose own messages stay. `key` joins identical calls already in flight.
    `passthrough` returns the last 429/5xx reply instead of raising (for callers with their own handling)."""
    if key is not None:
        k = (source, key)
        task = _INFLIGHT.get(k)
        if task is not None and not task.done():
            HEALTH[source].coalesced += 1
            return await asyncio.shield(task)
        task = asyncio.ensure_future(_attempts(source, fn, background, (gap, gap_from), retries, retry, timeout, passthrough))
        _INFLIGHT[k] = task
        task.add_done_callback(lambda t, k=k: (_INFLIGHT.pop(k, None) if _INFLIGHT.get(k) is t else None,
                                               t.cancelled() or t.exception()))
        return await asyncio.shield(task)
    return await _attempts(source, fn, background, (gap, gap_from), retries, retry, timeout, passthrough)


async def _attempts(source, fn, background, gap, retries, retry, timeout, passthrough=False):
    src = SOURCES.get(source) or SOURCES['other']
    retries = src.retries if retries is None else retries
    if not retry:
        retries = 0
    g, h = gate(source), HEALTH[source]
    network = _network_errors()
    for attempt in range(retries + 1):
        await g.acquire(background, *gap)
        released = False
        h.calls += 1
        started = CLOCK.now()
        try:
            result = fn()
            if asyncio.iscoroutine(result) or isinstance(result, asyncio.Future):
                result = await (asyncio.wait_for(result, timeout) if timeout else result)
        except EngineError as err:
            record_failure(source, err)
            raise
        except network as err:
            message = f'Couldn\'t reach {src.label} ({type(err).__name__})'
            record_failure(source, message)
            if attempt < retries:
                h.retried += 1
                g.release(background)
                released = True
                await CLOCK.sleep(min(30.0, src.backoff * 2 ** attempt))
                continue
            raise DataError(message, source, None, True) from err
        finally:
            if not released:
                g.release(background)
        ms = (CLOCK.now() - started) * 1000
        status = getattr(result, 'status_code', None)
        if isinstance(status, int) and status in RETRY_STATUS:
            delay = _retry_after(result, attempt, src.backoff)
            if status == 429:
                h.rate_limited += 1
                g.block(delay)
            record_failure(source, f'{src.label} answered {status}', status)
            if attempt < retries:
                h.retried += 1
                await CLOCK.sleep(delay)
                continue
            if passthrough:
                return result
            word = 'is limiting requests' if status == 429 else 'had a server error'
            raise DataError(f'{src.label} {word} ({status}); try again in a minute.', source, status, True)
        if isinstance(status, int) and status in (401, 403):
            record_failure(source, f'{src.label} refused the request ({status})', status)
        else:
            record_ok(source, ms, status if isinstance(status, int) else None)
        return result
    raise DataError(f'{src.label} could not be reached.', source)  # pragma: no cover - the loop always returns/raises


def request_key(method, url, params=None, headers=None):
    """A stable in-flight key for one HTTP request (headers hashed so keys never sit in it as text)."""
    items = sorted((params or {}).items()) if isinstance(params, dict) else params
    head = hashlib.sha1(repr(sorted((headers or {}).items())).encode()).hexdigest()[:12] if headers else ''
    return (method, str(url), repr(items), head)


async def get(client, source, url, *, params=None, headers=None, timeout=None, background=False, gap=None,
              gap_from=None, retries=None, coalesce=True, **kw):
    """client.get(url, ...) through `source`'s gate (None = from the URL's host), with retries and coalescing."""
    source = source or source_of_url(url)
    extra = {k: v for k, v in (('params', params), ('headers', headers), ('timeout', timeout)) if v is not None}

    def go():
        return client.get(url, **extra, **kw)
    key = request_key('GET', url, params, headers) if coalesce and not kw else None
    return await call(source, go, key=key, background=background, gap=gap, gap_from=gap_from, retries=retries)


class Routed:
    """A client (Schwab's) whose get_* calls go through `call(source)`. `.raw` is the client itself;
    `.background()` is the same client marked as background work (scanner), which leaves room for charts."""

    def __init__(self, client, source='schwab', background=False):
        self.raw = getattr(client, 'raw', client)
        self._source, self._background = source, background

    def background(self):
        return Routed(self.raw, self._source, True)

    def __getattr__(self, name):
        attr = getattr(self.raw, name)
        if not name.startswith('get_') or not callable(attr):
            return attr

        def routed(*args, **kwargs):
            return call(self._source, lambda: attr(*args, **kwargs), background=self._background)
        return routed


def raw(client):
    """The client without routing (for code that does its own `call`)."""
    return getattr(client, 'raw', client)


# ---------- provenance ----------

#: cache-key prefix -> source (for ctx.cached's hit counts and reply provenance)
CACHE_PREFIXES = {
    'sec': 'sec', 'form4': 'sec', 'formd': 'sec', 'nport': 'sec', 'alts': 'sec', 'smartmoney': 'sec', '13f': 'sec',
    'fred': 'fred', 'treasury': 'treasury', 'fiscal': 'treasury', 'auction': 'treasury', 'cot': 'cftc',
    'dividends': 'yahoo', 'splits': 'yahoo', 'yahoo-events': 'yahoo', 'daily': 'schwab', 'scan': 'schwab',
    'invest': 'schwab', 'board': 'schwab', 'quote': 'schwab', 'schwab': 'schwab', 'alpaca': 'alpaca', 'finra': 'finra', 'short': 'finra', 'crosscheck': 'other',
}


def source_of_key(key):
    first = key[0] if isinstance(key, tuple) and key else key
    text = str(first).lower()
    if text in SOURCES:
        return text
    for prefix, source in CACHE_PREFIXES.items():
        if text == prefix or text.startswith(prefix + '-') or text.startswith(prefix + ':') or text.startswith(prefix + '_'):
            return source
    return None


def envelope(value, source, as_of=None, fetched_at=None, stale=False):
    """A figure with where it came from: {value, source, sourceName, asOf, fetchedAt, stale}. asOf = the time the
    figure describes (a close, a filing date, unix seconds or 'YYYY-MM-DD'); fetchedAt = when the helper got it."""
    return {'value': value, 'source': source, 'sourceName': (SOURCES.get(source) or Source(source, source)).label,
            'asOf': as_of, 'fetchedAt': round(fetched_at if fetched_at is not None else CLOCK.wall()), 'stale': bool(stale)}


_TRACK = contextvars.ContextVar('tp_datahub_track', default=None)


def track():
    """Starts recording which cached values the current request uses. Returns the record (pass it to `provenance`)."""
    record = {}
    _TRACK.set(record)
    return record


def note_value(key, saved_at, stale):
    """ctx.cached calls this for every value it hands out."""
    record = _TRACK.get()
    if record is None:
        return
    source = source_of_key(key)
    if not source or source == 'other':
        return
    old = record.get(source)
    if old is None or saved_at < old['fetchedAt'] or (stale and not old['stale']):
        record[source] = {'fetchedAt': min(saved_at, old['fetchedAt']) if old else saved_at, 'stale': stale or bool(old and old['stale'])}


def provenance(record):
    """{fetchedAt (oldest data used, unix s), stale (an older saved copy was shown while it refreshes), sources} or None."""
    if not record:
        return None
    return {'fetchedAt': round(min(r['fetchedAt'] for r in record.values())),
            'stale': any(r['stale'] for r in record.values()),
            'sources': {s: {'fetchedAt': round(r['fetchedAt']), 'stale': r['stale'], 'name': SOURCES[s].label}
                        for s, r in sorted(record.items())}}


# ---------- one-time cache migrations ----------

def backup_rows(con, migration, keys):
    """Copies cache.db rows into the side table cache_backup (with the migration's name and time) before a
    migration changes or removes them. Returns how many were copied. Restore by copying them back into `cache`."""
    con.execute('CREATE TABLE IF NOT EXISTS cache_backup (key TEXT, saved REAL, data TEXT, migration TEXT, at REAL)')
    n = 0
    for key in keys:
        n += con.execute('INSERT INTO cache_backup SELECT key, saved, data, ?, ? FROM cache WHERE key = ?',
                         (migration, time.time(), key)).rowcount
    return n


def delete_prefix(prefix, keep=None):
    """A migration that backs up, then deletes, rows whose key starts with `prefix` (and doesn't end with `keep`)."""
    def run(con, name):
        sql = 'SELECT key FROM cache WHERE substr(key, 1, ?) = ?'
        args = [len(prefix), prefix]
        if keep:
            sql += ' AND substr(key, -?) != ?'
            args += [len(keep), keep]
        keys = [r[0] for r in con.execute(sql, args).fetchall()]
        saved = backup_rows(con, name, keys)
        for key in keys:
            con.execute('DELETE FROM cache WHERE key = ?', (key,))
        log.info('Cache migration %s: backed up %d row(s) to cache_backup, removed %d', name, saved, len(keys))
        return len(keys)
    return run


#: (name, function(con, name) -> rows changed). Each runs once (a ('migration', name) row records it), in order.
#: Old Alpaca bars were saved dividend-adjusted under ('alpaca', symbol, size); now ('alpaca', symbol, size, 'split').
#: The scanner runs its own 30-minute migration first (it reads these rows to tell Alpaca bars from Schwab ones).
MIGRATIONS = (
    ('alpaca-split-only', delete_prefix("('alpaca', '", ", 'split')")),
)


def run_migrations(disk, migrations=MIGRATIONS):
    """Runs each cache migration once, in order (safe to call at every start), each in its own transaction after
    backing up what it touches; a failure stops the chain there. Returns {name: rows changed} for those that ran."""
    import json
    done = {}
    for name, fn in migrations:
        try:
            with disk._lock:
                con = disk.db()
                marker = repr(('migration', name))
                if con.execute('SELECT 1 FROM cache WHERE key = ?', (marker,)).fetchone():
                    continue
                n = fn(con, name)
                con.execute('INSERT OR REPLACE INTO cache VALUES (?, ?, ?)', (marker, time.time(), json.dumps({'changed': n})))
                con.commit()
                done[name] = n
        except Exception as err:  # never stop the helper over a clean-up; it is tried again next start
            try:
                disk.db().rollback()
            except Exception:
                pass
            # Later steps may depend on this one (the 30-minute step reads the rows the Alpaca step removes), so
            # none of them runs and none is marked done: the next start redoes the chain in order.
            log.info('Cache migration %s failed (%s); later migrations wait for the next start', name, err)
            break
    return done


# ---------- times and units ----------

def utc_seconds(value):
    """Unix seconds (UTC) from seconds, milliseconds, an ISO time ('Z' or offset; naive = UTC) or a date (midnight
    UTC). None when it can't be read."""
    if value is None or value == '':
        return None
    if isinstance(value, (int, float)):
        return int(value / 1000) if value > 1e11 else int(value)
    if isinstance(value, dt.datetime):
        return int((value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)).timestamp())
    if isinstance(value, dt.date):
        return int(dt.datetime(value.year, value.month, value.day, tzinfo=dt.timezone.utc).timestamp())
    text = str(value).strip()
    try:
        return utc_seconds(float(text))
    except ValueError:
        pass
    try:
        return utc_seconds(dt.datetime.fromisoformat(text.replace('Z', '+00:00')))
    except ValueError:
        return None


def ny_date(seconds):
    """The New York calendar date of a UTC unix time (a daily bar stamped 05:00 UTC is that New York day)."""
    return dt.datetime.fromtimestamp(seconds, NY).date()


def ny_session_close(day):
    """UTC unix seconds of the regular-session close of New York date `day` (13:00 on early-close days)."""
    from .core import NYSE_EARLY_CLOSES
    hour = 13 if day in NYSE_EARLY_CLOSES else 16
    return int(dt.datetime(day.year, day.month, day.day, hour, tzinfo=NY).timestamp())


def is_trading_day(day):
    from .core import NYSE_HOLIDAYS
    return day.weekday() < 5 and day not in NYSE_HOLIDAYS


def fraction(percent_value):
    """4.2 (%) -> 0.042."""
    return None if percent_value is None else percent_value / 100.0


def percent(fraction_value):
    """0.042 -> 4.2 (%)."""
    return None if fraction_value is None else fraction_value * 100.0


def bp_to_fraction(bp):
    """25 (basis points) -> 0.0025."""
    return None if bp is None else bp / 10000.0


def from_thousands(value):
    """A figure reported in thousands (13F values before 2023, many FRED series) -> units."""
    return None if value is None else value * 1000.0
