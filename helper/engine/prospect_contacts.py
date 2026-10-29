"""
Contacts for prospects, from each firm's own website (free, public, polite), plus a review queue, a change watcher,
an AI research analyst and a do-not-contact list. Everything lives in prospect.db next to the SEC data.

1. Website crawler: the firm's website from Form ADV (or one the owner types). At most MAX_PAGES pages per firm (home,
   then team / people / about / leadership / contact / approach pages found by their link text, then bio pages linked
   from the team page). It reads robots.txt first and obeys it, waits HOST_GAP (1 s, or the site's Crawl-delay) between
   requests to a host, sends an honest User-Agent naming the platform, and only fetches public internet addresses.
   It extracts people (name, title, bio snippet), emails the firm publishes, main and direct phone lines (fax, mobile and
   unlabelled numbers on bio pages are dropped: no personal cell numbers) and the investment focus. Every finding keeps
   its page URL and date.
2. Email layer: published addresses are labelled "published". The firm's address pattern (first.last, flast...) is worked
   out from published addresses of named people; guesses for other people are labelled by how far they were checked:
   "pattern + server-checked" (the mail server accepted the mailbox; SMTP check is OFF by default), "pattern + domain
   accepts mail" (the domain has MX records), "guess", or "catch-all (can't verify)" (the server accepts any address).
   Nothing is ever "verified" unless the firm published it.
3. Phones: the main line from Form ADV and the website; direct lines only when the firm publishes them as direct.
4. AI research analyst (prospect.ai_profile): the owner's Anthropic key drafts a profile from the saved pages and SEC
   facts. Every fact must cite a source and quote it; facts whose source or quote can't be found are dropped.
5. Change watcher: weekly (and on demand) re-checks the SEC facts of watched and saved prospects and re-crawls their
   websites, recording new people, title changes, AUM changes, new filings and website changes.
6. Review queue: crawled, AI and watcher findings arrive "pending"; approved ones are shown as "reviewed by you on <date>".
7. Do-not-contact list: per firm or email. Contact exports and the firm export leave them out.

Not used, on purpose: LinkedIn scraping, bought or leaked lists, people-search sites.
"""
import asyncio
import csv
import datetime as dt
import hashlib
import html
import io
import json
import logging
import re
import secrets
import smtplib
import time
import unicodedata
import urllib.parse
import urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path

from . import prospect as pr
from .core import EngineError, background, handler, is_safe_url

log = logging.getLogger('engine.prospect')

MAX_PAGES = 10          # pages per firm per crawl (robots.txt not counted)
HOST_GAP = 1.0          # seconds between requests to one host (tests set 0)
MAX_GAP = 10.0          # longest Crawl-delay honoured (a longer one stops the crawl politely)
MAX_BYTES = 2_000_000   # per page
PAGE_TEXT_CHARS = 30000  # text kept per page (for the AI analyst and change checks)
MX_DAYS = 7
CHECK_DAYS = 30
WATCH_DAYS = 7
WATCH_MAX = 60          # firms per watcher run
ROBOTS_TOKEN = 'TradingPlatformProspecting'
DOH = ('https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve')
SMTP_FACTORY = smtplib.SMTP  # tests swap this
LABELS = ('published', 'pattern + server-checked', 'pattern + domain accepts mail', 'guess', "catch-all (can't verify)")

SCHEMA = """
CREATE TABLE IF NOT EXISTS contact_facts (fid INTEGER PRIMARY KEY AUTOINCREMENT, firm_id TEXT, kind TEXT, fkey TEXT, data TEXT,
  source_url TEXT, found_at REAL, origin TEXT, status TEXT, decided_at REAL, UNIQUE (firm_id, kind, fkey));
CREATE INDEX IF NOT EXISTS contact_facts_status ON contact_facts (status, firm_id);
CREATE TABLE IF NOT EXISTS contact_pages (firm_id TEXT, url TEXT, kind TEXT, fetched_at REAL, title TEXT, text TEXT, hash TEXT,
  PRIMARY KEY (firm_id, url));
CREATE TABLE IF NOT EXISTS contact_crawls (firm_id TEXT PRIMARY KEY, website TEXT, at REAL, pages INTEGER, status TEXT, note TEXT,
  skipped TEXT, site_hash TEXT);
CREATE TABLE IF NOT EXISTS contact_domains (domain TEXT PRIMARY KEY, mx TEXT, mx_ok INTEGER, mx_at REAL, mx_via TEXT,
  catch_all INTEGER, smtp_at REAL, smtp_note TEXT);
CREATE TABLE IF NOT EXISTS contact_email_checks (email TEXT PRIMARY KEY, result TEXT, code INTEGER, at REAL);
CREATE TABLE IF NOT EXISTS contact_optout (kind TEXT, value TEXT, reason TEXT, at REAL, PRIMARY KEY (kind, value));
CREATE TABLE IF NOT EXISTS contact_watch (firm_id TEXT PRIMARY KEY, starred INTEGER, added REAL, last_run REAL, snapshot TEXT,
  last_note TEXT);
"""


def connect(db_path=None):
    con = pr.connect(db_path)
    con.executescript(SCHEMA)
    return con


async def _q(fn, *args, db_path=None):
    def run():
        con = connect(db_path or pr.DB_PATH)
        try:
            return fn(con, *args)
        finally:
            con.close()
    return await asyncio.to_thread(run)


def _today():
    return dt.date.today().isoformat()


def _day(ts):
    return dt.datetime.fromtimestamp(ts).date().isoformat() if ts else None


# ---------- URLs and domains ----------

TWO_PART_TLDS = {'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.nz', 'com.br', 'co.jp', 'com.mx', 'com.sg', 'com.hk', 'co.za'}


def site_url(website):
    """The firm's home page from a Form ADV website field ("www.x.com", "https://x.com/; x2.com") or None."""
    for part in re.split(r'[\s;,|]+', str(website or '').strip()):
        part = part.strip().strip('/')
        if not part or '@' in part or ' ' in part:
            continue
        if not re.match(r'https?://', part, re.I):
            part = 'https://' + part
        parts = urllib.parse.urlsplit(part)
        host = (parts.hostname or '').lower()
        if '.' in host and re.fullmatch(r'[a-z0-9.-]+', host) and not re.search(r'(linkedin|facebook|twitter|x|instagram|youtube)\.com$', host):
            return f'{parts.scheme.lower()}://{host}{parts.path or "/"}'
    return None


def base_domain(host):
    """example.com for www.example.com (and example.co.uk for a.example.co.uk)."""
    host = (host or '').lower().strip('.')
    if host.startswith('www.'):
        host = host[4:]
    labels = host.split('.')
    if len(labels) >= 3 and '.'.join(labels[-2:]) in TWO_PART_TLDS:
        return '.'.join(labels[-3:])
    return '.'.join(labels[-2:])


def same_site(url, domain):
    host = (urllib.parse.urlsplit(url).hostname or '').lower()
    return host == domain or host.endswith('.' + domain)


def clean_url(url):
    """Drops the #fragment and tracking-free normalises the path, so one page is fetched once."""
    parts = urllib.parse.urlsplit(url)
    path = parts.path or '/'
    return urllib.parse.urlunsplit((parts.scheme.lower(), (parts.netloc or '').lower(), path, parts.query, ''))


def user_agent(contact=''):
    """Honest: names the platform, what it does and (when set) the owner's contact email."""
    who = f'; contact {contact}' if contact else ''
    return (f'{ROBOTS_TOKEN}/1.0 (TradingPlatform personal research tool of an investment adviser; reads public pages only, '
            f'1 request a second, obeys robots.txt{who})')


# ---------- HTML -> text blocks, links, emails, phones ----------

BLOCK_TAGS = {'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'tr', 'section', 'article', 'header',
              'footer', 'figure', 'figcaption', 'dd', 'dt', 'address', 'br', 'blockquote', 'table', 'main', 'aside', 'nav', 'form',
              'button', 'label', 'hr'}
SKIP_TAGS = {'script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe'}
HEAD_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b'}


class _Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.links, self.mailto, self.tel, self.jsonld = [], [], [], [], []
        self.title = ''
        self._buf, self._skip, self._head, self._link, self._json, self._in_title = [], 0, 0, None, None, False

    def flush(self):
        text = re.sub(r'\s+', ' ', ''.join(self._buf)).strip()
        self._buf = []
        if text:
            self.blocks.append({'text': text, 'head': self._head > 0})

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'script' and (a.get('type') or '').lower() == 'application/ld+json':
            self._json = []
            return
        if tag == 'title':
            self._in_title = True
        if tag in SKIP_TAGS:
            self._skip += 1
            return
        if tag in BLOCK_TAGS:
            self.flush()
        if tag in HEAD_TAGS:
            if tag.startswith('h'):
                self.flush()
            self._head += 1
        if tag == 'a':
            href = (a.get('href') or '').strip()
            low = href.lower()
            if low.startswith('mailto:'):
                self.mailto.append((urllib.parse.unquote(href[7:].split('?')[0]).strip(), len(self.blocks)))
            elif low.startswith('tel:'):
                self.tel.append((urllib.parse.unquote(href[4:]).strip(), len(self.blocks)))
            self._link = {'href': href, 'text': []}

    def handle_endtag(self, tag):
        if tag == 'script' and self._json is not None:
            self.jsonld.append(''.join(self._json))
            self._json = None
            return
        if tag == 'title':
            self._in_title = False
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if tag == 'a' and self._link is not None:
            self.links.append((self._link['href'], re.sub(r'\s+', ' ', ''.join(self._link['text'])).strip()))
            self._link = None
        if tag in HEAD_TAGS:
            if tag.startswith('h'):
                self.flush()
            self._head = max(0, self._head - 1)
        if tag in BLOCK_TAGS:
            self.flush()

    def handle_data(self, data):
        if self._json is not None:
            self._json.append(data)
            return
        if self._in_title:
            self.title += data
            return
        if self._skip:
            return
        self._buf.append(data)
        if self._link is not None:
            self._link['text'].append(data)


def parse_html(text, url):
    p = _Parser()
    try:
        p.feed(text or '')
        p.close()
    except Exception as err:  # broken markup: keep what was read
        log.debug('HTML parse problem on %s: %s', url, err)
    p.flush()
    links = []
    for href, label in p.links:
        if not href or href.startswith(('#', 'javascript:', 'mailto:', 'tel:', 'data:')):
            continue
        links.append((clean_url(urllib.parse.urljoin(url, href)), label))
    return {'url': url, 'title': re.sub(r'\s+', ' ', html.unescape(p.title)).strip(), 'blocks': p.blocks, 'links': links,
            'mailto': p.mailto, 'tel': p.tel, 'jsonld': p.jsonld}


def page_text(parsed):
    return '\n'.join(b['text'] for b in parsed['blocks'])


# ---------- People ----------

