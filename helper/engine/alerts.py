"""
Alerts run by the helper, so they work while the platform's tab is closed (as long as the helper is running).

Kinds: price above/below a level, a % move on the day, a watched setup reaching its entry zone, and "every A and B
setup" from the scanner. They are checked against the quotes the helper already gets (Schwab's stream and the
30-second official quote refresh); alert symbols are simply added to that watch list, so there are no extra Schwab
requests of their own.

Each alert fires once. With "repeat" on it re-arms after price has moved back across the level, and never fires again
within the cool-down. Delivery: ntfy, Telegram (keys in settings.json, never sent to the browser) and a desktop
notification in any open tab. A failed delivery is logged and shown on the alert; it never stops the helper.

Alerts only tell you something. This module never places, changes or cancels orders.
"""
import datetime as dt
import logging
import re
import sys
import time
import urllib.parse

from . import settings, store
from .core import EngineError, background, handler

log = logging.getLogger('engine.alerts')

COLLECTION = 'alerts'
KINDS = ('price', 'move', 'setup', 'setups_ab')
COOLDOWN_SECONDS = 30 * 60
MAX_ALERTS = 200
NTFY_DEFAULT = 'https://ntfy.sh'
TELEGRAM_API = 'https://api.telegram.org'
SYMBOL = re.compile(r'^[A-Z0-9.\-/$^]{1,15}$')
CHASE_LIMIT = 0.25  # matches src/home/entryZone.ts
NEAR_ATR = 0.3


# ---------- Entry zone (a port of src/home/entryZone.ts: the zone only) ----------

def entry_zone(s, price, today=None):
    """Where a setup stands against a live price: forming, waiting, approaching, entry, extended, target, invalid or expired."""
    today = today or dt.date.today().isoformat()
    p = s.get('plan') or {}
    d = 1 if (s.get('direction') or 0) > 0 else -1
    trade = s.get('trade') or None
    entry = trade['entry'] if trade and trade.get('entry') is not None else p.get('trigger')
    stop, target, atr = p.get('stop'), p.get('target'), p.get('atr') or 0
    if s.get('status') == 'forming':
        return 'forming'
    if price is None or entry is None or stop is None:
        return 'waiting'
    risk = abs(entry - stop)

    def beyond(a, b):
        return (a - b) * d

    if beyond(stop, price) >= 0:
        return 'invalid'
    if target is not None and beyond(price, target) >= 0:
        return 'target'
    if not trade and s.get('status') not in ('ready', 'waiting'):
        return 'waiting'
    if not trade and today > str(p.get('validUntil') or '9999'):
        return 'expired'
    past = beyond(price, entry)
    if p.get('entryType') == 'open' and not trade:
        return 'entry'
    if past < 0:
        return 'approaching' if -past <= NEAR_ATR * atr else 'waiting'
    return 'entry' if past <= CHASE_LIMIT * risk else 'extended'


def setup_id(s):
    """Same id as the Setups page (setupsPage.ts idOf)."""
    return f"{s.get('horizon') or 'swing'}:{s.get('strategy')}:{s.get('symbol')}:{s.get('signalDate')}"


def slim_setup(s):
    """The parts of a scanner setup an alert needs (saved with the alert, refreshed from newer scans)."""
    if not isinstance(s, dict):
        raise EngineError('Missing setup')
    plan = s.get('plan') or {}
    trade = s.get('trade') or None
    out = {k: s.get(k) for k in ('symbol', 'strategy', 'strategyName', 'horizon', 'signalDate', 'direction', 'status', 'tier', 'unit')}
    out['plan'] = {k: plan.get(k) for k in ('entryType', 'trigger', 'stop', 'target', 'atr', 'validUntil')}
    if trade and isinstance(trade.get('entry'), (int, float)):
        out['trade'] = {'entry': trade['entry']}
    if not isinstance(out['plan']['trigger'], (int, float)) or not isinstance(out['plan']['stop'], (int, float)):
        raise EngineError('That setup has no entry and stop to watch')
    return out


