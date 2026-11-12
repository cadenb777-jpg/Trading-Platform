"""
Where a company's money comes from, as deep as its own filing goes: revenue by product or service (Apple: iPhone, Mac,
iPad, Wearables, Services), by business segment and by region, with each part's share, growth on a year ago and, where
reported, segment operating income and margin.

Free and first-hand: read from the company's latest 10-K (or 10-Q) XBRL instance on SEC EDGAR, including the
"dimensional" facts (srt:ProductOrServiceAxis, us-gaap:StatementBusinessSegmentsAxis, srt:StatementGeographicalAxis)
that the SEC's simple company-facts API leaves out. Names come from the filing's own label file ("iPhone", "Greater
China"), not guessed. Every breakdown is checked: its parts are added up and compared with the company's reported
total; a breakdown whose parts don't add up says so (some companies report overlapping or partial members).

Request (read-only): research.segments {symbol, period: 'annual' | 'quarter'}
"""
import datetime as dt
import re

from . import safexml, sec
from .core import EngineError, handler

XBRLI = 'http://www.xbrl.org/2003/instance'
XBRLDI = 'http://xbrl.org/2006/xbrldi'
LINK = 'http://www.xbrl.org/2003/linkbase'
XLINK = 'http://www.w3.org/1999/xlink'

#: revenue as companies tag it, most specific first
REVENUE = ('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax',
           'SalesRevenueNet', 'SalesRevenueGoodsNet')
PROFIT = ('OperatingIncomeLoss',)
#: the breakdowns shown, in this order (axis local name -> heading)
AXES = (('ProductOrServiceAxis', 'By product or service'), ('StatementBusinessSegmentsAxis', 'By business segment'),
        ('StatementGeographicalAxis', 'By region'))
#: a breakdown's parts may differ from the reported total by this much and still count as complete
COMPLETE = 0.01
ROLE_LABEL = 'http://www.xbrl.org/2003/role/label'
ROLE_TERSE = 'http://www.xbrl.org/2003/role/terseLabel'


# ---------- pure parsing (tested) ----------

def _local(qname):
    return qname.split(':', 1)[-1] if qname else ''


def _date(text):
    try:
        return dt.date.fromisoformat((text or '').strip()[:10])
    except ValueError:
        return None


def parse_instance(text):
    """The XBRL instance -> (contexts {id: {start, end, days, dims {axis: member}}}, facts [{concept, context, value}])."""
    root = safexml.fromstring(text)
    contexts = {}
    for c in root.iter(f'{{{XBRLI}}}context'):
        period = c.find(f'{{{XBRLI}}}period')
        if period is None:
            continue
        start = _date(period.findtext(f'{{{XBRLI}}}startDate'))
        end = _date(period.findtext(f'{{{XBRLI}}}endDate') or period.findtext(f'{{{XBRLI}}}instant'))
        dims = {m.get('dimension'): (m.text or '').strip() for m in c.iter(f'{{{XBRLDI}}}explicitMember')}
        contexts[c.get('id')] = {'start': start, 'end': end, 'days': (end - start).days if start and end else 0, 'dims': dims}
    facts = []
    for el in root:
        ref = el.get('contextRef')
        if not ref or not isinstance(el.tag, str) or not el.tag.startswith('{'):
            continue
        try:
            value = float((el.text or '').strip())
        except ValueError:
            continue
        facts.append({'concept': el.tag.split('}', 1)[1], 'context': ref, 'value': value})
    return contexts, facts


def parse_labels(text):
    """The filing's label linkbase -> {'aapl:IPhoneMember': 'iPhone', ...} (terse label when there is one)."""
    root = safexml.fromstring(text)
    out = {}
    for link in root.iter(f'{{{LINK}}}labelLink'):
        locs, labels, arcs = {}, {}, []
        for el in link:
            kind = el.get(f'{{{XLINK}}}type')
            name = el.get(f'{{{XLINK}}}label')
            if kind == 'locator':
                href = el.get(f'{{{XLINK}}}href', '')
                frag = href.split('#', 1)[-1]
                locs[name] = frag.replace('_', ':', 1)
            elif kind == 'resource':
                labels.setdefault(name, {})[el.get(f'{{{XLINK}}}role', ROLE_LABEL)] = (el.text or '').strip()
            elif kind == 'arc':
                arcs.append((el.get(f'{{{XLINK}}}from'), el.get(f'{{{XLINK}}}to')))
        for frm, to in arcs:
            qname, text_by_role = locs.get(frm), labels.get(to)
            if qname and text_by_role:
                best = text_by_role.get(ROLE_TERSE) or text_by_role.get(ROLE_LABEL) or next(iter(text_by_role.values()))
                if qname not in out or ROLE_TERSE in text_by_role:
                    out[qname] = best
    return out


def member_name(qname, labels):
    """'aapl:IPhoneMember' -> 'iPhone' (the filing's label, without '[Member]'), else spaced from the code."""
    label = labels.get(qname)
    if label:
        return re.sub(r'\s*\[Member\]\s*$', '', label).strip()
    raw = _local(qname)
    raw = re.sub(r'(Segment)?Member$', '', raw)
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', raw).strip() or qname


