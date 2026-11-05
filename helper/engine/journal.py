"""
The trading journal: the owner's own trades, kept in ~/.trading-platform/platform.db (never the browser).

Every trade is built from fills (one fill = one execution or one filled order: time, price, quantity, fees). Fills come
from Webull's order history (read-only), from broker CSV/Excel exports (parsed in the browser by src/journal/importers.ts)
and from manual entry. A fill already saved (same order id, or the same day, symbol, side, quantity and price from any
source) is never saved twice. Fills are grouped into round-trip trades first in, first out per account and symbol:
scale-ins, partial exits, shorts and futures (with their contract multiplier). What the owner writes on a trade (notes,
tags, emotions, rating, plan, screenshots) is kept when the trades are rebuilt.

The journal reads; it never sends orders. The AI coach only reads the owner's own journal.
"""
import asyncio
import base64
import datetime as dt
import hashlib
import json
import re
import time
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo

from . import store
from .core import EngineError, handler

NEW_YORK = ZoneInfo('America/New_York')
DIR = Path.home() / '.trading-platform' / 'journal'
#: What the owner writes on a trade: carried over whenever the trades are rebuilt from fills.
OWNER_KEYS = ('strategy', 'playbookId', 'rulesFollowed', 'setup', 'plan', 'tags', 'emotionsBefore', 'emotionsAfter', 'rating', 'notes',
              'screenshots', 'mistakes', 'followedStop', 'mae', 'mfe', 'maePrice', 'mfePrice', 'atr', 'excursionSource', 'review')
#: Futures contract sizes ($ per point) by root, for exports that don't carry the multiplier (CME contract specs).
FUTURES_MULTIPLIERS = {'ES': 50, 'MES': 5, 'NQ': 20, 'MNQ': 2, 'YM': 5, 'MYM': 0.5, 'RTY': 50, 'M2K': 5, 'CL': 1000, 'MCL': 100,
                       'NG': 10000, 'GC': 100, 'MGC': 10, 'SI': 5000, 'HG': 25000, 'ZB': 1000, 'ZN': 1000, 'ZF': 1000, 'ZT': 2000,
                       '6E': 125000, '6J': 12500000, 'BTC': 5, 'MBT': 0.1, 'ETH': 50}
CONTRACT = re.compile(r'^/?([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{1,2})$')
#: $ per million tokens (input, output): the same figures as the prospect AI analyst.
PRICES = {'claude-opus-5-5': (4.0, 20.0), 'claude-sonnet-5-5': (2.0, 10.0), 'claude-haiku-5-5': (0.10, 0.50)}
MAX_SCREENSHOT = 8 * 2**20
WEBULL_WINDOW_NOTE = ("Webull's API keeps about {days} days of order history. For older trades, export your history from Webull "
                      "(or any broker) as CSV and use Import file.")


# ---------- storage ----------

def db():
    c = store.db()
    if not getattr(db, 'ready', None) is c:
        c.executescript('''
            CREATE TABLE IF NOT EXISTS journal_fills (fill_id TEXT PRIMARY KEY, dup_key TEXT, source TEXT, account TEXT, symbol TEXT, time REAL, data TEXT);
            CREATE INDEX IF NOT EXISTS journal_fills_dup ON journal_fills (dup_key);
            CREATE TABLE IF NOT EXISTS journal_trades (id TEXT PRIMARY KEY, symbol TEXT, opened REAL, data TEXT, updated REAL);
            CREATE TABLE IF NOT EXISTS journal_days (day TEXT PRIMARY KEY, data TEXT, updated REAL);
            CREATE TABLE IF NOT EXISTS journal_playbooks (id TEXT PRIMARY KEY, data TEXT, updated REAL);
            CREATE TABLE IF NOT EXISTS journal_plans (order_id TEXT PRIMARY KEY, data TEXT, updated REAL);
            CREATE TABLE IF NOT EXISTS journal_imports (id TEXT PRIMARY KEY, at REAL, data TEXT);
        ''')
        c.commit()
        db.ready = c
    return c


def _rows(sql, args=()):
    return [json.loads(r[0]) for r in db().execute(sql, args).fetchall()]


def all_fills():
    return _rows('SELECT data FROM journal_fills ORDER BY time, fill_id')


def all_trades():
    return _rows('SELECT data FROM journal_trades ORDER BY opened DESC')


def plans():
    return {r['orderId']: r for r in _rows('SELECT data FROM journal_plans')}


# ---------- fills ----------

