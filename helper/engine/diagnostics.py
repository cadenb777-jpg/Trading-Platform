"""
Diagnostics: one file the owner can save (Settings or the Data button) and upload in a chat, so problems with his real
data (Schwab, Webull, SEC, futures quotes...) can be fixed without guessing. Nothing is ever sent anywhere: the browser
asks for `diagnostics.collect` and saves the reply as a file.

What it keeps (small, in memory): the last ~300 requests (type, time, duration, ok or the error text, reply size; never
the request or reply contents), the last ~300 outside web calls (host, path, status, latency; never query strings),
and short per-feature notes (futures quotes: keys Schwab sent and how many matched; Webull: endpoint and status).

Everything leaves through `redact`, the one function that masks secrets: saved keys and tokens (their exact values),
anything that looks like a token/key/secret, account ids and numbers (all but the last 2 characters), email addresses,
paths in the home folder and long hex/base64 strings. Standard library only, so it loads with the helper.
"""
import collections
import json
import platform
import re
import sys
import time
from pathlib import Path

from .core import handler

DATA_DIR = Path.home() / '.trading-platform'
LOG_PATH = DATA_DIR / 'helper.log'
LOG_LINES = 200

REQUESTS = collections.deque(maxlen=300)
CALLS = collections.deque(maxlen=300)
NOTES = {}  # feature -> deque of recent notes
#: name -> function() returning a dict for the file (the live helper registers its status here)
SECTIONS = {}
#: account ids/numbers seen (Webull, Schwab): always masked to their last 2 characters
ACCOUNTS = set()

MASK = '[redacted]'


def record_request(kind, started, ok, error='', size=0):
    """Called once per browser request when its reply is sent."""
    REQUESTS.append({'type': str(kind or '?')[:60], 'at': round(started), 'ms': round((time.time() - started) * 1000),
                     'ok': bool(ok), **({'error': str(error)[:300]} if error else {}), 'bytes': int(size)})


def record_call(host, path, status, ms):
    CALLS.append({'host': host, 'path': (path or '')[:120], 'status': status, 'ms': round(ms), 'at': round(time.time())})


def note(feature, **info):
    """A short fact about a feature's last run (e.g. note('futures quotes', asked=12, matched=10, keys=[...]))."""
    NOTES.setdefault(feature, collections.deque(maxlen=20)).append({'at': round(time.time()), **info})


def account(value):
    """Remembers an account id/number so it is masked everywhere it shows up (logs and errors included)."""
    s = str(value or '').strip()
    if len(s) >= 4:
        ACCOUNTS.add(s)


def watch_http(client):
    """Adds hooks to an httpx client that record each call's host, path, status and latency (no query string)."""
    async def on_request(request):
        request.extensions['tp_started'] = time.monotonic()

    async def on_response(response):
        request = response.request
        started = request.extensions.get('tp_started')
        record_call(request.url.host, request.url.path, response.status_code, (time.monotonic() - started) * 1000 if started else 0)

    try:
        hooks = client.event_hooks
        client.event_hooks = {'request': [*hooks.get('request', []), on_request], 'response': [*hooks.get('response', []), on_response]}
    except Exception:  # not an httpx client (tests' fakes): nothing to record
        pass
    return client


# ---------- redaction ----------

