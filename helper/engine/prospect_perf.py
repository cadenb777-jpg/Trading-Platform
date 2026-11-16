"""
How a prospect's investments have done, and what that means for its revenue (Prospects → firm detail).

Performance: the firm's 13F stock holdings at the start of each of the last four quarters, priced through the quarter
(holdings-based return: the value-weighted price change of what it held at the quarter start, the top TOP positions;
options left out), compounded over the year and set beside SPY. It ignores trades inside a quarter, fees, cash and
everything 13F doesn't cover (bonds, private funds, non-US stocks), and says so.

Revenue: the Form ADV estimate (engine/prospect_revenue.py) with the performance fee worked out from that return, and,
when the firm (or its parent) is a public company filing XBRL with the SEC, its actual reported revenue.

Request (read-only): prospect.performance {firmId}
"""
import asyncio
import datetime as dt
import json

from . import prospect as pr
from . import prospect_revenue
from .core import EngineError, handler

TOP = 40
QUARTERS = 4


def _json_or(text, default):
    try:
        return json.loads(text) if text else default
    except ValueError:
        return default


def _close_on_or_before(bars, day):
    best = None
    for b in bars:
        if dt.datetime.fromtimestamp(b['time'], dt.timezone.utc).date() > day:
            break
        best = b['close']
    return best


def _load(con, firm_id):
    row = con.execute('SELECT cik, has13f, aum_total, client_mix, fees, employees FROM firms WHERE id = ?', (firm_id,)).fetchone()
    if not row:
        raise EngineError('That firm is not in the prospect database.')
    out = {'cik': row['cik'], 'aum': row['aum_total'], 'mix': row['client_mix'], 'fees': row['fees'], 'employees': row['employees'], 'quarters': []}
    if not (row['cik'] and row['has13f']):
        return out
    periods = [r[0] for r in con.execute('SELECT DISTINCT period FROM holdings_13f WHERE cik = ? ORDER BY period DESC', (row['cik'],))][:QUARTERS + 1]
    periods.sort()
    for start in periods:  # each runs to the next 13F date; the newest runs to today (marked partial)
        rows = [dict(r) for r in con.execute('SELECT cusip, issuer, class, value, shares, put_call FROM holdings_13f WHERE cik = ? AND period = ?', (row['cik'], start))]
        positions = pr.aggregate_positions(rows)
        w = pr.weights_by_cusip(positions)
        top = sorted(w.items(), key=lambda kv: -kv[1])[:TOP]
        mapping = pr._tickers_for(con, {k for k, _ in top})
        out['quarters'].append({'start': start, 'positions': [(k, wt, (mapping.get(k) or {}).get('ticker')) for k, wt in top]})
    for i, q in enumerate(out['quarters']):
        q['end'] = out['quarters'][i + 1]['start'] if i + 1 < len(out['quarters']) else None  # the last runs to today
    return out


async def _reported_revenue(ctx, cik):
    """The latest fiscal year's revenue when the CIK files XBRL statements (public companies), else None."""
    if not cik:
        return None
    try:
        from . import research
        core = await research.company_core(ctx, cik)
        annual = core['statements']['annual']
        values = annual['values'].get('revenue') or []
        for end, v in zip(reversed(annual['periods']), reversed(values)):
            if v:
                return {'value': v, 'fiscalYearEnd': end, 'source': 'SEC XBRL (10-K)'}
    except Exception:
        return None
    return None


@handler('prospect.performance')
async def performance(ctx, msg):
    firm_id = str(msg.get('firmId') or '')
    data = await pr._query(_load, firm_id)
    tickers = sorted({t for q in data['quarters'] for _, _, t in q['positions'] if t} | ({'SPY'} if data['quarters'] else set()))
    bars = {}

    async def get(t):
        try:
            bars[t] = await ctx.daily_bars(t, 2)
        except Exception:
            bars[t] = []
    await asyncio.gather(*(get(t) for t in tickers))
    today = dt.date.today()
    quarters, chain, spy_chain = [], [], []
    for q in data['quarters']:
        start = dt.date.fromisoformat(q['start'])
        end = dt.date.fromisoformat(q['end']) if q['end'] else today
        rows, contributions = [], []
        for cusip, weight, ticker in q['positions']:
            a, b = (_close_on_or_before(bars.get(ticker) or [], start), _close_on_or_before(bars.get(ticker) or [], end)) if ticker else (None, None)
            change = b / a - 1 if a and b else None
            rows.append((weight, change))
            if change is not None:
                contributions.append({'ticker': ticker, 'weight': weight, 'change': change, 'contribution': weight * change})
        ret = prospect_revenue.portfolio_return([rows])
        priced = sum(w for w, c in rows if c is not None)
        sa, sb = _close_on_or_before(bars.get('SPY') or [], start), _close_on_or_before(bars.get('SPY') or [], end)
        spy = sb / sa - 1 if sa and sb else None
        quarters.append({'start': q['start'], 'end': end.isoformat(), 'partial': q['end'] is None, 'return': ret, 'spy': spy,
                         'priced': priced, 'top': sorted(contributions, key=lambda c: -abs(c['contribution']))[:5]})
        chain.append(rows)
        spy_chain.append([(1.0, spy)])
    full = [q for q in quarters if not q['partial']][-QUARTERS:]
    one_year = prospect_revenue.portfolio_return([[(1.0, q['return'])] for q in full]) if full else None
    spy_year = prospect_revenue.portfolio_return([[(1.0, q['spy'])] for q in full]) if full else None
    mix, fees = _json_or(data['mix'], {}), _json_or(data['fees'], [])
    revenue = prospect_revenue.estimate(data['aum'], mix, fees, data['employees'], portfolio_return=one_year)
    return {'quarters': quarters, 'oneYear': one_year, 'spyOneYear': spy_year, 'quartersCounted': len(full),
            'revenue': revenue, 'reportedRevenue': await _reported_revenue(ctx, data['cik']),
            'note': 'Holdings-based: what the firm held at each quarter start (its top 40 13F stock positions), priced through the quarter. '
                    'Trades within a quarter, fees, cash, bonds and private holdings are not included.'}