def _num(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if v == v and abs(v) != float('inf') else None


def futures_root(symbol):
    m = CONTRACT.match(symbol or '')
    if not m:
        return None
    root = m.group(1)
    # the longest known root wins (MESZ6 -> MES, not ME)
    for size in range(len(symbol.lstrip('/')), 0, -1):
        cand = symbol.lstrip('/')[:size]
        if cand in FUTURES_MULTIPLIERS:
            return cand
    return root


def ny_day(t):
    return dt.datetime.fromtimestamp(t, NEW_YORK).date().isoformat()


def clean_fill(f, source):
    """A fill checked before saving; raises EngineError with a plain reason. Fields: symbol, side BUY/SELL, qty > 0,
    price >= 0, time (unix s), fees >= 0, account, orderId, open ('short' for an explicit sell short), assetClass,
    multiplier, preJournal."""
    if not isinstance(f, dict):
        raise EngineError('A fill was not readable.')
    symbol = str(f.get('symbol') or '').strip().upper()
    side = str(f.get('side') or '').strip().upper()
    side = {'B': 'BUY', 'S': 'SELL', 'SHORT': 'SELL', 'SELL_SHORT': 'SELL', 'BUY_TO_COVER': 'BUY', 'COVER': 'BUY'}.get(side, side)
    qty, price, when = _num(f.get('qty')), _num(f.get('price')), _num(f.get('time'))
    if not symbol or side not in ('BUY', 'SELL') or not qty or qty <= 0 or price is None or price < 0 or not when:
        raise EngineError(f"A {symbol or 'fill'} row is missing its side, quantity, price or time.")
    root = futures_root(symbol)
    asset = f.get('assetClass') or ('futures' if root and (symbol.startswith('/') or root in FUTURES_MULTIPLIERS) else 'stock')
    mult = _num(f.get('multiplier')) or (FUTURES_MULTIPLIERS.get(root or '', 1) if asset == 'futures' else 100 if asset == 'option' else 1)
    opening = 'short' if str(f.get('side') or '').upper() in ('SHORT', 'SELL_SHORT') or f.get('open') == 'short' else None
    out = {'symbol': symbol.lstrip('/') if asset == 'futures' else symbol, 'side': side, 'qty': qty, 'price': price, 'time': when,
           'fees': max(0.0, _num(f.get('fees')) or 0.0), 'account': str(f.get('account') or 'Default')[:80], 'orderId': str(f.get('orderId') or '')[:80],
           'assetClass': asset, 'multiplier': mult, 'source': source, 'open': opening, 'env': f.get('env') or None,
           'preJournal': bool(f.get('preJournal'))}
    return out


def dup_base(f):
    """Day (New York), symbol, side, quantity and price: the same fill seen through two sources."""
    return f"{ny_day(f['time'])}|{f['symbol']}|{f['side']}|{f['qty']:g}|{f['price']:.4f}"


def keyed(fills, source):
    """(fill_id, dup_key, fill) for a batch. Identical rows in one batch are told apart by their count (#1, #2), so two
    real identical fills on a day both save, while the same two seen again from another source don't."""
    seen = {}
    out = []
    for f in fills:
        base = dup_base(f)
        seen[base] = seen.get(base, 0) + 1
        dup = f'{base}#{seen[base]}'
        fid = f"{source.split(':')[0]}:{f['orderId']}:{f['side']}" if f['orderId'] else f"{source}:{hashlib.sha1(dup.encode()).hexdigest()[:16]}"
        out.append((fid, dup, f))
    return out


def save_fills(fills, source):
    """Saves new fills; returns (added, skipped as duplicates)."""
    c = db()
    added = skipped = 0
    for fid, dup, f in keyed(fills, source):
        if c.execute('SELECT 1 FROM journal_fills WHERE fill_id = ? OR dup_key = ?', (fid, dup)).fetchone():
            skipped += 1
            continue
        f = {**f, 'fillId': fid}
        c.execute('INSERT INTO journal_fills VALUES (?, ?, ?, ?, ?, ?, ?)', (fid, dup, source, f['account'], f['symbol'], f['time'], json.dumps(f)))
        added += 1
    c.commit()
    return added, skipped


# ---------- grouping fills into trades ----------

def _portion(f, qty):
    share = qty / f['qty'] if f['qty'] else 0
    return {'time': f['time'], 'price': f['price'], 'qty': qty, 'fees': f['fees'] * share, 'fillId': f.get('fillId', ''), 'orderId': f.get('orderId', ''),
            'preJournal': f.get('preJournal', False)}


def _tid(fill_id, n=0):
    return 't' + hashlib.sha1(f'{fill_id}|{n}'.encode()).hexdigest()[:14]


def group_fills(fills):
    """Round-trip trades from fills, first in first out per account and symbol. A trade opens when the position leaves
    zero and closes when it returns to zero; buys while long (or sells while short) scale in, the other side scales out.
    A fill bigger than the position closes the trade and opens one the other way with the rest (futures, or a stock
    sell marked short). A stock sell with nothing held (shares bought before the journal's history) becomes a closed
    trade with an unknown cost (openedBefore, costUnknown), left out of the statistics. Pure."""
    trades = []
    open_by = {}
    for f in sorted((x for x in fills if not x.get('ignored')), key=lambda x: (x['time'], x.get('fillId', ''))):
        key = (f['account'], f['symbol'])
        t = open_by.get(key)
        signed = 1 if f['side'] == 'BUY' else -1
        left = f['qty']
        if t:
            pos = t['_pos']
            if (pos > 0) == (signed > 0):
                t['entries'].append(_portion(f, left))
                t['_pos'] += signed * left
                continue
            close = min(left, abs(pos))
            t['exits'].append(_portion(f, close))
            t['_pos'] += signed * close
            left -= close
            if abs(t['_pos']) < 1e-9:
                t['status'], t['closedAt'] = 'closed', f['time']
                del open_by[key]
            if left <= 1e-9:
                continue
        if f['side'] == 'SELL' and f['assetClass'] == 'stock' and f.get('open') != 'short' and not f.get('preJournal'):
            trades.append(_trade(f, 'long', [], [_portion(f, left)], status='closed', closedAt=f['time'], openedBefore=True, costUnknown=True,
                                 tid=_tid(f.get('fillId', ''), 'x')))
            continue
        t = _trade(f, 'long' if signed > 0 else 'short', [_portion(f, left)], [], tid=_tid(f.get('fillId', ''), left != f['qty']))
        t['_pos'] = signed * left
        t['openedBefore'] = bool(f.get('preJournal'))
        open_by[key] = t
        trades.append(t)
    for t in trades:
        t['openQty'] = abs(t.pop('_pos', 0))
    return trades


def _trade(f, side, entries, exits, status='open', closedAt=None, openedBefore=False, costUnknown=False, tid=None):
    return {'id': tid, 'symbol': f['symbol'], 'account': f['account'], 'env': f.get('env'), 'side': side, 'assetClass': f['assetClass'],
            'multiplier': f['multiplier'], 'entries': entries, 'exits': exits, 'status': status, 'openedAt': f['time'], 'closedAt': closedAt,
            'openedBefore': openedBefore, 'costUnknown': costUnknown, 'source': f['source'], '_pos': 0}


def realized(t):
    """Realized P&L after fees, first in first out (None when the cost is unknown)."""
    if t.get('costUnknown'):
        return None
    lots = [[e['qty'], e['price']] for e in t['entries']]
    sign = 1 if t['side'] == 'long' else -1
    gross = 0.0
    for x in t['exits']:
        q = x['qty']
        while q > 1e-12 and lots:
            take = min(q, lots[0][0])
            gross += sign * (x['price'] - lots[0][1]) * take
            lots[0][0] -= take
            q -= take
            if lots[0][0] <= 1e-12:
                lots.pop(0)
    fees = sum(e['fees'] for e in t['entries']) + sum(x['fees'] for x in t['exits'])
    return gross * t['multiplier'] - fees


def r_multiple(t):
    """Net P&L divided by the planned risk (entry to the planned stop, times the size). None without a stop."""
    stop = _num((t.get('plan') or {}).get('stop'))
    pnl = realized(t)
    qty = sum(e['qty'] for e in t['entries'])
    if stop is None or pnl is None or not qty:
        return None
    avg = sum(e['qty'] * e['price'] for e in t['entries']) / qty
    risk = abs(avg - stop) * qty * t['multiplier']
    return pnl / risk if risk > 0 else None


def attach_plans(trades, plan_map):
    """A trade whose first entry came from an order placed on the Trade page carries that order's plan."""
    for t in trades:
        ids = [e.get('orderId') for e in t['entries'] if e.get('orderId')]
        hit = next((plan_map[i] for i in ids if i in plan_map), None)
        if hit:
            t['viaPlatform'] = True
            if not t.get('plan') and any(hit.get(k) is not None for k in ('stop', 'target')):
                t['plan'] = {k: hit.get(k) for k in ('stop', 'target', 'setup', 'setupId', 'exitBy', 'riskPct') if hit.get(k) is not None}
            if not t.get('strategy') and hit.get('strategy'):
                t['strategy'] = hit['strategy']
    return trades


def rebuild():
    """Regroups every fill into trades, keeping what the owner wrote on each (matched by trade id, else by the trade's
    first fill)."""
    c = db()
    old = all_trades()
    by_id = {t['id']: t for t in old}
    by_fill = {(t.get('entries') or t.get('exits') or [{}])[0].get('fillId'): t for t in old}
    trades = attach_plans(group_fills(all_fills()), plans())
    now = time.time()
    c.execute('DELETE FROM journal_trades')
    for t in trades:
        prev = by_id.get(t['id']) or by_fill.get((t['entries'] or t['exits'])[0].get('fillId'))
        if prev:
            for k in OWNER_KEYS:
                if prev.get(k) not in (None, '', []):
                    t[k] = prev[k]
        t['pnl'] = realized(t)
        t['r'] = r_multiple(t)
        c.execute('INSERT INTO journal_trades VALUES (?, ?, ?, ?, ?)', (t['id'], t['symbol'], t['openedAt'], json.dumps(t), now))
    c.commit()
    return trades


def log_import(source, added, skipped, note='', extra=None):
    entry = {'id': uuid.uuid4().hex[:12], 'at': time.time(), 'source': source, 'added': added, 'skipped': skipped, 'note': note, **(extra or {})}
    db().execute('INSERT INTO journal_imports VALUES (?, ?, ?)', (entry['id'], entry['at'], json.dumps(entry)))
    db().commit()
    return entry


def span(trades):
    times = [t['openedAt'] for t in trades if not t.get('openedBefore')] or [t['openedAt'] for t in trades]
    return (ny_day(min(times)), ny_day(max(t.get('closedAt') or t['openedAt'] for t in trades))) if times else (None, None)


def imported_message(trades, prefix='Imported'):
    first, last = span(trades)
    n = len(trades)
    return f'{prefix} {n} trade{"s" if n != 1 else ""}' + (f' from {first} to {last}.' if first else '.')


# ---------- requests: reading and writing ----------

@handler('journal.list')
async def list_trades(ctx, msg):
    """Every trade, the import log and the playbooks."""
    return {'trades': all_trades(), 'imports': _rows('SELECT data FROM journal_imports ORDER BY at DESC LIMIT 50'),
            'playbooks': _rows('SELECT data FROM journal_playbooks ORDER BY updated DESC'), 'fills': db().execute('SELECT COUNT(*) FROM journal_fills').fetchone()[0]}


def _trade_doc(trade_id):
    row = db().execute('SELECT data FROM journal_trades WHERE id = ?', (str(trade_id or ''),)).fetchone()
    if not row:
        raise EngineError('That trade is no longer in the journal (it may have been rebuilt). Reload the journal.')
    return json.loads(row[0])


def _put(t):
    t['pnl'] = realized(t)
    t['r'] = r_multiple(t)
    db().execute('UPDATE journal_trades SET data = ?, updated = ? WHERE id = ?', (json.dumps(t), time.time(), t['id']))
    db().commit()
    return t


def clean_notes(changes):
    """The owner's fields from a save, checked: unknown keys are refused, text is capped."""
    out = {}
    for k, v in (changes or {}).items():
        if k not in OWNER_KEYS or k == 'screenshots':
            raise EngineError(f'"{k}" can\'t be changed on a trade.')
        if k in ('tags', 'emotionsBefore', 'emotionsAfter', 'mistakes'):
            v = [str(x).strip()[:40] for x in (v or []) if str(x).strip()][:30]
        elif k == 'rating':
            v = None if v in (None, '') else max(0, min(5, int(v)))
        elif k in ('notes', 'strategy', 'playbookId', 'review', 'excursionSource'):
            v = str(v or '')[:20000]
        elif k == 'plan' and v is not None:
            v = {kk: (_num(vv) if kk in ('stop', 'target', 'riskPct') else str(vv)[:200]) for kk, vv in dict(v).items()
                 if kk in ('stop', 'target', 'riskPct', 'setup', 'setupId', 'exitBy', 'thesis')}
        elif k in ('mae', 'mfe', 'maePrice', 'mfePrice', 'atr'):
            v = _num(v)
        out[k] = v
    return out


@handler('journal.save_trade')
async def save_trade(ctx, msg):
    t = _trade_doc(msg.get('tradeId'))
    t.update(clean_notes(msg.get('changes')))
    return {'trade': _put(t)}


@handler('journal.bulk_tag')
async def bulk_tag(ctx, msg):
    add = clean_notes({'tags': msg.get('add') or []})['tags']
    remove = set(clean_notes({'tags': msg.get('remove') or []})['tags'])
    n = 0
    for tid in msg.get('tradeIds') or []:
        t = _trade_doc(tid)
        t['tags'] = [x for x in dict.fromkeys([*(t.get('tags') or []), *add]) if x not in remove]
        _put(t)
        n += 1
    return {'changed': n}


@handler('journal.delete_trade')
async def delete_trade(ctx, msg):
    """Removes a trade: its fills are kept as ignored, so importing the same history again doesn't bring it back."""
    t = _trade_doc(msg.get('tradeId'))
    ids = [p['fillId'] for p in t['entries'] + t['exits'] if p.get('fillId')]
    c = db()
    for fid in ids:
        row = c.execute('SELECT data FROM journal_fills WHERE fill_id = ?', (fid,)).fetchone()
        if row:
            f = json.loads(row[0])
            if f['source'] == 'manual':
                c.execute('DELETE FROM journal_fills WHERE fill_id = ?', (fid,))
            else:
                c.execute('UPDATE journal_fills SET data = ? WHERE fill_id = ?', (json.dumps({**f, 'ignored': True}), fid))
    c.commit()
    rebuild()
    return {'deleted': t['id']}


# ---------- imports ----------

def import_batch(raw, source, note='', extra=None):
    fills, problems = [], []
    for f in raw or []:
        try:
            fills.append(clean_fill(f, source))
        except EngineError as err:
            problems.append(str(err))
    added, skipped = save_fills(fills, source)
    trades = rebuild()
    mine = [t for t in trades if t['source'] == source] or trades
    entry = log_import(source, added, skipped, note, {**(extra or {}), 'problems': problems[:20], 'unreadable': len(problems)})
    return {'added': added, 'skipped': skipped, 'unreadable': len(problems), 'problems': problems[:20], 'trades': len(trades),
            'message': f"{imported_message(mine)} {added} new fill{'s' if added != 1 else ''}, {skipped} already in the journal"
                       + (f', {len(problems)} rows not readable' if problems else '') + '.', 'import': entry}


@handler('journal.import_fills')
async def import_fills(ctx, msg):
    """Fills from a broker export (parsed and previewed in the browser) or typed in by hand."""
    source = str(msg.get('source') or 'csv')
    if not re.fullmatch(r'(csv:[a-z0-9_]+|manual)', source):
        raise EngineError('Unknown import source.')
    fills = msg.get('fills')
    if not isinstance(fills, list) or not fills:
        raise EngineError('There were no fills to import.')
    if len(fills) > 50000:
        raise EngineError('That file has more than 50,000 fills; split it into years.')
    return import_batch(fills, source, str(msg.get('fileName') or '')[:120])


def webull_fill(row, account, env):
    side = row['side']
    return {'symbol': row['symbol'], 'side': 'SELL' if side in ('SELL', 'SHORT', 'SELL_SHORT') else 'BUY', 'open': 'short' if side in ('SHORT', 'SELL_SHORT') else None,
            'qty': row['qty'], 'price': row['price'], 'time': row['time'], 'orderId': row['orderId'], 'account': account['label'] + (' (Test)' if env == 'test' else ''),
            'env': env, 'assetClass': 'futures' if account.get('futures') or row.get('type') == 'FUTURES' else 'stock'}


def pre_journal(positions, fills, account, env, now):
    """Positions held from before the earliest imported fill: one opening fill at the broker's average cost for the
    shares the imported fills don't explain (marked preJournal; such trades stay out of the statistics until closed)."""
    out = []
    mine = [f for f in fills if f['account'] == account]
    first = min((f['time'] for f in mine), default=now) - 60
    for p in positions:
        sym = p['symbol'].upper()
        net = sum((1 if f['side'] == 'BUY' else -1) * f['qty'] for f in mine if f['symbol'] == sym and not f.get('preJournal'))
        missing = (p.get('qty') or 0) - net
        if abs(missing) < 1e-9 or p.get('avgCost') is None:
            continue
        out.append({'symbol': sym, 'side': 'BUY' if missing > 0 else 'SELL', 'open': 'short' if missing < 0 else None, 'qty': abs(missing),
                    'price': p['avgCost'], 'time': first, 'account': account, 'env': env, 'preJournal': True, 'orderId': f'pre-{sym}-{abs(missing):g}',
                    'assetClass': 'futures' if p.get('multiplier') else 'stock', 'multiplier': p.get('multiplier')})
    return out


@handler('journal.import_webull')
async def import_webull(ctx, msg):
    """Backfill from Webull: every account's filled orders as far back as Webull's API allows (read-only, paced by the
    Webull module's gate), plus positions held from before that history. Safe to run again: nothing is doubled."""
    from . import webull
    emit = msg.get('_emit') or (lambda e: asyncio.sleep(0))
    if not webull.available():
        raise EngineError(webull.NO_KEYS)
    env = webull.env()
    total_added = total_skipped = no_price = 0
    windows, notes = [], []
    for a in await webull.accounts(ctx):
        if not (a['stocks'] or a.get('futures')):
            continue
        await emit({'type': 'status', 'text': f"Reading {a['label']} order history…"})
        try:
            hist = await webull.order_history(ctx, a['id'])
        except EngineError as err:
            notes.append(f"{a['label']}: {err}")
            continue
        windows.append(hist['days'])
        rows = [r for r in hist['rows'] if r['status'] in ('FILLED', 'PARTIAL_FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'CANCELED', '')]
        good = [r for r in rows if r['price'] is not None and r['time']]
        no_price += len(rows) - len(good)
        if not hist['complete']:
            notes.append(f"{a['label']}: stopped after {webull.HISTORY_PAGES} pages; run the import again for the rest.")
        fills = [clean_fill(webull_fill(r, a, env), 'webull') for r in good]
        added, skipped = save_fills(fills, 'webull')
        total_added, total_skipped = total_added + added, total_skipped + skipped
        try:
            pos = await (webull.futures_positions(ctx, a['id']) if a.get('futures') else webull.positions(ctx, a['id']))
        except EngineError as err:
            notes.append(f"{a['label']}: positions not read ({err}), so holdings from before the history aren't added.")
            continue
        label = a['label'] + (' (Test)' if env == 'test' else '')
        stored = [f for f in all_fills() if f['account'] == label]
        db().execute("DELETE FROM journal_fills WHERE account = ? AND fill_id LIKE 'webull:pre-%'", (label,))
        db().commit()
        stored = [f for f in stored if not f.get('preJournal')]
        pre = [clean_fill(p, 'webull') for p in pre_journal([p for p in pos if p.get('type', 'EQUITY') in ('EQUITY', 'STOCK', 'ETF', 'FUTURES', 'UNKNOWN')], stored, label, env, time.time())]
        save_fills(pre, 'webull')
    trades = rebuild()
    mine = [t for t in trades if t['source'] == 'webull']
    days = min(windows) if windows else None
    window_note = WEBULL_WINDOW_NOTE.format(days=days) if days else ''
    if no_price:
        notes.append(f'{no_price} filled order{"s" if no_price != 1 else ""} came without a fill price or time and were skipped.')
    message = imported_message(mine) + (f' {total_added} new, {total_skipped} already in the journal.' if windows else '')
    entry = log_import('webull', total_added, total_skipped, ' '.join(notes), {'days': days, 'env': env})
    return {'message': message, 'windowNote': window_note, 'notes': notes, 'added': total_added, 'skipped': total_skipped, 'days': days,
            'trades': len(mine), 'import': entry}


ORDER_TEXT = re.compile(r'^(Buy|Sell) ([\d.]+) ([A-Z][A-Z0-9.]*)\b')


def read_orders_log(lines):
    """Orders placed through the Trade page (orders.log lines with result 'placed'): {orderId: {symbol, side, qty, time,
    env, summary}}. Futures lines carry the symbol; stock lines are read from the summary ("Buy 3 AAPL at ...")."""
    out = {}
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict) or e.get('action') != 'place' or e.get('result') != 'placed' or not e.get('orderId'):
            continue
        m = ORDER_TEXT.match(str(e.get('order') or ''))
        out[str(e['orderId'])] = {'orderId': str(e['orderId']), 'symbol': e.get('symbol') or (m.group(3) if m else None),
                                  'side': e.get('side') or (m.group(1).upper() if m else None), 'qty': float(m.group(2)) if m else None,
                                  'time': e.get('time'), 'env': e.get('env'), 'summary': e.get('order'), 'placed': True}
    return out


@handler('journal.import_orders_log')
async def import_orders_log(ctx, msg):
    """Tags trades that came from orders placed on the Trade page (from ~/.trading-platform/orders.log)."""
    from . import webull
    try:
        lines = webull.ORDERS_LOG.read_text(encoding='utf-8').splitlines()
    except FileNotFoundError:
        lines = []
    except (OSError, UnicodeDecodeError) as err:
        raise EngineError(f'The order log could not be read: {err}') from err
    found = read_orders_log(lines)
    known = plans()
    c = db()
    for oid, row in found.items():
        c.execute('INSERT OR REPLACE INTO journal_plans VALUES (?, ?, ?)', (oid, json.dumps({**row, **known.get(oid, {})}), time.time()))
    c.commit()
    trades = rebuild()
    tagged = sum(1 for t in trades if t.get('viaPlatform'))
    log_import('orders.log', len(found), 0, f'{tagged} trades matched')
    return {'orders': len(found), 'tagged': tagged, 'message': f'{len(found)} orders from the Trade page; {tagged} journal trades came from them.'}


@handler('journal.plan')
async def save_plan(ctx, msg):
    """The plan behind an order placed on the Trade page (stop, target, setup), kept by its order id."""
    oid = str(msg.get('orderId') or '')
    if not oid:
        raise EngineError('The order has no id.')
    plan = {'orderId': oid, 'symbol': str(msg.get('symbol') or '').upper()[:12], 'side': str(msg.get('side') or '')[:4], 'stop': _num(msg.get('stop')),
            'target': _num(msg.get('target')), 'setup': str(msg.get('setup') or '')[:200], 'strategy': str(msg.get('strategy') or '')[:80],
            'exitBy': str(msg.get('exitBy') or '')[:10], 'riskPct': _num(msg.get('riskPct')), 'time': time.time(), 'placed': True}
    db().execute('INSERT OR REPLACE INTO journal_plans VALUES (?, ?, ?)', (oid, json.dumps(plan), time.time()))
    db().commit()
    return {'saved': oid}


# ---------- daily journal and playbooks ----------

DAY = re.compile(r'^\d{4}-\d\d-\d\d$')


@handler('journal.days')
async def days(ctx, msg):
    return {'days': {r['day']: r for r in _rows('SELECT data FROM journal_days ORDER BY day DESC')}}


@handler('journal.day_save')
async def day_save(ctx, msg):
    day = str(msg.get('day') or '')
    if not DAY.match(day):
        raise EngineError('Pick a date.')
    doc = msg.get('doc') if isinstance(msg.get('doc'), dict) else {}
    clean = {'day': day, **{k: str(doc.get(k) or '')[:20000] for k in ('plan', 'review', 'lessons')}, 'mood': max(0, min(5, int(_num(doc.get('mood')) or 0))),
             'checklist': [bool(x) for x in (doc.get('checklist') or [])][:20]}
    db().execute('INSERT OR REPLACE INTO journal_days VALUES (?, ?, ?)', (day, json.dumps(clean), time.time()))
    db().commit()
    return {'day': clean}


@handler('journal.playbook_save')
async def playbook_save(ctx, msg):
    doc = msg.get('playbook') if isinstance(msg.get('playbook'), dict) else {}
    name = str(doc.get('name') or '').strip()[:80]
    if not name:
        raise EngineError('Give the playbook a name.')
    pid = str(doc.get('pbId') or '') or uuid.uuid4().hex[:10]
    clean = {'pbId': pid, 'name': name, 'description': str(doc.get('description') or '')[:4000],
             'rules': [str(r).strip()[:200] for r in (doc.get('rules') or []) if str(r).strip()][:30]}
    db().execute('INSERT OR REPLACE INTO journal_playbooks VALUES (?, ?, ?)', (pid, json.dumps(clean), time.time()))
    db().commit()
    return {'playbook': clean}


@handler('journal.playbook_delete')
async def playbook_delete(ctx, msg):
    db().execute('DELETE FROM journal_playbooks WHERE id = ?', (str(msg.get('pbId') or ''),))
    db().commit()
    return {'deleted': True}


# ---------- screenshots (files in ~/.trading-platform/journal/) ----------

KINDS = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}
SHOT_NAME = re.compile(r'^t[0-9a-f]{14}-[0-9a-f]{8}\.(png|jpg|webp|gif)$')


@handler('journal.screenshot_add')
async def screenshot_add(ctx, msg):
    t = _trade_doc(msg.get('tradeId'))
    ext = KINDS.get(str(msg.get('mediaType') or ''))
    if not ext:
        raise EngineError('Screenshots can be PNG, JPEG, WebP or GIF images.')
    try:
        data = base64.b64decode(str(msg.get('data') or ''), validate=True)
    except ValueError as err:
        raise EngineError('That image could not be read.') from err
    if not data or len(data) > MAX_SCREENSHOT:
        raise EngineError('Screenshots can be up to 8 MB.')
    DIR.mkdir(parents=True, exist_ok=True)
    name = f"{t['id']}-{uuid.uuid4().hex[:8]}.{ext}"
    (DIR / name).write_bytes(data)
    t['screenshots'] = [*(t.get('screenshots') or []), name][-20:]
    return {'trade': _put(t), 'name': name}


def _shot_path(name):
    name = str(name or '')
    if not SHOT_NAME.match(name):
        raise EngineError('Unknown screenshot.')
    return DIR / name


@handler('journal.screenshot')
async def screenshot(ctx, msg):
    path = _shot_path(msg.get('name'))
    if not path.exists():
        raise EngineError('That screenshot file is missing.')
    ext = path.suffix[1:]
    media = {v: k for k, v in KINDS.items()}[ext]
    return {'name': path.name, 'mediaType': media, 'data': base64.b64encode(path.read_bytes()).decode()}


@handler('journal.screenshot_delete')
async def screenshot_delete(ctx, msg):
    t = _trade_doc(msg.get('tradeId'))
    path = _shot_path(msg.get('name'))
    t['screenshots'] = [s for s in t.get('screenshots') or [] if s != path.name]
    path.unlink(missing_ok=True)
    return {'trade': _put(t)}


# ---------- the AI coach (reads only; never trades) ----------

def ai_view(t):
    """One trade for the AI: facts only, with its id so the answer can cite it."""
    qty = sum(e['qty'] for e in t['entries'])
    avg = sum(e['qty'] * e['price'] for e in t['entries']) / qty if qty else None
    xq = sum(x['qty'] for x in t['exits'])
    xavg = sum(x['qty'] * x['price'] for x in t['exits']) / xq if xq else None
    return {'tradeId': t['id'], 'symbol': t['symbol'], 'side': t['side'], 'account': t['account'], 'opened': _stamp(t['openedAt']),
            'closed': _stamp(t['closedAt']) if t.get('closedAt') else None, 'status': t['status'], 'qty': qty, 'avgEntry': avg, 'avgExit': xavg,
            'entries': len(t['entries']), 'exits': len(t['exits']), 'netPnl': t.get('pnl'), 'r': t.get('r'), 'plan': t.get('plan'),
            'strategy': t.get('strategy'), 'tags': t.get('tags'), 'emotionsBefore': t.get('emotionsBefore'), 'emotionsAfter': t.get('emotionsAfter'),
            'rating': t.get('rating'), 'mistakes': t.get('mistakes'), 'mae': t.get('mae'), 'mfe': t.get('mfe'),
            'notes': (t.get('notes') or '')[:600], 'openedBeforeJournal': t.get('openedBefore'), 'costUnknown': t.get('costUnknown')}


def _stamp(t):
    return dt.datetime.fromtimestamp(t, NEW_YORK).strftime('%Y-%m-%d %H:%M ET %a')


def summary(trades):
    """Count, wins, net P&L, win rate, profit factor and expectancy over closed trades with a known cost."""
    done = [t for t in trades if t['status'] == 'closed' and t.get('pnl') is not None and not t.get('openedBefore')]
    wins = [t['pnl'] for t in done if t['pnl'] > 0]
    losses = [t['pnl'] for t in done if t['pnl'] < 0]
    n = len(done)
    return {'closedTrades': n, 'wins': len(wins), 'losses': len(losses), 'netPnl': sum(t['pnl'] for t in done),
            'winRate': len(wins) / n if n else None, 'profitFactor': sum(wins) / -sum(losses) if losses else None,
            'expectancy': sum(t['pnl'] for t in done) / n if n else None, 'enoughTrades': n >= 30}


def journal_for_ai(start=None, end=None, symbol=None, limit=150):
    trades = all_trades()
    if symbol:
        trades = [t for t in trades if t['symbol'] == symbol.upper()]
    if start:
        trades = [t for t in trades if ny_day(t['openedAt']) >= start]
    if end:
        trades = [t for t in trades if ny_day(t['openedAt']) <= end]
    return {'summary': summary(trades), 'trades': [ai_view(t) for t in trades[:limit]], 'shown': min(limit, len(trades)), 'total': len(trades),
            'note': 'Fewer than 30 closed trades: any pattern is a hint, not evidence.' if summary(trades)['closedTrades'] < 30 else ''}


COACH_TRADE = """Review this one trade from my journal as a trading coach. Use ONLY the facts in <trade> and <context>; cite \
the trade id and dates; never invent a number. Cover: 1) plan vs execution (entry, stop, target, size, exit vs plan), \
2) mistakes, 3) what went well, 4) one lesson to keep. If a fact is missing (no stop, no notes), say so instead of guessing. \
About 200-300 words, plain language for a beginner. Never suggest placing an order."""
COACH_PERIOD = """Review my trading journal for {period} as a trading coach. Use ONLY the facts in <stats> and <trades>; \
cite trade ids and dates for every pattern; never invent a number. Look for patterns: time of day (e.g. losses after 2pm), \
revenge trades (a trade opened soon after a loss, bigger or worse), emotions vs results, strategies and tags that work or \
don't, holding losers longer than winners, plan adherence. Say how many trades each pattern rests on, and that under 30 \
trades a pattern is only a hint. End with 3 concrete rules to try next period. About 350-500 words. Never suggest placing an order."""


def _cost(model, prompt_chars, out_tokens=1500):
    price = PRICES.get(model, PRICES['claude-opus-5-5'])
    tokens_in = int(prompt_chars / 3.5) + 3000  # + the assistant's instructions
    return {'tokensIn': tokens_in, 'tokensOut': out_tokens, 'costUsd': round((tokens_in * price[0] + out_tokens * price[1]) / 1e6, 3), 'model': model}


@handler('journal.coach')
async def coach(ctx, msg):
    """{mode: 'trade', tradeId} or {mode: 'period', start, end, label, stats}; without run -> the cost estimate only."""
    from . import settings
    mode = msg.get('mode')
    if mode == 'trade':
        t = _trade_doc(msg.get('tradeId'))
        same = [ai_view(x) for x in all_trades() if x['symbol'] == t['symbol'] and x['id'] != t['id']][:10]
        text = f"{COACH_TRADE}\n\n<trade>\n{json.dumps(ai_view(t), default=str)}\n</trade>\n\n<context>\n{json.dumps({'earlierTradesSameSymbol': same, 'context': msg.get('context')}, default=str)[:20000]}\n</context>"
    elif mode == 'period':
        start, end = msg.get('start'), msg.get('end')
        data = journal_for_ai(start, end, limit=300)
        text = (COACH_PERIOD.format(period=str(msg.get('label') or f'{start} to {end}')[:60])
                + f"\n\n<stats>\n{json.dumps(msg.get('stats') or data['summary'], default=str)[:30000]}\n</stats>\n\n<trades>\n{json.dumps(data['trades'], default=str)}\n</trades>")
    else:
        raise EngineError('Unknown review.')
    model = settings.get('model', settings.DEFAULT_MODEL)
    estimate = _cost(model, len(text))
    if not msg.get('run'):
        return {'estimate': estimate}
    from . import ai
    emit = msg.get('_emit') or (lambda e: asyncio.sleep(0))
    messages = [{'role': 'user', 'content': [{'type': 'text', 'text': text}]}]
    answer, _ = await ai.converse(ctx, messages, emit, tools=False)
    conv = uuid.uuid4().hex[:12]
    ai._conversations[conv] = messages  # follow-up questions continue in the assistant
    if mode == 'trade':
        t = _trade_doc(msg.get('tradeId'))
        t['review'] = answer[:20000]
        _put(t)
    return {'text': answer, 'conversation': conv, 'estimate': estimate}