CREDENTIALS = {'cfa', 'cfp', 'cpa', 'chfc', 'clu', 'cima', 'aif', 'aifa', 'caia', 'frm', 'phd', 'ph.d', 'mba', 'jd', 'j.d', 'esq',
               'cpwa', 'crpc', 'ricp', 'cic', 'cfs', 'cdfa', 'cep', 'cap', 'ms', 'msf', 'cpa/pfs', 'pfs', 'aams', 'crps', 'cltc',
               'jr', 'sr', 'ii', 'iii', 'iv', 'md', 'llm', 'emba', 'cmt', 'fsa', 'ea', 'acc', 'ppc', 'ce', 'ma', 'ba', 'bs'}
PARTICLES = {'de', 'van', 'von', 'der', 'la', 'del', 'di', 'da', 'le', 'du', 'st.', 'mc', 'bin', 'al', 'den', 'ter'}
NOT_NAME = set("""our the and of team meet about contact us services service investment investments financial group llc inc
partners partner capital management wealth advisors advisers advisory read more view bio bios home client clients login office
offices privacy policy terms careers news insights planning family private asset assets fund funds street suite avenue road
leadership board directors staff people who we are company firm history mission values approach philosophy strategy
strategies welcome learn how what why your schedule call today email phone fax location locations st ave blvd floor
newsletter blog resources disclosures form adv crs click here back top menu search submit send message full united states
retirement estate tax trust trusts income growth equity equities fixed portfolio portfolios solutions process expertise
""".split())
TITLE_RE = re.compile(
    r'\b(founder|co-founder|partner|president|ceo|cfo|coo|cio|cco|cto|chief|officer|director|manager|managing|advisor|adviser|'
    r'principal|analyst|associate|planner|vice president|vp|svp|evp|head of|chair|chairman|chairwoman|counsel|specialist|'
    r'consultant|strategist|trader|economist|administrator|coordinator|controller|treasurer|secretary|executive|portfolio|'
    r'relationship|operations|compliance|paraplanner|wealth|investment|client service|owner|lead|senior|junior|intern)\b', re.I)
SEPARATORS = re.compile(r'\s+[|–—-]\s+|\s*,\s+(?=[A-Z])')


def _is_credential(token, all_caps=False):
    t = token.strip('.()')
    return t.lower() in CREDENTIALS or (not all_caps and bool(re.fullmatch(r'[A-Z]{2,6}', t)))


def strip_credentials(text):
    """"Jane A. Doe, CFA®, CFP" -> "Jane A. Doe" (letters after the name that are credentials or suffixes)."""
    text = re.sub(r'[\u00ae\u2122\u00a9]', '', text).strip()
    caps = text.upper() == text  # filings write names in capitals: "SMITH, JOHN A"
    parts = [x.strip() for x in text.split(',')]
    keep = [parts[0]] + [x for x in parts[1:] if not (x and all(_is_credential(t, caps) for t in re.split(r'[\s/&]+', x) if t))]
    words = ', '.join(keep).split()
    while len(words) > 2 and words[-1].strip('.,').lower() in CREDENTIALS:
        words.pop()
    return ' '.join(words).strip(' ,')


def looks_like_name(text):
    text = strip_credentials(text)
    if not 4 <= len(text) <= 50 or any(ch.isdigit() for ch in text) or '@' in text:
        return None
    words = text.split()
    if not 2 <= len(words) <= 5:
        return None
    for i, w in enumerate(words):
        lw = w.lower().strip('.,')
        if lw in NOT_NAME:
            return None
        if 0 < i < len(words) - 1 and lw in PARTICLES:
            continue
        if re.fullmatch(r'[A-Z]\.?', w) and 0 < i < len(words) - 1:
            continue  # middle initial
        if re.fullmatch(r'\(?["“]?[A-Z][a-z]+["”]?\)?', w) and i > 0 and w[0] in '("“':
            continue  # nickname
        if not re.fullmatch(r"[A-Z][a-zA-Z'’\-]*[a-z][a-zA-Z'’\-]*\.?", w):
            return None
    return text


def _title_ok(text):
    return len(text) <= 120 and bool(TITLE_RE.search(text)) and not looks_like_name(text)


def _bio_from(blocks, start, name):
    first, last = name.split()[0].lower(), name.split()[-1].lower()
    for b in blocks[start:start + 4]:
        t = b['text']
        if len(t) >= 120 and not b['head']:
            low = t.lower()
            if first in low or last in low or re.match(r'(he|she|they)\b', low):
                snippet = t[:300]
                cut = snippet.rfind('. ')
                return snippet[:cut + 1] if cut > 80 else snippet.rstrip() + ('…' if len(t) > 300 else '')
        if looks_like_name(t):
            break
    return ''


def _jsonld_people(chunks):
    out = []

    def walk(node):
        if isinstance(node, list):
            for x in node:
                walk(x)
        elif isinstance(node, dict):
            kinds = node.get('@type')
            kinds = kinds if isinstance(kinds, list) else [kinds]
            if 'Person' in kinds and isinstance(node.get('name'), str):
                out.append({'name': strip_credentials(node['name']), 'title': str(node.get('jobTitle') or '')[:120],
                            'bio': str(node.get('description') or '')[:300], 'email': str(node.get('email') or '').replace('mailto:', ''),
                            'telephone': str(node.get('telephone') or '')})
            for v in node.values():
                if isinstance(v, (list, dict)):
                    walk(v)
    for chunk in chunks:
        try:
            walk(json.loads(chunk))
        except ValueError:
            continue
    return out


def extract_people(parsed):
    """People on one page: a name block (2-5 capitalised words) with a job title in the same block ("Jane Doe, CFP |
    Partner") or one of the next two blocks, plus schema.org Person data. A name without a title is skipped (too many
    false positives). Returns [{name, title, bio, block}] (block = index, for linking nearby phones and emails)."""
    blocks = parsed['blocks']
    people = []
    for i, b in enumerate(blocks):
        text = b['text']
        if len(text) > 160:
            continue
        name, title = looks_like_name(text), ''
        if not name:
            parts = SEPARATORS.split(text, maxsplit=1)
            if len(parts) == 2 and looks_like_name(parts[0]) and _title_ok(parts[1]):
                name, title = looks_like_name(parts[0]), parts[1].strip()
            else:
                continue
        nxt = i + 1
        if not title:
            for j in range(i + 1, min(i + 3, len(blocks))):
                if _title_ok(blocks[j]['text']):
                    title, nxt = blocks[j]['text'].strip(' ,|'), j + 1
                    break
                if looks_like_name(blocks[j]['text']):
                    break
        if not title:
            continue
        people.append({'name': name, 'title': strip_credentials(title) if title.count(',') > 2 else title, 'bio': _bio_from(blocks, nxt, name), 'block': i})
    for p in _jsonld_people(parsed['jsonld']):
        if looks_like_name(p['name']):
            people.append({**p, 'block': None})
    best = {}
    for p in people:
        key = name_key(p['name'])
        old = best.get(key)
        if old is None:
            best[key] = dict(p)
            continue
        for k, v in p.items():
            if v in ('', None):
                continue
            if k in ('title', 'bio'):
                if len(v) > len(old.get(k) or ''):
                    old[k] = v
            elif old.get(k) in ('', None):
                old[k] = v
    return list(best.values())


def name_key(name):
    return re.sub(r'[^a-z]', '', ascii_fold(strip_credentials(name)).lower())


def ascii_fold(text):
    return unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode()


def split_name(name):
    """(first, last) in lower-case ASCII letters, for email patterns. "SMITH, JOHN A" (filings) and "John A. Smith, CFA"."""
    name = strip_credentials(ascii_fold(name or ''))
    name = re.sub(r'\([^)]*\)|"[^"]*"', ' ', name)
    if ',' in name:
        last, _, rest = name.partition(',')
        if rest.strip() and len(last.split()) <= 3:
            name = f'{rest.strip()} {last.strip()}'
    words = [w for w in re.split(r'\s+', name) if w and w.strip('.').lower() not in CREDENTIALS]
    words = [w for w in words if not re.fullmatch(r'[A-Za-z]\.?', w)] or words
    if len(words) < 2:
        return None
    first = re.sub(r'[^a-z]', '', words[0].lower())
    tail = words[1:]
    while len(tail) > 1 and tail[0].lower() not in PARTICLES:
        tail = tail[1:]  # middle names drop; particles ("de la Cruz") stay with the surname
    last = re.sub(r'[^a-z]', '', ''.join(tail).lower())
    return (first, last) if first and last else None


# ---------- Emails ----------

EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
BAD_EMAIL = re.compile(r'\.(png|jpe?g|gif|webp|svg|css|js)$|^(example|test|user|name|yourname|email|first\.?last)@|@(example|domain|email|sentry)\.', re.I)
ROLE_LOCALS = {'info', 'contact', 'hello', 'office', 'admin', 'support', 'service', 'clientservice', 'clientservices', 'compliance',
               'careers', 'jobs', 'hr', 'invest', 'investments', 'inquiries', 'inquiry', 'team', 'mail', 'general', 'operations',
               'ops', 'media', 'press', 'marketing', 'billing', 'accounting', 'privacy', 'webmaster', 'sales', 'reception', 'help'}


def deobfuscate(text):
    text = re.sub(r'\s*[\[\(\{]\s*at\s*[\]\)\}]\s*', '@', text, flags=re.I)
    return re.sub(r'\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*', '.', text, flags=re.I)


def extract_emails(parsed, domain):
    """[(email, block index)] published on the firm's own domain (other domains, such as a personal Gmail, are skipped)."""
    found = {}
    for addr, idx in parsed['mailto']:
        found.setdefault(addr.lower(), idx)
    for i, b in enumerate(parsed['blocks']):
        for m in EMAIL_RE.finditer(deobfuscate(b['text'])):
            found.setdefault(m.group(0).lower().rstrip('.'), i)
    out = []
    for addr, idx in found.items():
        if not EMAIL_RE.fullmatch(addr) or BAD_EMAIL.search(addr):
            continue
        dom = addr.rsplit('@', 1)[1]
        if dom == domain or dom.endswith('.' + domain):
            out.append((addr, idx))
    return out


PATTERNS = (
    ('first.last', lambda f, l: f'{f}.{l}'),
    ('flast', lambda f, l: f'{f[0]}{l}'),
    ('firstlast', lambda f, l: f'{f}{l}'),
    ('first', lambda f, l: f),
    ('f.last', lambda f, l: f'{f[0]}.{l}'),
    ('first_last', lambda f, l: f'{f}_{l}'),
    ('firstl', lambda f, l: f'{f}{l[0]}'),
    ('first-last', lambda f, l: f'{f}-{l}'),
    ('last', lambda f, l: l),
    ('lastf', lambda f, l: f'{l}{f[0]}'),
    ('last.first', lambda f, l: f'{l}.{f}'),
)
PATTERN_FN = dict(PATTERNS)