def _scanner_setups():
    """Every setup in the latest scan (all time frames), or [] before the first scan."""
    mod = sys.modules.get(f'{__package__}.scanner')
    result = getattr(mod, '_state', {}).get('result') if mod else None
    if not isinstance(result, dict):
        return []
    out = []
    for h in (result.get('horizons') or {}).values():
        out.extend(x for x in (h or {}).get('setups') or [] if isinstance(x, dict))
    return out


# ---------- Validation ----------

def _num(v, label, low=None):
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise EngineError(f'{label} must be a number')
    if x != x or (low is not None and x <= low):
        raise EngineError(f'{label} must be above {low}')
    return x


def clean_alert(doc, existing=None):
    """Checks an alert from the browser and keeps only the known fields."""
    if not isinstance(doc, dict):
        raise EngineError('Nothing to save')
    kind = doc.get('kind') or 'price'
    if kind not in KINDS:
        raise EngineError('Unknown alert type')
    out = {'kind': kind, 'note': str(doc.get('note') or '')[:200], 'repeat': bool(doc.get('repeat')), 'active': doc.get('active') is not False}
    if doc.get('id'):
        out['id'] = str(doc['id'])[:40]
    if kind in ('price', 'move'):
        symbol = str(doc.get('symbol') or '').strip().upper()
        if not SYMBOL.match(symbol):
            raise EngineError(f'Invalid symbol "{symbol}"')
        out['symbol'] = symbol
    if kind == 'price':
        if doc.get('condition') not in ('above', 'below'):
            raise EngineError('Choose above or below')
        out['condition'] = doc['condition']
        out['price'] = _num(doc.get('price'), 'The price', 0)
    elif kind == 'move':
        if doc.get('condition') not in ('up', 'down', 'either'):
            raise EngineError('Choose up, down or either way')
        out['condition'] = doc['condition']
        pct = _num(doc.get('pct'), 'The move', 0)
        if pct > 100:
            raise EngineError('The move must be 100% or less')
        out['pct'] = pct
    elif kind == 'setup':
        out['setup'] = slim_setup(doc.get('setup'))
        out['symbol'] = out['setup']['symbol']
        out['setupId'] = setup_id(out['setup'])
    else:
        out['symbol'] = ''
    # Fired state is the helper's own: keep it across edits unless the alert is switched back on.
    keep = existing or {}
    for k in ('created', 'firedAt', 'firedPrice', 'armed', 'firedKeys', 'lastDelivery', 'ended'):
        if k in keep:
            out[k] = keep[k]
    out.setdefault('created', time.time())
    changed_trigger = existing and any(existing.get(k) != out.get(k) for k in ('kind', 'symbol', 'condition', 'price', 'pct', 'setupId'))
    if not existing or changed_trigger or (out['active'] and not keep.get('active', True)):
        out['armed'] = True
        out.pop('ended', None)
    return out


# ---------- Evaluation (pure, tested) ----------

def condition_met(alert, quote):
    last = (quote or {}).get('last')
    if not isinstance(last, (int, float)) or last <= 0:
        return None
    kind = alert['kind']
    if kind == 'price':
        return last >= alert['price'] if alert['condition'] == 'above' else last <= alert['price']
    if kind == 'move':
        prev = quote.get('prevClose')
        if not isinstance(prev, (int, float)) or prev <= 0:
            return None
        change = (last / prev - 1) * 100
        return {'up': change >= alert['pct'], 'down': change <= -alert['pct'], 'either': abs(change) >= alert['pct']}[alert['condition']]
    return None


def _fmt(v):
    return f'${v:,.2f}' if v >= 1 else f'${v:.4f}'


def describe(alert):
    kind = alert['kind']
    if kind == 'price':
        return f"{alert['symbol']} {alert['condition']} {_fmt(alert['price'])}"
    if kind == 'move':
        word = {'up': 'up', 'down': 'down', 'either': 'up or down'}[alert['condition']]
        return f"{alert['symbol']} {word} {alert['pct']:g}% on the day"
    if kind == 'setup':
        s = alert['setup']
        return f"{s['symbol']} {'BUY' if (s.get('direction') or 0) > 0 else 'SELL'} setup reaches its entry"
    return 'Any A or B setup reaches its entry'


