"""
Financial statements "as reported", for any company with XBRL filings: every line the company itself reports, in its
own order and words (income statement, balance sheet, cash flow, equity), with the drill-downs the company tags
(net sales -> Products / Services; revenue by segment), and every note's detail table ("Revenue (Details)",
"Inventories (Details)", "Debt (Details)", "Segment Information (Details)" ...).

Read from the latest 10-K (or 10-Q) on SEC EDGAR: the instance (values), the presentation linkbase (the company's
layout: which lines, in what order, under which heading), the label linkbase (its words, including "Total ..." and
negated labels) and the schema (the statement titles). Nothing is re-mapped to a standard template, so nothing the
company reports is lost.

Request (read-only): research.asreported {symbol, period: 'annual' | 'quarter', role?} -> the list of statements and
notes, and the chosen one (default: the income statement) as rows of {label, depth, kind, values per column}.
"""
import re

from . import safexml, sec, segments
from .core import EngineError, handler

LINK, XLINK = segments.LINK, segments.XLINK
NEGATED = ('negatedLabel', 'negatedTotalLabel', 'negatedTerseLabel', 'negatedPeriodEndLabel', 'negatedPeriodStartLabel')
#: the main statements first, in this order (matched in the schema's title)
MAIN = (('income', re.compile(r'operations|income|earnings', re.I)), ('balance', re.compile(r'balance sheet|financial (position|condition)', re.I)),
        ('cashflow', re.compile(r'cash flow', re.I)), ('equity', re.compile(r"(shareholders|stockholders).{0,3} equity", re.I)))
MAX_COLUMNS = 5


# ---------- pure parsing (tested) ----------

def parse_roles(xsd_text):
    """The schema's role titles: {roleURI: '0000004 - Statement - CONSOLIDATED STATEMENTS OF OPERATIONS', ...}."""
    root = safexml.fromstring(xsd_text)
    out = {}
    for rt in root.iter(f'{{{LINK}}}roleType'):
        d = rt.findtext(f'{{{LINK}}}definition') or ''
        out[rt.get('roleURI')] = d.strip()
    return out


def parse_presentation(text):
    """{roleURI: [(parent qname, child qname, order, preferredLabel role)]} from the presentation linkbase."""
    root = safexml.fromstring(text)
    out = {}
    for link in root.iter(f'{{{LINK}}}presentationLink'):
        role = link.get(f'{{{XLINK}}}role')
        locs, arcs = {}, []
        for el in link:
            kind = el.get(f'{{{XLINK}}}type')
            if kind == 'locator':
                locs[el.get(f'{{{XLINK}}}label')] = el.get(f'{{{XLINK}}}href', '').split('#', 1)[-1].replace('_', ':', 1)
            elif kind == 'arc':
                try:
                    order = float(el.get('order') or 0)
                except ValueError:
                    order = 0.0
                arcs.append((el.get(f'{{{XLINK}}}from'), el.get(f'{{{XLINK}}}to'), order, el.get('preferredLabel') or ''))
        out.setdefault(role, []).extend((locs.get(f), locs.get(t), o, p) for f, t, o, p in arcs if locs.get(f) and locs.get(t))
    return out


def parse_all_labels(text):
    """{qname: {label role: text}} (every role: standard, terse, total, negated, period start/end ...)."""
    root = safexml.fromstring(text)
    out = {}
    for link in root.iter(f'{{{LINK}}}labelLink'):
        locs, labels, arcs = {}, {}, []
        for el in link:
            kind = el.get(f'{{{XLINK}}}type')
            name = el.get(f'{{{XLINK}}}label')
            if kind == 'locator':
                locs[name] = el.get(f'{{{XLINK}}}href', '').split('#', 1)[-1].replace('_', ':', 1)
            elif kind == 'resource':
                labels.setdefault(name, {})[el.get(f'{{{XLINK}}}role', segments.ROLE_LABEL)] = (el.text or '').strip()
            elif kind == 'arc':
                arcs.append((el.get(f'{{{XLINK}}}from'), el.get(f'{{{XLINK}}}to')))
        for frm, to in arcs:
            if locs.get(frm) and labels.get(to):
                out.setdefault(locs[frm], {}).update(labels[to])
    return out


def label_for(qname, all_labels, preferred=''):
    roles = all_labels.get(qname, {})
    text = (roles.get(preferred) if preferred else None) or roles.get(segments.ROLE_TERSE) or roles.get(segments.ROLE_LABEL)
    if text:
        return re.sub(r'\s*\[(Member|Axis|Domain|Line Items|Table|Abstract)\]\s*$', '', text).strip()
    return re.sub(r'(Abstract|LineItems|Axis|Domain)$', '', segments.member_name(qname, {})).strip()


SMALL = {'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with'}


def nice_title(text):
    """'CONSOLIDATED STATEMENTS OF OPERATIONS' -> 'Consolidated Statements of Operations' (mixed case is kept)."""
    if not text.isupper():
        return text
    words = text.lower().split()
    return ' '.join(w if i and w in SMALL else w[:1].upper() + w[1:] for i, w in enumerate(words))


