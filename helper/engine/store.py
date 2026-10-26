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
COLLECTIONS = {'portfolios', 'clients', 'branding', 'alt_holdings', 'alerts'}
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
#: statement re-import rebuilds the holdings); a null value clears it.
OWNER_FIELDS = ('purchaseDate', 'dividends', 'dividendsSource', 'dividendsAsOf', 'rocPct', 'rocYear')


def track_holdings(old, new, today=None):
    """A portfolio about to be saved, with each share holding's `seen` log carried forward from the saved version:
    [{date, shares}], a new entry the first time the platform sees the holding and whenever its share count changes.
    It lets dividends be estimated from the day the platform first saw a position (Webull and most exports give no
    purchase dates). Owner fields (OWNER_FIELDS) are carried forward too. Pure apart from `today`."""
    today = (today or dt.date.today()).isoformat()
    if (new.get('mode') or 'weight') != 'shares' or not isinstance(new.get('holdings'), list):
        return new
    before = {}
    for x in (old or {}).get('holdings') or []:
        if isinstance(x, dict) and (x.get('kind') or 'security') == 'security' and str(x.get('symbol') or '').strip():
            before.setdefault(str(x['symbol']).strip().upper(), x)
    out = []
    for x in new['holdings']:
        if not isinstance(x, dict) or (x.get('kind') or 'security') != 'security' or not str(x.get('symbol') or '').strip():
            out.append(x)
            continue
        prev = before.get(str(x['symbol']).strip().upper()) or {}
        x = dict(x)
        for key in OWNER_FIELDS:
            if key not in x and prev.get(key) is not None:
                x[key] = prev[key]
            elif key in x and x[key] is None:
                del x[key]
        log = [e for e in (x.get('seen') if isinstance(x.get('seen'), list) else prev.get('seen') or []) if isinstance(e, dict) and e.get('date')]
        try:
            shares = float(x.get('shares') or 0)
        except (TypeError, ValueError):
            shares = 0.0
        if shares > 0 and (not log or abs(float(log[-1].get('shares') or 0) - shares) > 1e-9):
            log = [e for e in log if e['date'] != today] + [{'date': today, 'shares': shares}]
        if log:
            x['seen'] = log
        out.append(x)
    return {**new, 'holdings': out}


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