def _setup_message(s, price):
    p = s['plan']
    side = 'BUY' if (s.get('direction') or 0) > 0 else 'SELL SHORT'
    entry = (s.get('trade') or {}).get('entry', p['trigger'])
    target = f", target {_fmt(p['target'])}" if p.get('target') is not None else ''
    grade = f" ({s['tier']}-grade)" if s.get('tier') else ''
    return (f"{s['symbol']} {side}{grade}: entry zone now at {_fmt(price)}. Entry {_fmt(entry)}, stop {_fmt(p['stop'])}{target}. "
            f"Check the setup on the Setups page before acting.")


def evaluate(alert, quotes, now, setups=None, today=None):
    """Checks one alert. Returns (events, changed): the messages to send and whether the alert's saved state changed.
    `quotes` maps symbol -> {'last', 'prevClose'}; `setups` is the latest scan's setups (for setup alerts)."""
    if not alert.get('active', True):
        return [], False
    kind = alert['kind']
    cooling = alert.get('firedAt') and now - alert['firedAt'] < COOLDOWN_SECONDS
    if kind in ('price', 'move'):
        met = condition_met(alert, quotes.get(alert['symbol']))
        if met is None:
            return [], False
        armed = alert.get('armed', True)
        if met and armed and not cooling:
            last = quotes[alert['symbol']]['last']
            alert.update(firedAt=now, firedPrice=last, armed=False)
            if not alert.get('repeat'):
                alert['active'], alert['ended'] = False, 'fired'
            extra = f" · {alert['note']}" if alert.get('note') else ''
            return [{'title': f"{alert['symbol']} alert", 'message': f"{describe(alert)} (now {_fmt(last)}){extra}"}], True
        if not met and not armed and alert.get('repeat'):
            alert['armed'] = True  # back across the level: ready to fire again (after the cool-down)
            return [], True
        return [], False
    if kind == 'setup':
        s = alert['setup']
        fresh = next((x for x in setups or [] if setup_id(x) == alert.get('setupId')), None)
        if fresh:
            s = alert['setup'] = slim_setup(fresh)
        q = quotes.get(s['symbol'])
        if not q or not isinstance(q.get('last'), (int, float)):
            return [], False
        zone = entry_zone(s, q['last'], today)
        if zone in ('invalid', 'expired', 'target'):
            alert['active'] = False
            alert['ended'] = {'invalid': 'Stop level hit: the setup failed', 'expired': 'Entry window closed', 'target': 'Price reached the target first'}[zone]
            return [], True
        if zone == 'entry' and alert.get('armed', True) and not cooling:
            alert.update(firedAt=now, firedPrice=q['last'], armed=False)
            if not alert.get('repeat'):
                alert['active'], alert['ended'] = False, 'fired'
            return [{'title': f"{s['symbol']}: entry zone now", 'message': _setup_message(s, q['last'])}], True
        if zone != 'entry' and not alert.get('armed', True) and alert.get('repeat'):
            alert['armed'] = True
            return [], True
        return [], False
    # setups_ab: every A and B setup of the latest scan, each one alerted once.
    events, changed = [], False
    fired = alert.setdefault('firedKeys', {})
    for key in [k for k, at in fired.items() if now - at > 14 * 86400]:
        del fired[key]
        changed = True
    for s in setups or []:
        if s.get('tier') not in ('A', 'B') or s.get('status') == 'forming':
            continue
        key = setup_id(s)
        q = quotes.get(s.get('symbol'))
        if key in fired or not q or not isinstance(q.get('last'), (int, float)):
            continue
        try:
            slim = slim_setup(s)
        except EngineError:
            continue
        if entry_zone(slim, q['last'], today) == 'entry':
            fired[key] = now
            alert['firedAt'], changed = now, True
            events.append({'title': f"{slim['symbol']}: entry zone now", 'message': _setup_message(slim, q['last'])})
    return events, changed


