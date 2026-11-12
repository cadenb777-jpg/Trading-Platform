"""
Where a stock really trades, and whether a fund trades at its value.

1. Off-exchange ("dark pool") share, weekly, from FINRA OTC Transparency (free API, no key needed for this public
   dataset): shares traded on alternative trading systems (ATS, the dark pools) and other off-exchange venues
   (internalisers, non-ATS OTC) for the symbol, against the total consolidated volume of the same week (Schwab daily
   bars). FINRA publishes with a delay (2 weeks for the biggest stocks, 4 for the rest), so the latest week shown is
   that old. Rising dark-pool share can mean large holders working orders quietly; it does not say buy or sell.
2. A fund's price against its net asset value (premium/discount): the last close against the NAV it published for the
   same day (Schwab quote nAV, else Yahoo's navPrice). For ETFs arbitrage keeps it small; closed-end funds can sit at
   wide discounts for years (a classic relative-value trade, and also a trap: the discount can widen).

Requests (read-only): flow.offexchange {symbol}, invest.navpremium {symbol}
"""
import asyncio
import datetime as dt
from zoneinfo import ZoneInfo

from . import crosscheck, datahub
from .core import EngineError, handler

FINRA = 'https://api.finra.org/data/group/otcMarket/name/weeklySummary'
NY = ZoneInfo('America/New_York')
ATS, OTC = 'ATS_W_SMBL', 'OTC_W_SMBL'
WEEKS = 26


# ---------- pure maths (tested) ----------

def finra_query(symbol, kind, limit=WEEKS + 4):
    return {'compareFilters': [{'compareType': 'EQUAL', 'fieldName': 'issueSymbolIdentifier', 'fieldValue': symbol},
                               {'compareType': 'EQUAL', 'fieldName': 'summaryTypeCode', 'fieldValue': kind}],
            'sortFields': ['-weekStartDate'], 'limit': limit}


def weekly_shares(rows):
    """FINRA weekly rows -> {week start date: shares} (rows for the same week, e.g. two tiers, are added)."""
    out = {}
    for r in rows or []:
        week, qty = r.get('weekStartDate'), r.get('totalWeeklyShareQuantity')
        if week and isinstance(qty, (int, float)):
            out[week[:10]] = out.get(week[:10], 0) + qty
    return out


def week_volume(bars, week_start):
    """Total volume of the Monday-Friday week starting `week_start` from [(date, volume)]."""
    start = dt.date.fromisoformat(week_start)
    end = start + dt.timedelta(days=7)
    return sum(v for d, v in bars if start <= d < end)


def shares_of_volume(ats, otc, bars):
    rows = []
    for week in sorted(set(ats) | set(otc)):
        total = week_volume(bars, week)
        if not total:
            continue
        a, o = ats.get(week, 0), otc.get(week, 0)
        rows.append({'week': week, 'ats': a, 'otc': o, 'total': total, 'atsShare': a / total, 'offShare': (a + o) / total})
    return rows


def yahoo_nav(data):
    """Yahoo quoteSummary JSON -> the fund's latest NAV (summaryDetail.navPrice), or None."""
    result = ((data or {}).get('quoteSummary') or {}).get('result') or []
    nav = ((result[0].get('summaryDetail') or {}).get('navPrice') or {}) if result else {}
    value = nav.get('raw') if isinstance(nav, dict) else None
    return float(value) if isinstance(value, (int, float)) and value > 0 else None


def premium(price, nav):
    return price / nav - 1 if price and nav else None


# ---------- requests ----------

async def _finra(ctx, symbol, kind):
    response = await datahub.call('finra', lambda: ctx.http.post(FINRA, json=finra_query(symbol, kind), headers={'Accept': 'application/json'}, timeout=30))
    if response.status_code in (401, 403):
        raise EngineError('FINRA asked for an API login for this data.')
    if response.status_code == 204:
        return []
    response.raise_for_status()
    return response.json()


@handler('flow.offexchange')
async def offexchange(ctx, msg):
    symbol = str(msg.get('symbol') or '').upper().strip()
    if not symbol:
        raise EngineError('Enter a symbol')

    async def load():
        ats, otc, bars = await asyncio.gather(_finra(ctx, symbol, ATS), _finra(ctx, symbol, OTC), ctx.daily_bars(symbol, 1))
        daily = [(dt.datetime.fromtimestamp(b['time'], NY).date(), b.get('volume') or 0) for b in bars]
        rows = shares_of_volume(weekly_shares(ats), weekly_shares(otc), daily)
        if not rows:
            raise EngineError(f'FINRA has no off-exchange weeks for {symbol}.')
        rows = rows[-WEEKS:]
        avg = sum(r['atsShare'] for r in rows) / len(rows)
        return {'symbol': symbol, 'weeks': rows, 'latest': rows[-1], 'avgAtsShare': avg,
                'avgOffShare': sum(r['offShare'] for r in rows) / len(rows),
                'source': 'FINRA OTC Transparency (ATS and non-ATS weekly), total volume from Schwab'}
    return await ctx.cached(('offexchange', symbol), 12 * 3600, load, persist=True, stale_ok=True)


@handler('invest.navpremium')
async def navpremium(ctx, msg):
    symbol = str(msg.get('symbol') or '').upper().strip()
    if not symbol:
        raise EngineError('Enter a symbol')
    response = await ctx.schwab.get_quotes([symbol])
    data = response.json() if response.status_code == 200 else {}
    item = (data or {}).get(symbol) or {}
    q = item.get('quote') or {}
    asset = item.get('assetMainType') or ''
    nav, source = crosscheck._num(q.get('nAV')), 'Schwab'
    if not nav:
        try:
            crumb = await crosscheck._yahoo_crumb(ctx)
            r = await crosscheck._get(ctx, 'yahoo', crosscheck.YAHOO_SUMMARY.format(symbol=symbol), params={'modules': 'summaryDetail', 'crumb': crumb})
            nav, source = (yahoo_nav(r.json()) if r.status_code == 200 else None), 'Yahoo Finance'
        except Exception:
            nav = None
    close, last = crosscheck._num(q.get('closePrice')), crosscheck._num(q.get('lastPrice'))
    if not nav:
        return {'symbol': symbol, 'assetType': asset, 'nav': None,
                'note': 'No published NAV found for this symbol (it may not be a fund).'}
    return {'symbol': symbol, 'assetType': asset, 'nav': nav, 'navSource': source, 'close': close, 'last': last,
            'premium': premium(close, nav), 'livePremium': premium(last, nav),
            'note': 'NAV is struck once a day at the close; the premium compares it with the same day’s closing price. '
                    'Live premium uses the last trade against that NAV (only a rough guide during the day).'}
