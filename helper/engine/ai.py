"""
The AI assistant (Claude, through Anthropic's official Python SDK). It runs here in the helper so the API
key never reaches the browser. It answers with live platform data through tools (quotes, news, options,
insiders, financials, macro, portfolios, clients), can save portfolios and clients, and asks the browser
to open charts, add indicators or set price alerts. It can never place trades.
"""
import asyncio
import datetime as dt
import json
import uuid
from zoneinfo import ZoneInfo

import anthropic

from . import alts, flow, invest, macro, positioning, quant, research, sec, settings, store
from .core import EngineError, handler

EASTERN = ZoneInfo('America/New_York')
MAX_TURNS = 14
MAX_TOOL_RESULT_CHARS = 40000
MAX_CONVERSATIONS = 40
FALLBACK_MODELS = {'claude-opus-5-5', 'claude-sonnet-5-5'}
WEB_SEARCH_TOOL = {'type': 'web_search_20260209', 'name': 'web_search', 'max_uses': 5}
WEB_SEARCH_TOOL_BASIC = {'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 5}

SYSTEM_PROMPT = """You are the built-in assistant of the owner's personal trading and wealth-management platform \
(a Bloomberg-style workstation). The owner is building their skills, so explain things in plain language and keep \
answers well organised: short paragraphs, bullet points, and small tables for numbers. Lead with the answer.

You have tools for live data from the platform: real-time quotes and price history (Charles Schwab), market news \
(Google News and CNBC), options flow, SEC insider trades and financial statements, macro data (FRED), futures \
positioning (CFTC Commitment of Traders) and stock positioning (FINRA short volume), the bond market (yields, \
spreads, Treasury auctions), evergreen and private funds from SEC filings (NAV, holdings, Form D), plus the owner's \
saved portfolios, clients and alternative investments. Always use tools for anything that depends on current data instead of answering from \
memory, and say when the data is from (for example "as of 2:41 pm ET"). Use web search for recent events the \
news tool doesn't cover. When explaining why something moved, combine the price action with the news and \
positioning and say how confident you are.

You can act inside the platform: save or update portfolios and clients, run portfolio analysis and optimisation, \
and use ui_action to open a chart or page, add an indicator, or create a price alert. Do these when asked; for \
anything that changes saved data, say exactly what you saved. You cannot place, change or cancel trades or move \
money, and you must not claim to.

When asked whether to buy or sell, give a balanced, specific view: the bull case, the bear case, key price levels \
from the data, and a concrete plan with conditions ("if it closes above X, ...; if it breaks below Y, ..."), plus \
what would change the view. Note briefly that it's analysis, not personal financial advice. Never invent numbers: \
if a tool fails, say so.

Files the owner attaches (spreadsheets as CSV text, PDFs, images) come with their message; analyse them directly."""

INSIGHT_PROMPTS = {
    'options': 'Here is the current options-flow analysis for {symbol}. Explain what the options market is signalling: the overall bias (bullish, bearish or neutral, with a confidence level), what the put/call ratios, max pain, gamma exposure and the unusual trades suggest, the key price levels (biggest open-interest strikes, max pain, gamma flip area), and a game plan with specific conditions such as "if {symbol} reaches X, consider Y". End with the main risks.',
    'insiders': 'Here are recent SEC Form 4 insider transactions for {symbol}. Explain what insiders are doing, separate meaningful signals (open-market buys and large discretionary sales) from routine activity (awards, tax withholding, planned sales), and say whether this is bullish, bearish or neutral and how much weight to give it.',
    'cot': 'Here is Commitment of Traders data for {symbol} ({market}). Explain how speculators and commercial hedgers are positioned, whether positioning is near an extreme compared with the last three years, what that has historically meant, and what it suggests for the related stock or market, with conditions to watch.',
    'positioning': 'Here is a positioning summary for {symbol}: FINRA short-sale volume, related futures positioning (COT), options activity and insider trades. Pull it together: who is positioned how, whether the signals agree, the overall bias with a confidence level, key levels, and a specific game plan with conditions ("if it reaches X, do Y").',
    'research': 'Here are the financial statements, ratios and valuation for {symbol}. Give a concise investment summary: business quality (growth, margins, returns, balance sheet), valuation versus its own history and the market, the bull and bear case, and price levels or events that would change the view.',
    'indicator': 'Here is the {indicator} indicator on {symbol} ({timeframe}) with its latest values and recent history. Explain what it is saying right now for this stock, how reliable that signal tends to be, settings that suit this stock\'s behaviour, and how to combine it with other tools. Give concrete conditions to act on.',
    'chart': 'Here is recent price data for {symbol} ({timeframe}). Describe the trend, support and resistance, momentum and volatility, and give a game plan with specific levels.',
    'scanner': 'Here are the market scanner\'s current results: ranked setups with their signals, ATR-based trade plans, support and resistance, institutional flow (Williams A/D, money flow, COT, insiders, big options trades), and each signal\'s tested track record on that stock. Write a short trading-desk note: the market backdrop, the 2-3 best plays with entry, stop and targets and why, what would invalidate each, and which setups to avoid. Weigh the tested track record heavily and say plainly when evidence is thin. Use get_news for any fresh catalyst on the top names.',
    'market': 'Here is today\'s market snapshot from the platform\'s home page (major indexes with their latest change, and the top headlines). Explain what is driving the market today, whether the tone is risk-on or risk-off, what to watch next (upcoming events), and what it means for positioning. Be specific and use the numbers.',
    'macro': 'Here are the latest US economic readings (rates, inflation, jobs, growth, markets) with 1-month and 1-year changes, and the Treasury yield curve. Summarise where the economy is in the cycle, what the Fed is likely to do, whether conditions are bullish or bearish for stocks and bonds, and the key risks. Use the numbers.',
    'bonds': 'Here is the bond market: Treasury yields, corporate yields and credit spreads, real yields, breakeven inflation, and recent Treasury auctions. Explain what bonds are signalling about growth, inflation and risk appetite, whether now favours short or long maturities and credit vs Treasuries, and what to watch.',
    'board': 'Here is a market board from the Investments page ({market}): each line with today\'s change and 1-month, year-to-date and 1-year returns. Explain what is leading and lagging, what that says about the market (rotation, risk appetite), and which areas look strongest or weakest right now.',
    'fund': 'Here is SEC data on the private/evergreen fund {symbol}: NAV per share history, returns, distributions, holdings and Form D details. Summarise how the fund is doing, the distribution yield and whether it is covered, risks (liquidity, concentration, NAV lag), and how it compares with what an investor would expect from its strategy.',
    'backtest': 'Here are backtest results for a trading strategy on {symbol} ({timeframe}): performance statistics, Monte Carlo ranges and the random-walk test where available. Judge whether the edge is real or likely luck/curve-fitting, the main weaknesses, how to improve the rules, and whether it is worth paper trading. Be honest and specific.',
}

TOOLS = [
    {
        'name': 'get_quotes',
        'description': 'Real-time quotes from Schwab for up to 20 stocks, ETFs or indexes ($SPX, $DJI, $COMPX, $VIX, $RUT): last price, change, day range, volume, 52-week range, P/E.',
        'input_schema': {'type': 'object', 'properties': {'symbols': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Tickers, e.g. ["NVDA", "$SPX"]'}}, 'required': ['symbols']},
    },
    {
        'name': 'get_price_history',
        'description': 'Price history for one symbol with summary statistics (change, high, low) and a sampled list of bars.',
        'input_schema': {'type': 'object', 'properties': {
            'symbol': {'type': 'string'},
            'range': {'type': 'string', 'enum': ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y'], 'description': '1d and 5d use 5-minute bars, longer ranges daily bars.'},
        }, 'required': ['symbol', 'range']},
    },
    {
        'name': 'get_news',
        'description': 'Latest market news headlines, newest first, with a market-impact rating. Give symbols for company news, a query for a topic, or neither for general market news.',
        'input_schema': {'type': 'object', 'properties': {'symbols': {'type': 'array', 'items': {'type': 'string'}}, 'query': {'type': 'string'}}},
    },
    {
        'name': 'get_options_flow',
        'description': 'Options activity for a stock or ETF: put/call ratios, max pain, at-the-money implied volatility, gamma exposure, biggest open-interest strikes and unusual trades.',
        'input_schema': {'type': 'object', 'properties': {'symbol': {'type': 'string'}}, 'required': ['symbol']},
    },
    {
        'name': 'get_insider_trades',
        'description': 'Recent SEC Form 4 insider transactions for a US company.',
        'input_schema': {'type': 'object', 'properties': {'symbol': {'type': 'string'}}, 'required': ['symbol']},
    },
    {
        'name': 'get_company_financials',
        'description': 'Company profile, valuation (market cap, P/E, EV/EBITDA, FCF yield, beta), trailing-twelve-month figures, yearly ratios and statement highlights from SEC filings.',
        'input_schema': {'type': 'object', 'properties': {'symbol': {'type': 'string'}}, 'required': ['symbol']},
    },
    {
        'name': 'get_macro_snapshot',
        'description': 'Latest US economic data (rates, inflation, jobs, growth, VIX, credit spreads, oil, dollar) and the Treasury yield curve.',
        'input_schema': {'type': 'object', 'properties': {}},
    },
    {
        'name': 'get_positioning',
        'description': 'Who is positioned how in a stock: FINRA daily short-sale volume, related futures positioning (COT), options summary and insider summary.',
        'input_schema': {'type': 'object', 'properties': {'symbol': {'type': 'string'}}, 'required': ['symbol']},
    },
    {
        'name': 'get_private_fund',
        'description': 'SEC data on an evergreen or private fund (non-traded REITs and BDCs like BREIT, BCRED, Blue Owl OCIC; interval and tender-offer funds; any Form D private fund): NAV per share history, net assets, total return, distributions, latest NAV announcements, N-PORT holdings and monthly returns, Form D raise details, recent filings.',
        'input_schema': {'type': 'object', 'properties': {
            'name': {'type': 'string', 'description': 'Full fund name, e.g. "Blackstone Real Estate Income Trust"'},
            'cik': {'type': 'integer', 'description': 'SEC CIK number if known (from search_private_funds)'},
        }},
    },
    {
        'name': 'search_private_funds',
        'description': 'Search every Form D filed with the SEC (private funds and feeder funds, e.g. by manager or placement agent such as iCapital). Returns names, CIKs and latest filing dates.',
        'input_schema': {'type': 'object', 'properties': {'query': {'type': 'string'}}, 'required': ['query']},
    },
    {
        'name': 'get_bond_market',
        'description': 'The bond market now: Treasury yields, corporate yields and credit spreads, TIPS real yield, breakeven inflation, fed funds and mortgage rates (FRED, with 1-month and 1-year changes), plus recent and upcoming Treasury auctions.',
        'input_schema': {'type': 'object', 'properties': {}},
    },
    {
        'name': 'get_my_alternatives',
        'description': "The owner's own alternative investments (private funds, e.g. held through iCapital) with commitments, paid-in capital, distributions, value, unfunded amounts, TVPI and DPI.",
        'input_schema': {'type': 'object', 'properties': {}},
    },
    {
        'name': 'list_portfolios',
        'description': "The owner's saved portfolios with holdings and settings.",
        'input_schema': {'type': 'object', 'properties': {}},
    },
    {
        'name': 'save_portfolio',
        'description': 'Create a portfolio, or update one when id is given. Weights are percentages and are scaled to 100% when analysed.',
        'input_schema': {'type': 'object', 'properties': {
            'id': {'type': 'string', 'description': 'Existing portfolio id to update; omit to create a new one.'},
            'name': {'type': 'string'},
            'holdings': {'type': 'array', 'items': {'type': 'object', 'properties': {
                'symbol': {'type': 'string'}, 'weight': {'type': 'number'},
                'assetClass': {'type': 'string', 'enum': ['US stocks', 'International stocks', 'Bonds', 'Real estate', 'Commodities', 'Cash', 'Crypto', 'Private credit', 'Private real estate', 'Private equity', 'Infrastructure', 'Hedge funds', 'Other']},
            }, 'required': ['symbol', 'weight', 'assetClass']}},
            'benchmark': {'type': 'string', 'description': 'Default SPY'},
            'rebalance': {'type': 'string', 'enum': ['none', 'monthly', 'quarterly', 'yearly']},
        }, 'required': ['name', 'holdings']},
    },
    {
        'name': 'analyze_portfolio',
        'description': 'Historical performance and risk of a saved portfolio (portfolio_id) or a list of holdings: returns for YTD, 1/3/5/10 years and since inception, volatility, Sharpe, drawdown, stress tests, calendar years.',
        'input_schema': {'type': 'object', 'properties': {
            'portfolio_id': {'type': 'string'},
            'holdings': {'type': 'array', 'items': {'type': 'object', 'properties': {'symbol': {'type': 'string'}, 'weight': {'type': 'number'}}, 'required': ['symbol', 'weight']}},
            'benchmark': {'type': 'string'},
            'since': {'type': 'string', 'description': 'Optional start date YYYY-MM-DD'},
        }},
    },
    {
        'name': 'optimize_portfolio',
        'description': 'Suggested weights for a set of holdings: max_sharpe, min_var (lowest risk) or risk_parity.',
        'input_schema': {'type': 'object', 'properties': {
            'symbols': {'type': 'array', 'items': {'type': 'string'}},
            'method': {'type': 'string', 'enum': ['max_sharpe', 'min_var', 'risk_parity']},
            'max_weight': {'type': 'number', 'description': 'Largest weight per holding as a fraction, default 0.6'},
        }, 'required': ['symbols', 'method']},
    },
    {
        'name': 'list_clients',
        'description': "The owner's saved clients and which portfolio each follows.",
        'input_schema': {'type': 'object', 'properties': {}},
    },
    {
        'name': 'save_client',
        'description': 'Create a client, or update one when id is given.',
        'input_schema': {'type': 'object', 'properties': {
            'id': {'type': 'string'}, 'name': {'type': 'string'}, 'household': {'type': 'string'}, 'account_name': {'type': 'string'},
            'portfolio_id': {'type': 'string', 'description': 'A saved portfolio id, or a template: "template:Classic 60/40", "template:All-weather style", "template:Growth (90/10)"'}, 'inception': {'type': 'string', 'description': 'YYYY-MM-DD'},
            'initial_investment': {'type': 'number'}, 'fee_percent': {'type': 'number', 'description': 'Yearly advisory fee in percent, e.g. 1'},
        }, 'required': ['name']},
    },
    {
        'name': 'ui_action',
        'description': 'Do something in the platform window: open_chart (symbol, optional timeframe like 5m/1h/1D), open_page (page: home, chart, multi, invest, flow, research, macro, portfolio, clients, backtest, calendar, scripts), add_indicator (indicator name, e.g. "RSI" or "VWAP bands"), or create_alert (symbol, price, direction above/below, optional note).',
        'input_schema': {'type': 'object', 'properties': {
            'action': {'type': 'string', 'enum': ['open_chart', 'open_page', 'add_indicator', 'create_alert']},
            'symbol': {'type': 'string'}, 'timeframe': {'type': 'string'}, 'page': {'type': 'string'},
            'indicator': {'type': 'string'}, 'price': {'type': 'number'}, 'direction': {'type': 'string', 'enum': ['above', 'below']}, 'note': {'type': 'string'},
        }, 'required': ['action']},
    },
]
for _tool in TOOLS:
    _tool['eager_input_streaming'] = True

TOOL_LABELS = {
    'get_quotes': 'Getting live quotes', 'get_price_history': 'Reading price history', 'get_news': 'Reading the news',
    'get_options_flow': 'Checking options flow', 'get_insider_trades': 'Checking insider trades',
    'get_company_financials': 'Reading SEC financials', 'get_macro_snapshot': 'Checking the economy',
    'get_positioning': 'Checking positioning', 'get_private_fund': 'Reading the fund\'s SEC filings',
    'search_private_funds': 'Searching private funds', 'get_bond_market': 'Checking the bond market', 'get_my_alternatives': 'Looking at your alternatives', 'list_portfolios': 'Looking at your portfolios', 'save_portfolio': 'Saving the portfolio',
    'analyze_portfolio': 'Analysing the portfolio', 'optimize_portfolio': 'Optimising weights', 'list_clients': 'Looking at your clients',
    'save_client': 'Saving the client', 'ui_action': 'Updating the platform', 'web_search': 'Searching the web',
}

_conversations = {}
_client = None
_client_key = None


def client():
    global _client, _client_key
    key = settings.get('anthropic_key')
    if not key:
        raise EngineError('NO_AI_KEY')
    if _client is None or key != _client_key:
        _client = anthropic.AsyncAnthropic(api_key=key, max_retries=3)
        _client_key = key
    return _client


def _iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, EASTERN).strftime('%Y-%m-%d %H:%M ET') if ms else None


def _clip(value):
    text = json.dumps(value, default=str)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS] + ' …(cut for length)'
    return text


def _str(value, name):
    if not isinstance(value, str) or not value.strip():
        raise EngineError(f'"{name}" is required')
    return value.strip()


# ---------- Tools ----------

async def t_get_quotes(ctx, args, actions):
    symbols = [str(s).upper().strip() for s in args.get('symbols') or [] if str(s).strip()][:20]
    if not symbols:
        raise EngineError('No symbols given')
    response = await ctx.schwab.get_quotes(symbols)
    if response.status_code != 200:
        raise EngineError(f'Schwab returned {response.status_code}')
    out = {}
    for sym, data in response.json().items():
        q, f = data.get('quote', {}), data.get('fundamental', {})
        out[sym] = {
            'last': q.get('lastPrice'), 'change': q.get('netChange'), 'changePercent': q.get('netPercentChange'),
            'open': q.get('openPrice'), 'high': q.get('highPrice'), 'low': q.get('lowPrice'), 'prevClose': q.get('closePrice'),
            'volume': q.get('totalVolume'), 'high52': q.get('52WeekHigh'), 'low52': q.get('52WeekLow'),
            'peRatio': f.get('peRatio'), 'divYield': f.get('divYield'), 'asOf': _iso(q.get('quoteTime') or q.get('tradeTime')),
        }
    return out


async def t_get_price_history(ctx, args, actions):
    symbol = _str(args.get('symbol'), 'symbol').upper()
    rng = args.get('range', '3mo')
    now = dt.datetime.now(dt.timezone.utc)
    if rng in ('1d', '5d'):
        response = await ctx.schwab.get_price_history_every_five_minutes(
            symbol, start_datetime=now - dt.timedelta(days=1 if rng == '1d' else 7), end_datetime=now, need_extended_hours_data=False)
        if response.status_code != 200:
            raise EngineError(f'Schwab returned {response.status_code}')
        bars = [{'time': c['datetime'] // 1000, 'open': c['open'], 'high': c['high'], 'low': c['low'], 'close': c['close'], 'volume': c.get('volume', 0)}
                for c in response.json().get('candles', [])]
        if rng == '1d' and bars:
            last_day = dt.datetime.fromtimestamp(bars[-1]['time'], EASTERN).date()
            bars = [b for b in bars if dt.datetime.fromtimestamp(b['time'], EASTERN).date() == last_day]
    else:
        years = {'1mo': 1, '3mo': 1, '6mo': 1, '1y': 1, '5y': 5}[rng]
        bars = await ctx.daily_bars(symbol, years)
        days = {'1mo': 31, '3mo': 92, '6mo': 183, '1y': 366, '5y': 1830}[rng]
        cutoff = now.timestamp() - days * 86400
        bars = [b for b in bars if b['time'] >= cutoff]
    if not bars:
        raise EngineError(f'No price history for {symbol}')
    step = max(1, len(bars) // 100)
    sample = bars[::step] + ([bars[-1]] if (len(bars) - 1) % step else [])
    fmt = '%Y-%m-%d %H:%M' if rng in ('1d', '5d') else '%Y-%m-%d'
    return {
        'symbol': symbol, 'range': rng, 'bars': len(bars),
        'first': {'time': dt.datetime.fromtimestamp(bars[0]['time'], EASTERN).strftime(fmt), 'close': bars[0]['close']},
        'last': {'time': dt.datetime.fromtimestamp(bars[-1]['time'], EASTERN).strftime(fmt), 'close': bars[-1]['close']},
        'changePercent': 100 * (bars[-1]['close'] / bars[0]['open'] - 1),
        'high': max(b['high'] for b in bars), 'low': min(b['low'] for b in bars),
        'sample': [[dt.datetime.fromtimestamp(b['time'], EASTERN).strftime(fmt), round(b['close'], 4), b['volume']] for b in sample],
    }


async def t_get_news(ctx, args, actions):
    if ctx.news is None:
        raise EngineError('News is not available')
    symbols = [str(s).upper() for s in args.get('symbols') or []][:6]
    items, failed = await ctx.news.get(symbols, str(args.get('query') or ''))
    items = sorted(items, key=lambda i: i.get('published', 0), reverse=True)[:20]
    return {'items': [{'title': i['title'], 'source': i['source'], 'published': _iso(i['published'] * 1000), 'impact': i.get('impact'),
                       'summary': (i.get('summary') or '')[:300], 'link': i.get('link')} for i in items], 'unavailable': failed}


async def t_get_options_flow(ctx, args, actions):
    d = await flow.options(ctx, {'symbol': _str(args.get('symbol'), 'symbol')})
    top = sorted(d['strikes'], key=lambda r: r['callOi'] + r['putOi'], reverse=True)[:8]
    gex = sorted(d['gex'], key=lambda g: abs(g['gex']), reverse=True)[:8]
    return {'symbol': d['symbol'], 'spot': d['spot'], 'expiration': d['expiration'], 'summary': d['summary'], 'topOpenInterestStrikes': top,
            'largestGammaStrikes': gex, 'unusual': [{k: u[k] for k in ('type', 'strike', 'expiration', 'volume', 'oi', 'premium', 'side', 'iv')} for u in d['unusual'][:12]]}


async def t_get_insider_trades(ctx, args, actions):
    d = await sec.insiders(ctx, {'symbol': _str(args.get('symbol'), 'symbol')})
    return {**d, 'trades': [{k: t[k] for k in ('date', 'insider', 'title', 'type', 'shares', 'price', 'value')} for t in d['trades'][:30]]}


async def t_get_company_financials(ctx, args, actions):
    d = await research.company(ctx, {'symbol': _str(args.get('symbol'), 'symbol')})
    a = d['annual']
    pick = lambda keys: {k: a['values'][k][-5:] for k in keys}
    return {'symbol': d['symbol'], 'profile': d['profile'], 'quote': d['quote'], 'valuation': d['valuation'], 'ttm': d['ttm'],
            'fiscalYears': a['periods'][-5:], 'annual': pick(['revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'epsDiluted', 'freeCashFlow', 'cash', 'longTermDebt']),
            'ratios': {k: v[-5:] for k, v in d['ratios'].items()}}


async def t_get_macro_snapshot(ctx, args, actions):
    dash, curve = await asyncio.gather(macro.dashboard(ctx, {}), macro.curve(ctx, {}), return_exceptions=True)
    return {'series': dash.get('series') if isinstance(dash, dict) else str(dash),
            'yieldCurve': curve.get('curve') if isinstance(curve, dict) else str(curve)}


async def t_get_positioning(ctx, args, actions):
    d = await positioning.positioning(ctx, {'symbol': _str(args.get('symbol'), 'symbol')})
    if d.get('cot'):
        d['cot'] = {**{k: d['cot'][k] for k in ('market', 'reason')}, 'recentWeeks': d['cot']['rows'][-8:]}
    if d.get('shortVolume'):
        d['shortVolume'] = {**{k: d['shortVolume'][k] for k in ('avg5', 'avgAll', 'latest')}, 'recentDays': d['shortVolume']['rows'][-10:]}
    return d


async def t_get_private_fund(ctx, args, actions):
    if not args.get('name') and not args.get('cik'):
        raise EngineError('Give the fund name or CIK')
    d = await alts.fund(ctx, {'name': args.get('name') or '', 'cik': args.get('cik')})
    facts = d.get('facts') or {}
    out = {k: d.get(k) for k in ('cik', 'secName', 'navNotes', 'formD', 'schwab', 'errors')}
    out['facts'] = {k: v[-8:] for k, v in facts.items() if v}
    if d.get('nport'):
        n = d['nport']
        out['nport'] = {**{k: n[k] for k in ('date', 'netAssets', 'totalAssets', 'returns', 'holdingsCount', 'mix')}, 'topHoldings': n['topHoldings'][:8]}
    out['recentFilings'] = [{k: f[k] for k in ('form', 'filed', 'reportDate', 'url')} for f in d.get('filings', [])[:10]]
    return out


async def t_search_private_funds(ctx, args, actions):
    return (await alts.search_private(ctx, {'query': _str(args.get('query'), 'query')}))['results'][:25]


async def t_get_bond_market(ctx, args, actions):
    market, auctions = await asyncio.gather(invest.bond_market(ctx, {}), invest.auctions(ctx, {}), return_exceptions=True)
    out = {}
    if not isinstance(market, Exception):
        out['rates'] = [{k: s[k] for k in ('name', 'value', 'date', 'monthAgo', 'yearAgo')} for s in market['series']]
    if not isinstance(auctions, Exception):
        out['recentAuctions'] = auctions['results'][:12]
        out['upcomingAuctions'] = auctions['upcoming'][:10]
    if not out:
        raise EngineError(f'Bond data unavailable: {market}')
    return out


async def t_get_my_alternatives(ctx, args, actions):
    rows = []
    for d in store.list_docs('alt_holdings'):
        paid, dist, value, commit = d.get('contributed'), d.get('distributed') or 0, d.get('value'), d.get('commitment')
        rows.append({**{k: d.get(k) for k in ('fund', 'manager', 'strategy', 'account', 'commitment', 'contributed', 'distributed', 'value', 'valueDate')},
                     'unfunded': max(0, commit - paid) if commit is not None and paid is not None else None,
                     'tvpi': (dist + (value or 0)) / paid if paid else None, 'dpi': dist / paid if paid else None})
    return rows or {'note': 'No alternative investments saved yet (Investments > Alternatives > My alternatives).'}


async def t_list_portfolios(ctx, args, actions):
    return [{k: p.get(k) for k in ('id', 'name', 'benchmark', 'rebalance', 'holdings', 'inception')} for p in store.list_docs('portfolios')]


async def t_save_portfolio(ctx, args, actions):
    holdings = []
    for h in args.get('holdings') or []:
        symbol = str(h.get('symbol', '')).upper().strip()
        weight = float(h.get('weight') or 0)
        if symbol and weight > 0:
            holdings.append({'symbol': symbol, 'weight': round(weight, 2), 'assetClass': h.get('assetClass') or 'Other'})
    if not holdings:
        raise EngineError('A portfolio needs at least one holding with a weight above 0')
    doc = {'name': _str(args.get('name'), 'name'), 'holdings': holdings, 'benchmark': str(args.get('benchmark') or 'SPY').upper(),
           'rebalance': args.get('rebalance') if args.get('rebalance') in quant.REBALANCE else 'quarterly'}
    if args.get('id'):
        existing = store.get_doc('portfolios', str(args['id']))
        if not existing:
            raise EngineError('No portfolio with that id')
        doc = {**existing, **doc}
    saved = store.save_doc('portfolios', doc)
    actions.append({'action': 'refresh', 'what': 'portfolios'})
    return {'saved': True, 'id': saved['id'], 'name': saved['name'], 'holdings': saved['holdings']}


async def t_analyze_portfolio(ctx, args, actions):
    msg = {'benchmark': args.get('benchmark'), 'since': args.get('since')}
    if args.get('portfolio_id'):
        p = store.get_doc('portfolios', str(args['portfolio_id']))
        if not p:
            raise EngineError('No portfolio with that id')
        msg.update(holdings=p['holdings'], benchmark=args.get('benchmark') or p.get('benchmark'), rebalance=p.get('rebalance'))
    else:
        msg['holdings'] = args.get('holdings') or []
    d = await quant.analyze(ctx, msg)
    keep = ('cagr', 'totalReturn', 'volatility', 'sharpe', 'sortino', 'maxDrawdown', 'peak', 'trough', 'recovered', 'beta', 'correlation', 'var95', 'worstMonth', 'bestMonth')
    return {'start': d['start'], 'end': d['end'], 'benchmark': d['benchmark'], 'totalReturnIncludesDividends': d['totalReturn'],
            'trailing': d['trailing'], 'stats': {k: d['stats'][k] for k in keep}, 'benchmarkStats': {k: d['benchmarkStats'][k] for k in keep},
            'calendarYears': d['calendar'][-6:], 'stress': d['stress'], 'holdings': d['assets'],
            'growthOf10k': d['growth'][-1]['value'], 'benchmarkGrowthOf10k': d['benchmarkGrowth'][-1]['value']}


async def t_optimize_portfolio(ctx, args, actions):
    symbols = [str(s).upper() for s in args.get('symbols') or []]
    d = await quant.optimize(ctx, {'holdings': [{'symbol': s, 'weight': 1} for s in symbols], 'method': args.get('method', 'max_sharpe'),
                                   'maxWeight': float(args.get('max_weight') or 0.6), 'years': 10})
    return {'method': d['method'], 'since': d['start'], 'weights': dict(zip(d['symbols'], d['weights'])), 'expected': d['result'],
            'note': 'Expected figures are based on past returns, which may not repeat.'}


async def t_list_clients(ctx, args, actions):
    names = {p['id']: p['name'] for p in store.list_docs('portfolios')}
    return [{**{k: c.get(k) for k in ('id', 'name', 'household', 'accountName', 'inception', 'initialInvestment', 'fee')},
             'portfolio': names.get(c.get('portfolioId')) or (c.get('portfolioId') or 'none').replace('template:', 'template ')} for c in store.list_docs('clients')]


async def t_save_client(ctx, args, actions):
    doc = {}
    if args.get('id'):
        doc = store.get_doc('clients', str(args['id'])) or {}
        if not doc:
            raise EngineError('No client with that id')
    doc['name'] = _str(args.get('name') or doc.get('name'), 'name')
    for src, dst in (('household', 'household'), ('account_name', 'accountName'), ('portfolio_id', 'portfolioId'), ('inception', 'inception')):
        if args.get(src) is not None:
            doc[dst] = str(args[src])
    if args.get('initial_investment') is not None:
        doc['initialInvestment'] = float(args['initial_investment'])
    if args.get('fee_percent') is not None:
        doc['fee'] = float(args['fee_percent']) / 100
    doc.setdefault('fee', 0.01)
    doc.setdefault('initialInvestment', 100000)
    doc.setdefault('accountName', '')
    doc.setdefault('inception', '')
    doc.setdefault('portfolioId', '')
    if doc['portfolioId'] and not doc['portfolioId'].startswith('template:') and not store.get_doc('portfolios', doc['portfolioId']):
        raise EngineError('No portfolio with that id')
    saved = store.save_doc('clients', doc)
    actions.append({'action': 'refresh', 'what': 'clients'})
    return {'saved': True, 'id': saved['id'], 'name': saved['name']}


async def t_ui_action(ctx, args, actions):
    action = args.get('action')
    if action not in ('open_chart', 'open_page', 'add_indicator', 'create_alert'):
        raise EngineError('Unknown action')
    if action in ('open_chart', 'create_alert'):
        _str(args.get('symbol'), 'symbol')
    if action == 'create_alert' and not isinstance(args.get('price'), (int, float)):
        raise EngineError('An alert needs a price')
    actions.append({k: v for k, v in args.items() if v is not None})
    return {'done': True, 'note': 'The platform window carries this out when your reply is shown.'}


TOOL_FUNCS = {
    'get_quotes': t_get_quotes, 'get_price_history': t_get_price_history, 'get_news': t_get_news, 'get_options_flow': t_get_options_flow,
    'get_insider_trades': t_get_insider_trades, 'get_company_financials': t_get_company_financials, 'get_macro_snapshot': t_get_macro_snapshot,
    'get_positioning': t_get_positioning, 'get_private_fund': t_get_private_fund, 'search_private_funds': t_search_private_funds,
    'get_bond_market': t_get_bond_market, 'get_my_alternatives': t_get_my_alternatives, 'list_portfolios': t_list_portfolios, 'save_portfolio': t_save_portfolio,
    'analyze_portfolio': t_analyze_portfolio, 'optimize_portfolio': t_optimize_portfolio, 'list_clients': t_list_clients,
    'save_client': t_save_client, 'ui_action': t_ui_action,
}


async def run_tool(ctx, block, actions):
    func = TOOL_FUNCS.get(block.name)
    args = block.input if isinstance(block.input, dict) else None
    if func is None or args is None:
        return {'type': 'tool_result', 'tool_use_id': block.id, 'is_error': True, 'content': 'INVALID_JSON: the tool input could not be read; try again.'}
    try:
        result = await asyncio.wait_for(func(ctx, args, actions), timeout=90)
        return {'type': 'tool_result', 'tool_use_id': block.id, 'content': _clip(result)}
    except Exception as err:  # Report the failure to the model instead of crashing the conversation.
        return {'type': 'tool_result', 'tool_use_id': block.id, 'is_error': True, 'content': f'Error: {err}'}


# ---------- Conversation loop ----------

def _request_options(model):
    opts = {'model': model, 'max_tokens': 32000, 'system': SYSTEM_PROMPT, 'cache_control': {'type': 'ephemeral'},
            'output_config': {'effort': 'medium'}}
    if model in FALLBACK_MODELS:
        # If the model declines on a safety false positive, the API retries on a suitable model in the same call.
        opts.update(betas=['server-side-fallback-2026-07-01'], fallbacks='default')
    return opts


def _friendly_api_error(err):
    if isinstance(err, anthropic.AuthenticationError):
        return 'Your Anthropic API key was rejected. Check it in Settings (gear icon, bottom left).'
    if isinstance(err, anthropic.PermissionDeniedError):
        return 'Your Anthropic account doesn’t have access to this model. Pick another model in Settings.'
    if isinstance(err, anthropic.RateLimitError):
        return 'The AI is busy (rate limit). Wait a few seconds and try again.'
    if isinstance(err, anthropic.BadRequestError):
        text = str(err)
        if 'credit' in text.lower() or 'billing' in text.lower():
            return 'Your Anthropic account is out of credit. Add credit at console.anthropic.com → Billing.'
        return f'The AI couldn’t process that request: {getattr(err, "message", text)}'
    if isinstance(err, anthropic.APIConnectionError):
        return 'Couldn’t reach the AI service. Check your internet connection.'
    if isinstance(err, anthropic.APIStatusError):
        return f'The AI service had a problem ({err.status_code}). Try again in a moment.'
    return str(err)


async def converse(ctx, messages, emit, tools=True, effort=None):
    """Runs the model (and its tool calls) until it answers. Appends to `messages`; returns (text, actions)."""
    model = settings.get('model', settings.DEFAULT_MODEL)
    opts = _request_options(model)
    if effort:
        opts['output_config'] = {'effort': effort}
    if tools:
        opts['tools'] = TOOLS + [WEB_SEARCH_TOOL_BASIC if model == 'claude-haiku-5-5' else WEB_SEARCH_TOOL]
    actions, answer = [], []
    json_retries = 0
    turn = 0
    while turn < MAX_TURNS:
        turn += 1
        turn_start = len(answer)
        try:
            async with client().beta.messages.stream(messages=messages, **opts) as stream:
                async for event in stream:
                    if event.type == 'text':
                        answer.append(event.text)
                        await emit({'type': 'text', 'text': event.text})
                    elif event.type == 'content_block_start' and event.content_block.type in ('tool_use', 'server_tool_use'):
                        name = event.content_block.name
                        await emit({'type': 'status', 'text': TOOL_LABELS.get(name, 'Working') + '…'})
                response = await stream.get_final_message()
            json_retries = 0
        except ValueError:
            # A tool input the SDK couldn't parse at all; ask again (bounded).
            json_retries += 1
            del answer[turn_start:]  # drop text from the garbled attempt; the retry writes it again
            if json_retries > 2:
                raise EngineError('The AI sent an unreadable request twice. Please rephrase and try again.')
            turn -= 1
            continue
        except anthropic.APIError as err:
            raise EngineError(_friendly_api_error(err)) from err

        messages.append({'role': 'assistant', 'content': response.content})
        if response.stop_reason == 'refusal':
            note = '\n\nI can’t help with that request.'
            answer.append(note)
            await emit({'type': 'text', 'text': note})
            break
        if response.stop_reason == 'pause_turn':
            continue
        tool_uses = [b for b in response.content if b.type == 'tool_use']
        if not tool_uses:
            if response.stop_reason == 'max_tokens':
                note = '\n\n_(Answer cut short: it reached the length limit.)_'
                answer.append(note)
                await emit({'type': 'text', 'text': note})
            break
        if response.stop_reason == 'max_tokens':
            raise EngineError('The AI’s request was cut off. Please try again.')
        results = await asyncio.gather(*(run_tool(ctx, b, actions) for b in tool_uses))
        messages.append({'role': 'user', 'content': list(results)})
        if answer and not answer[-1].endswith('\n'):
            answer.append('\n\n')
            await emit({'type': 'text', 'text': '\n\n'})
    else:
        note = '\n\n_(Stopped after many steps. Ask me to continue if needed.)_'
        answer.append(note)
        await emit({'type': 'text', 'text': note})
    return ''.join(answer).strip(), actions


def _attachment_blocks(attachments):
    blocks = []
    for a in attachments or []:
        name = str(a.get('name', 'file'))[:120]
        kind = a.get('kind')
        data = a.get('data') or ''
        if kind == 'text':
            blocks.append({'type': 'text', 'text': f'<file name="{name}">\n{data}\n</file>'})
        elif kind == 'pdf':
            blocks.append({'type': 'document', 'title': name, 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': data}})
        elif kind == 'image':
            media = a.get('mediaType') if a.get('mediaType') in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') else 'image/png'
            blocks.append({'type': 'image', 'source': {'type': 'base64', 'media_type': media, 'data': data}})
    return blocks


def _context_text(context):
    now = dt.datetime.now(EASTERN).strftime('%A %B %d, %Y, %I:%M %p ET')
    parts = [f'Now: {now}.']
    if isinstance(context, dict):
        if context.get('page'):
            parts.append(f"Page open: {context['page']}.")
        if context.get('symbol'):
            parts.append(f"Chart symbol: {context['symbol']} ({context.get('timeframe', '')}).")
    return '[Platform context] ' + ' '.join(parts)


@handler('ai.chat')
async def chat(ctx, msg):
    emit = msg.get('_emit') or (lambda e: asyncio.sleep(0))
    text = str(msg.get('message') or '').strip()
    files = _attachment_blocks(msg.get('attachments'))
    if not text and not files:
        raise EngineError('Type a question')
    conv_id = str(msg.get('conversation') or '') or uuid.uuid4().hex[:12]
    messages = _conversations.setdefault(conv_id, [])
    if len(_conversations) > MAX_CONVERSATIONS:
        _conversations.pop(next(iter(_conversations)))
    content = files + [{'type': 'text', 'text': f"{_context_text(msg.get('context'))}\n\n{text or 'Please analyse the attached file(s).'}"}]
    start = len(messages)
    messages.append({'role': 'user', 'content': content})
    try:
        answer, actions = await converse(ctx, messages, emit)
    except Exception:
        del messages[start:]  # keep the conversation valid for the next question
        raise
    return {'conversation': conv_id, 'text': answer, 'actions': actions}


@handler('ai.insight')
async def insight(ctx, msg):
    """A one-off AI read of the data on screen (options flow, insiders, COT, positioning, research, an indicator)."""
    emit = msg.get('_emit') or (lambda e: asyncio.sleep(0))
    topic = msg.get('topic')
    if topic not in INSIGHT_PROMPTS:
        raise EngineError('Unknown topic')
    fields = {'symbol': str(msg.get('symbol') or ''), 'market': str(msg.get('market') or ''), 'indicator': str(msg.get('indicator') or ''),
              'timeframe': str(msg.get('timeframe') or '')}
    prompt = INSIGHT_PROMPTS[topic].format(**fields)
    data = _clip(msg.get('data'))
    content = [{'type': 'text', 'text': f"{_context_text(None)}\n\n{prompt}\n\nKeep it to about 250-400 words with clear headings.\n\n<data>\n{data}\n</data>"}]
    messages = [{'role': 'user', 'content': content}]
    # Same tools as the chat, so a follow-up question continues the identical request setup.
    answer, _ = await converse(ctx, messages, emit)
    # Keep it as a conversation so the owner can ask follow-up questions in the assistant.
    conv_id = uuid.uuid4().hex[:12]
    _conversations[conv_id] = messages
    return {'conversation': conv_id, 'text': answer}


@handler('ai.reset')
async def reset(ctx, msg):
    _conversations.pop(str(msg.get('conversation') or ''), None)
    return {'ok': True}
