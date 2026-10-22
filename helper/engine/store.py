"""
Saves portfolios, clients and report branding in a small database file on this computer
(~/.trading-platform/platform.db), so client data never lives in the browser.
"""
import json
import sqlite3
import time
import uuid
from pathlib import Path

from .core import EngineError, handler

DB_PATH = Path.home() / '.trading-platform' / 'platform.db'
COLLECTIONS = {'portfolios', 'clients', 'branding'}

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


def save_doc(collection, doc):
    _check(collection)
    if not isinstance(doc, dict):
        raise EngineError('Nothing to save')
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
    return {'doc': save_doc(str(msg.get('collection')), msg.get('doc'))}


@handler('store.delete')
async def _delete(ctx, msg):
    delete_doc(str(msg.get('collection')), str(msg.get('id')))
    return {'ok': True}
