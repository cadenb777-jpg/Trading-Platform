"""
Live flow: big off-exchange ("dark pool") prints and big options trades on the owner's chosen symbols, as they happen,
with alerts to the phone and open tabs (engine/alerts.py deliver) even with the platform closed.

Dark-pool prints come from Alpaca's full-market (SIP) trades (free market-data keys in Settings). Every trade printed
off the exchanges is reported to FINRA and carries venue code 'D' on the tape; a print at or above the owner's dollar
threshold is a block. On Alpaca's free plan the newest 15 minutes of full-market data aren't available, so prints arrive
15 minutes late; with a paid real-time plan they arrive within a minute (detected by itself). A print says a large trade
happened away from the exchanges; it does not say who bought or sold. Prints flagged late or average-priced (condition
codes) are often reports of trades agreed earlier: shown, but labelled.

Options come from the Schwab chain polled every 2 minutes during the session: a contract whose day volume grew by at
least the owner's premium threshold since the last poll (volume added x price x 100) is a big options trade, with
whether it went off near the ask (bought) or the bid (sold) and whether it is more than the open interest (new
positions). Several trades in the same 2 minutes add up.

Requests: liveflow.get {}, liveflow.save {config}. Read-only towards brokers: never places, changes or cancels orders.
"""
import asyncio
import datetime as dt
import logging
import time
from zoneinfo import ZoneInfo

from . import alerts, alpaca, flow, store
from .core import EngineError, handler

log = logging.getLogger('engine.liveflow')
NY = ZoneInfo('America/New_York')
COLLECTION = 'liveflow'
DEFAULTS = {'symbols': [], 'blockMin': 1_000_000, 'optionMin': 250_000, 'alert': True, 'darkPool': True, 'options': True}
MAX_SYMBOLS = 15
DARK_EVERY, OPTIONS_EVERY = 60, 120
FEED_SIZE = 300
ALERT_COOLDOWN = 5 * 60  # per symbol and kind: more prints in this time are summed into the next alert
#: trade conditions marking a print reported late, out of sequence, at an average price or derived from other trades
LATE = {'W': 'average price', '4': 'derivatively priced', 'Z': 'sold out of sequence', 'U': 'extended hours, late',
        'T': 'extended hours', '7': 'qualified contingent trade', 'L': 'sold last (late)'}


# ---------- pure (tested) ----------

def clean_config(doc):
    c = {**DEFAULTS, **{k: v for k, v in (doc or {}).items() if k in DEFAULTS}}
    syms = []
    for s in c['symbols'] if isinstance(c['symbols'], list) else str(c['symbols']).split(','):
        s = str(s).strip().upper()
        if s and s.replace('.', '').replace('-', '').isalnum() and len(s) <= 10 and s not in syms:
            syms.append(s)
    if len(syms) > MAX_SYMBOLS:
        raise EngineError(f'Live flow watches up to {MAX_SYMBOLS} symbols.')
    c['symbols'] = syms
    for key, low in (('blockMin', 100_000), ('optionMin', 25_000)):
        try:
            c[key] = max(low, float(c[key]))
        except (TypeError, ValueError):
            c[key] = DEFAULTS[key]
    for key in ('alert', 'darkPool', 'options'):
        c[key] = bool(c[key])
    return c


def dark_prints(symbol, trades, min_notional):
    """Off-exchange prints (venue 'D') worth at least `min_notional`, newest last."""
    out = []
    for t in trades or []:
        try:
            price, size = float(t['p']), float(t['s'])
        except (KeyError, TypeError, ValueError):
            continue
        if t.get('x') != 'D' or price * size < min_notional:
            continue
        conds = [c for c in (t.get('c') or []) if c in LATE]
        out.append({'kind': 'darkpool', 'symbol': symbol, 'time': t.get('t'), 'price': price, 'size': size,
                    'notional': price * size, 'late': ', '.join(LATE[c] for c in conds), 'id': f"{symbol}:{t.get('i')}:{t.get('t')}"})
    return out


