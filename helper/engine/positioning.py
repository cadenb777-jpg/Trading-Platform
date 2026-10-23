"""
Positioning for individual stocks. The CFTC's Commitment of Traders report only covers futures, so a stock
is linked to the futures market it trades with (NVDA -> Nasdaq-100, XOM -> crude oil, ...). Stock-level
positioning comes from FINRA's free daily short-sale volume files, options activity and insider trades.
"""
import asyncio
import datetime as dt

from . import flow, sec
from .core import EngineError, handler

FINRA_URL = 'https://cdn.finra.org/equity/regsho/daily/CNMSshvol{day}.txt'

# Stocks and ETFs whose closest futures market isn't the broad index.
RELATED_MARKET = {
    '067651': ['XLE', 'XOM', 'CVX', 'COP', 'OXY', 'EOG', 'SLB', 'HAL', 'MPC', 'PSX', 'VLO', 'DVN', 'FANG', 'USO', 'XOP', 'OIH', 'APA', 'HES'],
    '088691': ['GLD', 'IAU', 'GDX', 'GDXJ', 'NEM', 'GOLD', 'AEM', 'KGC', 'FNV', 'WPM', 'RGLD'],
    '084691': ['SLV', 'PAAS', 'AG', 'HL', 'SIL'],
    '085692': ['FCX', 'SCCO', 'COPX', 'CPER', 'TECK'],
    '023651': ['UNG', 'BOIL', 'KOLD', 'EQT', 'AR', 'RRC', 'CTRA', 'LNG'],
    '043602': ['IEF', 'IEI', 'BND', 'AGG', 'GOVT'],
    '020601': ['TLT', 'EDV', 'TMF', 'ZROZ'],
    '133741': ['IBIT', 'FBTC', 'GBTC', 'BITO', 'COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HUT', 'BITX'],
    '098662': ['UUP', 'UDN'],
    '099741': ['FXE'],
    '097741': ['FXY'],
    '096742': ['FXB'],
    '002602': ['CORN', 'DE', 'ADM', 'BG', 'MOS', 'NTR', 'CF', 'FMC'],
    '005602': ['SOYB'],
    '239742': ['IWM', 'IWN', 'IWO', 'VTWO', 'TNA', 'TZA'],
    '124603': ['DIA', 'UDOW', 'SDOW'],
    '209742': ['QQQ', 'QQQM', 'TQQQ', 'SQQQ', 'XLK', 'VGT', 'SMH', 'SOXX', 'SOXL', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL',
               'GOOG', 'META', 'AVGO', 'TSLA', 'NFLX', 'AMD', 'ADBE', 'CSCO', 'INTC', 'QCOM', 'TXN', 'AMAT', 'MU', 'LRCX',
               'KLAC', 'MRVL', 'PANW', 'CRWD', 'SNPS', 'CDNS', 'ORCL', 'CRM', 'PLTR', 'ARM', 'SHOP', 'ASML', 'INTU', 'ABNB'],
    '13874A': ['SPY', 'VOO', 'IVV', 'SPLG', 'RSP', 'SSO', 'UPRO', 'SPXL', 'SPXU', 'SH'],
}
SYMBOL_MARKET = {sym: code for code, syms in RELATED_MARKET.items() for sym in syms}


async def related_market(ctx, symbol):
    """The futures market a stock moves with, and why."""
    symbol = symbol.upper().lstrip('$')
    if symbol in flow.COT_MARKETS:
        return symbol, 'You picked this futures market directly.'
    code = SYMBOL_MARKET.get(symbol)
    if code:
        return code, f'{symbol} tends to move with {flow.COT_MARKETS[code]} futures.'
    exchange = ''
    try:
        response = await ctx.schwab.get_quote(symbol)
        if response.status_code == 200:
            data = response.json().get(symbol, {})
            exchange = (data.get('reference', {}).get('exchangeName') or data.get('quote', {}).get('exchange') or '').upper()
    except Exception:
        pass
    if 'NASDAQ' in exchange or exchange == 'Q':
        return '209742', f'{symbol} is a Nasdaq-listed stock, so Nasdaq-100 futures are the closest futures market.'
    return '13874A', f'{symbol} moves mostly with the broad market, so S&P 500 futures are the closest futures market.'


def rolling_index(values, window=156):
    out = []
    for i, v in enumerate(values):
        w = values[max(0, i - window + 1): i + 1]
        lo, hi = min(w), max(w)
        out.append(None if len(w) < 26 else (100 * (v - lo) / (hi - lo) if hi > lo else 50.0))
    return out


async def cot_rows(ctx, code):
    async def load():
        params = {'cftc_contract_market_code': code, '$order': 'report_date_as_yyyy_mm_dd DESC', '$limit': '520'}
        response = await ctx.http.get(flow.COT_URL, params=params)
        response.raise_for_status()
        return flow.parse_cot(response.json())
    return await ctx.cached(('cot-long', code), 6 * 3600, load, persist=True, stale_ok=True)