def local_for(pattern, name):
    parts = split_name(name)
    return PATTERN_FN[pattern](*parts) if parts and pattern in PATTERN_FN else None


def match_patterns(local, name):
    parts = split_name(name)
    if not parts:
        return []
    local = local.lower()
    return [p for p, fn in PATTERNS if fn(*parts) == local]


def detect_pattern(emails, names):
    """The firm's address pattern from published addresses of named people: {pattern, examples: [email], matched}.
    None when no published address matches a person's name."""
    counts, examples = {}, {}
    for email in emails:
        local = email.split('@')[0]
        for name in names:
            for p in match_patterns(local, name):
                counts[p] = counts.get(p, 0) + 1
                examples.setdefault(p, []).append(email)
    if not counts:
        return None
    order = [p for p, _ in PATTERNS]
    best = max(counts, key=lambda p: (counts[p], -order.index(p)))
    return {'pattern': best, 'examples': sorted(set(examples[best]))[:3], 'matched': counts[best]}


def person_for_email(email, people, idx=None):
    """The person a published address belongs to: by name pattern, or (if the local part shares the first 3 letters of
    their first or last name) by being next to their name on the page."""
    local = email.split('@')[0].lower()
    for p in people:
        if match_patterns(local, p['name']):
            return p['name']
    if local in ROLE_LOCALS or idx is None:
        return ''
    near = [p for p in people if p.get('block') is not None and 0 <= idx - p['block'] <= 4]
    for p in sorted(near, key=lambda p: idx - p['block']):
        parts = split_name(p['name'])
        if parts and any(len(x) >= 3 and x[:3] in local for x in parts):
            return p['name']
    return ''


def guess_label(pattern_known, mx_ok, catch_all, check):
    """The label for an address the firm did NOT publish (published ones are always "published")."""
    if catch_all:
        return "catch-all (can't verify)"
    if pattern_known and check and check.get('result') == 'accepted':
        return 'pattern + server-checked'
    if pattern_known and mx_ok and not (check and check.get('result') == 'rejected'):
        return 'pattern + domain accepts mail'
    return 'guess'


# ---------- Phones ----------

PHONE_RE = re.compile(r'(?<![\d-])(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?([2-9]\d{2})[\s.\-]?(\d{4})(?![\d-])')


def phone_digits(text):
    d = re.sub(r'\D', '', text or '')
    if len(d) == 11 and d[0] == '1':
        d = d[1:]
    return d if len(d) == 10 else ''


def phone_text(digits):
    return f'({digits[:3]}) {digits[3:6]}-{digits[6:]}'


def classify_phone(context, page_kind, digits, adv_digits):
    """'main', 'direct' or None (fax, mobile/cell, or an unlabelled number on a bio/team page: could be personal)."""
    ctx = context.lower()[-40:]
    if re.search(r'\bfax\b|\bf\s*[:.]|facsimile', ctx):
        return None
    if re.search(r'\b(cell|mobile|m\s*[:.]|text|sms|personal|home)\b', ctx):
        return None
    if re.search(r'\bdirect\b|\bd\s*[:.]|\bdir\b', ctx):
        return 'direct'
    if adv_digits and digits == adv_digits:
        return 'main'
    if re.search(r'\b(main|office|phone|tel|telephone|t\s*[:.]|call|toll[- ]free|p\s*[:.])\b', ctx) or page_kind in ('home', 'contact', 'about'):
        return 'main'
    return None


def extract_phones(parsed, page_kind, adv_digits):
    """[(digits, kind, block index)] for main and direct lines only."""
    out, seen = [], set()
    candidates = [(phone_digits(num), parsed['blocks'][idx - 1]['text'] if 0 < idx <= len(parsed['blocks']) else '', idx) for num, idx in parsed['tel']]
    for i, b in enumerate(parsed['blocks']):
        for m in PHONE_RE.finditer(b['text']):
            candidates.append((''.join(m.groups()), b['text'][:m.start()] or (parsed['blocks'][i - 1]['text'] if i else ''), i))
    for digits, context, idx in candidates:
        if not digits or digits in seen:
            continue
        kind = classify_phone(context, page_kind, digits, adv_digits)
        if kind:
            seen.add(digits)
            out.append((digits, kind, idx))
    return out


# ---------- Investment focus ----------

FOCUS_TAGS = {
    'Private equity': r'private equity', 'Venture capital': r'venture capital', 'Real estate': r'real estate',
    'Hedge funds': r'hedge funds?', 'Private credit': r'private (credit|debt|lending)', 'Fixed income': r'fixed income|municipal bonds?',
    'Alternatives': r'alternative investments?|\balternatives\b', 'ESG / impact': r'\besg\b|impact invest|sustainable invest|socially responsible',
    'Retirement planning': r'retirement (planning|income|plans?)', 'Tax planning': r'tax[- ](planning|efficient|aware|loss|management)',
    'Estate planning': r'estate planning', 'Financial planning': r'financial planning', 'Family office services': r'family office',
    'Business owners': r'business owners?', 'Endowments and foundations': r'endowments?|foundations\b',
    'Direct investments': r'direct (investments?|deals?)|co-invest', 'Equities': r'\b(equity|equities|stock) (portfolios?|strateg|investing)',
    'Index / passive': r'index funds?|passive|factor[- ]based', 'Options / hedging': r'\boptions? strateg|covered calls?|hedging',
}
FOCUS_SENTENCE = re.compile(r'\b(we|our (firm|team|clients|approach|philosophy|process))\b.{0,120}\b(speciali[sz]|focus|invest|manag|serv|offer|build|believe)', re.I)


def investment_focus(pages):
    """{tags: [{tag, url}], sentences: [{text, url}]} from the crawled pages (approach/about/home pages first)."""
    order = {'focus': 0, 'about': 1, 'home': 2, 'team': 3, 'contact': 4, 'bio': 5, 'other': 6}
    tags, sentences = {}, []
    for pg in sorted(pages, key=lambda p: order.get(p['kind'], 9)):
        text = pg['text']
        for tag, rx in FOCUS_TAGS.items():
            if tag not in tags and re.search(rx, text, re.I):
                tags[tag] = pg['url']
        for s in re.split(r'(?<=[.!?])\s+|\n', text):
            s = s.strip()
            if 40 <= len(s) <= 300 and FOCUS_SENTENCE.search(s) and all(s != x['text'] for x in sentences):
                sentences.append({'text': s, 'url': pg['url']})
    return {'tags': [{'tag': t, 'url': u} for t, u in tags.items()], 'sentences': sentences[:3]}


# ---------- Crawler ----------

LINK_KINDS = (
    ('team', 6, r'\bteam\b|our[- ]people|\bpeople\b|professionals|\bstaff\b|advis[eo]rs\b|leadership|management|principals|partners|who[- ]we[- ]are|\bbios?\b|meet'),
    ('contact', 4, r'contact|locations?|offices?|reach us|get in touch'),
    ('about', 4, r'about|our[- ]firm|history|our[- ]story|company'),
    ('focus', 3, r'approach|philosophy|strateg|invest|services|what[- ]we[- ]do|solutions|process|expertise|capabilities'),
)
SKIP_LINK = re.compile(r'\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4|mp3|webp|svg|ics)(\?|$)|/(login|log-in|signin|sign-in|portal|account|cart|'
                       r'wp-admin|wp-login|feed|tag|category|author|search|privacy|terms|disclosures?|cookie)', re.I)


def link_kind(url, text):
    """(kind, score) for a link worth reading, else (None, 0)."""
    if SKIP_LINK.search(url):
        return None, 0
    path = urllib.parse.urlsplit(url).path.lower()
    hay = f'{text.lower()} {path.replace("-", " ").replace("_", " ").replace("/", " ")}'
    for kind, score, rx in LINK_KINDS:
        if re.search(rx, hay):
            return kind, score
    return None, 0


class Page:
    def __init__(self, status, url, ctype='', text='', error=''):
        self.status, self.url, self.ctype, self.text, self.error = status, url, ctype, text, error


class HttpFetcher:
    """GETs public pages only (every redirect hop is checked against local/private addresses), up to MAX_BYTES."""

    def __init__(self, contact=''):
        import httpx
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(15, connect=8), follow_redirects=False,
                                        headers={'User-Agent': user_agent(contact), 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.8'})

    async def __call__(self, url):
        for _ in range(6):
            if not await asyncio.to_thread(is_safe_url, url):
                return Page(0, url, error='not a public internet address')
            try:
                async with self.client.stream('GET', url) as r:
                    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get('location'):
                        url = urllib.parse.urljoin(url, r.headers['location'])
                        continue
                    ctype = r.headers.get('content-type', '').lower()
                    if r.status_code != 200 or not ('html' in ctype or 'text/plain' in ctype):
                        return Page(r.status_code, url, ctype)
                    data = b''
                    async for chunk in r.aiter_bytes():
                        data += chunk
                        if len(data) > MAX_BYTES:
                            break
                    return Page(200, url, ctype, data.decode(r.encoding or 'utf-8', errors='replace'))
            except Exception as err:
                return Page(0, url, error=f'{type(err).__name__}: {err}'[:200])
        return Page(0, url, error='too many redirects')

    async def close(self):
        await self.client.aclose()


class Crawler:
    """Reads up to MAX_PAGES pages of one site, politely. `fetch(url) -> Page` (injected in tests)."""

    def __init__(self, fetch, gap=None, emit=None):
        self.fetch, self.gap, self.emit = fetch, HOST_GAP if gap is None else gap, emit
        self._last = {}
        self._robots = {}

    async def _pace(self, host, gap):
        wait = self._last.get(host, 0) + gap - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        self._last[host] = time.monotonic()

    async def robots(self, url):
        """(RobotFileParser or None if allowed everywhere, error text or '')."""
        parts = urllib.parse.urlsplit(url)
        host = parts.netloc
        if host in self._robots:
            return self._robots[host]
        await self._pace(host, self.gap)
        page = await self.fetch(f'{parts.scheme}://{host}/robots.txt')
        rp = urllib.robotparser.RobotFileParser()
        if page.status == 200:
            rp.parse(page.text.splitlines())
            result = (rp, '')
        elif page.status in (401, 403):
            rp.disallow_all = True
            result = (rp, '')
        elif 400 <= page.status < 500:
            result = (None, '')  # no robots.txt: everything allowed
        else:
            result = (None, f'robots.txt could not be read ({page.error or page.status}); nothing fetched. Try again later.')
        self._robots[host] = result
        return result

    async def allowed(self, url):
        rp, err = await self.robots(url)
        if err:
            return False, err, 0
        if rp is None:
            return True, '', self.gap
        delay = rp.crawl_delay(ROBOTS_TOKEN) or 0
        try:
            delay = float(delay)
        except (TypeError, ValueError):
            delay = 0
        if delay > MAX_GAP:
            return False, f'robots.txt asks for {delay:.0f} s between requests; skipped to respect it', 0
        return rp.can_fetch(ROBOTS_TOKEN, url), 'blocked by robots.txt', max(self.gap, delay)

    async def run(self, start):
        domain = base_domain(urllib.parse.urlsplit(start).hostname)
        queue = [(10, 0, start, 'home')]
        seen, pages, skipped = set(), [], []
        note = ''
        while queue and len(pages) < MAX_PAGES:
            queue.sort(key=lambda x: (-x[0], x[1]))
            score, depth, url, kind = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)
            ok, why, gap = await self.allowed(url)
            if not ok:
                skipped.append({'url': url, 'reason': why})
                if why.startswith('robots.txt could not') or 'between requests' in why:
                    note = why
                    break
                continue
            await self._pace(urllib.parse.urlsplit(url).netloc, gap)
            if self.emit:
                await self.emit({'type': 'status', 'text': f'Reading {url} ({len(pages) + 1}/{MAX_PAGES} pages at most)'})
            page = await self.fetch(url)
            final = clean_url(page.url or url)
            if final != url:
                if not same_site(final, domain):
                    skipped.append({'url': url, 'reason': f'redirects to another site ({urllib.parse.urlsplit(final).hostname})'})
                    continue
                ok, why, _ = await self.allowed(final)
                if not ok:
                    skipped.append({'url': final, 'reason': why})
                    continue
                seen.add(final)
            if page.status != 200 or not page.text:
                skipped.append({'url': url, 'reason': page.error or (f'HTTP {page.status}' if page.status else 'no answer') if page.status != 200 else 'not a web page'})
                if kind == 'home' and not pages:
                    note = f'The website did not answer ({page.error or page.status}).'
                continue
            parsed = parse_html(page.text, final)
            pages.append({'url': final, 'kind': kind, 'parsed': parsed, 'title': parsed['title'], 'text': page_text(parsed)})
            if depth >= 2:
                continue
            for link, text in parsed['links']:
                if link in seen or not same_site(link, domain) or not link.startswith(('http://', 'https://')):
                    continue
                k, s = link_kind(link, text)
                if kind == 'team' and not k:
                    path, here = urllib.parse.urlsplit(link).path, urllib.parse.urlsplit(final).path.rstrip('/')
                    if (here and path.startswith(here + '/')) or looks_like_name(text):
                        k, s = 'bio', 5
                if k:
                    queue.append((s - depth, depth + 1, link, k))
        status = 'done' if pages else 'failed'
        if not pages and not note:
            note = skipped[0]['reason'] if skipped else 'No page could be read.'
        return {'pages': pages, 'skipped': skipped[:30], 'status': status, 'note': note}


