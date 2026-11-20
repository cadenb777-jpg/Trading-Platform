"""
When you can get money out of an interval fund or a tender-offer fund (SEC EDGAR, free).

An interval fund must buy back part of its shares on a fixed schedule and tell the SEC each time (Form N-23C3A, the
"notification of repurchase offer"; N-23C3B/C for discretionary or amended ones). A tender-offer fund files Schedule
TO-I for each tender offer. So the fund's own filings give the dates: every notice is listed, and the newest one is read
for its repurchase request deadline, pricing date and the share of the fund on offer. The next offer is only estimated
(the usual gap between notices), and says so.

Request: funds.liquidity {symbol} -> {symbol, cik, name, kind: 'interval' | 'tender' | None, offers: [...],
latest: {...} | None, nextEstimate}. Tickers are looked up in the SEC's fund list (company_tickers_mf.json) and its
company list.
"""
import datetime as dt
import re
import statistics

from . import sec
from .core import EngineError, handler

MF_URL = 'https://www.sec.gov/files/company_tickers_mf.json'
INTERVAL_FORMS = ('N-23C3A', 'N-23C3B', 'N-23C3C')
TENDER_FORMS = ('SC TO-I', 'SC TO-I/A')
MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
DATE = rf'((?:{MONTHS})\s+\d{{1,2}},\s+\d{{4}})'
DEADLINE = re.compile(rf'repurchase\s+request\s+deadline\W{{0,40}}(?:\w+\W+){{0,12}}?{DATE}', re.I)
PRICING = re.compile(rf'repurchase\s+pricing\s+date\W{{0,40}}(?:\w+\W+){{0,12}}?{DATE}', re.I)
EXPIRES = re.compile(rf'(?:offer|tender offer)\s+(?:will\s+)?expires?\W{{0,40}}(?:\w+\W+){{0,14}}?{DATE}', re.I)
PERCENT = re.compile(r'(\d{1,2}(?:\.\d+)?)\s*%\s+of\s+(?:the\s+)?(?:fund\W?s\s+)?(?:its\s+)?(?:issued\s+and\s+)?outstanding\s+(?:common\s+)?shares', re.I)


def _iso(text):
    try:
        return dt.datetime.strptime(re.sub(r'\s+', ' ', text.strip()), '%B %d, %Y').date().isoformat()
    except ValueError:
        return None


def plain(html):
    """Readable text from a filing's HTML (tags and entities out, spaces squeezed) (pure, tested)."""
    t = re.sub(r'(?is)<(script|style).*?</\1>', ' ', html or '')
    t = re.sub(r'<[^>]+>', ' ', t)
    t = t.replace('&nbsp;', ' ').replace('&#160;', ' ').replace('&amp;', '&').replace('&#8217;', "'").replace('&rsquo;', "'")
    return re.sub(r'\s+', ' ', t)


def parse_notice(text):
    """{'deadline', 'pricingDate', 'percent'} from a repurchase or tender notice; missing parts are None (pure, tested)."""
    d = DEADLINE.search(text) or EXPIRES.search(text)
    p = PRICING.search(text)
    pct = PERCENT.search(text)
    return {'deadline': _iso(d.group(1)) if d else None, 'pricingDate': _iso(p.group(1)) if p else None,
            'percent': float(pct.group(1)) if pct else None}


def next_estimate(dates):
    """The next notice date from the usual gap between past ones (median), or None with fewer than 3 (pure, tested)."""
    ds = sorted({dt.date.fromisoformat(d) for d in dates if d})
    if len(ds) < 3:
        return None
    gap = statistics.median((b - a).days for a, b in zip(ds, ds[1:]))
    return (ds[-1] + dt.timedelta(days=round(gap))).isoformat() if gap >= 20 else None


def parse_mf_tickers(data):
    """{SYMBOL: cik} from the SEC's company_tickers_mf.json ({fields: [...], data: [[cik, series, class, symbol]]})."""
    fields = (data or {}).get('fields') or []
    try:
        ci, si = fields.index('cik'), fields.index('symbol')
    except ValueError:
        return {}
    return {str(row[si]).upper(): int(row[ci]) for row in (data or {}).get('data') or [] if row and row[si]}


async def fund_cik(ctx, symbol):
    async def load():
        return parse_mf_tickers((await sec.sec_get(ctx, MF_URL)).json())
    funds = await ctx.cached('sec-mf-tickers', 86400, load, persist=True, stale_ok=True)
    if symbol in funds:
        return funds[symbol]
    try:
        return (await sec.company(ctx, symbol))['cik']
    except sec.NotListed:
        return None


@handler('funds.liquidity')
async def liquidity(ctx, msg):
    symbol = str(msg.get('symbol') or '').strip().upper().lstrip('$')
    if not re.fullmatch(r'[A-Z0-9.\-]{1,10}', symbol):
        raise EngineError('Give a fund ticker.')

    async def load():
        cik = await fund_cik(ctx, symbol)
        if not cik:
            return {'symbol': symbol, 'cik': None, 'kind': None, 'offers': [], 'latest': None, 'nextEstimate': None}
        subs = await sec.submissions(ctx, cik)
        rows = sec.recent_filings(subs, INTERVAL_FORMS + TENDER_FORMS, limit=24)
        kind = 'interval' if any(r['form'] in INTERVAL_FORMS for r in rows) else 'tender' if rows else None
        offers = [{'form': r['form'], 'filed': r['filed'], 'url': sec.filing_url(cik, r['accession'], r['document'])} for r in rows]
        latest = None
        newest = next((r for r in rows if r['form'] in INTERVAL_FORMS or r['form'] == 'SC TO-I'), None)
        if newest:
            try:
                html = (await sec.sec_get(ctx, sec.filing_url(cik, newest['accession'], newest['document']))).text
                latest = {**parse_notice(plain(html)[:200000]), 'filed': newest['filed'], 'form': newest['form'],
                          'url': sec.filing_url(cik, newest['accession'], newest['document'])}
            except EngineError:
                latest = {'deadline': None, 'pricingDate': None, 'percent': None, 'filed': newest['filed'], 'form': newest['form'],
                          'url': sec.filing_url(cik, newest['accession'], newest['document'])}
        main_forms = INTERVAL_FORMS if kind == 'interval' else ('SC TO-I',)
        return {'symbol': symbol, 'cik': cik, 'name': subs.get('name', ''), 'kind': kind, 'offers': offers, 'latest': latest,
                'nextEstimate': next_estimate([o['filed'] for o in offers if o['form'] in main_forms])}
    return await ctx.cached(('fund-liquidity', symbol), 12 * 3600, load, persist=True, stale_ok=True)