def statement_kind(title):
    """'income' / 'balance' / 'cashflow' / 'equity' for a main statement title, else None."""
    body = title.split(' - ', 2)[-1]
    if 'parenthetical' in body.lower():
        return None
    for kind, pattern in MAIN:
        if pattern.search(body):
            return kind
    return None


def catalogue(roles, presentation):
    """The statements and note detail tables that have a layout: [{role, title, kind, group}] main ones first."""
    items = []
    for role, title in roles.items():
        if role not in presentation:
            continue
        parts = title.split(' - ', 2)
        if len(parts) < 3:
            continue
        group, body = parts[1].strip().lower(), parts[2].strip()
        if group == 'statement':
            kind = statement_kind(title)
            if kind:
                items.append({'role': role, 'title': nice_title(body), 'kind': kind, 'group': 'statement'})
        elif group == 'disclosure' and body.endswith('(Details)'):
            items.append({'role': role, 'title': body.replace('(Details)', '').strip(), 'kind': 'details', 'group': 'details'})
    order = {k: i for i, (k, _) in enumerate(MAIN)}
    items.sort(key=lambda r: (r['group'] != 'statement', order.get(r['kind'], 9), r['title']))
    return items


def _columns(contexts, used, period):
    """The columns to show: the periods (instants or durations) that the shown lines use, newest first."""
    keys = set()
    for ctx_id in used:
        c = contexts[ctx_id]
        keys.add((c['start'] if c['days'] else None, c['end']))
    durations = [k for k in keys if k[0]]
    if durations:
        want = (350, 380) if period == 'annual' else (80, 100)
        fit = [k for k in durations if want[0] <= (k[1] - k[0]).days <= want[1]]
        keys = set(fit or durations) | {k for k in keys if not k[0]}
    instants = sorted([k for k in keys if not k[0]], key=lambda k: k[1], reverse=True)
    spans = sorted([k for k in keys if k[0]], key=lambda k: k[1], reverse=True)
    return spans[:MAX_COLUMNS] if spans else instants[:MAX_COLUMNS]


def build_statement(role, presentation, contexts, facts, all_labels, period='annual'):
    """One statement or note as rows, in the company's order: headings, lines, totals and member drill-down rows."""
    arcs = presentation.get(role, [])
    children = {}
    for parent, child, order, pref in arcs:
        children.setdefault(parent, []).append((order, child, pref))
    for v in children.values():
        v.sort(key=lambda t: t[0])
    roots = [p for p in children if p not in {c for _, c, _ in sum(children.values(), [])}]
    by_concept = {}
    for f in facts:
        by_concept.setdefault(f['concept'], []).append(f)

    rows = []

    def values(qname, dims):
        local = segments._local(qname)
        want = {segments._local(a): segments._local(m) for a, m in dims.items()}
        out = {}
        for f in by_concept.get(local, []):
            c = contexts.get(f['context'])
            if c is not None and {segments._local(a): segments._local(m) for a, m in c['dims'].items()} == want:
                out[f['context']] = f['value']
        return out

    def members_of(axis):
        seen, stack = [], [axis]
        while stack:
            node = stack.pop()
            for _, child, _ in children.get(node, []):
                if segments._local(child).endswith('Member'):
                    seen.append(child)
                stack.append(child)
        return seen

    STRUCTURE = ('Axis', 'Domain', 'Member')

    def walk(node, depth, axes, pref='', root=False):
        local = segments._local(node)
        kids = children.get(node, [])
        if local.endswith('Table'):
            members = {a: members_of(a) for _, a, _ in kids if segments._local(a).endswith('Axis')}
            for _, child, p in kids:
                if not segments._local(child).endswith('Axis'):
                    walk(child, depth, members, p)
            return
        if local.endswith(STRUCTURE):
            return
        if local.endswith('LineItems'):
            for _, child, p in kids:
                walk(child, depth, axes, p)
            return
        if local.endswith('Abstract'):
            if not root:
                rows.append({'kind': 'heading', 'label': label_for(node, all_labels), 'depth': depth, 'concept': local, 'ctx': {}})
            for _, child, p in kids:
                walk(child, depth if root else depth + 1, axes, p)
            return
        line(node, depth, axes, pref)
        for _, child, p in kids:
            walk(child, depth + 1, axes, p)

    def line(node, depth, axes, pref):
        local = segments._local(node)
        role = pref.split('/')[-1]
        sign = -1 if role in NEGATED else 1
        vals = {k: v * sign for k, v in values(node, {}).items()}
        row = {'kind': 'total' if role.lower().endswith('totallabel') else 'line', 'label': label_for(node, all_labels, pref),
               'depth': depth, 'concept': local, 'start': 'periodStart' in role, 'ctx': vals}
        rows.append(row)
        found = False
        for axis, members in (axes or {}).items():
            for m in members:
                mv = {k: v * sign for k, v in values(node, {axis: m}).items()}
                if mv:
                    found = True
                    rows.append({'kind': 'member', 'label': label_for(m, all_labels), 'depth': depth + 1, 'concept': local,
                                 'axis': label_for(axis, all_labels), 'ctx': mv})
        if found and not vals:
            row['kind'] = 'heading'  # reported only in parts: a heading over its members

    for root in sorted(roots):
        walk(root, 0, {}, root=True)
    used = {ctx_id for r in rows for ctx_id in r['ctx'] if contexts[ctx_id]['days']} or {ctx_id for r in rows for ctx_id in r['ctx']}
    cols = _columns(contexts, used, period)

    spans = bool(cols) and cols[0][0] is not None

    def key(ctx_id, at_start):
        c = contexts[ctx_id]
        if c['days'] or not spans:
            return (c['start'] if c['days'] else None, c['end'])
        # a balance (cash at the start / end of the year) shown in a duration column
        for s, e in cols:
            if (at_start and abs((c['end'] - s).days) <= 1) or (not at_start and c['end'] == e):
                return (s, e)
        return None
    out_rows = []
    for r in rows:
        by_col = {}
        for ctx_id, v in r['ctx'].items():
            by_col.setdefault(key(ctx_id, r.get('start')), v)
        vals = [by_col.get(c) for c in cols]
        if r['kind'] != 'heading' and all(v is None for v in vals):
            continue
        out_rows.append({k: r[k] for k in ('kind', 'label', 'depth', 'concept') if k in r} | ({'axis': r['axis']} if 'axis' in r else {}) | {'values': vals})
    # drop headings with nothing under them
    cleaned = []
    for i, r in enumerate(out_rows):
        nxt = out_rows[i + 1] if i + 1 < len(out_rows) else None
        if r['kind'] == 'heading' and (not nxt or nxt['depth'] <= r['depth']):
            continue
        cleaned.append(r)
    columns = [{'start': s.isoformat() if s else None, 'end': e.isoformat()} for s, e in cols]
    return {'columns': columns, 'rows': cleaned}