def symbols_for(alerts, setups=None):
    """The symbols whose quotes the active alerts need."""
    out = set()
    for a in alerts:
        if not a.get('active', True):
            continue
        if a['kind'] in ('price', 'move'):
            out.add(a['symbol'])
        elif a['kind'] == 'setup':
            out.add(a['setup']['symbol'])
        elif a['kind'] == 'setups_ab':
            out.update(s['symbol'] for s in setups or [] if s.get('tier') in ('A', 'B') and s.get('status') != 'forming' and s.get('symbol'))
    return {s for s in out if SYMBOL.match(str(s))}


# ---------- Delivery ----------

def _hide(text, secrets):
    text = str(text)
    for s in secrets:
        if s:
            text = text.replace(s, '***')
    return text[:200]


def channels():
    data = settings.load()
    return {'ntfy': bool(data.get('ntfy_topic')), 'telegram': bool(data.get('telegram_token') and data.get('telegram_chat'))}


async def send_ntfy(http, title, message):
    data = settings.load()
    topic, server = data.get('ntfy_topic'), (data.get('ntfy_server') or NTFY_DEFAULT).rstrip('/')
    # Header values must be plain ASCII; the message body can be anything.
    r = await http.post(f'{server}/{urllib.parse.quote(topic)}', content=message.encode('utf-8'),
                        headers={'Title': title.encode('ascii', 'ignore').decode() or 'Alert', 'Tags': 'chart_with_upwards_trend', 'Priority': 'high'})
    if r.status_code >= 300:
        raise RuntimeError(f'answered {r.status_code}')


async def send_telegram(http, title, message):
    data = settings.load()
    r = await http.post(f"{TELEGRAM_API}/bot{data['telegram_token']}/sendMessage", json={'chat_id': data['telegram_chat'], 'text': f'{title}\n{message}'})
    if r.status_code >= 300:
        try:
            why = r.json().get('description') or ''
        except Exception:
            why = ''
        raise RuntimeError(f'answered {r.status_code} {why}'.strip())


async def deliver(http, title, message, push=None):
    """Sends one message on every configured channel. Returns {channel: 'ok' or why it failed}; never raises."""
    data = settings.load()
    secrets = [data.get('ntfy_topic'), data.get('telegram_token'), data.get('telegram_chat')]
    results = {}
    on = channels()
    for name, send in (('ntfy', send_ntfy), ('telegram', send_telegram)):
        if not on[name]:
            continue
        try:
            await send(http, title, message)
            results[name] = 'ok'
        except Exception as err:
            results[name] = _hide(f'{type(err).__name__}: {err}' if not isinstance(err, RuntimeError) else err, secrets)
            log.warning('Alert delivery by %s failed: %s', name, results[name])
    if push:
        try:
            tabs = push({'title': title, 'message': message})
            results['browser'] = f'{tabs} tab{"s" if tabs != 1 else ""}' if tabs else 'no tab open'
        except Exception as err:
            results['browser'] = _hide(err, secrets)
    return results


# ---------- The monitor the helper calls with each batch of quotes ----------

class Monitor:
    def __init__(self):
        self.alerts = None
        self.push = None   # set by the helper: sends a message to open tabs, returns how many
        self.http = None   # the engine's httpx client

    def load(self):
        if self.alerts is None:
            try:
                self.alerts = store.list_docs(COLLECTION)
            except Exception as err:
                log.warning('Could not read alerts: %s', err)
                self.alerts = []
        return self.alerts

    def reload(self):
        self.alerts = None
        return self.load()

    def symbols(self):
        return symbols_for(self.load(), _scanner_setups() if any(a['kind'] == 'setups_ab' for a in self.load()) else None)

    def check(self, quotes, now=None):
        """Evaluates every active alert; sends what fired in the background. Returns the events (for tests)."""
        now = now or time.time()
        alerts = self.load()
        if not alerts:
            return []
        setups = _scanner_setups() if any(a['kind'] in ('setup', 'setups_ab') for a in alerts) else []
        fired = []
        for a in alerts:
            try:
                events, changed = evaluate(a, quotes, now, setups)
            except Exception as err:  # a bad alert must never stop the others
                log.warning('Alert %s could not be checked: %s', a.get('id'), err)
                continue
            if changed and not events:
                store.save_doc(COLLECTION, a)
            for e in events:
                fired.append((a, e))
        for a, e in fired:
            background(self._send(a, e))
        return [e for _, e in fired]

    async def _send(self, alert, event):
        results = await deliver(self.http, event['title'], event['message'], self.push)
        alert['lastDelivery'] = {'at': time.time(), 'results': results, 'message': event['message']}
        try:
            if store.get_doc(COLLECTION, alert['id']) is None:
                return  # deleted while it was being sent
            saved = store.save_doc(COLLECTION, alert)
            alert['updated'] = saved['updated']
        except Exception as err:
            log.warning('Could not save alert state: %s', err)