# ---------- Turning pages into facts ----------

def findings(pages, domain, adv_phone=''):
    """people / emails / phones / focus found on the crawled pages, each with the page it came from."""
    adv = phone_digits(adv_phone)
    people, emails, phones = {}, {}, {}
    for pg in pages:
        parsed = pg['parsed']
        found = extract_people(parsed) if pg['kind'] in ('team', 'bio', 'about', 'home', 'other', 'focus', 'contact') else []
        for p in found:
            key = name_key(p['name'])
            if key not in people or len(p.get('bio') or '') > len(people[key].get('bio') or ''):
                people[key] = {'name': p['name'], 'title': p.get('title', ''), 'bio': p.get('bio', ''), 'url': pg['url']}
            if p.get('email') and EMAIL_RE.fullmatch(p['email'].lower()) and same_site('http://' + p['email'].split('@')[1], domain):
                emails.setdefault(p['email'].lower(), {'email': p['email'].lower(), 'person': p['name'], 'url': pg['url']})
        for addr, idx in extract_emails(parsed, domain):
            if addr not in emails:
                emails[addr] = {'email': addr, 'person': person_for_email(addr, found, idx) or person_for_email(addr, list(people.values())), 'url': pg['url']}
        for digits, kind, idx in extract_phones(parsed, pg['kind'], adv):
            person = ''
            if kind == 'direct':
                near = [p for p in found if p.get('block') is not None and 0 <= idx - p['block'] <= 6]
                person = max(near, key=lambda p: p['block'])['name'] if near else ''
            old = phones.get(digits)
            if not old or (old['kind'] == 'main' and kind == 'direct'):
                phones[digits] = {'number': phone_text(digits), 'kind': kind, 'person': person, 'url': pg['url']}
    for e in emails.values():
        if not e['person']:
            e['role'] = 'general'
    return {'people': list(people.values()), 'emails': list(emails.values()), 'phones': list(phones.values()),
            'focus': investment_focus(pages)}


MATERIAL = {'person': ('title',), 'email': ('person',), 'phone': ('kind',), 'focus': ('tagsKey',), 'ai': ('text',), 'change': ()}


def upsert_fact(con, firm_id, kind, fkey, data, source_url, origin, now=None):
    """Adds or updates one finding. New = pending; a material change (title, phone kind...) sends an approved one back to
    review; a rejected one stays rejected while it reads the same. Returns 'new', 'changed', 'same' or 'rejected'."""
    now = now or time.time()
    row = con.execute('SELECT fid, data, status FROM contact_facts WHERE firm_id = ? AND kind = ? AND fkey = ?', (firm_id, kind, fkey)).fetchone()
    if not row:
        con.execute('INSERT INTO contact_facts (firm_id, kind, fkey, data, source_url, found_at, origin, status) VALUES (?,?,?,?,?,?,?,?)',
                    (firm_id, kind, fkey, json.dumps(data), source_url, now, origin, 'pending'))
        return 'new'
    old = json.loads(row['data'])
    changed = any((old.get(f) or '') != (data.get(f) or '') for f in MATERIAL.get(kind, ()))
    if changed:
        if kind == 'person' and old.get('title'):
            data = {**data, 'previousTitle': old.get('title')}
        con.execute('UPDATE contact_facts SET data = ?, source_url = ?, found_at = ?, origin = ?, status = ?, decided_at = NULL WHERE fid = ?',
                    (json.dumps(data), source_url, now, origin, 'pending', row['fid']))
        return 'changed'
    con.execute('UPDATE contact_facts SET data = ?, source_url = ?, found_at = ? WHERE fid = ?', (json.dumps({**old, **data}), source_url, now, row['fid']))
    return 'rejected' if row['status'] == 'rejected' else 'same'


def _hash(text):
    return hashlib.sha1((text or '').encode()).hexdigest()[:16]


def change_fact(con, firm_id, change, summary, before=None, after=None, source_url='', origin='watch', now=None):
    now = now or time.time()
    fkey = f'{change}:{_hash(summary)}'
    return upsert_fact(con, firm_id, 'change', fkey, {'change': change, 'summary': summary, 'before': before, 'after': after, 'date': _day(now)},
                       source_url, origin, now)


def save_crawl(con, firm_id, website, result, adv_phone='', now=None):
    """Stores the pages and findings of one crawl; on a re-crawl also records what changed. Returns counts."""
    now = now or time.time()
    domain = base_domain(urllib.parse.urlsplit(website).hostname)
    prev = con.execute('SELECT * FROM contact_crawls WHERE firm_id = ?', (firm_id,)).fetchone()
    first = not prev or not prev['pages']
    counts = {'new': 0, 'changed': 0, 'people': 0, 'emails': 0, 'phones': 0}
    pages = result['pages']
    if pages:
        old_hashes = {r['url']: r['hash'] for r in con.execute('SELECT url, hash FROM contact_pages WHERE firm_id = ?', (firm_id,))}
        con.execute('DELETE FROM contact_pages WHERE firm_id = ?', (firm_id,))
        for pg in pages:
            text = pg['text'][:PAGE_TEXT_CHARS]
            con.execute('INSERT OR REPLACE INTO contact_pages VALUES (?,?,?,?,?,?,?)', (firm_id, pg['url'], pg['kind'], now, pg['title'], text, _hash(text)))
        site_hash = _hash(''.join(sorted(_hash(pg['text'][:PAGE_TEXT_CHARS]) for pg in pages)))
        differ = sum(1 for pg in pages if old_hashes.get(pg['url']) not in (None, _hash(pg['text'][:PAGE_TEXT_CHARS])))
        if not first and prev['site_hash'] and site_hash != prev['site_hash'] and differ:
            change_fact(con, firm_id, 'website change', f'Website text changed on {differ} of {len(pages)} pages read', source_url=website, origin='watch', now=now)
            counts['changed'] += 1
        found = findings(pages, domain, adv_phone)
        before = {r['fkey'] for r in con.execute("SELECT fkey FROM contact_facts WHERE firm_id = ? AND kind = 'person' AND origin = 'website'", (firm_id,))}
        for p in found['people']:
            data = {'name': p['name'], 'title': p['title'], 'bio': p['bio']}
            if not first and name_key(p['name']) not in before:
                data['note'] = 'new on the website since the last check'
            r = upsert_fact(con, firm_id, 'person', name_key(p['name']), data, p['url'], 'website', now)
            counts[r] = counts.get(r, 0) + 1
            counts['people'] += 1
        if not first:
            now_keys = {name_key(p['name']) for p in found['people']}
            for key in before - now_keys:
                row = con.execute("SELECT data FROM contact_facts WHERE firm_id = ? AND kind = 'person' AND fkey = ?", (firm_id, key)).fetchone()
                name = json.loads(row['data'])['name'] if row else key
                change_fact(con, firm_id, 'person gone', f'{name} is no longer listed on the website', source_url=website, origin='watch', now=now)
        for e in found['emails']:
            r = upsert_fact(con, firm_id, 'email', e['email'], {'email': e['email'], 'person': e['person'], 'role': e.get('role', 'person')}, e['url'], 'website', now)
            counts[r] = counts.get(r, 0) + 1
            counts['emails'] += 1
        for ph in found['phones']:
            r = upsert_fact(con, firm_id, 'phone', phone_digits(ph['number']), ph, ph['url'], 'website', now)
            counts[r] = counts.get(r, 0) + 1
            counts['phones'] += 1
        focus = found['focus']
        if focus['tags'] or focus['sentences']:
            data = {**focus, 'tagsKey': ','.join(sorted(t['tag'] for t in focus['tags']))}
            src = (focus['sentences'] or focus['tags'])[0]['url']
            r = upsert_fact(con, firm_id, 'focus', 'focus', data, src, 'website', now)
            counts[r] = counts.get(r, 0) + 1
    else:
        site_hash = prev['site_hash'] if prev else None
    con.execute('INSERT OR REPLACE INTO contact_crawls VALUES (?,?,?,?,?,?,?,?)',
                (firm_id, website, now, len(pages), result['status'], result.get('note', ''), json.dumps(result.get('skipped', [])), site_hash))
    con.commit()
    return counts


# ---------- Do not contact ----------

def note_opt_outs():
    """Firms whose outreach status (store prospect_notes) is "do not contact"."""
    try:
        from . import store
        return {d['id'] for d in store.list_docs('prospect_notes') if d.get('status') == 'do not contact'}
    except Exception:
        return set()


