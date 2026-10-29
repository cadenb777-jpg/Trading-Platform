"""
"Smart money" data for the chart's Positioning indicators: who is buying a stock.

- research.insider_history: open-market buys (P) and sales (S) by a company's officers, directors and 10% owners
  from their SEC Form 4 filings, for the last few years, plus net dollars per month.
- prospect.holders_by_symbol: how many 13F filers (institutions with $100M+) hold the stock each quarter, how many
  shares, and how many opened, added, reduced or sold out. It reads the Prospecting page's 13F download
  (~/.trading-platform/prospect.db); without it the reply says to download that first.

The SEC asks for a contact email in the User-Agent (sec.sec_get) and at most 10 requests a second: new Form 4
downloads here are spaced 0.125 s apart and each filing is kept in cache.db for good.
"""
import asyncio
import datetime as dt
import re
import sqlite3
import time
from pathlib import Path

from . import sec
from .core import EngineError, handler

SUBMISSIONS_FILE_URL = 'https://data.sec.gov/submissions/{name}'
PROSPECT_DB = Path.home() / '.trading-platform' / 'prospect.db'
#: newest filings first; a big company files ~100 Form 4s a year, so this covers 3+ years for nearly everyone
MAX_FILINGS = 400
SEC_SPACING = 0.125

_pace_lock = None
_last_sent = [0.0]


async def paced_sec_get(ctx, url):
    """sec_get, spaced so this module never sends the SEC more than 8 requests a second."""
    global _pace_lock
    if _pace_lock is None:
        _pace_lock = asyncio.Lock()
    async with _pace_lock:
        wait = _last_sent[0] + SEC_SPACING - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last_sent[0] = time.monotonic()
    return await sec.sec_get(ctx, url)


def form4_rows(block, since):
    """Form 4 filings filed on or after `since` from a submissions column block (the 'recent' part or an older file)."""
    rows = []
    forms = block.get('form', [])
    for i, form in enumerate(forms):
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
            return (await paced_sec_get(ctx, url)).json()
        try:
            rows += form4_rows(await ctx.cached(('sec-subs-file', f['name']), 30 * 86400, load, persist=True), since)
        except Exception:
            continue
    rows.sort(key=lambda r: r['filed'], reverse=True)
    return rows[:MAX_FILINGS]


def monthly_net(trades):
    """Buy and sell dollars per calendar month of the trade date (open-market trades only)."""
    months = {}
    for t in trades:
        if t['code'] not in ('P', 'S') or not t.get('date'):
            continue
        m = months.setdefault(t['date'][:7], {'month': t['date'][:7], 'buy': 0.0, 'sell': 0.0})
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
            return sec.parse_form4((await paced_sec_get(ctx, url)).text)
        try:
            trades = await ctx.cached(('form4', f['accession']), 365 * 86400, load, persist=True)
        except Exception:
            return []
        return [{**t, 'filed': f['filed']} for t in trades if t['code'] in ('P', 'S') and t.get('date')]

    trades = [t for group in await asyncio.gather(*(one(f) for f in filings)) for t in group]
    trades.sort(key=lambda t: t['date'])
    slim = [{k: t.get(k) for k in ('date', 'filed', 'code', 'insider', 'title', 'shares', 'price', 'value')} for t in trades]
    return {'symbol': symbol, 'company': info['name'], 'since': since, 'filings': len(filings), 'trades': slim, 'months': monthly_net(trades)}


# ---------- 13F holders (from the Prospecting download) ----------

NO_13F = 'Download 13F data in Prospecting first (Prospecting page > Download data). The 13F holder count comes from that download.'


def holders_from_db(path, symbol):
    """Per 13F quarter: filers holding the stock, total shares and value, and the change versus the quarter before."""
    if not Path(path).exists():
        raise EngineError(NO_13F)
    con = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=5)
    try:
        try:
            if not con.execute('SELECT 1 FROM holdings_13f LIMIT 1').fetchone():
                raise EngineError(NO_13F)
            row = con.execute('SELECT cik FROM cusip_map WHERE ticker = ?', (symbol,)).fetchone()
        except sqlite3.OperationalError as err:
            raise EngineError(NO_13F) from err
        if not row:
            raise EngineError(f'{symbol} isn’t matched to a CUSIP in the 13F download yet (ETFs and some share classes aren’t).')
        cusips = [r[0] for r in con.execute('SELECT cusip FROM cusip_map WHERE cik = ?', (row[0],))]
        marks = ','.join('?' * len(cusips))
        # Shares only: option rows (put_call set) and principal amounts (bonds) aren't ownership of the stock.
        rows = con.execute(
            f"SELECT period, cik, SUM(shares), SUM(value) FROM holdings_13f WHERE cusip IN ({marks}) "
            f"AND COALESCE(put_call, '') = '' AND COALESCE(share_type, 'SH') IN ('SH', '') GROUP BY period, cik",
            cusips,
        ).fetchall()
    finally:
        con.close()
    by_period = {}
    for period, cik, shares, value in rows:
        by_period.setdefault(period, {})[cik] = (shares or 0.0, value or 0.0)
    return quarter_changes(by_period)


def quarter_changes(by_period):
    """{period: {cik: (shares, value)}} -> quarter rows with new / added / reduced / sold-out counts."""
    out, prev = [], None
    for period in sorted(by_period):
        cur = {c: v for c, v in by_period[period].items() if v[0] > 0}
        q = {'period': period, 'holders': len(cur), 'shares': sum(v[0] for v in cur.values()), 'value': sum(v[1] for v in cur.values())}
        if prev is not None:
            q['new'] = sum(1 for c in cur if c not in prev)
            q['soldOut'] = sum(1 for c in prev if c not in cur)
            q['added'] = sum(1 for c in cur if c in prev and cur[c][0] > prev[c][0])
            q['reduced'] = sum(1 for c in cur if c in prev and cur[c][0] < prev[c][0])
        out.append(q)
        prev = cur
    return out


@handler('prospect.holders_by_symbol')
async def holders_by_symbol(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper().strip().lstrip('$')
    if not symbol:
        raise EngineError('Enter a symbol')
    quarters = await asyncio.to_thread(holders_from_db, PROSPECT_DB, symbol)
    if not quarters:
        raise EngineError(f'No 13F holders of {symbol} in the download.')
    return {'symbol': symbol, 'quarters': quarters}
