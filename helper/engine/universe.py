"""
The scanner's stocks: the Nasdaq composite's common stocks, cut to the most traded (Setups v30, stage 1).

1. Every Nasdaq-listed security from Nasdaq Trader's free symbol directory (nasdaqlisted.txt, refreshed daily).
   Kept: common stocks and ADRs. Left out: ETFs, test issues, NextShares, companies not in normal standing
   (deficient, delinquent, bankrupt) and non-common securities (warrants, units, rights, preferreds, notes).
2. A liquidity gate from Schwab quotes (one request per 100 symbols, once a week): price >= $5 and 10-day average
   dollar volume >= $10M. Thin stocks are left out on purpose: their backtests are fiction (gaps, wide spreads).
3. The most traded MAX_STOCKS by dollar volume, plus the Nasdaq-100 always. The cap keeps the scanner's memory and
   Schwab pacing reasonable: a stock's 15 years of daily bars take about 1.7 MB of memory, so stocks outside the
   Nasdaq-100 load 5 years of daily and 8 years of weekly bars (scanner.EXTENDED_*). Raise the cap once the scan
   streams stocks instead of holding all of them.

Hourly bars (the short time frame), the strategy lab and the weekly rule tests use the HOURLY_STOCKS / LAB_STOCKS
most traded (plus the Nasdaq-100): those need far more data or computing per stock.
"""
import time

from . import datahub

DIRECTORY = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'
MIN_PRICE = 5.0
MIN_DOLLAR_VOLUME = 10_000_000
MAX_STOCKS = 400
HOURLY_STOCKS = 150
LAB_STOCKS = 250
NOT_COMMON = ('warrant', 'unit', ' right', 'rights', 'preferred', 'notes due', 'debenture', 'depositary share representing', '% ')


# ---------- pure (tested) ----------

def parse_directory(text):
    """nasdaqlisted.txt -> [{symbol, name}] for common stocks in normal standing."""
    lines = [ln for ln in (text or '').splitlines() if ln.strip()]
    if not lines or not lines[0].startswith('Symbol|'):
        return []
    head = lines[0].split('|')
    col = {name: i for i, name in enumerate(head)}
    out = []
    for ln in lines[1:]:
        if ln.startswith('File Creation Time'):
            continue
        cells = ln.split('|')
        if len(cells) < len(head):
            continue
        get = lambda k: cells[col[k]].strip() if k in col else ''  # noqa: E731
        symbol, name = get('Symbol'), get('Security Name')
        if get('Test Issue') == 'Y' or get('ETF') == 'Y' or get('NextShares') == 'Y':
            continue
        if get('Financial Status') not in ('', 'N'):
            continue
        low = name.lower()
        if any(w in low for w in NOT_COMMON):
            continue
        if not symbol or not symbol.replace('.', '').isalpha():
            continue
        out.append({'symbol': symbol, 'name': name})
    return out


def rank_liquid(quotes, min_price=MIN_PRICE, min_dollar_volume=MIN_DOLLAR_VOLUME):
    """Schwab quote items -> [(symbol, dollar volume)] passing the gate, most traded first."""
    rows = []
    for sym, item in (quotes or {}).items():
        q, f = item.get('quote') or {}, item.get('fundamental') or {}
        price = q.get('lastPrice') or q.get('closePrice')
        vol = f.get('avg10DaysVolume') or f.get('avg1YearVolume') or q.get('totalVolume')
        if not isinstance(price, (int, float)) or not isinstance(vol, (int, float)) or price < min_price:
            continue
        dollars = price * vol
        if dollars >= min_dollar_volume:
            rows.append((sym, dollars))
    return sorted(rows, key=lambda r: -r[1])


def choose(ranked, core, cap=MAX_STOCKS):
    """The most traded `cap` plus every core (Nasdaq-100) symbol, most traded first, core ones not passing the gate last."""
    top = [s for s, _ in ranked[:cap]]
    return top + [s for s in core if s not in top]


# ---------- fetching ----------

async def directory(ctx):
    async def load():
        response = await datahub.get(ctx.http, 'nasdaq', DIRECTORY)
        response.raise_for_status()
        rows = parse_directory(response.text)
        if len(rows) < 1000:
            raise ValueError(f'the Nasdaq directory listed only {len(rows)} common stocks')
        return rows
    return await ctx.cached(('nasdaq-directory',), 24 * 3600, load, persist=True, stale_ok=True)


async def liquid(ctx, quotes_fn, core):
    """The scanner's stocks, most traded first, refreshed weekly; the Nasdaq-100 alone when the directory or the
    quotes can't be read. `quotes_fn(symbols)` returns Schwab quote items (the scanner's paced fetch)."""
    async def load():
        names = [r['symbol'] for r in await directory(ctx)]
        quotes = await quotes_fn(names)
        ranked = rank_liquid(quotes)
        if len(ranked) < 100:
            raise ValueError(f'only {len(ranked)} stocks passed the liquidity gate (quotes incomplete?)')
        return {'ranked': ranked, 'listed': len(names), 'built': time.time()}
    data = await ctx.cached(('scan-universe', MAX_STOCKS), 7 * 86400, load, persist=True, stale_ok=True)
    symbols = choose([tuple(r) for r in data['ranked']], core)
    by_volume = [s for s, _ in data['ranked']]
    return {'symbols': symbols, 'hourly': choose([(s, 0) for s in by_volume], core, HOURLY_STOCKS),
            'lab': choose([(s, 0) for s in by_volume], core, LAB_STOCKS), 'listed': data['listed'], 'liquid': len(data['ranked'])}