def opt_outs(con, notes=None):
    firms = {r['value'] for r in con.execute("SELECT value FROM contact_optout WHERE kind = 'firm'")}
    emails = {r['value'] for r in con.execute("SELECT value FROM contact_optout WHERE kind = 'email'")}
    return firms | set(notes if notes is not None else note_opt_outs()), emails


def set_opt_out(con, firm_id=None, email=None, on=True, reason=''):
    if not firm_id and not email:
        raise EngineError('Pick a firm or an email address.')
    kind, value = ('email', str(email).strip().lower()) if email else ('firm', str(firm_id))
    if kind == 'email' and not EMAIL_RE.fullmatch(value):
        raise EngineError('That is not an email address.')
    if on:
        con.execute('INSERT OR REPLACE INTO contact_optout VALUES (?,?,?,?)', (kind, value, str(reason or '')[:200], time.time()))
    else:
        con.execute('DELETE FROM contact_optout WHERE kind = ? AND value = ?', (kind, value))
    con.commit()
    return {'kind': kind, 'value': value, 'on': bool(on)}


def excluded_firms(con):
    """For prospect.export: firms on the do-not-contact list (prospect.EXPORT_FILTERS)."""
    con.executescript(SCHEMA)
    return opt_outs(con)[0]


# ---------- The contacts view ----------

def _fact_rows(con, firm_id, kind):
    return [{**json.loads(r['data']), 'fid': r['fid'], 'sourceUrl': r['source_url'], 'foundAt': _day(r['found_at']), 'origin': r['origin'],
             'status': r['status'], 'reviewedOn': _day(r['decided_at']) if r['status'] == 'approved' else None}
            for r in con.execute("SELECT * FROM contact_facts WHERE firm_id = ? AND kind = ? AND status != 'rejected' ORDER BY found_at DESC", (firm_id, kind))]


def domain_info(con, domain):
    r = con.execute('SELECT * FROM contact_domains WHERE domain = ?', (domain,)).fetchone() if domain else None
    if not r:
        return None
    return {'mx': json.loads(r['mx'] or '[]'), 'mxOk': None if r['mx_ok'] is None else bool(r['mx_ok']), 'mxCheckedOn': _day(r['mx_at']),
            'via': r['mx_via'], 'catchAll': None if r['catch_all'] is None else bool(r['catch_all']), 'smtpCheckedOn': _day(r['smtp_at']),
            'smtpNote': r['smtp_note'] or ''}


def filing_people(con, firm_id, limit=30):
    rows = con.execute('SELECT name, title, source, filed, key_title FROM people WHERE firm_id = ? ORDER BY key_title DESC, filed DESC', (firm_id,)).fetchall()
    seen, out = set(), []
    for r in rows:
        key = name_key(r['name'])
        if key in seen or not split_name(r['name']) or re.search(r'\b(llc|inc|lp|trust|corp|holdings|partners|ltd|company)\b', r['name'], re.I):
            continue
        seen.add(key)
        out.append({'name': r['name'], 'title': r['title'] or '', 'source': r['source'], 'filed': r['filed']})
        if len(out) >= limit:
            break
    return out


def contacts(con, firm_id, smtp_on=False, notes=None):
    firm = con.execute('SELECT id, name, website, phone, crd FROM firms WHERE id = ?', (firm_id,)).fetchone()
    if not firm:
        raise EngineError('That firm is not in the prospect database.')
    crawl = con.execute('SELECT * FROM contact_crawls WHERE firm_id = ?', (firm_id,)).fetchone()
    website = (crawl['website'] if crawl else None) or site_url(firm['website'])
    domain = base_domain(urllib.parse.urlsplit(website).hostname) if website else ''
    dinfo = domain_info(con, domain) or {}
    firms_out, emails_out = opt_outs(con, notes)
    people = _fact_rows(con, firm_id, 'person')
    emails = _fact_rows(con, firm_id, 'email')
    phones = _fact_rows(con, firm_id, 'phone')
    focus = (_fact_rows(con, firm_id, 'focus') or [None])[0]
    names = [p['name'] for p in people] + [p['name'] for p in filing_people(con, firm_id)]
    pattern = detect_pattern([e['email'] for e in emails], names)
    by_person = {}
    for e in emails:
        e['label'] = 'published'
        e['doNotContact'] = e['email'] in emails_out
        if e.get('person'):
            by_person.setdefault(name_key(e['person']), e)

    def guess(name):
        if not domain:
            return None
        pat = pattern['pattern'] if pattern else 'first.last'
        local = local_for(pat, name)
        if not local:
            return None
        addr = f'{local}@{domain}'
        chk = con.execute('SELECT result, code, at FROM contact_email_checks WHERE email = ?', (addr,)).fetchone()
        check = dict(chk) if chk else None
        label = guess_label(bool(pattern), dinfo.get('mxOk'), dinfo.get('catchAll'), check)
        note = {'pattern + server-checked': 'The mail server accepted this mailbox (it still may not be read).',
                'pattern + domain accepts mail': f'Built from the firm\'s {pat} pattern; the domain receives email.',
                "catch-all (can't verify)": 'This mail server accepts every address, so no check can tell.'}.get(label)
        if not note:
            note = ('The mail server said this mailbox does not exist.' if check and check.get('result') == 'rejected' else
                    f'Built from the firm\'s {pat} pattern; the domain\'s mail was not checked.' if pattern else
                    'No published address to learn the pattern from: first.last is only the most common format.')
        return {'email': addr, 'label': label, 'pattern': pat, 'note': note, 'checkedOn': _day(check['at']) if check else None,
                'doNotContact': addr in emails_out}

    for p in people:
        p['email'] = by_person.get(name_key(p['name'])) or guess(p['name'])
        p['phones'] = [x for x in phones if x.get('person') and name_key(x['person']) == name_key(p['name'])]
    on_site = {name_key(p['name']) for p in people}
    filed = []
    for p in filing_people(con, firm_id):
        if name_key(p['name']) in on_site:
            continue
        filed.append({**p, 'email': by_person.get(name_key(p['name'])) or guess(p['name'])})
    adv_digits = phone_digits(firm['phone'])
    main = []
    if adv_digits:
        main.append({'number': phone_text(adv_digits), 'kind': 'main', 'source': 'Form ADV', 'sourceUrl': pr.IAPD_FIRM.format(crd=firm['crd']) if firm['crd'] else None})
    for x in phones:
        if not x.get('person') and phone_digits(x['number']) != adv_digits:
            main.append({**x, 'source': 'website'})
        elif not x.get('person'):
            main[0]['alsoOn'] = x['sourceUrl']
    w = con.execute('SELECT starred, last_run, last_note FROM contact_watch WHERE firm_id = ?', (firm_id,)).fetchone()
    return {
        'firmId': firm_id, 'firmName': firm['name'], 'website': website, 'domain': domain,
        'crawl': {'at': _day(crawl['at']), 'pages': crawl['pages'], 'status': crawl['status'], 'note': crawl['note'],
                  'skipped': json.loads(crawl['skipped'] or '[]')} if crawl else None,
        'people': people, 'filingPeople': filed,
        'generalEmails': [e for e in emails if not e.get('person')], 'phones': main,
        'focus': focus, 'pattern': pattern, 'domainCheck': dinfo or None,
        'aiFacts': _fact_rows(con, firm_id, 'ai'), 'changes': _fact_rows(con, firm_id, 'change')[:20],
        'optOut': {'firm': firm_id in firms_out, 'byNote': firm_id in (notes if notes is not None else note_opt_outs()),
                   'emails': sorted(e for e in emails_out if domain and e.endswith('@' + domain))},
        'smtpCheck': bool(smtp_on), 'watched': bool(w and w['starred']), 'lastWatch': _day(w['last_run']) if w else None,
        'pagesSaved': con.execute('SELECT COUNT(*) FROM contact_pages WHERE firm_id = ?', (firm_id,)).fetchone()[0],
        'labels': list(LABELS),
    }


# ---------- Domain checks: MX (DNS) and the optional SMTP check ----------

def parse_doh(data):
    """MX hosts (by preference) from a DNS-over-HTTPS JSON reply; [] for no MX / NXDOMAIN."""
    out = []
    for a in (data or {}).get('Answer') or []:
        if a.get('type') == 15:
            parts = str(a.get('data', '')).split()
            if len(parts) == 2 and parts[0].isdigit():
                out.append((int(parts[0]), parts[1].rstrip('.').lower()))
    return [h for _, h in sorted(out)]


async def mx_lookup(http, domain):
    """(hosts, via): dnspython when installed, otherwise free DNS-over-HTTPS (Cloudflare, then Google)."""
    try:
        import dns.asyncresolver  # optional (requirements-extra.txt)
        try:
            answer = await dns.asyncresolver.resolve(domain, 'MX', lifetime=8)
            return [str(r.exchange).rstrip('.').lower() for r in sorted(answer, key=lambda r: r.preference)], 'dnspython'
        except Exception as err:
            if type(err).__name__ in ('NXDOMAIN', 'NoAnswer'):
                return [], 'dnspython'
    except ImportError:
        pass
    last = None
    for url in DOH:
        try:
            r = await http.get(url, params={'name': domain, 'type': 'MX'}, headers={'Accept': 'application/dns-json'}, timeout=10)
            r.raise_for_status()
            return parse_doh(r.json()), urllib.parse.urlsplit(url).hostname
        except Exception as err:
            last = err
    raise EngineError(f'DNS lookup for {domain} failed ({last}).')


async def check_domain(con_path, http, domain, force=False):
    con = connect(con_path)
    try:
        row = con.execute('SELECT mx_at FROM contact_domains WHERE domain = ?', (domain,)).fetchone()
        if row and row['mx_at'] and time.time() - row['mx_at'] < MX_DAYS * 86400 and not force:
            return domain_info(con, domain)
    finally:
        con.close()
    try:
        hosts, via = await mx_lookup(http, domain)
    except EngineError as err:
        log.info('MX lookup failed: %s', err)
        return None
    ok = bool([h for h in hosts if h and h != '.'])
    con = connect(con_path)
    try:
        con.execute('INSERT INTO contact_domains (domain, mx, mx_ok, mx_at, mx_via) VALUES (?,?,?,?,?) ON CONFLICT(domain) DO UPDATE SET '
                    'mx = excluded.mx, mx_ok = excluded.mx_ok, mx_at = excluded.mx_at, mx_via = excluded.mx_via',
                    (domain, json.dumps(hosts), int(ok), time.time(), via))
        con.commit()
        return domain_info(con, domain)
    finally:
        con.close()