SECRET_NAME = re.compile(r'(key|secret|token|password|passwd|auth|signature|cookie|session|credential|email|contact|chat|topic)', re.I)
ACCOUNT_NAME = re.compile(r'(account|acct|hash)', re.I)
_TEXT_RULES = [
    (re.compile(r'(?i)\bbearer\s+[\w.~+/=-]+'), 'Bearer ' + MASK),
    (re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+'), '[email]'),
    (re.compile(r'(https?://[^\s?#"\'<>]+)\?[^\s"\'<>]*'), r'\1?[query removed]'),
    (re.compile(r'(?i)\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|app[_-]?key|authorization|signature|client[_-]?id)[\w-]*)'
                r'(["\']?\s*[:=]\s*["\']?)(?!\[)([^\s"\',;&}\]]+)'), r'\1\2' + MASK),
    (re.compile(r'\b\d{5,15}:[A-Za-z0-9_-]{30,}'), MASK),  # Telegram bot token
    (re.compile(r'(?i)\b(account|acct)(s?(?:[ _-]?(?:id|number|no\.?|hash))?\s*[:=#]?\s*["\']?)([A-Za-z0-9-]*\d[A-Za-z0-9-]{2,})'),
     lambda m: m.group(1) + m.group(2) + _last2(m.group(3))),
    (re.compile(r'\b[0-9a-fA-F]{24,}\b'), '[hex]'),
    (re.compile(r'(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{32,}={0,2}'), '[long string]'),  # base64-like (has a digit)
    (re.compile(r'\b\d{7,}\b'), lambda m: _last2(m.group(0))),  # long numbers: account numbers, phone numbers
]
_HOME_PATTERN = re.compile(r'(?i)(/Users/|/home/|[A-Z]:\\Users\\|[A-Z]:/Users/)[^/\\\s"\'<>]+')


def _last2(s):
    s = str(s)
    return '••' + s[-2:] if len(s) > 2 else '••'


def _strings(value, out, depth=0):
    if depth > 6:
        return
    if isinstance(value, str):
        out.add(value)
    elif isinstance(value, dict):
        for v in value.values():
            _strings(v, out, depth + 1)
    elif isinstance(value, list):
        for v in value:
            _strings(v, out, depth + 1)


def known_secrets():
    """Exact values that must never appear: saved settings secrets and the Schwab keys and login token's contents."""
    values = set()
    try:
        from . import settings
        data = settings.load()
        for k in (*settings.SECRET_KEYS, 'sec_contact'):
            if isinstance(data.get(k), str):
                values.add(data[k])
    except Exception:
        pass
    for name in ('schwab_config.json', 'schwab_token.json'):
        try:
            _strings(json.loads((DATA_DIR / name).read_text()), values)
        except (OSError, ValueError):
            pass
    return sorted((v for v in values if len(v.strip()) >= 8 and not v.startswith('http')), key=len, reverse=True)


def redact_text(text, secrets=(), accounts=()):
    s = str(text)
    for value in secrets:
        s = s.replace(value, MASK)
    for value in sorted(accounts, key=len, reverse=True):
        s = s.replace(value, _last2(value))
    home = str(Path.home())
    if len(home) > 3:
        for form in {home, home.replace('\\', '/'), home.replace('/', '\\')}:
            s = s.replace(form, '~')
    s = _HOME_PATTERN.sub('~', s)
    for pattern, repl in _TEXT_RULES:
        s = pattern.sub(repl, s)
    return s


def redact(value, secrets=None, accounts=None, _depth=0):
    """A copy of `value` (dicts, lists, strings, numbers) with every secret masked. The one redaction used for the file."""
    if secrets is None:
        secrets = known_secrets()
    if accounts is None:
        accounts = set(ACCOUNTS)
    if _depth > 12:
        return '[too deep]'
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            name = redact_text(k, secrets, accounts)
            if isinstance(v, (str, int, float)) and not isinstance(v, bool) and SECRET_NAME.search(str(k)) and v not in ('', 0):
                out[name] = MASK
            elif isinstance(v, (str, int)) and not isinstance(v, bool) and ACCOUNT_NAME.search(str(k)) and str(v):
                out[name] = _last2(v)
            else:
                out[name] = redact(v, secrets, accounts, _depth + 1)
        return out
    if isinstance(value, (list, tuple, collections.deque)):
        return [redact(v, secrets, accounts, _depth + 1) for v in value]
    if isinstance(value, str):
        return redact_text(value, secrets, accounts)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact_text(repr(value), secrets, accounts)


# ---------- the file ----------

def log_tail(path=None, lines=LOG_LINES):
    """The last `lines` lines of helper.log (read from the end, so a big log costs nothing)."""
    path = Path(path or LOG_PATH)
    try:
        with path.open('rb') as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 256 * 1024))
            text = f.read().decode('utf-8', 'replace')
    except OSError as err:
        return [f'(log not readable: {type(err).__name__})']
    return text.splitlines()[-lines:]


def settings_flags():
    """Which settings are on or set (never the values of keys, tokens or the email)."""
    try:
        from . import settings
        flags = dict(settings.public())
    except Exception as err:
        return {'error': f'{type(err).__name__}'}
    flags.pop('models', None)
    flags['secContactSet'] = bool(flags.pop('secContact', ''))
    return flags


def feed_health():
    """Per outside host: calls, failures (status 400+), the last status and the average latency."""
    hosts = {}
    for c in CALLS:
        h = hosts.setdefault(c['host'], {'calls': 0, 'failed': 0, 'lastStatus': None, 'lastAt': None, 'avgMs': 0})
        h['calls'] += 1
        h['failed'] += c['status'] >= 400
        h['avgMs'] += c['ms']
        h['lastStatus'], h['lastAt'] = c['status'], c['at']
    for h in hosts.values():
        h['avgMs'] = round(h['avgMs'] / h['calls'])
    return hosts


def _package_versions():
    from importlib import metadata
    out = {}
    for name in ('schwab-py', 'httpx', 'websockets', 'numpy', 'scipy', 'anthropic'):
        try:
            out[name] = metadata.version(name)
        except Exception:
            out[name] = None
    return out


def collect(version=None, log_path=None):
    """The helper's half of the diagnostics file, already redacted."""
    from . import LOAD_ERRORS, READY
    sections = {}
    for name, fn in SECTIONS.items():
        try:
            sections[name] = fn()
        except Exception as err:
            sections[name] = {'error': f'{type(err).__name__}: {err}'}
    requests = list(REQUESTS)
    data = {
        'helperVersion': version if version is not None else sections.get('helper', {}).get('version'),
        'collectedAt': round(time.time()),
        'python': sys.version.split()[0],
        'os': platform.system() + ' ' + platform.release(),
        'packages': _package_versions(),
        'engineLoaded': READY.is_set(),
        'featuresUnavailable': dict(LOAD_ERRORS),
        'settings': settings_flags(),
        **sections,
        'requestSummary': {'count': len(requests), 'failed': sum(not r['ok'] for r in requests)},
        'requests': requests,
        'feedHealth': feed_health(),
        'externalCalls': list(CALLS)[-100:],
        'notes': {k: list(v) for k, v in NOTES.items()},
        'logTail': log_tail(log_path),
    }
    return redact(data)


@handler('diagnostics.collect')
async def collect_handler(ctx, msg):
    return collect()
