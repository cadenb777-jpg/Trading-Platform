"""
Saves portfolios, clients and report branding in a small database file on this computer
(~/.trading-platform/platform.db), so client data never lives in the browser.
"""
import datetime as dt
import json
import sqlite3
import time
import uuid
from pathlib import Path

from .core import EngineError, handler

DB_PATH = Path.home() / '.trading-platform' / 'platform.db'
# alt_holdings: your private/alternative investments (e.g. from iCapital statements), entered or imported by you.
# alerts: run by the helper (engine/alerts.py); saved only through alerts.save, which checks them.
COLLECTIONS = {'portfolios', 'clients', 'branding', 'alt_holdings', 'alerts', 'prospect_searches', 'prospect_notes'}
ENGINE_ONLY = {'alerts'}

_db = None


def db():
    global _db
    if _db is None:
        DB_PATH.parent.mkdir(exist_ok=True)
        _db = sqlite3.connect(DB_PATH, check_same_thread=False)
        _db.execute('CREATE TABLE IF NOT EXISTS docs (collection TEXT, id TEXT, data TEXT, updated REAL, PRIMARY KEY (collection, id))')
        _db.commit()
    return _db


def _check(collection):
    if collection not in COLLECTIONS:
        raise EngineError(f'Unknown collection "{collection}"')


def list_docs(collection):
    _check(collection)
    rows = db().execute('SELECT data FROM docs WHERE collection = ? ORDER BY updated DESC', (collection,)).fetchall()
    return [json.loads(r[0]) for r in rows]


def get_doc(collection, doc_id):
    _check(collection)
    row = db().execute('SELECT data FROM docs WHERE collection = ? AND id = ?', (collection, doc_id)).fetchone()
    return json.loads(row[0]) if row else None


#: What the owner typed for a holding (Account page): kept when a save leaves the key out (a Webull sync or a
#: statement re-import rebuilds the holdings); a null value clears it. A statement's dividends never replace a figure
#: the owner typed.
OWNER_FIELDS = ('purchaseDate', 'dividends', 'dividendsSource', 'dividendsAsOf', 'rocPct', 'rocYear')
DIVIDEND_FIELDS = ('dividends', 'dividendsSource', 'dividendsAsOf')


def _iso_day(value, today):
    """A YYYY-MM-DD date that is real and not in the future, else None."""
    try:
        d = dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None
    return d.isoformat() if len(str(value)) == 10 and d <= today else None


def _number(value, low=0.0, high=None):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float('inf'), float('-inf')) or v < low or (high is not None and v > high):
        return None
    return v


def clean_owner_fields(x, today):
    """Owner fields checked before saving: finite amounts >= 0, return of capital 0-1, a 4-digit tax year, ISO dates
    not in the future. Anything else is refused with a plain message (never silently changed)."""
    checks = {
        'purchaseDate': lambda v: _iso_day(v, today),
        'dividendsAsOf': lambda v: _iso_day(v, today),
        'dividends': lambda v: _number(v),
        'rocPct': lambda v: _number(v, 0.0, 1.0),
        'rocYear': lambda v: str(v) if str(v).isdigit() and 1990 <= int(str(v)) <= today.year else None,
        'dividendsSource': lambda v: v if v in ('entered', 'statement') else None,
    }
    for key, check in checks.items():
        if x.get(key) is not None and check(x[key]) is None:
            raise EngineError(f"{x.get('symbol') or 'A holding'}: {key} {x[key]!r} isn't valid (amounts 0 or more, return of capital 0-100%, dates not in the future).")
    return x


def _symbol(x):
    return str(x.get('symbol') or '').strip().upper() if isinstance(x, dict) and (x.get('kind') or 'security') == 'security' else ''