def smtp_probe(mx_hosts, domain, addresses, timeout=10):
    """Asks the mail server (port 25) whether each address exists, after first testing a random address: if that is
    accepted the server is catch-all and no answer means anything. Never sends a message (RCPT only, then QUIT).
    Returns {catchAll, results: {email: (result, code)}, note}."""
    last = None
    for host in [h for h in mx_hosts if h and h != '.'][:2]:
        try:
            s = SMTP_FACTORY(host, 25, timeout=timeout)
            try:
                s.ehlo_or_helo_if_needed()
                code, _ = s.mail('')  # null sender: no address of the owner is given out
                if code >= 400:
                    return {'catchAll': None, 'results': {}, 'note': f'The mail server refused the check (code {code}).'}
                code, _ = s.rcpt(f'tp-nobody-{secrets.token_hex(6)}@{domain}')
                catch_all = code in (250, 251)
                results = {}
                if not catch_all:
                    for a in addresses:
                        c, _ = s.rcpt(a)
                        results[a] = ('accepted' if c in (250, 251) else 'rejected' if c in (550, 551, 553, 554) else 'unknown', c)
                return {'catchAll': catch_all, 'results': results, 'note': 'Catch-all server: it accepts any address.' if catch_all else ''}
            finally:
                try:
                    s.quit()
                except Exception:
                    pass
        except (OSError, smtplib.SMTPException) as err:
            last = err
    return {'catchAll': None, 'results': {}, 'note': f'Could not talk to the mail server on port 25 ({last}). Many home internet providers block it; '
                                                    'the labels fall back to the domain check.'}


def smtp_enabled():
    from . import settings
    return settings.load().get('prospect_smtp_check') is True


# ---------- Crawl one firm ----------

_crawl_slots = None
_firm_locks = {}


async def crawl_firm(ctx, firm_id, website=None, emit=None, db_path=None, fetch=None):
    """Crawls the firm's website, saves what it found (pending review) and checks the domain's mail (MX)."""
    global _crawl_slots
    db_path = db_path or pr.DB_PATH
    con = connect(db_path)
    try:
        firm = con.execute('SELECT id, name, website, phone FROM firms WHERE id = ?', (firm_id,)).fetchone()
        if not firm:
            raise EngineError('That firm is not in the prospect database.')
        prev = con.execute('SELECT website FROM contact_crawls WHERE firm_id = ?', (firm_id,)).fetchone()
    finally:
        con.close()
    start = site_url(website) if website else (site_url(prev['website']) if prev and prev['website'] else site_url(firm['website']))
    if not start:
        raise EngineError('No website on file for this firm (Form ADV lists none). Type the firm\'s own website to crawl it.')
    if _crawl_slots is None:
        _crawl_slots = asyncio.Semaphore(2)
    lock = _firm_locks.setdefault(firm_id, asyncio.Lock())
    if lock.locked():
        raise EngineError('This firm\'s website is already being read.')
    async with lock, _crawl_slots:
        own = fetch is None
        fetcher = fetch or HttpFetcher(getattr(ctx, 'sec_contact', '') or '')
        try:
            result = await Crawler(fetcher, emit=emit).run(start)
        finally:
            if own:
                await fetcher.close()
        counts = await _q(save_crawl, firm_id, start, result, firm['phone'] or '', db_path=db_path)
        domain = base_domain(urllib.parse.urlsplit(start).hostname)
        if result['pages'] and ctx is not None and getattr(ctx, 'http', None) is not None:
            if emit:
                await emit({'type': 'status', 'text': f'Checking that {domain} receives email (DNS)'})
            await check_domain(db_path, ctx.http, domain)
        return {'website': start, 'pages': len(result['pages']), 'status': result['status'], 'note': result['note'], 'counts': counts}


async def email_check(ctx, firm_id, db_path=None):
    """The optional SMTP check of this firm's guessed addresses (Settings: off by default)."""
    db_path = db_path or pr.DB_PATH
    if not smtp_enabled():
        raise EngineError('The mail-server check is off. Turn it on in Settings > Data sources (read the note there first).')
    view = await _q(contacts, firm_id, True, db_path=db_path)
    domain = view['domain']
    if not domain:
        raise EngineError('No website domain for this firm yet: crawl its website first.')
    info = await check_domain(db_path, ctx.http, domain)
    if not info or not info['mxOk']:
        raise EngineError(f'{domain} has no mail servers (MX records), so there is nothing to check.')
    guesses = [p['email']['email'] for p in view['people'] + view['filingPeople'] if p.get('email') and p['email']['label'] != 'published']
    fresh = []
    con = connect(db_path)
    try:
        for g in guesses:
            r = con.execute('SELECT at FROM contact_email_checks WHERE email = ?', (g,)).fetchone()
            if not r or time.time() - r['at'] > CHECK_DAYS * 86400:
                fresh.append(g)
    finally:
        con.close()
    probe = await asyncio.to_thread(smtp_probe, info['mx'], domain, fresh[:20])
    con = connect(db_path)
    try:
        now = time.time()
        con.execute('UPDATE contact_domains SET catch_all = ?, smtp_at = ?, smtp_note = ? WHERE domain = ?',
                    (None if probe['catchAll'] is None else int(probe['catchAll']), now, probe['note'], domain))
        for addr, (result, code) in probe['results'].items():
            con.execute('INSERT OR REPLACE INTO contact_email_checks VALUES (?,?,?,?)', (addr, result, code, now))
        con.commit()
    finally:
        con.close()
    return {'checked': len(probe['results']), 'catchAll': probe['catchAll'], 'note': probe['note']}


# ---------- Review queue ----------

def fact_summary(kind, d):
    if kind == 'person':
        if d.get('previousTitle'):
            return f'Title change: {d["name"]}: {d["previousTitle"]} -> {d.get("title") or "?"}'
        return f'{"New person" if d.get("note") else "Person"}: {d["name"]}{", " + d["title"] if d.get("title") else ""}'
    if kind == 'email':
        return f'Published email: {d["email"]}{" (" + d["person"] + ")" if d.get("person") else " (general address)"}'
    if kind == 'phone':
        return f'{"Direct line" if d.get("kind") == "direct" else "Main line"}: {d.get("number")}{" (" + d["person"] + ")" if d.get("person") else ""}'
    if kind == 'focus':
        return 'Investment focus: ' + (', '.join(t['tag'] for t in d.get('tags', [])) or (d.get('sentences') or [{}])[0].get('text', ''))[:200]
    if kind == 'ai':
        return f'AI profile ({d.get("topic", "fact")}): {d.get("text", "")}'[:300]
    if kind == 'change':
        return d.get('summary', 'Change')
    return kind


def review_list(con, status='pending', firm_id=None, limit=200):
    where, args = ['f.status = ?'], [status]
    if firm_id:
        where.append('f.firm_id = ?')
        args.append(firm_id)
    rows = con.execute(f'SELECT f.*, firms.name AS firm_name FROM contact_facts f LEFT JOIN firms ON firms.id = f.firm_id WHERE {" AND ".join(where)} '
                       f'ORDER BY f.found_at DESC LIMIT ?', [*args, int(limit)]).fetchall()
    counts = {r[0]: r[1] for r in con.execute('SELECT status, COUNT(*) FROM contact_facts GROUP BY status')}
    return {'items': [{'fid': r['fid'], 'firmId': r['firm_id'], 'firmName': r['firm_name'] or r['firm_id'], 'kind': r['kind'], 'origin': r['origin'],
                       'summary': fact_summary(r['kind'], json.loads(r['data'])), 'sourceUrl': r['source_url'], 'foundAt': _day(r['found_at']),
                       'status': r['status'], 'decidedOn': _day(r['decided_at'])} for r in rows],
            'counts': {'pending': counts.get('pending', 0), 'approved': counts.get('approved', 0), 'rejected': counts.get('rejected', 0)}}


def review_decide(con, fids, decision):
    if decision not in ('approve', 'reject', 'undo'):
        raise EngineError('Decision must be approve, reject or undo.')
    ids = [int(x) for x in (fids or []) if str(x).isdigit()][:500]
    if not ids:
        raise EngineError('Pick at least one item.')
    status = {'approve': 'approved', 'reject': 'rejected', 'undo': 'pending'}[decision]
    marks = ','.join('?' * len(ids))
    cur = con.execute(f'UPDATE contact_facts SET status = ?, decided_at = ? WHERE fid IN ({marks})', [status, None if decision == 'undo' else time.time(), *ids])
    con.commit()
    return {'updated': cur.rowcount, 'status': status}


# ---------- Contacts CSV export (labels kept; do-not-contact left out) ----------

EXPORT_COLUMNS = ['Firm', 'Firm ID', 'Name', 'Title', 'Email', 'Email label', 'Phone', 'Phone type', 'Source', 'Found on', 'Reviewed']


def contacts_csv(con, firm_ids=None, guesses=True, notes=None):
    if not firm_ids:
        firm_ids = [r[0] for r in con.execute("SELECT DISTINCT firm_id FROM contact_facts WHERE kind IN ('person', 'email', 'phone')")]
    firms_out, emails_out = opt_outs(con, notes)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(EXPORT_COLUMNS)
    rows = skipped_firms = skipped_emails = 0
    for fid in firm_ids[:5000]:
        if fid in firms_out:
            skipped_firms += 1
            continue
        try:
            v = contacts(con, fid, notes=notes or set())
        except EngineError:
            continue

        def write(name, title, email, phone, src, found, reviewed):
            nonlocal rows, skipped_emails
            if email and email.get('email') in emails_out:
                skipped_emails += 1
                email = None
            if email and email['label'] != 'published' and not guesses:
                email = None
            w.writerow([pr.csv_cell(x) for x in (v['firmName'], fid, name, title, email['email'] if email else '', email['label'] if email else '',
                                                  phone.get('number', '') if phone else '', phone.get('kind', '') if phone else '', src, found, reviewed)])
            rows += 1
        for p in v['people']:
            write(p['name'], p.get('title', ''), p.get('email'), (p.get('phones') or [None])[0], p.get('sourceUrl'), p.get('foundAt'),
                  f'reviewed by you on {p["reviewedOn"]}' if p.get('reviewedOn') else 'not reviewed')
        for p in v['filingPeople']:
            write(p['name'], p.get('title', ''), p.get('email'), None, p.get('source'), p.get('filed'), 'from filing')
        for e in v['generalEmails']:
            write('', '', e, None, e.get('sourceUrl'), e.get('foundAt'), f'reviewed by you on {e["reviewedOn"]}' if e.get('reviewedOn') else 'not reviewed')
        for ph in v['phones']:
            write('', '', None, ph, ph.get('sourceUrl') or ph.get('source'), ph.get('foundAt', ''), 'from filing' if ph.get('source') == 'Form ADV' else
                  (f'reviewed by you on {ph["reviewedOn"]}' if ph.get('reviewedOn') else 'not reviewed'))
    return {'csv': out.getvalue(), 'rows': rows, 'skippedFirms': skipped_firms, 'skippedEmails': skipped_emails, 'columns': EXPORT_COLUMNS}


# ---------- AI research analyst ----------