def option_events(symbol, before, contracts, min_premium, min_contracts=100):
    """Big options trades since the last poll: day volume added x price x 100 at least `min_premium`.
    `before` {contract symbol: day volume at the last poll}; contracts not seen before are only remembered."""
    out = []
    for c in contracts:
        prev = before.get(c['symbol'])
        added = c['volume'] - prev if prev is not None else 0
        price = c['last'] or c['mark']
        if added < min_contracts or not price or added * price * 100 < min_premium:
            continue
        side = 'near the ask (bought)' if c['ask'] and price >= c['ask'] - 0.25 * (c['ask'] - c['bid']) else \
            'near the bid (sold)' if c['bid'] and price <= c['bid'] + 0.25 * (c['ask'] - c['bid']) else 'between bid and ask'
        out.append({'kind': 'options', 'symbol': symbol, 'contract': c['symbol'], 'type': c['type'], 'strike': c['strike'],
                    'expiration': c['expiration'], 'added': added, 'price': price, 'premium': added * price * 100,
                    'side': side, 'oi': c['oi'], 'opening': added > c['oi'], 'time': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
                    'id': f"{c['symbol']}:{c['volume']}"})
    return out


def session(now):
    """'regular', 'extended' or None (closed) for a New York time."""
    if now.weekday() >= 5:
        return None
    hm = now.hour * 60 + now.minute
    if 9 * 60 + 30 <= hm < 16 * 60:
        return 'regular'
    if 4 * 60 <= hm < 20 * 60:
        return 'extended'
    return None


def describe(e):
    if e['kind'] == 'darkpool':
        when = dt.datetime.fromisoformat(str(e['time']).replace('Z', '+00:00')).astimezone(NY).strftime('%I:%M %p').lstrip('0') if e.get('time') else ''
        late = f" ({e['late']})" if e.get('late') else ''
        return (f"Dark pool: {e['symbol']} ${e['notional'] / 1e6:,.1f}M",
                f"{e['size']:,.0f} shares at ${e['price']:,.2f} off-exchange at {when}{late}. Where it traded, not who bought or sold.")
    kind = 'call' if e['type'] == 'call' else 'put'
    return (f"Options: {e['symbol']} ${e['premium'] / 1e6:,.2f}M in {kind}s",
            f"{e['added']:,.0f} × {e['strike']:g} {kind} {e['expiration']} at ${e['price']:,.2f}, {e['side']}"
            f"{'; more than the open interest (new positions)' if e['opening'] else ''}.")


# ---------- state and the loop ----------

class Live:
    def __init__(self):
        self.feed = []
        self.seen = set()
        self.volumes = {}       # symbol -> {contract: day volume}
        self.last_end = None    # end of the last Alpaca window (unix seconds)
        self.mode = ''          # 'live' or 'delayed' (free plan)
        self.status = {'darkPool': 'off', 'options': 'off', 'lastRun': None, 'errors': {}}
        self.last_alert = {}
        self.pending = {}

    def config(self):
        try:
            return clean_config(store.get_doc(COLLECTION, 'config'))
        except Exception:
            return dict(DEFAULTS)

    def add(self, events):
        fresh = [e for e in events if e['id'] not in self.seen]
        for e in fresh:
            self.seen.add(e['id'])
            title, message = describe(e)
            e['title'], e['message'] = title, message
        self.feed = (self.feed + fresh)[-FEED_SIZE:]
        if len(self.seen) > 20000:
            self.seen = {e['id'] for e in self.feed}
        return fresh


LIVE = Live()


