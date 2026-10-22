"""
Options flow from Schwab option chains (unusual activity, put/call ratios, max pain, gamma
exposure) and futures positioning from the CFTC's Commitment of Traders report.
"""
import math

from .core import EngineError, handler

UNUSUAL_MIN_VOLUME = 300
UNUSUAL_MIN_RATIO = 1.0


def _num(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    # Schwab uses -999 (and NaN) for values it doesn't have.
    return None if math.isnan(v) or v <= -999 else v


def flatten_chain(chain):
    """Turns Schwab's nested {expiration: {strike: [contract]}} maps into a flat list."""
    contracts = []
    for side, key in (('call', 'callExpDateMap'), ('put', 'putExpDateMap')):
        for exp_key, strikes in (chain.get(key) or {}).items():
            expiration = exp_key.split(':')[0]
            for strike_key, entries in strikes.items():
                for c in entries:
                    contracts.append({
                        'type': side,
                        'symbol': c.get('symbol', ''),
                        'expiration': expiration,
                        'dte': int(c.get('daysToExpiration') or 0),
                        'strike': float(c.get('strikePrice') or strike_key),
                        'bid': _num(c.get('bid')) or 0,
                        'ask': _num(c.get('ask')) or 0,
                        'last': _num(c.get('last')) or 0,
                        'mark': _num(c.get('mark')) or 0,
                        'volume': int(c.get('totalVolume') or 0),
                        'oi': int(c.get('openInterest') or 0),
                        'iv': _num(c.get('volatility')),
                        'delta': _num(c.get('delta')),
                        'gamma': _num(c.get('gamma')),
                    })
    return contracts


def max_pain(contracts, expiration):
    """The strike where option holders would lose the most (the value of all options is lowest) at expiry."""
    exp = [c for c in contracts if c['expiration'] == expiration and c['oi']]
    strikes = sorted({c['strike'] for c in exp})
    if not strikes:
        return None
    def pain(s):
        return sum(c['oi'] * max(0.0, s - c['strike']) if c['type'] == 'call' else c['oi'] * max(0.0, c['strike'] - s) for c in exp)
    return min(strikes, key=pain)


def gamma_exposure(contracts, spot):
    """Dealer gamma exposure by strike, in $ per 1% move (calls positive, puts negative, the usual convention)."""
    by_strike = {}
    for c in contracts:
        if c['gamma'] is None or not c['oi']:
            continue
        gex = c['gamma'] * c['oi'] * 100 * spot * spot * 0.01
        by_strike[c['strike']] = by_strike.get(c['strike'], 0.0) + (gex if c['type'] == 'call' else -gex)
    return [{'strike': k, 'gex': v} for k, v in sorted(by_strike.items())]


def unusual(contracts, limit=30):
    """Contracts trading more today than their open interest, biggest premium first."""
    hits = []
    for c in contracts:
        if c['volume'] < UNUSUAL_MIN_VOLUME:
            continue
        ratio = c['volume'] / c['oi'] if c['oi'] else float('inf')
        if ratio < UNUSUAL_MIN_RATIO:
            continue
        price = c['last'] or c['mark']
        side = ''
        if c['ask'] and price >= c['ask']:
            side = 'at ask'
        elif c['bid'] and price <= c['bid']:
            side = 'at bid'
        hits.append({**c, 'ratio': None if ratio == float('inf') else round(ratio, 2), 'premium': c['volume'] * price * 100, 'side': side})
    hits.sort(key=lambda c: c['premium'], reverse=True)
    return hits[:limit]


def analyze_chain(chain, expiration=None):
    spot = _num((chain.get('underlying') or {}).get('last')) or _num(chain.get('underlyingPrice'))
    contracts = flatten_chain(chain)
    if not contracts or not spot:
        raise EngineError('No options data for this symbol.')
    expirations = sorted({c['expiration'] for c in contracts})
    chosen = expiration if expiration in expirations else expirations[0]
    calls = [c for c in contracts if c['type'] == 'call']
    puts = [c for c in contracts if c['type'] == 'put']
    cv, pv = sum(c['volume'] for c in calls), sum(c['volume'] for c in puts)
    coi, poi = sum(c['oi'] for c in calls), sum(c['oi'] for c in puts)
    near = [c for c in contracts if c['expiration'] == chosen]
    atm = sorted(near, key=lambda c: abs(c['strike'] - spot))[:4]
    ivs = [c['iv'] for c in atm if c['iv']]
    strikes = {}
    for c in near:
        row = strikes.setdefault(c['strike'], {'strike': c['strike'], 'callVolume': 0, 'putVolume': 0, 'callOi': 0, 'putOi': 0})
        row['callVolume' if c['type'] == 'call' else 'putVolume'] += c['volume']
        row['callOi' if c['type'] == 'call' else 'putOi'] += c['oi']
    gex = gamma_exposure(contracts, spot)
    return {
        'symbol': chain.get('symbol', ''),
        'spot': spot,
        'expirations': expirations,
        'expiration': chosen,
        'summary': {
            'callVolume': cv,
            'putVolume': pv,
            'putCallVolume': pv / cv if cv else None,
            'callOi': coi,
            'putOi': poi,
            'putCallOi': poi / coi if coi else None,
            'maxPain': max_pain(contracts, chosen),
            'atmIv': sum(ivs) / len(ivs) if ivs else None,
            'netGex': sum(g['gex'] for g in gex),
        },
        'strikes': sorted(strikes.values(), key=lambda r: r['strike']),
        'gex': gex,
        'unusual': unusual(contracts),
    }


@handler('flow.options')
async def options(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper()
    if not symbol:
        raise EngineError('Enter a symbol')
    async def load():
        response = await ctx.schwab.get_option_chain(symbol, strike_count=40, include_underlying_quote=True)
        if response.status_code == 401:
            raise EngineError('Schwab login expired. Close the helper and start it again to log in.')
        if response.status_code != 200:
            raise EngineError(f'Schwab returned {response.status_code} for {symbol} options')
        return response.json()
    chain = await ctx.cached(('chain', symbol), 60, load)
    return analyze_chain(chain, msg.get('expiration'))


# ---------- Commitment of Traders ----------

COT_URL = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json'
COT_MARKETS = {
    '13874A': 'S&P 500 (E-mini)',
    '209742': 'Nasdaq-100 (E-mini)',
    '124603': 'Dow Jones (E-mini)',
    '239742': 'Russell 2000 (E-mini)',
    '043602': '10-Year Treasury Note',
    '020601': 'U.S. Treasury Bond',
    '088691': 'Gold',
    '084691': 'Silver',
    '085692': 'Copper',
    '067651': 'Crude Oil (WTI)',
    '023651': 'Natural Gas',
    '099741': 'Euro',
    '097741': 'Japanese Yen',
    '096742': 'British Pound',
    '098662': 'U.S. Dollar Index',
    '133741': 'Bitcoin (CME)',
    '002602': 'Corn',
    '005602': 'Soybeans',
}


def parse_cot(rows):
    out = []
    for r in rows:
        def n(key):
            try:
                return float(r.get(key) or 0)
            except ValueError:
                return 0.0
        spec_long, spec_short = n('noncomm_positions_long_all'), n('noncomm_positions_short_all')
        comm_long, comm_short = n('comm_positions_long_all'), n('comm_positions_short_all')
        small_long, small_short = n('nonrept_positions_long_all'), n('nonrept_positions_short_all')
        out.append({
            'date': str(r.get('report_date_as_yyyy_mm_dd', ''))[:10],
            'openInterest': n('open_interest_all'),
            'specLong': spec_long, 'specShort': spec_short, 'specNet': spec_long - spec_short,
            'commLong': comm_long, 'commShort': comm_short, 'commNet': comm_long - comm_short,
            'smallNet': small_long - small_short,
        })
    out.sort(key=lambda r: r['date'])
    return out


def cot_index(values):
    """Where the latest value sits in its 3-year range (0 = most bearish, 100 = most bullish)."""
    if len(values) < 2:
        return None
    lo, hi = min(values), max(values)
    return 100 * (values[-1] - lo) / (hi - lo) if hi > lo else 50.0


@handler('flow.cot_markets')
async def cot_markets(ctx, msg):
    return {'markets': [{'code': k, 'name': v} for k, v in COT_MARKETS.items()]}


@handler('flow.cot')
async def cot(ctx, msg):
    code = str(msg.get('code', '13874A'))
    if code not in COT_MARKETS:
        raise EngineError('Unknown market')
    async def load():
        params = {'cftc_contract_market_code': code, '$order': 'report_date_as_yyyy_mm_dd DESC', '$limit': '156'}
        response = await ctx.http.get(COT_URL, params=params)
        response.raise_for_status()
        return parse_cot(response.json())
    rows = await ctx.cached(('cot', code), 6 * 3600, load)
    if not rows:
        raise EngineError('The CFTC returned no data for this market.')
    latest, prev = rows[-1], rows[-2] if len(rows) > 1 else rows[-1]
    return {
        'code': code,
        'name': COT_MARKETS[code],
        'rows': rows,
        'latest': latest,
        'weeklyChange': {'specNet': latest['specNet'] - prev['specNet'], 'commNet': latest['commNet'] - prev['commNet']},
        'specIndex': cot_index([r['specNet'] for r in rows]),
        'commIndex': cot_index([r['commNet'] for r in rows]),
    }