PRICES = {'claude-opus-5-5': (4.0, 20.0), 'claude-sonnet-5-5': (2.0, 10.0), 'claude-haiku-5-5': (0.10, 0.50)}  # $ per million tokens
AI_PAGE_CHARS = 12000
AI_TOTAL_CHARS = 90000
AI_TOPICS = ['overview', 'people', 'investment focus', 'clients', 'services', 'assets', 'history', 'other']
AI_SYSTEM = ('You are a careful research analyst preparing a prospect profile of an investment firm for a registered investment '
             'adviser. Use ONLY the numbered sources given. Every fact must name the source it comes from (its url exactly as given) '
             'and quote the words that support it (a short verbatim quote copied from that source). Do not guess, do not add '
             'outside knowledge, do not include contact details beyond what the sources print. If the sources do not say something, '
             'leave it out.')
AI_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['facts'], 'properties': {'facts': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['topic', 'text', 'source', 'quote'],
    'properties': {'topic': {'type': 'string', 'enum': AI_TOPICS}, 'text': {'type': 'string'}, 'source': {'type': 'string'}, 'quote': {'type': 'string'}}}}}}


def sec_source(con, firm_id):
    """The SEC facts as one source (with the IAPD / EDGAR page as its link)."""
    f = con.execute('SELECT * FROM firms WHERE id = ?', (firm_id,)).fetchone()
    if not f:
        return None
    url = pr.IAPD_FIRM.format(crd=f['crd']) if f['crd'] else (pr.EDGAR_COMPANY.format(cik=f['cik']) if f['cik'] else None)
    if not url:
        return None
    lines = [f'Name: {f["name"]}', f'Type: {f["type"]}', f'Address: {f["street"]}, {f["city"]}, {f["state"]} {f["zip"]}']
    if f['aum_total'] is not None:
        lines.append(f'Regulatory assets under management: ${f["aum_total"]:,.0f} (Form ADV filed {f["filing_date"]})')
    if f['clients_total'] is not None:
        lines.append(f'Clients: {f["clients_total"]}')
    if f['employees'] is not None:
        lines.append(f'Employees: {f["employees"]}')
    if f['value_13f']:
        lines.append(f'13F holdings value: ${f["value_13f"]:,.0f} (quarter {f["period_13f"]})')
    if f['funds']:
        lines.append(f'Private funds: {f["funds"]}')
    for p in filing_people(con, firm_id, 15):
        lines.append(f'Person in filing: {p["name"]}, {p["title"]} ({p["source"]})')
    return {'url': url, 'title': 'SEC filings (Form ADV / 13F / Form D) as loaded in the prospect database', 'text': '\n'.join(lines)}


def ai_sources(con, firm_id):
    out, total = [], 0
    sec = sec_source(con, firm_id)
    if sec:
        out.append(sec)
        total += len(sec['text'])
    for r in con.execute("SELECT url, title, text FROM contact_pages WHERE firm_id = ? ORDER BY CASE kind WHEN 'home' THEN 0 WHEN 'about' THEN 1 "
                         "WHEN 'team' THEN 2 WHEN 'focus' THEN 3 ELSE 4 END", (firm_id,)):
        text = (r['text'] or '')[:AI_PAGE_CHARS]
        if total + len(text) > AI_TOTAL_CHARS:
            break
        out.append({'url': r['url'], 'title': r['title'] or r['url'], 'text': text})
        total += len(text)
    return out


def ai_estimate(con, firm_id, model):
    sources = ai_sources(con, firm_id)
    chars = sum(len(s['text']) for s in sources) + len(AI_SYSTEM) + 1500
    tokens_in, tokens_out = chars // 4, 2500 + 5000  # the answer plus the model's thinking (billed as output)
    price = PRICES.get(model, PRICES['claude-opus-5-5'])
    pages = sum(1 for s in sources if 'SEC filings' not in s['title'])
    return {'pages': pages, 'sources': len(sources), 'inputTokens': tokens_in, 'outputTokens': tokens_out,
            'costUsd': round((tokens_in * price[0] + tokens_out * price[1]) / 1e6, 3), 'model': model}


def _norm(text):
    return re.sub(r'\s+', ' ', re.sub(r'[‘’“”"\']', '', html.unescape(text or ''))).strip().lower()


def keep_cited(facts, sources):
    """Keeps facts whose source is one of the given urls AND whose quote is in that source's text. Returns (kept, dropped)."""
    by_url = {s['url']: _norm(s['text']) for s in sources}
    kept, dropped = [], []
    for f in facts or []:
        src, quote = str(f.get('source') or '').strip(), _norm(f.get('quote'))
        text = by_url.get(src)
        if text is None or len(quote) < 8 or quote not in text or not str(f.get('text') or '').strip():
            dropped.append({**f, 'why': 'no such source' if text is None else 'quote not found in the source'})
        else:
            kept.append({'topic': f.get('topic') if f.get('topic') in AI_TOPICS else 'other', 'text': str(f['text']).strip()[:600],
                         'source': src, 'quote': str(f.get('quote')).strip()[:300]})
    return kept, dropped


async def ai_profile(ctx, firm_id, emit=None, db_path=None):
    from . import ai, settings
    import anthropic
    db_path = db_path or pr.DB_PATH
    emit = emit or (lambda e: asyncio.sleep(0))
    sources = await _q(ai_sources, firm_id, db_path=db_path)
    if not any('SEC filings' not in s['title'] for s in sources):
        raise EngineError('Read the firm\'s website first ("Find contacts"): the AI analyst only uses saved pages and SEC facts.')
    model = settings.get('model', settings.DEFAULT_MODEL)
    await emit({'type': 'status', 'text': f'Reading {len(sources)} sources'})
    listing = '\n\n'.join(f'<source n="{i + 1}" url="{s["url"]}" title="{html.escape(s["title"])}">\n{s["text"]}\n</source>' for i, s in enumerate(sources))
    opts = {'model': model, 'max_tokens': 16000, 'system': AI_SYSTEM,
            'output_config': {'effort': 'medium', 'format': {'type': 'json_schema', 'schema': AI_SCHEMA}},
            'messages': [{'role': 'user', 'content': f'{listing}\n\nDraft the firm profile as a list of facts (10-25), each with its source url and a verbatim quote.'}]}
    if model in ai.FALLBACK_MODELS:
        opts.update(betas=['server-side-fallback-2026-07-01'], fallbacks='default')
    await emit({'type': 'status', 'text': f'Asking Claude ({model})'})
    try:
        if 'betas' in opts:
            stream_cm = ai.client().beta.messages.stream(**opts)
        else:
            stream_cm = ai.client().messages.stream(**opts)
        async with stream_cm as stream:
            response = await stream.get_final_message()
    except anthropic.APIError as err:
        raise EngineError(ai._friendly_api_error(err)) from err
    if response.stop_reason == 'refusal':
        raise EngineError('The AI declined this request.')
    text = ''.join(getattr(b, 'text', '') for b in response.content if getattr(b, 'type', '') == 'text')
    try:
        facts = json.loads(text).get('facts', [])
    except ValueError as err:
        raise EngineError('The AI answer could not be read. Try again.') from err
    await emit({'type': 'status', 'text': 'Checking every citation against its source'})
    kept, dropped = keep_cited(facts, sources)

    def save(con):
        now = time.time()
        for f in kept:
            upsert_fact(con, firm_id, 'ai', _hash(f['text']), {'topic': f['topic'], 'text': f['text'], 'quote': f['quote']}, f['source'], 'ai', now)
        con.commit()
    await _q(save, db_path=db_path)
    usage = getattr(response, 'usage', None)
    return {'kept': kept, 'dropped': dropped, 'model': model,
            'usage': {'input': getattr(usage, 'input_tokens', None), 'output': getattr(usage, 'output_tokens', None)}}


# ---------- Change watcher ----------

WATCH = {'running': False, 'current': None, 'last': None, 'error': None}


def sec_snapshot(con, firm_id):
    f = con.execute('SELECT name, aum_total, filing_date, website, phone, period_13f, offerings FROM firms WHERE id = ?', (firm_id,)).fetchone()
    if not f:
        return None
    people = {name_key(p['name']): {'name': p['name'], 'title': p['title']} for p in filing_people(con, firm_id, 200)}
    return {'name': f['name'], 'aum': f['aum_total'], 'filed': f['filing_date'], 'website': site_url(f['website']) or '', 'phone': f['phone'] or '',
            'period13f': f['period_13f'], 'offerings': f['offerings'] or 0, 'people': people}


def _money(v):
    return '?' if v is None else f'${v / 1e9:.2f}B' if v >= 1e9 else f'${v / 1e6:.1f}M'


def diff_snapshots(old, new):
    """[(change, summary, before, after)] between two SEC snapshots (nothing on the first one)."""
    if not old or not new:
        return []
    out = []
    if old.get('aum') is not None and new.get('aum') is not None and old['aum'] != new['aum']:
        pct = (new['aum'] - old['aum']) / old['aum'] * 100 if old['aum'] else 0
        out.append(('AUM change', f'Regulatory AUM {_money(old["aum"])} -> {_money(new["aum"])} ({pct:+.0f}%)', old['aum'], new['aum']))
    if new.get('filed') and new['filed'] != old.get('filed'):
        out.append(('new filing', f'New Form ADV filed {new["filed"]}', old.get('filed'), new['filed']))
    if new.get('period13f') and new['period13f'] != old.get('period13f'):
        out.append(('new filing', f'New 13F for the quarter ended {new["period13f"]}', old.get('period13f'), new['period13f']))
    if (new.get('offerings') or 0) > (old.get('offerings') or 0):
        out.append(('new filing', f'{new["offerings"] - (old.get("offerings") or 0)} new Form D offering(s)', old.get('offerings'), new['offerings']))
    if (new.get('website') or '') != (old.get('website') or '') and old.get('website') is not None:
        out.append(('website change', f'Website on file changed: {old.get("website") or "none"} -> {new.get("website") or "none"}', old.get('website'), new.get('website')))
    op, np_ = old.get('people') or {}, new.get('people') or {}
    for k, p in np_.items():
        if k not in op:
            out.append(('new person', f'New person in filings: {p["name"]}{", " + p["title"] if p.get("title") else ""}', None, p['name']))
        elif (op[k].get('title') or '') != (p.get('title') or '') and p.get('title'):
            out.append(('title change', f'Title change in filings: {p["name"]}: {op[k].get("title") or "?"} -> {p["title"]}', op[k].get('title'), p['title']))
    return out


def watched_firms(con, saved=None):
    starred = [r['firm_id'] for r in con.execute('SELECT firm_id FROM contact_watch WHERE starred = 1 ORDER BY added')]
    if saved is None:
        try:
            from . import store
            saved = [d['id'] for d in store.list_docs('prospect_notes') if d.get('status') != 'do not contact']
        except Exception:
            saved = []
    out = []
    for fid in starred + list(saved):
        if fid not in out:
            out.append(fid)
    return out[:WATCH_MAX]


