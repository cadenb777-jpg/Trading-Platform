"""
Credit and reserves: three readings of the financial system's plumbing, from free FRED data.

1. Are bank reserves still "ample"? Reserve balances at the Fed (WRESBAL, weekly, $ millions) over nominal GDP (GDP,
   quarterly, annualised $ billions). Every week is divided by the GDP of its own quarter; quarters not yet published
   (the latest one or two) are estimated by growing the last published quarter at its average quarterly growth over the
   year before, and flagged, so today and a year ago are on the same basis. The Fed has said it will keep
   reserves "ample"; the last time they ran short, overnight repo rates jumped (week of September 18, 2019, when the
   ratio was about 6.4%). Shown: today's ratio, how far above the September 2019 level it is in today's dollars
   ((ratio - ratio_2019) x GDP), and its 3- and 12-month change. The demand curve behind it: Lopez-Salido and
   Vissing-Jorgensen (2023), "Reserve Demand, Interest Rate Control, and Quantitative Tightening", FEDS 2023-012
   (reserves matter relative to the size of the economy; the curve steepens as they get scarce).

2. Short-term credit stress: 90-day AA financial commercial paper (RIFSPPFAAD90NB) minus the 3-month Treasury bill
   (DTB3), both discount basis, daily since 1997; percentile against its own history. It jumped first in August 2007,
   September 2008 and March 2020 (Kacperczyk and Schnabl 2010, "When Safe Proved Risky", J. Econ. Perspectives 24(1)).
   Stressed = 95th percentile or higher.

3. Banks' lending standards: the Fed's Senior Loan Officer Survey, net share of banks tightening standards on loans to
   large and mid-sized firms (DRTSCILM, quarterly). Tightening has led weaker lending and wider credit spreads (Bassett,
   Chosak, Driscoll and Zakrajšek 2014, "Changes in Bank Lending Standards and the Macroeconomy", J. Monetary
   Economics 62). Shown with its percentile since 1990 and the last survey's change; a net 10% or more either way is
   called tightening / easing (symmetric), less is about steady.

Request (read-only): bonds.system {} -> {reserves, paper, lending, notes, sources}; each part null when its source fails.
"""
import asyncio
import datetime as dt

from .core import handler
from .moneydesk import _fred, on_or_before
from .ratesdesk import percentile_rank, value_ago

#: the week money markets broke (SOFR jumped to 5.25% on September 17, 2019; Anbil, Anderson and Senyuz 2020)
STRESS_WEEK = '2019-09-18'
PAPER_STRESS = 95
LENDING_STEP = 10.0


# ---------- pure maths (tested) ----------

