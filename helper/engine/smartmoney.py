"""
"Smart money" data for the chart's Positioning indicators: who is buying a stock.

- research.insider_history: open-market buys (P) and sales (S) by a company's officers, directors and 10% owners
  from their SEC Form 4 filings, for the last few years, plus net dollars per month of the filing date (the day
  each trade became public).
- prospect.holders_by_symbol: how many 13F filers (institutions with $100M+) hold the stock in the two newest
  quarters of the Prospecting page's 13F download (~/.trading-platform/prospect.db), how many shares, and how many
  opened, added, reduced or sold out. Without that download the reply says to download it first.

SEC requests go through sec.sec_get, which keeps the whole helper under the SEC's rate limit; each Form 4 is kept
in cache.db for good.
"""
import asyncio
import datetime as dt
import re
import sqlite3
from pathlib import Path

from . import sec
from .core import EngineError, handler

SUBMISSIONS_FILE_URL = 'https://data.sec.gov/submissions/{name}'
PROSPECT_DB = Path.home() / '.trading-platform' / 'prospect.db'
#: newest filings first; a big company files ~100 Form 4s a year, so this covers 3+ years for nearly everyone
MAX_FILINGS = 400


def form4_rows(block, since):
    """Form 4 filings filed on or after `since` from a submissions column block (the 'recent' part or an older file)."""
    rows = []
    for i, form in enumerate(block.get('form', [])):
        if form != '4':
            continue
        filed = block['filingDate'][i]
        if filed < since:
            continue
        rows.append({'filed': filed, 'accession': block['accessionNumber'][i], 'document': block['primaryDocument'][i]})
    return rows


async def form4_filings(ctx, cik, since):
    subs = await sec.submissions(ctx, cik)
    rows = form4_rows(subs.get('filings', {}).get('recent', {}), since)
    # Busy filers have older filings in extra files; read those that reach back into the window.
    for f in subs.get('filings', {}).get('files', []):
        if len(rows) >= MAX_FILINGS or str(f.get('filingTo', '')) < since:
            continue
        url = SUBMISSIONS_FILE_URL.format(name=f['name'])
        async def load(url=url):
            return (await sec.sec_get(ctx, url)).json()
        try:
            rows += form4_rows(await ctx.cached(('sec-subs-file', f['name']), 30 * 86400, load, persist=True), since)
        except Exception:
            continue
    rows.sort(key=lambda r: r['filed'], reverse=True)
    return rows[:MAX_FILINGS]


def monthly_net(trades):
    """Buy and sell dollars per calendar month of the filing date (open-market trades only)."""
    months = {}
    for t in trades:
        if t['code'] not in ('P', 'S') or not t.get('filed'):
            continue
        m = months.setdefault(t['filed'][:7], {'month': t['filed'][:7], 'buy': 0.0, 'sell': 0.0})
        m['buy' if t['code'] == 'P' else 'sell'] += t.get('value') or 0.0
    out = sorted(months.values(), key=lambda m: m['month'])
    for m in out:
        m['net'] = m['buy'] - m['sell']
    return out