def watch_sec(con, firm_id, now=None):
    """Re-checks one firm's SEC facts against the last snapshot; records the differences. Returns the changes."""
    now = now or time.time()
    new = sec_snapshot(con, firm_id)
    if new is None:
        return []
    row = con.execute('SELECT snapshot FROM contact_watch WHERE firm_id = ?', (firm_id,)).fetchone()
    old = json.loads(row['snapshot']) if row and row['snapshot'] else None
    f = con.execute('SELECT crd, cik FROM firms WHERE id = ?', (firm_id,)).fetchone()
    src = pr.IAPD_FIRM.format(crd=f['crd']) if f['crd'] else (pr.EDGAR_COMPANY.format(cik=f['cik']) if f['cik'] else '')
    changes = diff_snapshots(old, new)
    for change, summary, before, after in changes:
        change_fact(con, firm_id, change, summary, before, after, src, 'watch', now)
    con.execute('INSERT INTO contact_watch (firm_id, starred, added, last_run, snapshot) VALUES (?, 0, ?, ?, ?) ON CONFLICT(firm_id) DO UPDATE SET '
                'last_run = excluded.last_run, snapshot = excluded.snapshot', (firm_id, now, now, json.dumps(new)))
    con.commit()
    return changes


async def watch_firm(ctx, firm_id, emit=None, db_path=None, fetch=None):
    db_path = db_path or pr.DB_PATH
    changes = await _q(watch_sec, firm_id, db_path=db_path)
    note = f'{len(changes)} SEC change(s)'
    try:
        r = await crawl_firm(ctx, firm_id, emit=emit, db_path=db_path, fetch=fetch)
        note += f'; website: {r["pages"]} page(s), {r["counts"].get("new", 0)} new, {r["counts"].get("changed", 0)} changed'
    except EngineError as err:
        note += f'; website not read ({err})'

    def done(con):
        con.execute('UPDATE contact_watch SET last_note = ? WHERE firm_id = ?', (note, firm_id))
        con.commit()
    await _q(done, db_path=db_path)
    return note


async def run_watch(ctx, firm_ids=None, emit=None, db_path=None, fetch=None):
    db_path = db_path or pr.DB_PATH
    if WATCH['running']:
        raise EngineError('The change watcher is already running.')
    WATCH.update({'running': True, 'error': None, 'started': time.time()})
    try:
        ids = firm_ids or await _q(watched_firms, db_path=db_path)
        for i, fid in enumerate(ids):
            WATCH['current'] = fid
            if emit:
                await emit({'type': 'status', 'text': f'Checking {i + 1} of {len(ids)}'})
            await watch_firm(ctx, fid, emit=emit, db_path=db_path, fetch=fetch)
        if not firm_ids:
            def mark(con):
                pr.set_meta(con, 'watch:last', time.time())
                con.commit()
            await _q(mark, db_path=db_path)
        WATCH['last'] = time.time()
        return {'firms': len(ids)}
    except Exception as err:
        WATCH['error'] = str(err)
        raise
    finally:
        WATCH.update({'running': False, 'current': None})


def watch_status(con):
    last = pr.get_meta(con, 'watch:last')
    rows = []
    for fid in watched_firms(con):
        r = con.execute('SELECT f.name, w.starred, w.last_run, w.last_note FROM firms f LEFT JOIN contact_watch w ON w.firm_id = f.id WHERE f.id = ?', (fid,)).fetchone()
        if r:
            rows.append({'firmId': fid, 'name': r['name'], 'starred': bool(r['starred']), 'lastRun': _day(r['last_run']), 'note': r['last_note'] or ''})
    return {'running': WATCH['running'], 'current': WATCH['current'], 'error': WATCH['error'], 'lastRun': _day(last),
            'nextRun': _day((last or time.time()) + WATCH_DAYS * 86400), 'everyDays': WATCH_DAYS, 'firms': rows, 'max': WATCH_MAX}


def set_watch(con, firm_id, on):
    if not con.execute('SELECT 1 FROM firms WHERE id = ?', (firm_id,)).fetchone():
        raise EngineError('That firm is not in the prospect database.')
    con.execute('INSERT INTO contact_watch (firm_id, starred, added) VALUES (?, ?, ?) ON CONFLICT(firm_id) DO UPDATE SET starred = excluded.starred',
                (firm_id, int(bool(on)), time.time()))
    con.commit()
    return {'firmId': firm_id, 'watched': bool(on)}


async def watch_loop(ctx, db_path=None):
    """Weekly: re-checks watched and saved prospects (started by prospect.schedule_loop)."""
    db_path = Path(db_path or pr.DB_PATH)
    await asyncio.sleep(900)
    while True:
        try:
            if db_path.exists() and not pr.JOB.get('running') and not WATCH['running']:
                con = connect(db_path)
                last = pr.get_meta(con, 'watch:last') or 0
                has = bool(watched_firms(con))
                con.close()
                if has and time.time() - last >= WATCH_DAYS * 86400:
                    await run_watch(ctx, db_path=db_path)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            log.info('Change watcher skipped: %s', err)
        await asyncio.sleep(6 * 3600)


# ---------- Handlers ----------

def _firm_id(msg):
    fid = str(msg.get('firmId') or '').strip()
    if not fid:
        raise EngineError('Which firm? (firmId)')
    return fid


@handler('prospect.contacts')
async def h_contacts(ctx, msg):
    """{firmId} -> people (website + filings) with emails and their labels, phones, focus, AI facts, changes, opt-outs."""
    fid = _firm_id(msg)
    notes = await asyncio.to_thread(note_opt_outs)
    view = await _q(contacts, fid, smtp_enabled(), notes)
    if view['domain'] and view['crawl'] and view['crawl']['pages'] and not view['domainCheck'] and getattr(ctx, 'http', None) is not None:
        await check_domain(pr.DB_PATH, ctx.http, view['domain'])
        view = await _q(contacts, fid, smtp_enabled(), notes)
    return view


@handler('prospect.crawl')
async def h_crawl(ctx, msg):
    """{firmId, website?} reads up to 10 pages of the firm's site (robots.txt obeyed, 1 request a second) and returns
    the contacts view. Progress streams as engine_event."""
    fid = _firm_id(msg)
    result = await crawl_firm(ctx, fid, msg.get('website') or None, msg.get('_emit'))
    view = await _q(contacts, fid, smtp_enabled(), await asyncio.to_thread(note_opt_outs))
    return {**view, 'lastCrawl': result}


@handler('prospect.email_check')
async def h_email_check(ctx, msg):
    """{firmId}: asks the firm's mail server about guessed addresses (only when turned on in Settings)."""
    fid = _firm_id(msg)
    r = await email_check(ctx, fid)
    return {**await _q(contacts, fid, True, await asyncio.to_thread(note_opt_outs)), 'lastCheck': r}


@handler('prospect.ai_profile')
async def h_ai_profile(ctx, msg):
    """{firmId, run?}: without run -> the cost estimate (pages, tokens, $); with run -> drafts the profile (facts with
    citations, unsourced ones dropped; they wait in the review queue)."""
    from . import settings
    fid = _firm_id(msg)
    model = settings.get('model', settings.DEFAULT_MODEL)
    if not msg.get('run'):
        est = await _q(ai_estimate, fid, model)
        return {**est, 'aiKeySet': bool(settings.get('anthropic_key'))}
    return await ai_profile(ctx, fid, msg.get('_emit'))


@handler('prospect.watch.run')
async def h_watch_run(ctx, msg):
    """{firmId?}: one firm now (waits, streams progress), or every watched firm in the background."""
    if msg.get('firmId'):
        fid = _firm_id(msg)
        note = await watch_firm(ctx, fid, msg.get('_emit'))
        return {'note': note, **await _q(watch_status)}
    if WATCH['running']:
        raise EngineError('The change watcher is already running.')

    async def go():
        try:
            await run_watch(ctx)
        except Exception as err:
            log.info('Change watcher failed: %s', err)
    background(go())
    return {'started': True, **await _q(watch_status)}


@handler('prospect.watch.status')
async def h_watch_status(ctx, msg):
    return await _q(watch_status)


@handler('prospect.watch.set')
async def h_watch_set(ctx, msg):
    """{firmId, on}: star or unstar a firm for the weekly change watcher."""
    return await _q(set_watch, _firm_id(msg), bool(msg.get('on')))


@handler('prospect.review.list')
async def h_review_list(ctx, msg):
    """{status?: pending|approved|rejected, firmId?, limit?}"""
    status = msg.get('status') if msg.get('status') in ('pending', 'approved', 'rejected') else 'pending'
    return await _q(review_list, status, msg.get('firmId') or None, min(int(msg.get('limit') or 200), 1000))


@handler('prospect.review.decide')
async def h_review_decide(ctx, msg):
    """{fids: [..], decision: approve|reject|undo}"""
    return await _q(review_decide, msg.get('fids'), msg.get('decision'))


@handler('prospect.optout.set')
async def h_optout_set(ctx, msg):
    """{firmId? | email?, on, reason?}: the do-not-contact list (exports and outreach leave these out)."""
    return await _q(set_opt_out, msg.get('firmId') or None, msg.get('email') or None, msg.get('on', True) is not False, msg.get('reason') or '')


@handler('prospect.optout.list')
async def h_optout_list(ctx, msg):
    def run(con):
        return {'items': [{'kind': r['kind'], 'value': r['value'], 'reason': r['reason'], 'on': _day(r['at']),
                           'name': (con.execute('SELECT name FROM firms WHERE id = ?', (r['value'],)).fetchone() or [None])[0] if r['kind'] == 'firm' else None}
                          for r in con.execute('SELECT * FROM contact_optout ORDER BY at DESC')]}
    return await _q(run)


@handler('prospect.contacts_export')
async def h_contacts_export(ctx, msg):
    """{firmIds?, guesses?}: contacts as CSV with their labels; do-not-contact firms and emails are left out."""
    ids = [str(x) for x in (msg.get('firmIds') or []) if str(x).strip()] or None
    notes = await asyncio.to_thread(note_opt_outs)
    return await _q(contacts_csv, ids, msg.get('guesses') is not False, notes)


@handler('prospect.contacts_settings')
async def h_contacts_settings(ctx, msg):
    """{smtpCheck?}: the optional mail-server check (off by default). Also in settings.get / settings.set."""
    from . import settings
    if 'smtpCheck' in msg:
        settings.save({'prospect_smtp_check': bool(msg['smtpCheck'])})
    return {'smtpCheck': smtp_enabled()}


# Hooks into prospect.py: the do-not-contact list leaves firms out of prospect.export, and the weekly watcher runs
# beside the download schedule.
pr.EXPORT_FILTERS.append(excluded_firms)
pr.SCHEDULE_HOOKS.append(watch_loop)
