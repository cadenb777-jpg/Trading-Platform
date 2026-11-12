"""
Triangulated prices: every source the helper already touches offers (price, trade time, source) for a symbol, and the
price shown is the one from the newest trade, unless it disagrees with the other recent sources (a bad tick).

Sources, cheapest first: Schwab's live stream (trade time per tick), Schwab's official quote every 30 s (tradeTime),
the underlying quote in every Schwab option chain the helper loads anyway (Flow, Live flow), and only for symbols that
have gone quiet (no newer price for STALE seconds while the market is open) Alpaca's latest trade (free keys,
real-time IEX; full market with a paid plan) and then Yahoo's quote. So in normal running there are no extra requests.

A backup's price (Alpaca, Yahoo, an option chain) is refused when at least two other sources priced in the last 5
minutes agree with each other and it sits more than BAD_TICK away from their median: a stray print never reaches the
screen. Schwab's own stream and official quote are never held back that way, so a real jump on news shows at once.

Pure bookkeeping here (tested); the helper (schwab_helper.py) applies the result to the quotes it pushes, and
engine/alpaca + crosscheck fetch the backups. Read-only: market data only.
"""
import datetime as dt
import re
import time

from .core import handler

STALE = 20          # seconds without a newer price (market open) before backups are asked
RECENT = 300        # sources priced within this many seconds take part in the bad-tick check
BAD_TICK = 0.015    # 1.5% away from the agreeing others
PRIMARY = {'stream', 'schwab'}  # Schwab's own prices: newest wins, never refused as a bad tick


class Hub:
    def __init__(self):
        self.sources = {}   # symbol -> {source: (price, trade time s, received s)}
        self.best = {}      # symbol -> (price, trade time s, source)
        self.refused = {}   # symbol -> last refused (source, price, median)

    def offer(self, symbol, price, at, source, now=None):
        """Records a price; returns True when it becomes the price to show (newest trade and not a bad tick)."""
        now = now or time.time()
        try:
            price, at = float(price), float(at)
        except (TypeError, ValueError):
            return False
        if not price > 0 or not at > 0:
            return False
        if at > 1e11:  # milliseconds
            at /= 1000
        others = [p for s, (p, t, _) in self.sources.get(symbol, {}).items() if s != source and now - t <= RECENT]
        self.sources.setdefault(symbol, {})[source] = (price, at, now)
        if source not in PRIMARY and len(others) >= 2:
            mid = sorted(others)[len(others) // 2]
            agree = [p for p in others if abs(p / mid - 1) <= BAD_TICK]
            if len(agree) >= 2 and abs(price / mid - 1) > BAD_TICK:
                self.refused[symbol] = (source, price, mid)
                return False
        best = self.best.get(symbol)
        if best and at < best[1]:
            return False  # an older trade never replaces a newer one
        self.best[symbol] = (price, at, source)
        return True

    def stale(self, symbols, now=None):
        """Symbols whose newest trade is older than STALE seconds."""
        now = now or time.time()
        return [s for s in symbols if now - (self.best.get(s, (0, 0, ''))[1]) > STALE]

    def describe(self, symbol, now=None):
        """Every source's latest price and age, the chosen one first (for the price tooltip and diagnostics)."""
        now = now or time.time()
        best = self.best.get(symbol)
        rows = [{'source': s, 'price': p, 'age': round(now - t, 1)} for s, (p, t, _) in sorted(self.sources.get(symbol, {}).items(), key=lambda kv: -kv[1][1])]
        prices = [r['price'] for r in rows if r['age'] <= RECENT]
        spread = (max(prices) / min(prices) - 1) if len(prices) > 1 else None
        return {'symbol': symbol, 'chosen': {'price': best[0], 'source': best[2], 'age': round(now - best[1], 1)} if best else None,
                'sources': rows, 'spread': spread, 'refused': self.refused.get(symbol)}


HUB = Hub()

#: names shown on screen
NAMES = {'stream': 'Schwab live', 'schwab': 'Schwab quote', 'chain': 'Schwab options chain', 'alpaca': 'Alpaca', 'yahoo': 'Yahoo Finance'}


def offer_chain(symbol, chain):
    """An option chain's underlying quote (free with every chain the helper loads)."""
    u = (chain or {}).get('underlying') or {}
    at = u.get('tradeTime') or u.get('quoteTime')
    if u.get('last') and at:
        HUB.offer(symbol, u['last'], at, 'chain')


def rfc3339_seconds(text):
    """'2026-11-12T15:01:02.123456789Z' (nanoseconds) -> unix seconds."""
    m = re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)?$', str(text))
    if not m:
        raise ValueError(text)
    base = dt.datetime.fromisoformat(m.group(1) + (m.group(3) or 'Z').replace('Z', '+00:00'))
    return base.timestamp() + (float('0' + m.group(2)) if m.group(2) else 0.0)


