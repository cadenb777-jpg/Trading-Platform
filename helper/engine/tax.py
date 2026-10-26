"""
Tax view for the Account page (an estimate, not tax advice): accounts grouped by how they're taxed (Roth = tax-free,
Traditional IRA = tax-deferred, cash/margin = taxable), and for taxable accounts the unrealized gain or loss per
holding, loss-harvesting candidates and a wash-sale warning when the same symbol was bought in the last 30 days
(Webull fills, any account). The platform has no purchase lots, so most holding periods are "unknown".
"""
from .core import handler

HARVEST_MIN = 100.0
TYPES = {
    'roth': ('Tax-free (Roth)', 'Tax-free: no tax on gains or dividends if the rules are met (age 59½ and the account open 5 years).'),
    'deferred': ('Tax-deferred (Traditional IRA)', 'Tax-deferred: no tax while the money stays in; withdrawals are taxed as income.'),
    'taxable': ('Taxable (cash / margin)', 'Taxable: dividends are taxed each year and gains when you sell.'),
}
NOT_ADVICE = 'Estimate only, not tax advice; confirm with your 1099-B (or a tax professional).'


def tax_type(name, explicit=None):
    """'roth', 'deferred' or 'taxable' from the account's chosen type, else its name (e.g. "Webull Roth IRA ••1234")."""
    if explicit in TYPES:
        return explicit
    n = str(name or '').lower()
    if 'roth' in n:
        return 'roth'
    if any(w in n for w in ('ira', '401', '403', 'sep', 'traditional', 'rollover', 'pension')):
        return 'deferred'
    return 'taxable'


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def tax_view(accounts, buys=None):
    """accounts: [{name, taxType?, holdings: [{symbol, shares, value, cost, kind}]}]; buys: Webull fills in the last
    31 days ([{symbol, qty, account}]) or None when unknown. Pure."""
    groups = {}
    taxable = []
    bought = {}
    for b in buys or []:
        bought.setdefault(str(b.get('symbol') or '').upper(), []).append(b)
    for a in accounts if isinstance(accounts, list) else []:
        if not isinstance(a, dict):
            continue
        kind = tax_type(a.get('name'), a.get('taxType'))
        holdings = [x for x in a.get('holdings') or [] if isinstance(x, dict)]
        value = sum(_num(x.get('value')) or 0 for x in holdings)
        g = groups.setdefault(kind, {'type': kind, 'label': TYPES[kind][0], 'meaning': TYPES[kind][1], 'value': 0.0, 'accounts': []})
        g['value'] += value
        g['accounts'].append(a.get('name') or 'Account')
        if kind != 'taxable':
            continue
        for x in holdings:
            symbol = str(x.get('symbol') or '').upper()
            shares, val, cost = _num(x.get('shares')) or 0, _num(x.get('value')), _num(x.get('cost'))
            if x.get('kind', 'security') != 'security' or not shares:
                continue
            gain = val - cost if val is not None and cost is not None else None
            recent = min(shares, sum(_num(b.get('qty')) or 0 for b in bought.get(symbol, []))) if buys is not None else None
            if recent is None:
                term = 'unknown'
            elif recent >= shares:
                term = 'short'
            elif recent > 0:
                term = 'mixed'
            else:
                term = 'unknown'
            loss = gain is not None and gain < 0
            taxable.append({
                'account': a.get('name') or 'Account', 'symbol': symbol, 'shares': shares, 'value': val, 'cost': cost, 'gain': gain,
                'term': term, 'recentShares': recent,
                'harvest': gain is not None and gain < -HARVEST_MIN,
                'washSale': sorted({b.get('account') or '' for b in bought.get(symbol, [])}) if loss and bought.get(symbol) else [],
            })
    order = [k for k in TYPES if k in groups]
    gains = [x['gain'] for x in taxable if x['gain'] is not None]
    return {
        'groups': [groups[k] for k in order],
        'taxable': sorted(taxable, key=lambda x: (x['gain'] if x['gain'] is not None else 0)),
        'totals': {'gain': sum(g for g in gains if g > 0), 'loss': sum(g for g in gains if g < 0),
                   'harvest': sum(x['gain'] for x in taxable if x['harvest']), 'noCost': sum(1 for x in taxable if x['gain'] is None)},
        'notAdvice': NOT_ADVICE,
    }


@handler('tax.account')
async def account(ctx, msg):
    from . import webull
    accounts = msg.get('accounts') if isinstance(msg.get('accounts'), list) else []
    buys, note = None, 'No Webull keys in Settings, so recent purchases are unknown: wash sales can’t be checked and holding periods are unknown.'
    if any(tax_type(a.get('name'), a.get('taxType')) == 'taxable' for a in accounts if isinstance(a, dict)) and webull.available():
        try:
            found = await webull.recent_buys(ctx)
            buys = found['buys']
            note = None if found['complete'] else 'Some Webull order history couldn’t be read, so recent purchases may be missing.'
        except Exception as err:  # Webull down or busy: say so, never guess
            note = f'Webull purchase history unavailable ({err}); wash sales can’t be checked.'
    return {**tax_view(accounts, buys), 'buysKnown': buys is not None, 'buysNote': note, 'buyDays': 31}