async def _dark(ctx, cfg):
    if not alpaca.available():
        LIVE.status['darkPool'] = 'needs Alpaca keys (free) in Settings'
        return []
    now = time.time()
    end = now if LIVE.mode != 'delayed' else now - alpaca.SIP_DELAY
    start = LIVE.last_end or end - 120
    if end - start < 20:
        return []
    start = max(start, end - 15 * 60)  # after a pause, only the last 15 minutes
    try:
        data = await alpaca.trades(ctx, cfg['symbols'], start, end)
        LIVE.mode = LIVE.mode or 'live'
    except EngineError as err:
        if 'plan' in str(err) and LIVE.mode != 'delayed':
            LIVE.mode = 'delayed'  # free plan: full-market trades end 15 minutes ago
            LIVE.last_end = None
            return []
        raise
    LIVE.last_end = end
    LIVE.status['darkPool'] = 'live' if LIVE.mode == 'live' else '15 minutes behind (Alpaca free plan)'
    out = []
    for sym, rows in data.items():
        out.extend(dark_prints(sym, rows, cfg['blockMin']))
    return out


async def _options(ctx, cfg):
    out = []
    for sym in cfg['symbols']:
        try:
            chain, _ = await flow.chain(ctx, sym)
        except Exception as err:
            LIVE.status['errors'][f'options {sym}'] = str(err)[:120]
            continue
        contracts = flow.flatten_chain(chain)
        before = LIVE.volumes.get(sym, {})
        out.extend(option_events(sym, before, contracts, cfg['optionMin']))
        LIVE.volumes[sym] = {c['symbol']: c['volume'] for c in contracts}
    LIVE.status['options'] = 'every 2 minutes (Schwab chains)'
    return out


async def _alert(ctx, events, cfg):
    if not cfg['alert'] or not events:
        return
    now = time.time()
    for e in events:
        key = (e['symbol'], e['kind'])
        LIVE.pending.setdefault(key, []).append(e)
    for key, group in list(LIVE.pending.items()):
        if now - LIVE.last_alert.get(key, 0) < ALERT_COOLDOWN:
            continue
        LIVE.last_alert[key] = now
        del LIVE.pending[key]
        top = max(group, key=lambda e: e.get('notional') or e.get('premium') or 0)
        title, message = top['title'], top['message']
        if len(group) > 1:
            total = sum(e.get('notional') or e.get('premium') or 0 for e in group)
            message += f' ({len(group)} in all, ${total / 1e6:,.1f}M.)'
        await alerts.deliver(ctx.http, title, message, alerts.MONITOR.push)
        await asyncio.sleep(alerts.SEND_GAP)


async def loop(ctx):
    """Runs while the helper runs: dark-pool prints every minute (4 am-8 pm ET), options every 2 minutes in the session."""
    last_options = 0.0
    while True:
        try:
            cfg = LIVE.config()
            phase = session(dt.datetime.now(NY))
            events = []
            if cfg['symbols'] and phase:
                if cfg['darkPool']:
                    try:
                        events += await _dark(ctx, cfg)
                        LIVE.status['errors'].pop('darkPool', None)
                    except Exception as err:
                        LIVE.status['errors']['darkPool'] = str(err)[:200]
                if cfg['options'] and phase == 'regular' and time.time() - last_options >= OPTIONS_EVERY:
                    last_options = time.time()
                    events += await _options(ctx, cfg)
                LIVE.status['lastRun'] = time.time()
            elif not phase:
                LIVE.status.update(darkPool='market closed', options='market closed')
                LIVE.volumes.clear()  # day volumes restart tomorrow
            fresh = LIVE.add(events)
            await _alert(ctx, fresh, cfg)
        except Exception as err:  # never let the loop die
            log.warning('Live flow pass failed: %s', err)
        await asyncio.sleep(DARK_EVERY)


@handler('liveflow.get')
async def get(ctx, msg):
    return {'config': LIVE.config(), 'feed': list(reversed(LIVE.feed[-200:])), 'status': {**LIVE.status, 'errors': dict(LIVE.status['errors'])},
            'alpaca': alpaca.available(), 'maxSymbols': MAX_SYMBOLS}


@handler('liveflow.save')
async def save(ctx, msg):
    cfg = clean_config(msg.get('config'))
    store.save_doc(COLLECTION, {'id': 'config', **cfg})
    LIVE.last_end = None
    return await get(ctx, {})
