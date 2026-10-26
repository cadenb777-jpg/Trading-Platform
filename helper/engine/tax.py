"""
Tax view for the Account page (an estimate, not tax advice): accounts grouped by how they're taxed (Roth = tax-free,
Traditional IRA = tax-deferred, cash/margin = taxable), and for taxable accounts the unrealized gain or loss per
holding, loss-harvesting candidates and a wash-sale warning when the same symbol was bought in the last 30 days
(Webull fills, any account). The platform has no purchase lots, so most holding periods are "unknown".
"""
import re

from .core import handler

HARVEST_MIN = 100.0
TYPES = {
    'roth': ('Tax-free (Roth)', 'Tax-free: no tax on gains or dividends if the rules are met (age 59½ and the account open 5 years).'),
    'deferred': ('Tax-deferred (Traditional IRA)', 'Tax-deferred: no tax while the money stays in; withdrawals are taxed as income.'),
    'taxable': ('Taxable (cash / margin)', 'Taxable: dividends are taxed each year and gains when you sell.'),
}
NOT_ADVICE = 'Estimate only, not tax advice; confirm with your 1099-B (or a tax professional).'


#: Webull account_class -> tax type (classes from Webull's account list; see webull.CLASS_NAMES).
WEBULL_CLASSES = {'ROTH_IRA': 'roth', 'MANAGED_ROTH_IRA': 'roth', 'TRADITIONAL_IRA': 'deferred', 'ROLLOVER_IRA': 'deferred',
                  'MANAGED_TRADITIONAL_IRA': 'deferred', 'INDIVIDUAL_CASH': 'taxable', 'INDIVIDUAL_MARGIN': 'taxable'}
ROTH_WORDS = re.compile(r'\broth\b', re.I)
DEFERRED_WORDS = re.compile(r'\b(ira|401\(?k\)?|403\(?b\)?|sep|traditional|rollover|pension)(?![\w(])', re.I)
ACCOUNT_SUFFIX = re.compile(r'\s*(••|…)\s*\w+.*$')


def auto_type(name, webull_class=None):
    """The tax type without the owner's choice: Webull's account class for synced accounts, else whole words in the
    name (its "••1234" number suffix removed): Roth -> roth; IRA, 401(k), 403(b), SEP, traditional, rollover, pension
    -> deferred; anything else taxable."""
    cls = str(webull_class or '').strip().upper()
    if cls in WEBULL_CLASSES:
        return WEBULL_CLASSES[cls]
    n = ACCOUNT_SUFFIX.sub('', str(name or ''))
    if ROTH_WORDS.search(n):
        return 'roth'
    if DEFERRED_WORDS.search(n):
        return 'deferred'
    return 'taxable'


def tax_type(name, explicit=None, webull_class=None):
    """'roth', 'deferred' or 'taxable': the owner's choice (Portfolio.taxType) wins, else auto_type."""
    return explicit if explicit in TYPES else auto_type(name, webull_class)


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def tax_view(accounts, buys=None):
    """accounts: [{name, taxType?, webullAccount?, webullClass?, holdings: [{symbol, shares, value, cost, kind}]}]; buys: Webull fills
    in the last 31 days ([{symbol, qty, account, accountId}]) or None when unknown. A holding's recent (short-term)
    shares come from buys in its own Webull account; a wash sale can come from a buy in any account. Pure."""
    groups = {}
    taxable = []
    types = []
    bought = {}
    for b in buys or []:
        bought.setdefault(str(b.get('symbol') or '').upper(), []).append(b)
    for a in accounts if isinstance(accounts, list) else []:
        if not isinstance(a, dict):
            continue
        kind = tax_type(a.get('name'), a.get('taxType'), a.get('webullClass'))
        types.append({'name': a.get('name') or 'Account', 'auto': auto_type(a.get('name'), a.get('webullClass')), 'type': kind})
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
            own = a.get('webullAccount')
            recent = min(shares, sum(_num(b.get('qty')) or 0 for b in bought.get(symbol, []) if b.get('accountId') == own)) if buys is not None and own else None
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
        'accounts': types,
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
    if any(tax_type(a.get('name'), a.get('taxType'), a.get('webullClass')) == 'taxable' for a in accounts if isinstance(a, dict)) and webull.available():
        try:
            found = await webull.recent_buys(ctx)
            buys = found['buys']
            note = None if found['complete'] else 'Some Webull order history couldn’t be read, so recent purchases may be missing.'
        except Exception as err:  # Webull down or busy: say so, never guess
            note = f'Webull purchase history unavailable ({err}); wash sales can’t be checked.'
    return {**tax_view(accounts, buys), 'buysKnown': buys is not None, 'buysNote': note, 'buyDays': 31}