def track_holdings(old, new, today=None):
    """A portfolio about to be saved, with one `seen` log per symbol [{date, shares}] (total shares over every lot of
    that symbol in the account): an entry the first time the platform sees the symbol and whenever its share count
    changes. The log lives on the symbol's first holding and is taken from the saved version (never from the browser),
    so a first-seen date can't move forward; a symbol that leaves the account keeps its log (and owner fields) in
    `seenArchive` and gets it back if it returns. Owner fields (OWNER_FIELDS) are carried forward the same way and
    checked. Lets dividends be estimated from the day the platform first saw a position. Pure apart from `today`."""
    today_d = today or dt.date.today()
    day = today_d.isoformat()
    if (new.get('mode') or 'weight') != 'shares' or not isinstance(new.get('holdings'), list):
        return new
    old = old or {}
    # what the saved version knows per symbol: its log and owner fields (archive first, live holdings win)
    known = {k: dict(v) for k, v in (old.get('seenArchive') or {}).items() if isinstance(v, dict)}
    for x in old.get('holdings') or []:
        sym = _symbol(x)
        if not sym:
            continue
        k = known.setdefault(sym, {})
        if x.get('seen') and not k.get('live'):
            k['seen'] = x['seen']
        for key in OWNER_FIELDS:
            if x.get(key) is not None and (key not in k or not k.get('live')):
                k[key] = x[key]
        k['live'] = True
    totals = {}
    for x in new['holdings']:
        sym = _symbol(x)
        if sym:
            try:
                totals[sym] = totals.get(sym, 0.0) + max(0.0, float(x.get('shares') or 0))
            except (TypeError, ValueError):
                pass
    out, done = [], set()
    for x in new['holdings']:
        sym = _symbol(x)
        if not sym:
            out.append(x)
            continue
        x = {k: v for k, v in x.items() if k != 'seen'}
        if sym in done:  # a second lot: the symbol's first holding carries the log and the owner's fields
            out.append({k: v for k, v in x.items() if k not in OWNER_FIELDS})
            continue
        done.add(sym)
        prev = known.get(sym, {})
        # a statement's dividends never replace a figure the owner typed
        if x.get('dividendsSource') == 'statement' and prev.get('dividendsSource') == 'entered':
            for key in DIVIDEND_FIELDS:
                x.pop(key, None)
        for key in OWNER_FIELDS:
            if key not in x and prev.get(key) is not None:
                x[key] = prev[key]
            elif key in x and x[key] is None:
                del x[key]
        clean_owner_fields(x, today_d)
        log = [dict(e) for e in prev.get('seen') or [] if isinstance(e, dict) and e.get('date')]
        shares = totals.get(sym, 0.0)
        if shares > 0 and (not log or abs(float(log[-1].get('shares') or 0) - shares) > 1e-9):
            log = [e for e in log if e['date'] != day] + [{'date': day, 'shares': shares}]  # one entry per day
        if log:
            x['seen'] = log
        out.append(x)
    archive = {sym: {k: v for k, v in info.items() if k != 'live'} for sym, info in known.items() if sym not in done and (info.get('seen') or any(info.get(k) is not None for k in OWNER_FIELDS))}
    result = {**new, 'holdings': out}
    if archive:
        result['seenArchive'] = archive
    else:
        result.pop('seenArchive', None)
    return result


def save_doc(collection, doc):
    _check(collection)
    if not isinstance(doc, dict):
        raise EngineError('Nothing to save')
    if collection == 'portfolios':
        doc = track_holdings(get_doc(collection, str(doc['id'])) if doc.get('id') else None, doc)
    doc = {**doc, 'id': str(doc.get('id') or uuid.uuid4().hex[:12]), 'updated': time.time()}
    db().execute('INSERT OR REPLACE INTO docs VALUES (?, ?, ?, ?)', (collection, doc['id'], json.dumps(doc), doc['updated']))
    db().commit()
    return doc


def delete_doc(collection, doc_id):
    _check(collection)
    db().execute('DELETE FROM docs WHERE collection = ? AND id = ?', (collection, doc_id))
    db().commit()


@handler('store.list')
async def _list(ctx, msg):
    return {'docs': list_docs(str(msg.get('collection')))}


@handler('store.save')
async def _save(ctx, msg):
    if msg.get('collection') in ENGINE_ONLY:
        raise EngineError('Save alerts with alerts.save')
    return {'doc': save_doc(str(msg.get('collection')), msg.get('doc'))}


@handler('store.delete')
async def _delete(ctx, msg):
    # 'id' is taken by the request id the browser adds to every message.
    delete_doc(str(msg.get('collection')), str(msg.get('docId')))
    return {'ok': True}