def _quarter_start(day):
    d = dt.date.fromisoformat(day)
    return dt.date(d.year, 3 * ((d.month - 1) // 3) + 1, 1).isoformat()


def gdp_for(gdp, day):
    """(GDP of the quarter containing `day`, estimated?). A quarter not yet published = the last published quarter grown
    at its average quarterly growth over the 4 quarters before it, compounded once per missing quarter."""
    q = _quarter_start(day)
    known = dict(gdp)
    if q in known:
        return known[q], False
    if not gdp or q < gdp[0][0]:
        return None, False
    last_q, last = gdp[-1]
    if len(gdp) >= 5 and gdp[-5][1] > 0:
        growth = (last / gdp[-5][1]) ** 0.25
    else:
        growth = 1.0
    qd, ld = dt.date.fromisoformat(q), dt.date.fromisoformat(last_q)
    steps = (qd.year - ld.year) * 4 + (qd.month - ld.month) // 3
    return last * growth ** steps, True


def reserve_ratio(reserves, gdp):
    """reserves: [(date, $ millions)] weekly; gdp: [(quarter start, $ billions annualised)] -> [(date, % of GDP, est.)]."""
    out = []
    for d, r in reserves:
        g, est = gdp_for(gdp, d)
        if g:
            out.append((d, 100 * (r / 1000) / g, est))
    return out


def reserves_reading(reserves, gdp):
    ratio = reserve_ratio(reserves, gdp)
    if not ratio:
        return None
    d, now, est = ratio[-1]
    g, _ = gdp_for(gdp, d)
    pairs = [(x[0], x[1]) for x in ratio]
    stress = on_or_before(pairs, STRESS_WEEK)
    return {'date': d, 'reserves': reserves[-1][1] * 1e6, 'ratio': now, 'gdpEstimated': est, 'gdpQuarter': _quarter_start(d),
            'stressRatio': stress, 'stressDate': STRESS_WEEK,
            # how far above the 2019 level, in today's dollars ($ billions)
            'aboveStress': None if stress is None else (now - stress) / 100 * g,
            'ratio3m': value_ago(pairs, 91), 'ratio12m': value_ago(pairs, 365),
            'from': ratio[0][0], 'series': [{'date': x[0], 'ratio': round(x[1], 3)} for x in ratio[-520:]]}


def paper_reading(cp, bill):
    """CP minus T-bill (bp) on common days."""
    b = dict(bill)
    rows = [(d, 100 * (v - b[d])) for d, v in cp if d in b]
    if not rows:
        return None
    d, s = rows[-1]
    pct = percentile_rank([x for _, x in rows], s)
    return {'date': d, 'cp': b[d] + s / 100, 'bill': b[d], 'spreadBp': s, 'percentile': pct,
            'monthAgoBp': value_ago(rows, 28),
            'high1yBp': max(x for dd, x in rows if dd > (dt.date.fromisoformat(d) - dt.timedelta(days=365)).isoformat()),
            'stressed': pct is not None and pct >= PAPER_STRESS, 'from': rows[0][0],
            'series': [{'date': x[0], 'spreadBp': round(x[1], 1)} for x in rows[-260:]]}


def lending_reading(rows):
    """Senior Loan Officer Survey, net % tightening (quarterly)."""
    if not rows:
        return None
    d, v = rows[-1]
    prev = rows[-2][1] if len(rows) > 1 else None
    word = 'tightening' if v >= LENDING_STEP else 'easing' if v <= -LENDING_STEP else 'about steady'
    return {'date': d, 'netTightening': v, 'previous': prev, 'percentile': percentile_rank([x for _, x in rows], v),
            'reading': word, 'from': rows[0][0], 'series': [{'date': x[0], 'net': x[1]} for x in rows[-40:]]}


# ---------- data ----------

@handler('bonds.system')
async def system(ctx, msg):
    res, gdp, cp, bill, slo = await asyncio.gather(
        _fred(ctx, 'WRESBAL', '2002-01-01'), _fred(ctx, 'GDP', '2002-01-01'), _fred(ctx, 'RIFSPPFAAD90NB', '1997-01-01'),
        _fred(ctx, 'DTB3', '1997-01-01'), _fred(ctx, 'DRTSCILM', '1990-01-01'), return_exceptions=True)
    bad = lambda *xs: any(isinstance(x, BaseException) for x in xs)  # noqa: E731 (CancelledError is a BaseException)
    out, notes = {}, []
    out['reserves'] = None if bad(res, gdp) else reserves_reading(res, gdp)
    if out['reserves'] is None:
        notes.append('Reserves unavailable: ' + ('FRED could not be reached.' if bad(res, gdp) else 'FRED returned no matching weeks.'))
    out['paper'] = None if bad(cp, bill) else paper_reading(cp, bill)
    if out['paper'] is None:
        notes.append('Commercial paper spread unavailable: ' + ('FRED could not be reached.' if bad(cp, bill) else 'FRED returned no matching days.'))
    out['lending'] = None if bad(slo) else lending_reading(slo)
    if out['lending'] is None:
        notes.append('Lending standards unavailable: ' + ('FRED could not be reached.' if bad(slo) else 'FRED returned no survey readings.'))
    out['notes'] = notes
    out['sources'] = {
        'reserves': {'name': 'Fed reserve balances (WRESBAL) and BEA nominal GDP (GDP), via FRED', 'url': 'https://fred.stlouisfed.org/series/WRESBAL'},
        'paper': {'name': '90-day AA financial commercial paper (Fed) and 3-month T-bill, via FRED', 'url': 'https://fred.stlouisfed.org/series/RIFSPPFAAD90NB'},
        'lending': {'name': 'Fed Senior Loan Officer Opinion Survey (DRTSCILM), via FRED', 'url': 'https://fred.stlouisfed.org/series/DRTSCILM'},
    }
    return out