@handler('flow.cot_for_symbol')
async def cot_for_symbol(ctx, msg):
    """COT history for a symbol's related futures market, with 3-year positioning indexes for each week."""
    symbol = str(msg.get('symbol', '')).upper()
    if not symbol:
        raise EngineError('Enter a symbol')
    code, reason = await related_market(ctx, symbol)
    rows = await cot_rows(ctx, code)
    if not rows:
        raise EngineError('The CFTC returned no data for this market.')
    spec_idx = rolling_index([r['specNet'] for r in rows])
    comm_idx = rolling_index([r['commNet'] for r in rows])
    return {
        'symbol': symbol,
        'code': code,
        'market': flow.COT_MARKETS[code],
        'reason': reason,
        'rows': [{**r, 'specIndex': s, 'commIndex': c} for r, s, c in zip(rows, spec_idx, comm_idx)],
    }


def parse_short_file(text):
    """FINRA daily file -> {symbol: [short volume, total volume]}."""
    out = {}
    for line in text.splitlines()[1:]:
        parts = line.split('|')
        if len(parts) < 5 or not parts[2].replace('.', '').isdigit():
            continue
        try:
            out[parts[1]] = [float(parts[2]), float(parts[4])]
        except ValueError:
            continue
    return out


async def short_day(ctx, day):
    async def load():
        response = await ctx.http.get(FINRA_URL.format(day=day.strftime('%Y%m%d')))
        if response.status_code in (403, 404):
            return {}  # market holiday or not published yet
        response.raise_for_status()
        return parse_short_file(response.text)
    # Past days never change, so they are kept for good; today's file may not be out yet.
    age = 30 * 86400 if day < dt.date.today() - dt.timedelta(days=1) else 1800
    return await ctx.cached(('finra-short', day.isoformat()), age, load, persist=True)


@handler('flow.short_volume')
async def short_volume(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper().strip()
    days = max(5, min(120, int(msg.get('days') or 40)))
    if not symbol or symbol.startswith('$'):
        raise EngineError('Short volume is only published for stocks and ETFs.')
    dates, d = [], dt.date.today()
    while len(dates) < int(days * 1.1) + 2:
        if d.weekday() < 5:
            dates.append(d)
        d -= dt.timedelta(days=1)
    files = await asyncio.gather(*(short_day(ctx, day) for day in dates), return_exceptions=True)
    rows = []
    for day, data in zip(dates, files):
        if isinstance(data, Exception) or not data:
            continue
        hit = data.get(symbol) or data.get(symbol.replace('/', '.')) or data.get(symbol.replace('.', '/'))
        if hit and hit[1]:
            rows.append({'date': day.isoformat(), 'short': hit[0], 'total': hit[1], 'ratio': hit[0] / hit[1]})
    if not rows and all(isinstance(f, Exception) for f in files):
        raise EngineError('Could not reach FINRA for short-sale data. Check your internet connection.')
    if not rows:
        raise EngineError(f'FINRA has no short-sale volume for {symbol}.')
    rows.sort(key=lambda r: r['date'])
    rows = rows[-days:]
    ratios = [r['ratio'] for r in rows]
    recent = ratios[-5:]
    return {
        'symbol': symbol,
        'rows': rows,
        'latest': rows[-1],
        'avg5': sum(recent) / len(recent),
        'avgAll': sum(ratios) / len(ratios),
    }


@handler('flow.positioning')
async def positioning(ctx, msg):
    """Everything about who is positioned how in one stock, gathered in parallel."""
    symbol = str(msg.get('symbol', '')).upper()
    if not symbol:
        raise EngineError('Enter a symbol')
    tasks = {
        'shortVolume': short_volume(ctx, {'symbol': symbol, 'days': 40}),
        'cot': cot_for_symbol(ctx, {'symbol': symbol}),
        'options': flow.options(ctx, {'symbol': symbol}),
        'insiders': sec.insiders(ctx, {'symbol': symbol}),
    }
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    out, errors = {'symbol': symbol}, {}
    for key, result in zip(tasks, results):
        if isinstance(result, Exception):
            errors[key] = str(result)
            out[key] = None
        else:
            out[key] = result
    if out['cot']:
        out['cot'] = {**out['cot'], 'rows': out['cot']['rows'][-156:]}
    if out['options']:
        o = out['options']
        out['options'] = {'spot': o['spot'], 'expiration': o['expiration'], 'summary': o['summary'], 'unusual': o['unusual'][:8],
                          'topStrikes': sorted(o['strikes'], key=lambda r: r['callOi'] + r['putOi'], reverse=True)[:6]}
    if out['insiders']:
        out['insiders'] = {'company': out['insiders']['company'], 'summary': out['insiders']['summary'], 'trades': out['insiders']['trades'][:10]}
    out['errors'] = errors
    return out
