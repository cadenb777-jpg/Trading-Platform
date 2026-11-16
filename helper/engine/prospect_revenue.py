"""
Estimated revenue of an investment adviser, from its own Form ADV (Prospects page). Form ADV reports assets and
clients, not revenue, so this is an ESTIMATE, always shown as a range with its method:

1. Fee revenue by client type (Item 5.D: each client type's assets and number of clients):
   - Individuals and high-net-worth clients: the average account (type assets / type clients) run through a typical
     tiered RIA schedule (1.00% on the first $1M, 0.80% to $3M, 0.65% to $5M, 0.50% to $10M, 0.35% above: the shape
     industry fee surveys report, not this firm's own schedule).
   - Institutions, funds and others: typical management-fee rates for that client type (TYPE_RATES).
   - Without a client breakdown: total regulatory AUM x a wide generic range.
2. Performance fees (only when Item 5.E says the firm charges them, on its pooled-vehicle assets): 20% of the year's
   gain. The gain is the firm's own 13F portfolio return when known (prospect.performance), else a 0% / 7% / 15% low /
   likely / high year.
3. Cross-check from headcount (Item 5.A employees x a rough revenue-per-employee range); shown, not mixed in.

Pure maths, tested. Rates are assumptions, stated on screen and in the export.
"""

#: a typical tiered schedule for individual and high-net-worth accounts: (upper bound of the band, annual rate)
TIERS = ((1_000_000, 0.0100), (3_000_000, 0.0080), (5_000_000, 0.0065), (10_000_000, 0.0050), (float('inf'), 0.0035))
#: typical management-fee rate by Form ADV client type: (low, likely, high), as a share of assets a year
TYPE_RATES = {
    'banks': (0.0010, 0.0025, 0.0050), 'investment_companies': (0.0010, 0.0040, 0.0080), 'bdcs': (0.0100, 0.0150, 0.0200),
    'pooled': (0.0075, 0.0125, 0.0200), 'pensions': (0.0015, 0.0030, 0.0060), 'charities': (0.0025, 0.0045, 0.0080),
    'government': (0.0010, 0.0025, 0.0050), 'other_advisers': (0.0015, 0.0030, 0.0060), 'insurance': (0.0010, 0.0020, 0.0040),
    'sovereign': (0.0005, 0.0015, 0.0035), 'corporations': (0.0020, 0.0035, 0.0070), 'other': (0.0025, 0.0050, 0.0100),
}
GENERIC = (0.0030, 0.0060, 0.0100)  # no client breakdown
RETAIL_SPREAD = (0.75, 1.0, 1.25)  # low / likely / high around the tiered schedule
PERFORMANCE_SHARE = 0.20
ASSUMED_RETURNS = (0.0, 0.07, 0.15)
REVENUE_PER_EMPLOYEE = (250_000, 450_000, 800_000)  # rough adviser-industry range (assumption)
LABELS = {'individuals': 'Individuals', 'hnw': 'High-net-worth individuals', 'banks': 'Banks', 'investment_companies': 'Mutual funds / investment companies',
          'bdcs': 'Business development companies', 'pooled': 'Private funds (pooled vehicles)', 'pensions': 'Pension plans',
          'charities': 'Charities', 'government': 'State and municipal', 'other_advisers': 'Other advisers (sub-advised)',
          'insurance': 'Insurance companies', 'sovereign': 'Sovereign wealth funds', 'corporations': 'Corporations', 'other': 'Other'}


def tiered_rate(account):
    """Effective annual fee rate on one account of size `account` under TIERS."""
    if not account or account <= 0:
        return TIERS[0][1]
    fee, lower = 0.0, 0.0
    for upper, rate in TIERS:
        band = min(account, upper) - lower
        if band <= 0:
            break
        fee += band * rate
        lower = upper
    return fee / account