def _period_ok(c, period):
    days = c['days']
    return 350 <= days <= 380 if period == 'annual' else 80 <= days <= 100


def totals(contexts, facts, concepts, period):
    """The company's own (undimensioned) figure for the first concept found: {end date: value}."""
    for concept in concepts:
        rows = {}
        for f in facts:
            c = contexts.get(f['context'])
            if f['concept'] == concept and c and not c['dims'] and _period_ok(c, period):
                rows[c['end']] = f['value']
        if rows:
            return concept, rows
    return None, {}


def breakdown(contexts, facts, concept, axis_local, period):
    """{end date: {member qname: value}} for facts with exactly one dimension, on `axis_local`."""
    out = {}
    for f in facts:
        if f['concept'] != concept:
            continue
        c = contexts.get(f['context'])
        if not c or len(c['dims']) != 1 or not _period_ok(c, period):
            continue
        axis, member = next(iter(c['dims'].items()))
        if _local(axis) == axis_local:
            out.setdefault(c['end'], {})[member] = f['value']
    return out


def build(contexts, facts, labels, period='annual'):
    """Every breakdown for the newest period, with the year-earlier figures, shares, growth, margins and the add-up check."""
    concept, total_by_end = totals(contexts, facts, REVENUE, period)
    if not concept:
        raise EngineError('This filing has no revenue figure the platform can read.')
    _, profit_total = totals(contexts, facts, PROFIT, period)
    sections = []
    newest = max(total_by_end)
    for axis, heading in AXES:
        by_end = breakdown(contexts, facts, concept, axis, period)
        if newest not in by_end:
            continue
        rows = by_end[newest]
        prior_end = max((e for e in by_end if e < newest), default=None)
        prior = by_end.get(prior_end, {})
        profit = breakdown(contexts, facts, PROFIT[0], axis, period).get(newest, {})
        total = total_by_end[newest]
        parts = sum(rows.values())
        items = []
        for member, value in sorted(rows.items(), key=lambda kv: -kv[1]):
            was = prior.get(member)
            op = profit.get(member)
            items.append({
                'member': member, 'name': member_name(member, labels), 'value': value, 'prior': was,
                'share': value / total if total else None,
                'growth': (value / was - 1) if was else None,
                'operatingIncome': op, 'margin': (op / value) if op is not None and value else None,
            })
        sections.append({
            'axis': axis, 'heading': heading, 'items': items, 'sum': parts, 'total': total,
            'complete': bool(total) and abs(parts / total - 1) <= COMPLETE,
            'coverage': parts / total if total else None,
        })
    return {'revenueConcept': concept, 'periodEnd': newest.isoformat(), 'period': period, 'total': total_by_end[newest],
            'priorTotal': total_by_end.get(max((e for e in total_by_end if e < newest), default=newest)) if len(total_by_end) > 1 else None,
            'operatingIncome': profit_total.get(newest), 'sections': sections}


def pick_files(names):
    """The instance document and the label linkbase among a filing folder's files."""
    instance = next((n for n in names if n.endswith('_htm.xml')), None)
    if not instance:
        skip = ('_cal.xml', '_def.xml', '_lab.xml', '_pre.xml', 'FilingSummary.xml')
        instance = next((n for n in names if n.endswith('.xml') and not n.endswith(skip)), None)
    labels = next((n for n in names if n.endswith('_lab.xml')), None)
    return instance, labels


# ---------- fetching ----------

async def latest(ctx, symbol, period='annual'):
    co = await sec.company(ctx, symbol)
    cik = co['cik']
    forms = ('10-K', '10-K/A') if period == 'annual' else ('10-Q', '10-K')
    filings = sec.recent_filings(await sec.submissions(ctx, cik), forms=forms, limit=4)
    if not filings:
        raise EngineError(f'{symbol} has no {"10-K" if period == "annual" else "10-Q"} on file with the SEC.')
    f = filings[0]
    folder = f'https://www.sec.gov/Archives/edgar/data/{cik}/{f["accession"].replace("-", "")}/'

    async def load():
        index = (await sec.sec_get(ctx, folder + 'index.json')).json()
        names = [i.get('name', '') for i in index.get('directory', {}).get('item', [])]
        instance, label_file = pick_files(names)
        if not instance:
            raise EngineError('This filing has no XBRL data to read.')
        contexts, facts = parse_instance((await sec.sec_get(ctx, folder + instance)).text)
        labels = parse_labels((await sec.sec_get(ctx, folder + label_file)).text) if label_file else {}
        return build(contexts, facts, labels, 'annual' if f['form'].startswith('10-K') else 'quarter')
    data = await ctx.cached(('segments', f['accession']), 30 * 86400, load, persist=True)
    return {'symbol': symbol, 'company': co.get('name', symbol), 'form': f['form'], 'filed': f['filed'],
            'source': sec.filing_url(cik, f['accession'], f['document']), **data}


@handler('research.segments')
async def segments(ctx, msg):
    symbol = str(msg.get('symbol') or '').strip().upper()
    if not symbol:
        raise EngineError('Give a ticker.')
    period = 'quarter' if msg.get('period') == 'quarter' else 'annual'
    return await latest(ctx, symbol, period)