@handler('research.insider_history')
async def insider_history(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper().strip().lstrip('$')
    if not symbol:
        raise EngineError('Enter a symbol')
    years = max(1, min(10, int(msg.get('years') or 3)))
    info = await sec.company(ctx, symbol)
    since = (dt.date.today() - dt.timedelta(days=int(365.25 * years))).isoformat()
    filings = await form4_filings(ctx, info['cik'], since)

    async def one(f):
        document = re.sub(r'^xsl[^/]+/', '', f['document'])  # the raw XML, not the styled view
        url = sec.filing_url(info['cik'], f['accession'], document)
        async def load():
            return sec.parse_form4((await sec.sec_get(ctx, url)).text)
        try:
            trades = await ctx.cached(('form4', f['accession']), 365 * 86400, load, persist=True)
        except Exception:
            return []
        return [{**t, 'filed': f['filed']} for t in trades if t['code'] in ('P', 'S') and t.get('date')]

    trades = [t for group in await asyncio.gather(*(one(f) for f in filings)) for t in group]
    trades.sort(key=lambda t: (t['filed'], t['date']))
    slim = [{k: t.get(k) for k in ('date', 'filed', 'code', 'insider', 'title', 'shares', 'price', 'value')} for t in trades]
    return {'symbol': symbol, 'company': info['name'], 'since': since, 'filings': len(filings), 'trades': slim, 'months': monthly_net(trades)}


# ---------- 13F holders (from the Prospecting download) ----------

NO_13F = 'Download 13F data in Prospecting first (Prospecting page > Download data). The 13F holder count comes from that download.'
BUSY_13F = 'Prospecting data is busy (a download is running); try again in a minute.'
#: a quarter counts only when at least this share of the newest quarter's filers reported it (Prospecting keeps each
#: filer's own newest two quarters, so older quarters hold only the few slow or late filers)
MIN_PERIOD_COVERAGE = 0.5


def _db_error(err):
    text = str(err).lower()
    return EngineError(BUSY_13F if 'locked' in text or 'busy' in text else NO_13F)


def pick_cusip(symbol, candidates):
    """The CUSIP for `symbol` among a company's CUSIPs [{cusip, ticker, class, value}]: one CUSIP, an exact ticker
    match, a class letter (BRK.B -> "CL B"), else the most widely held class. Returns (cusip, note)."""
    if len(candidates) == 1:
        return candidates[0]['cusip'], ''
    exact = [c for c in candidates if (c['ticker'] or '').upper().replace('.', '-') == symbol.replace('.', '-')]
    if len(exact) == 1:
        return exact[0]['cusip'], ''
    m = re.search(r'[.-]([A-Z])$', symbol)
    if m:
        letter = m.group(1)
        hits = [c for c in candidates if re.search(rf'\bCL(ASS)?\s*{letter}\b|\s{letter}$', (c['class'] or '').upper())]
        if len(hits) == 1:
            return hits[0]['cusip'], ''
    best = max(candidates, key=lambda c: c['value'] or 0)
    return best['cusip'], f'Several share classes; showing the most widely held ({best["class"] or best["cusip"]}).'


def holders_from_db(path, cik, symbol=''):
    """The two newest well-reported 13F quarters for the company `cik`: filers holding it, total shares and value,
    and versus the quarter before, how many opened, added, reduced or sold out (among filers in both quarters)."""
    if not Path(path).exists():
        raise EngineError(NO_13F)
    try:
        con = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=5)
    except sqlite3.OperationalError as err:
        raise _db_error(err) from err
    try:
        if not con.execute('SELECT 1 FROM holdings_13f LIMIT 1').fetchone():
            raise EngineError(NO_13F)
        candidates = [
            {'cusip': r[0], 'ticker': r[1], 'class': r[2], 'value': r[3]}
            for r in con.execute(
                'SELECT m.cusip, m.ticker, (SELECT MAX(class) FROM holdings_13f h WHERE h.cusip = m.cusip), '
                '(SELECT SUM(value) FROM holdings_13f h WHERE h.cusip = m.cusip) FROM cusip_map m WHERE m.cik = ?', (cik,))
        ]
        candidates = [c for c in candidates if c['value']]
        if not candidates:
            raise EngineError(f'{symbol or "This stock"} isn’t matched to a CUSIP in the 13F download yet (ETFs and some share classes aren’t).')
        cusip, note = pick_cusip(symbol.upper(), candidates)
        filers = dict(con.execute('SELECT period, COUNT(DISTINCT cik) FROM holdings_13f GROUP BY period').fetchall())
        newest = max(filers.values())
        periods = sorted(p for p, n in filers.items() if n >= MIN_PERIOD_COVERAGE * newest)[-2:]
        held, reporting = {}, {}
        for period in periods:
            reporting[period] = {r[0] for r in con.execute('SELECT DISTINCT cik FROM holdings_13f WHERE period = ?', (period,))}
            # Shares only: option rows (put_call set) and principal amounts (bonds) aren't ownership of the stock.
            held[period] = {r[0]: (r[1] or 0.0, r[2] or 0.0) for r in con.execute(
                "SELECT cik, SUM(shares), SUM(value) FROM holdings_13f WHERE cusip = ? AND period = ? "
                "AND COALESCE(put_call, '') = '' AND COALESCE(share_type, 'SH') IN ('SH', '') GROUP BY cik", (cusip, period))}
    except sqlite3.OperationalError as err:
        raise _db_error(err) from err
    finally:
        con.close()
    return {'cusip': cusip, 'note': note, 'quarters': quarter_changes(periods, held, reporting)}


def quarter_changes(periods, held, reporting):
    """Quarter rows; changes count only filers that reported in both quarters (a missing report isn't a sale)."""
    out, prev = [], None
    for period in periods:
        cur = {c: v for c, v in held[period].items() if v[0] > 0}
        q = {'period': period, 'holders': len(cur), 'shares': sum(v[0] for v in cur.values()), 'value': sum(v[1] for v in cur.values())}
        if prev is not None:
            both = reporting[prev] & reporting[period]
            was = {c: v for c, v in held[prev].items() if v[0] > 0 and c in both}
            now = {c: v for c, v in cur.items() if c in both}
            q['new'] = sum(1 for c in now if c not in was)
            q['soldOut'] = sum(1 for c in was if c not in now)
            q['added'] = sum(1 for c in now if c in was and now[c][0] > was[c][0])
            q['reduced'] = sum(1 for c in now if c in was and now[c][0] < was[c][0])
        out.append(q)
        prev = period
    return out


@handler('prospect.holders_by_symbol')
async def holders_by_symbol(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper().strip().lstrip('$')
    if not symbol:
        raise EngineError('Enter a symbol')
    if not PROSPECT_DB.exists():
        raise EngineError(NO_13F)
    info = await sec.company(ctx, symbol)  # every SEC ticker of the company (GOOGL and GOOG, BRK.B) maps to its CIK
    result = await asyncio.to_thread(holders_from_db, PROSPECT_DB, info['cik'], symbol)
    if not result['quarters']:
        raise EngineError(f'No 13F holders of {symbol} in the download.')
    return {'symbol': symbol, **result}