MONITOR = Monitor()


# ---------- Requests from the browser ----------

def _reply():
    return {'alerts': MONITOR.load(), 'channels': channels()}


@handler('alerts.list')
async def list_alerts(ctx, msg):
    return _reply()


@handler('alerts.save')
async def save_alert(ctx, msg):
    doc = msg.get('alert')
    existing = None
    if isinstance(doc, dict) and doc.get('id'):
        existing = store.get_doc(COLLECTION, str(doc['id']))
    elif len(MONITOR.load()) >= MAX_ALERTS:
        raise EngineError(f'You have {MAX_ALERTS} alerts already. Delete some first.')
    alert = clean_alert(doc, existing)
    if alert['kind'] == 'setups_ab':  # only one of these
        for a in MONITOR.load():
            if a['kind'] == 'setups_ab' and a['id'] != alert.get('id'):
                alert['id'] = a['id']
                alert.setdefault('firedKeys', a.get('firedKeys', {}))
    if alert['kind'] == 'setup':  # one per setup
        for a in MONITOR.load():
            if a['kind'] == 'setup' and a.get('setupId') == alert['setupId'] and not alert.get('id'):
                alert['id'] = a['id']
    saved = store.save_doc(COLLECTION, alert)
    MONITOR.reload()
    return {'alert': saved, **_reply()}


@handler('alerts.delete')
async def delete_alert(ctx, msg):
    # 'id' is the request id; the alert is `docId`. `setupId` deletes a setup's alert, `kind: setups_ab` the A/B one.
    for a in MONITOR.load():
        if a['id'] == msg.get('docId') or (msg.get('setupId') and a.get('setupId') == msg['setupId']) or (msg.get('kind') == 'setups_ab' and a['kind'] == 'setups_ab'):
            store.delete_doc(COLLECTION, a['id'])
    MONITOR.reload()
    return _reply()


@handler('alerts.test')
async def test_alert(ctx, msg):
    on = channels()
    results = await deliver(ctx.http, 'Test alert', 'Alerts from your trading platform reach you here.', MONITOR.push)
    if not on['ntfy'] and not on['telegram']:
        results['note'] = 'No phone channel set up yet: add ntfy or Telegram in Settings.'
    return {'results': results, 'channels': on}


@handler('alerts.telegram_link')
async def telegram_link(ctx, msg):
    """Finds your chat id from the last message you sent the bot (so you don't have to look it up) and saves it."""
    data = settings.load()
    token = data.get('telegram_token')
    if not token:
        raise EngineError('Save the bot token first.')
    try:
        r = await ctx.http.get(f'{TELEGRAM_API}/bot{token}/getUpdates')
        updates = r.json().get('result') or [] if r.status_code == 200 else None
    except Exception as err:
        raise EngineError(_hide(f'Could not reach Telegram ({type(err).__name__})', [token]))
    if updates is None:
        raise EngineError(f'Telegram refused the bot token (answered {r.status_code}). Copy it again from BotFather.')
    chats = [(u.get('message') or u.get('channel_post') or {}).get('chat') or {} for u in updates]
    chats = [c for c in chats if isinstance(c.get('id'), int)]
    if not chats:
        raise EngineError('No message found. Open your bot in Telegram, press Start (or send it "hi"), then try again.')
    chat = chats[-1]
    settings.save({'telegram_chat': str(chat['id'])})
    return {'ok': True, 'name': chat.get('first_name') or chat.get('title') or chat.get('username') or 'your chat', **settings.public()}