def estimate(aum_total, client_mix, fees, employees=None, portfolio_return=None):
    """{low, likely, high, parts[], performance{}, perEmployee{}, method, notes[]} or None without AUM."""
    mix = client_mix or {}
    fee_kinds = fees or []
    parts, notes = [], []
    covered = 0.0
    for key, row in mix.items():
        aum = (row or {}).get('aum')
        if not aum or aum <= 0:
            continue
        covered += aum
        if key in ('individuals', 'hnw'):
            count = (row or {}).get('count')
            avg = aum / count if count else None
            rate = tiered_rate(avg) if avg else TIERS[0][1]
            low, mid, high = (rate * s for s in RETAIL_SPREAD)
            basis = f'average account ${avg:,.0f} on a typical tiered schedule' if avg else 'typical schedule (client count not reported)'
        else:
            low, mid, high = TYPE_RATES.get(key, TYPE_RATES['other'])
            basis = 'typical fee rate for this client type'
        parts.append({'type': key, 'label': LABELS.get(key, key), 'aum': aum, 'rate': mid, 'rateLow': low, 'rateHigh': high,
                      'low': aum * low, 'likely': aum * mid, 'high': aum * high, 'basis': basis})
    if aum_total and aum_total > 0 and covered < aum_total * 0.5:
        # little or no client breakdown: the rest at a wide generic rate
        rest = aum_total - covered
        parts.append({'type': 'unbroken', 'label': 'Assets without a client breakdown', 'aum': rest, 'rate': GENERIC[1], 'rateLow': GENERIC[0],
                      'rateHigh': GENERIC[2], 'low': rest * GENERIC[0], 'likely': rest * GENERIC[1], 'high': rest * GENERIC[2],
                      'basis': 'generic adviser fee range (no client breakdown in the filing)'})
        notes.append('Most assets have no client-type breakdown in Form ADV, so the range is wide.')
    if not parts:
        return None
    low = sum(p['low'] for p in parts)
    likely = sum(p['likely'] for p in parts)
    high = sum(p['high'] for p in parts)
    perf = None
    pooled = (mix.get('pooled') or {}).get('aum') or 0
    if pooled and 'Performance-based' in fee_kinds:
        if portfolio_return is not None:
            r = (max(0.0, portfolio_return),) * 3
            source = 'its 13F stock portfolio return over the last year'
        else:
            r = ASSUMED_RETURNS
            source = 'an assumed 0% / 7% / 15% year'
        perf = {'assets': pooled, 'share': PERFORMANCE_SHARE, 'returns': r, 'source': source,
                'low': pooled * r[0] * PERFORMANCE_SHARE, 'likely': pooled * r[1] * PERFORMANCE_SHARE, 'high': pooled * r[2] * PERFORMANCE_SHARE}
        low, likely, high = low + perf['low'], likely + perf['likely'], high + perf['high']
    if fee_kinds and 'Percentage of assets' not in fee_kinds:
        notes.append('The firm does not say it charges a percentage of assets (it lists ' + ', '.join(fee_kinds).lower() + '): an asset-based estimate may be far off.')
    per_emp = None
    if employees:
        per_emp = {'employees': employees, 'low': employees * REVENUE_PER_EMPLOYEE[0], 'likely': employees * REVENUE_PER_EMPLOYEE[1],
                   'high': employees * REVENUE_PER_EMPLOYEE[2]}
        if likely > per_emp['high'] * 2 or likely < per_emp['low'] / 2:
            notes.append(f"The headcount check ({employees} employees) points to a very different size: treat the estimate with extra care.")
    return {'low': low, 'likely': likely, 'high': high, 'parts': parts, 'performance': perf, 'perEmployee': per_emp,
            'effectiveRate': likely / aum_total if aum_total else None, 'notes': notes,
            'method': 'Estimated from Form ADV assets by client type x typical fee rates (not reported revenue).'}


def portfolio_return(quarters):
    """Holdings-based return from quarter-start holdings: quarters = [[(weight, price change), ...], ...] oldest first;
    each quarter's return is the value-weighted price change of the positions held at its start. Compounded."""
    total = 1.0
    used = 0
    for positions in quarters:
        w = sum(p[0] for p in positions if p[1] is not None)
        if w <= 0:
            continue
        total *= 1 + sum(p[0] * p[1] for p in positions if p[1] is not None) / w
        used += 1
    return (total - 1) if used else None