def parse_alpaca_latest(data):
    """Alpaca /v2/stocks/trades/latest JSON -> {symbol: (price, unix seconds)}."""
    out = {}
    for sym, t in ((data or {}).get('trades') or {}).items():
        try:
            out[sym] = (float(t['p']), rfc3339_seconds(t['t']))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def parse_yahoo_quotes(data):
    """Yahoo /v7/finance/quote JSON -> {symbol: (price, unix seconds)} (regular, pre- or post-market, whichever is newer)."""
    out = {}
    for q in ((data or {}).get('quoteResponse') or {}).get('result') or []:
        best = None
        for p, t in (('regularMarketPrice', 'regularMarketTime'), ('preMarketPrice', 'preMarketTime'), ('postMarketPrice', 'postMarketTime')):
            if isinstance(q.get(p), (int, float)) and isinstance(q.get(t), (int, float)) and (best is None or q[t] > best[1]):
                best = (float(q[p]), float(q[t]))
        if best and q.get('symbol'):
            out[q['symbol']] = best
    return out


# ---------- backups for quiet symbols ----------

ALPACA_LATEST = 'https://data.alpaca.markets/v2/stocks/trades/latest'
YAHOO_QUOTE = 'https://query2.finance.yahoo.com/v7/finance/quote'
ASK_AGAIN = 60      # a quiet symbol is asked about at most once a minute per backup source
_asked = {}


def _due(source, symbols, now):
    out = [s for s in symbols if now - _asked.get((source, s), 0) >= ASK_AGAIN]
    for s in out:
        _asked[(source, s)] = now
    return out


async def backups(ctx, symbols, now=None):
    """Asks Alpaca, then Yahoo, for symbols that have gone quiet; offers what they return. Never raises."""
    from . import alpaca, crosscheck
    now = now or time.time()
    quiet = HUB.stale(symbols, now)
    if not quiet:
        return
    if alpaca.available():
        ask = _due('alpaca', quiet, now)[:100]
        if ask:
            try:
                data = await alpaca._get(ctx, {'symbols': ','.join(ask), 'feed': 'iex'}, ALPACA_LATEST)
                for sym, (price, at) in parse_alpaca_latest(data).items():
                    HUB.offer(sym, price, at, 'alpaca', now)
            except Exception:
                pass
    quiet = HUB.stale(quiet, now)
    ask = _due('yahoo', quiet, now)[:50]
    if ask:
        try:
            crumb = await crosscheck._yahoo_crumb(ctx)
            r = await crosscheck._get(ctx, 'yahoo', YAHOO_QUOTE, params={'symbols': ','.join(ask), 'crumb': crumb})
            if r.status_code == 200:
                for sym, (price, at) in parse_yahoo_quotes(r.json()).items():
                    HUB.offer(sym, price, at, 'yahoo', now)
        except Exception:
            pass



@handler('prices.sources')
async def sources(ctx, msg):
    """Where a symbol's price came from: every source's latest price and age, the chosen one and their spread."""
    symbol = str(msg.get('symbol') or '').upper().strip()
    out = HUB.describe(symbol)
    for r in out['sources']:
        r['name'] = NAMES.get(r['source'], r['source'])
    if out['chosen']:
        out['chosen']['name'] = NAMES.get(out['chosen']['source'], out['chosen']['source'])
    return out
