"""
One symbol normaliser for every data source, so "BRK.B", "BRK-B", "BRK/B" and "brk b" are the same stock everywhere.

The platform's own (canonical) form is what the browser and Schwab use:
  stocks/ETFs   upper case, share class after a dot: AAPL, BRK.B, BF.B, HEI.A
  indexes       Schwab's $ form: $SPX, $DJI, $COMPX, $VIX
  futures       Schwab's / form: /ES, /CL
  crypto pairs  BASE-QUOTE: BTC-USD (Coinbase's product id)

Each source spells a few of these differently (`to_source(symbol, source)` / `from_source(symbol, source)`):
  schwab   canonical (share classes with a dot; quote replies may key a class with '/', so `lookup` tries both)
  sec      company_tickers.json writes share classes with a dash: BRK-B
  yahoo    dash share classes (BRK-B), ^ indexes (^GSPC), =F futures (ES=F); crypto BTC-USD
  alpaca   dot share classes (BRK.B); crypto pairs BTC/USD
  coinbase BTC-USD
  nasdaq   dot share classes (brk.b in page links; the API takes BRK.B)
  finra    dot share classes (FINRA's short-volume files: BRK.B)
  webull   dot share classes
Standard library only; pure functions (tested in helper/tests/test_datahub.py).
"""
import re

#: Schwab index symbol -> Yahoo's.
_YAHOO_INDEX = {'$SPX': '^GSPC', '$DJI': '^DJI', '$COMPX': '^IXIC', '$NDX': '^NDX', '$RUT': '^RUT', '$VIX': '^VIX',
                '$TNX': '^TNX', '$TYX': '^TYX', '$FVX': '^FVX', '$IRX': '^IRX', '$SOX': '^SOX', '$OEX': '^OEX'}
_FROM_YAHOO_INDEX = {v: k for k, v in _YAHOO_INDEX.items()}
#: Quote currencies a crypto pair can end with (BTCUSD -> BTC-USD).
_CRYPTO_QUOTES = ('USDT', 'USDC', 'USD', 'EUR', 'GBP', 'BTC', 'ETH')
_KNOWN_CRYPTO = {'BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'LTC', 'AVAX', 'DOT', 'LINK', 'MATIC', 'SHIB', 'BCH', 'XLM', 'UNI'}
_CLASS = re.compile(r'^([A-Z0-9]{1,6})[.\-/ ]([A-Z])$')  # BRK.B / BRK-B / BRK/B / BRK B
SOURCES = ('schwab', 'sec', 'yahoo', 'alpaca', 'coinbase', 'nasdaq', 'finra', 'webull')


def kind(symbol):
    """'index', 'future', 'crypto' or 'stock' for a canonical symbol."""
    s = normalize(symbol)
    if s.startswith('$'):
        return 'index'
    if s.startswith('/'):
        return 'future'
    if re.match(r'^[A-Z0-9]{2,10}-[A-Z]{3,4}$', s):
        return 'crypto'
    return 'stock'


def normalize(symbol):
    """The platform's canonical form of any spelling (see the module notes). Unknown shapes come back upper-cased
    and trimmed, never invented."""
    s = str(symbol or '').strip().upper().replace('‑', '-').replace('‐', '-')
    if not s:
        return ''
    if s in _FROM_YAHOO_INDEX:
        return _FROM_YAHOO_INDEX[s]
    if s.startswith('^'):
        return '$' + s[1:]
    if s.endswith('=F') and len(s) > 2:
        return '/' + s[:-2]
    if s.startswith('$') or s.startswith('/'):
        return s
    pair = re.match(r'^([A-Z0-9]{2,10})[/\-]([A-Z]{3,4})$', s)
    if pair and pair.group(2) in _CRYPTO_QUOTES:  # a share class is one letter, so BTC-USD / BTC/USD is a pair
        return f'{pair.group(1)}-{pair.group(2)}'
    glued = re.match(r'^(%s)(USDT|USDC|USD)$' % '|'.join(sorted(_KNOWN_CRYPTO)), s)
    if glued:  # BTCUSD -> BTC-USD (only for well-known coins: 'ETHUSD' yes, a stock ticker never)
        return f'{glued.group(1)}-{glued.group(2)}'
    m = _CLASS.match(s)
    if m:
        return f'{m.group(1)}.{m.group(2)}'
    return s


def to_source(symbol, source):
    """The canonical symbol spelled the way `source` expects it."""
    s = normalize(symbol)
    k = kind(s)
    if source == 'yahoo':
        if k == 'index':
            return _YAHOO_INDEX.get(s, '^' + s[1:])
        if k == 'future':
            return s[1:] + '=F'
        return s.replace('.', '-')
    if source == 'sec':
        return s.replace('.', '-')
    if source == 'alpaca' and k == 'crypto':
        return s.replace('-', '/')
    return s


def from_source(symbol, source):
    """A source's spelling back to the canonical form."""
    return normalize(symbol)


def variants(symbol):
    """Every spelling a reply might key this symbol by (canonical first): BRK.B, BRK/B, BRK-B."""
    s = normalize(symbol)
    out = [s]
    m = _CLASS.match(s)
    if m:
        out += [f'{m.group(1)}/{m.group(2)}', f'{m.group(1)}-{m.group(2)}', f'{m.group(1)} {m.group(2)}']
    return out


def lookup(mapping, symbol, default=None):
    """mapping[symbol] under any of its spellings (a Schwab quote reply keyed BRK/B, a SEC list keyed BRK-B...)."""
    if not mapping:
        return default
    for v in variants(symbol):
        if v in mapping:
            return mapping[v]
    return default


def share_class(symbol):
    """The class letter of a share-class symbol ('B' for BRK.B), else ''."""
    m = _CLASS.match(normalize(symbol))
    return m.group(2) if m else ''


def root(symbol):
    """The company part without the class (BRK for BRK.B); the symbol itself otherwise."""
    m = _CLASS.match(normalize(symbol))
    return m.group(1) if m else normalize(symbol)
