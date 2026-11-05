"""
The desktop app's navigation: sections across the top, their pages as tabs under them, and a command line that takes
a ticker, a Bloomberg-style code ("AAPL GP", "WEI") or a page name. Pure (no Qt) and tested (tests/test_nav.py).
"""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class Page:
    key: str
    section: str
    label: str
    code: str
    about: str


SECTIONS = ('Markets', 'Analyze', 'Money')

PAGES = (
    Page('home', 'Markets', 'Overview', 'WEI', 'World indexes, futures, rates and your watchlist at a glance'),
    Page('chart', 'Analyze', 'Chart', 'GP', 'The price chart: candles, volume, sessions'),
    Page('quote', 'Analyze', 'Quote', 'DES', 'One security: last price, day range and key figures'),
    Page('account', 'Money', 'Account', 'ACCT', 'Your Webull account: balances and positions (read-only)'),
)

TICKER = re.compile(r'^[A-Z][A-Z0-9.\-/^$]{0,14}$')


def pages_in(section):
    return [p for p in PAGES if p.section == section]


def page_by_code(code):
    code = code.upper()
    return next((p for p in PAGES if p.code == code), None)


def parse_command(text):
    """What a command line entry means: ('page', key, symbol-or-None) or None.

    "AAPL" -> chart of AAPL; "AAPL GP" / "AAPL DES" -> that function for AAPL; "WEI" / "ACCT" -> that page;
    "chart" / "account" -> the page by name.
    """
    words = text.strip().upper().split()
    if not words:
        return None
    if len(words) == 1:
        page = page_by_code(words[0]) or next((p for p in PAGES if p.label.upper() == words[0] or p.key.upper() == words[0]), None)
        if page:
            return ('page', page.key, None)
        if TICKER.match(words[0]):
            return ('page', 'chart', words[0])
        return None
    if len(words) == 2 and TICKER.match(words[0]):
        page = page_by_code(words[1])
        if page:
            return ('page', page.key, words[0])
    return None
