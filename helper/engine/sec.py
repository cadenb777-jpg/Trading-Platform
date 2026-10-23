"""
SEC EDGAR data (free): company lookups, filings, insider trades (Form 4) and financial
statements (XBRL company facts). The SEC asks for a contact email in the User-Agent and at most
10 requests per second.
"""
import asyncio
import re
import xml.etree.ElementTree as ET

from .core import EngineError, handler

TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK{cik:010d}.json'
FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json'
ARCHIVE_URL = 'https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}'

_sec_slots = asyncio.Semaphore(5)


async def sec_get(ctx, url):
    if not ctx.sec_contact:
        raise EngineError('SEC data needs a contact email: open Settings (the gear at the bottom of the left menu) and add your email under "SEC email".')
    async with _sec_slots:
        response = await ctx.sec_http.get(url)
    if response.status_code == 404:
        raise EngineError('The SEC has no data for this company.')
    if response.status_code == 403:
        raise EngineError('The SEC refused the request. Check the SEC email in Settings (gear icon, bottom left).')
    response.raise_for_status()
    return response


async def company(ctx, symbol):
    """Looks up a ticker's SEC CIK number and name."""
    async def load():
        data = (await sec_get(ctx, TICKERS_URL)).json()
        return {row['ticker'].upper(): {'cik': int(row['cik_str']), 'name': row['title']} for row in data.values()}
    tickers = await ctx.cached('sec-tickers', 86400, load, persist=True, stale_ok=True)
    found = tickers.get(symbol.upper().replace('.', '-')) or tickers.get(symbol.upper())
    if not found:
        raise EngineError(f'"{symbol}" isn\'t in the SEC\'s company list (ETFs, indexes and foreign companies often aren\'t).')
    return found


async def submissions(ctx, cik):
    return await ctx.cached(('sec-subs', cik), 3600, lambda: _json(ctx, SUBMISSIONS_URL.format(cik=cik)), persist=True, stale_ok=True)


async def _json(ctx, url):
    return (await sec_get(ctx, url)).json()


def recent_filings(subs, forms=None, limit=40):
    recent = subs.get('filings', {}).get('recent', {})
    rows = []
    for i, form in enumerate(recent.get('form', [])):
        if forms and form not in forms:
            continue
        rows.append({
            'form': form,
            'filed': recent['filingDate'][i],
            'reportDate': recent.get('reportDate', [''] * (i + 1))[i],
            'accession': recent['accessionNumber'][i],
            'document': recent['primaryDocument'][i],
            'description': recent.get('primaryDocDescription', [''] * (i + 1))[i],
        })
        if len(rows) >= limit:
            break
    return rows


def filing_url(cik, accession, document):
    return ARCHIVE_URL.format(cik=cik, accession=accession.replace('-', ''), document=document)


# ---------- Insider trades (Form 4) ----------

TRANSACTION_CODES = {
    'P': 'Buy', 'S': 'Sell', 'A': 'Award', 'M': 'Option exercise', 'F': 'Tax withholding',
    'G': 'Gift', 'D': 'Disposed to company', 'C': 'Conversion', 'X': 'Option exercise', 'J': 'Other',
}


def _text(node, path):
    found = node.find(path)
    return (found.text or '').strip() if found is not None and found.text else ''


def _num(node, path):
    try:
        return float(_text(node, path))
    except ValueError:
        return None


def parse_form4(xml_text):
    """Reads the stock transactions out of a Form 4 filing."""
    root = ET.fromstring(xml_text)
    owners = root.findall('reportingOwner')
    name = _text(owners[0], 'reportingOwnerId/rptOwnerName') if owners else ''
    rel = owners[0].find('reportingOwnerRelationship') if owners else None
    title = ''
    if rel is not None:
        title = _text(rel, 'officerTitle') or ('Director' if _text(rel, 'isDirector') in ('1', 'true') else '') \
            or ('10% owner' if _text(rel, 'isTenPercentOwner') in ('1', 'true') else '')
    trades = []
    for tx in root.findall('nonDerivativeTable/nonDerivativeTransaction'):
        code = _text(tx, 'transactionCoding/transactionCode')
        shares = _num(tx, 'transactionAmounts/transactionShares/value') or 0
        price = _num(tx, 'transactionAmounts/transactionPricePerShare/value')
        direction = _text(tx, 'transactionAmounts/transactionAcquiredDisposedCode/value')
        trades.append({
            'date': _text(tx, 'transactionDate/value'),
            'insider': name.title() if name.isupper() else name,
            'title': title,
            'code': code,
            'type': TRANSACTION_CODES.get(code, code or 'Other'),
            'shares': shares,
            'price': price,
            'value': shares * price if price else None,
            'acquired': direction == 'A',
            'ownedAfter': _num(tx, 'postTransactionAmounts/sharesOwnedFollowingTransaction/value'),
        })
    return trades


@handler('flow.insiders')
async def insiders(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper()
    info = await company(ctx, symbol)
    filings = recent_filings(await submissions(ctx, info['cik']), forms={'4'}, limit=40)

    async def one(f):
        # The listed document is the styled HTML view; the raw XML has the same name without the style folder.
        document = re.sub(r'^xsl[^/]+/', '', f['document'])
        url = filing_url(info['cik'], f['accession'], document)
        async def load():
            return parse_form4((await sec_get(ctx, url)).text)
        try:
            trades = await ctx.cached(('form4', f['accession']), 365 * 86400, load, persist=True)
        except Exception:
            return []
        link = filing_url(info['cik'], f['accession'], f['document'])
        return [{**t, 'filed': f['filed'], 'link': link} for t in trades]

    trades = [t for group in await asyncio.gather(*(one(f) for f in filings)) for t in group]
    trades.sort(key=lambda t: t['date'], reverse=True)
    buys = [t for t in trades if t['code'] == 'P']
    sells = [t for t in trades if t['code'] == 'S']
    return {
        'symbol': symbol,
        'company': info['name'],
        'trades': trades,
        'summary': {
            'buyValue': sum(t['value'] or 0 for t in buys),
            'sellValue': sum(t['value'] or 0 for t in sells),
            'buyers': len({t['insider'] for t in buys}),
            'sellers': len({t['insider'] for t in sells}),
            'since': trades[-1]['date'] if trades else '',
        },
    }