# ---------- fetching ----------

def _pick(names, suffix):
    return next((n for n in names if n.endswith(suffix)), None)


async def load(ctx, symbol, period='annual'):
    co = await sec.company(ctx, symbol)
    cik = co['cik']
    forms = ('10-K', '10-K/A') if period == 'annual' else ('10-Q', '10-K')
    filings = sec.recent_filings(await sec.submissions(ctx, cik), forms=forms, limit=4)
    if not filings:
        raise EngineError(f'{symbol} has no {"10-K" if period == "annual" else "10-Q"} on file with the SEC.')
    f = filings[0]
    folder = f'https://www.sec.gov/Archives/edgar/data/{cik}/{f["accession"].replace("-", "")}/'

    async def parse():
        index = (await sec.sec_get(ctx, folder + 'index.json')).json()
        names = [i.get('name', '') for i in index.get('directory', {}).get('item', [])]
        instance, lab = segments.pick_files(names)
        pre, xsd = _pick(names, '_pre.xml'), _pick(names, '.xsd')
        if not (instance and pre and xsd):
            raise EngineError('This filing has no XBRL statement layout to read.')
        contexts, facts = segments.parse_instance((await sec.sec_get(ctx, folder + instance)).text)
        presentation = parse_presentation((await sec.sec_get(ctx, folder + pre)).text)
        roles = parse_roles((await sec.sec_get(ctx, folder + xsd)).text)
        labels = parse_all_labels((await sec.sec_get(ctx, folder + lab)).text) if lab else {}
        kind = 'annual' if f['form'].startswith('10-K') else 'quarter'
        items = catalogue(roles, presentation)
        built = {it['role']: build_statement(it['role'], presentation, contexts, facts, labels, kind) for it in items}
        return {'items': [it for it in items if built[it['role']]['rows']], 'statements': built}
    data = await ctx.cached(('asreported', f['accession']), 30 * 86400, parse, persist=True)
    return co, f, cik, data


@handler('research.asreported')
async def asreported(ctx, msg):
    symbol = str(msg.get('symbol') or '').strip().upper()
    if not symbol:
        raise EngineError('Give a ticker.')
    period = 'quarter' if msg.get('period') == 'quarter' else 'annual'
    co, f, cik, data = await load(ctx, symbol, period)
    items = data['items']
    if not items:
        raise EngineError(f'{symbol}’s latest filing has no statements the platform can lay out.')
    role = msg.get('role') if msg.get('role') in data['statements'] else items[0]['role']
    chosen = next(i for i in items if i['role'] == role)
    return {'symbol': symbol, 'company': co.get('name', symbol), 'form': f['form'], 'filed': f['filed'],
            'source': sec.filing_url(cik, f['accession'], f['document']), 'items': items,
            'chosen': {**chosen, **data['statements'][role]}}
