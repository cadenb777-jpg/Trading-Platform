"""The quant pack: options (helper/engine/options_math.py), the portfolio tear sheet (tearsheet.py) and comparable
companies (comps.py), against textbook values and hand-worked examples."""
import asyncio
import datetime as dt
import math
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np  # noqa: E402

from engine import comps, options_math as om, tearsheet as ts  # noqa: E402


class BlackScholes(unittest.TestCase):
    def test_hull_example_15_6(self):
        # Hull, Options, Futures, and Other Derivatives (8th ed.) Example 15.6: S 42, K 40, r 10%, sigma 20%, 6 months
        self.assertAlmostEqual(om.price(42, 40, 0.5, 0.10, 0.20, 0, 'call'), 4.76, places=2)
        self.assertAlmostEqual(om.price(42, 40, 0.5, 0.10, 0.20, 0, 'put'), 0.81, places=2)

    def test_hull_chapter_19_greeks(self):
        # Hull ch. 19 (the Greek letters): S 49, K 50, r 5%, sigma 20%, 20 weeks; call worth about $2.40
        S, K, T, r, v = 49, 50, 20 / 52, 0.05, 0.20
        self.assertAlmostEqual(om.price(S, K, T, r, v), 2.40, places=2)
        g = om.greeks(S, K, T, r, v)
        self.assertAlmostEqual(g['delta'], 0.522, places=3)
        self.assertAlmostEqual(g['gamma'], 0.066, places=3)
        self.assertAlmostEqual(g['vegaYear'], 12.1, places=1)
        self.assertAlmostEqual(g['thetaYear'], -4.31, places=2)
        self.assertAlmostEqual(g['rhoYear'], 8.91, places=2)
        # trader units: per vol point, per calendar day, per rate point
        self.assertAlmostEqual(g['vega'], g['vegaYear'] / 100)
        self.assertAlmostEqual(g['theta'], g['thetaYear'] / 365)
        self.assertAlmostEqual(g['rho'], g['rhoYear'] / 100)

    def test_hull_index_option_with_dividend_yield(self):
        # Hull Example 17.1: index 930, K 900, r 8%, sigma 20%, 2 months, dividend yield 3% a year -> 51.83
        self.assertAlmostEqual(om.price(930, 900, 2 / 12, 0.08, 0.20, 0.03, 'call'), 51.83, places=2)

    def test_put_call_parity_with_dividends(self):
        S, K, T, r, q, v = 100, 95, 0.75, 0.04, 0.02, 0.3
        c, p = om.price(S, K, T, r, v, q, 'call'), om.price(S, K, T, r, v, q, 'put')
        self.assertAlmostEqual(c - p, S * math.exp(-q * T) - K * math.exp(-r * T), places=10)

    def test_put_greeks_match_finite_differences(self):
        S, K, T, r, q, v = 100, 110, 0.4, 0.03, 0.01, 0.25
        g = om.greeks(S, K, T, r, v, q, 'put')
        h = 1e-4
        self.assertAlmostEqual(g['delta'], (om.price(S + h, K, T, r, v, q, 'put') - om.price(S - h, K, T, r, v, q, 'put')) / (2 * h), places=6)
        self.assertAlmostEqual(g['vegaYear'], (om.price(S, K, T, r, v + h, q, 'put') - om.price(S, K, T, r, v - h, q, 'put')) / (2 * h), places=5)
        self.assertAlmostEqual(g['rhoYear'], (om.price(S, K, T, r + h, v, q, 'put') - om.price(S, K, T, r - h, v, q, 'put')) / (2 * h), places=5)
        self.assertAlmostEqual(g['thetaYear'], -(om.price(S, K, T + h, r, v, q, 'put') - om.price(S, K, T - h, r, v, q, 'put')) / (2 * h), places=4)

    def test_implied_vol_recovers_the_input(self):
        for K in (60, 80, 100, 120, 160):
            for kind in ('call', 'put'):
                for v in (0.08, 0.3, 1.2):
                    p = om.price(100, K, 0.3, 0.04, v, 0.01, kind)
                    if p - om.price(100, K, 0.3, 0.04, om.IV_LO, 0.01, kind) < 1e-4:
                        continue  # no time value to read a volatility from (deep in or far out of the money)
                    self.assertAlmostEqual(om.implied_vol(p, 100, K, 0.3, 0.04, 0.01, kind), v, places=4, msg=(K, kind, v))

    def test_implied_vol_bisection_fallback_far_from_the_money(self):
        # tiny vega: Newton's first step leaves the range, bisection still finds it
        p = om.price(100, 150, 0.1, 0.03, 0.33)
        self.assertAlmostEqual(om.implied_vol(p, 100, 150, 0.1, 0.03), 0.33, places=4)

    def test_implied_vol_none_outside_no_arbitrage_bounds(self):
        self.assertIsNone(om.implied_vol(1.0, 42, 40, 0.5, 0.1))  # below intrinsic value (about 3.95)
        self.assertIsNone(om.implied_vol(50.0, 42, 40, 0.5, 0.1))  # above the stock price
        self.assertIsNone(om.implied_vol(None, 42, 40, 0.5, 0.1))

    def test_year_fraction_to_four_pm_new_york(self):
        now = dt.datetime(2026, 11, 5, 21, 0, tzinfo=dt.timezone.utc)  # 4:00 pm EST
        self.assertAlmostEqual(om.year_fraction('2026-11-06', now), 1 / 365)
        self.assertAlmostEqual(om.year_fraction('2026-11-05', now), om.MIN_T)  # expired today: floor of an hour

    def test_expected_move(self):
        m = om.expected_move(100, 0.2, 0.25)
        self.assertAlmostEqual(m['amount'], 10.0)
        self.assertAlmostEqual(m['percent'], 0.10)
        self.assertAlmostEqual(m['low'], 100 * math.exp(-0.1))
        self.assertAlmostEqual(m['high'], 100 * math.exp(0.1))
        self.assertIsNone(om.expected_move(100, None, 0.25))


def _chain(spot, now, r, q, exps, smile):
    """Contracts priced exactly by BSM with a known IV per strike (bid = ask = model price)."""
    out = []
    for exp in exps:
        T = om.year_fraction(exp, now)
        for K in range(70, 131, 5):
            v = smile(K, T)
            for kind in ('call', 'put'):
                p = om.price(spot, K, T, r, v, q, kind)
                out.append({'type': kind, 'expiration': exp, 'dte': round(T * 365), 'strike': float(K), 'bid': p, 'ask': p, 'mark': p, 'last': p,
                            'volume': 10, 'oi': 100, 'iv': v * 100, 'delta': None, 'gamma': None})
    return out


class OptionAnalytics(unittest.TestCase):
    now = dt.datetime(2026, 11, 5, 15, 0, tzinfo=dt.timezone.utc)

    def test_smile_term_structure_and_skew_from_a_known_surface(self):
        # IV falls with strike (equity skew) and rises with time: 20% at the money in 1 year
        smile = lambda K, T: 0.20 + 0.02 * math.sqrt(T) - 0.002 * (K - 100)  # noqa: E731
        chain = _chain(100, self.now, 0.04, 0.01, ['2026-12-18', '2027-06-17'], smile)
        out = om.analytics(chain, 100, self.now, 0.04, 0.01)
        self.assertEqual(out['expiration'], '2026-12-18')
        for row in out['smile']:
            self.assertAlmostEqual(row['iv'], smile(row['strike'], out['years']), places=4)
        near, far = out['term']
        fwd_near = 100 * math.exp(0.03 * near['years'])
        self.assertAlmostEqual(near['atmIv'], smile(fwd_near, near['years']), places=3)
        self.assertGreater(far['atmIv'], near['atmIv'] - 0.01)
        self.assertGreater(near['skew']['riskReversal'], 0)  # puts dearer than calls
        self.assertAlmostEqual(near['skew90110'], smile(90, near['years']) - smile(110, near['years']), places=4)
        g = next(x for x in out['greeks'] if x['strike'] == 100)
        self.assertAlmostEqual(g['call']['iv'], smile(100, out['years']), places=4)
        self.assertAlmostEqual(g['call']['delta'] - g['put']['delta'], math.exp(-0.01 * out['years']), places=6)

    def test_smile_uses_the_out_of_the_money_side(self):
        chain = _chain(100, self.now, 0.04, 0.0, ['2026-12-18'], lambda K, T: 0.25)
        fwd = 100 * math.exp(0.04 * om.year_fraction('2026-12-18', self.now))
        for c in chain:  # make the in-the-money side (against the forward) unusable: a mid below intrinsic value
            if (c['type'] == 'call') == (c['strike'] < fwd):
                c['bid'] = c['ask'] = 0.01
        rows, fwd = om.smile([c for c in chain], 100, om.year_fraction('2026-12-18', self.now), 0.04, 0.0)
        self.assertTrue(all(abs(r['iv'] - 0.25) < 1e-4 for r in rows))

    def test_penny_quotes_and_no_bid_carry_no_volatility(self):
        self.assertIsNone(om.usable_price({'bid': 0.01, 'ask': 0.03}))
        self.assertIsNone(om.usable_price({'bid': 0, 'ask': 0.40}))
        self.assertAlmostEqual(om.usable_price({'bid': 1.0, 'ask': 1.2}), 1.1)
        self.assertEqual(om.usable_price({'bid': 0, 'ask': 0, 'mark': 0.5}), 0.5)

    def test_greeks_use_the_out_of_the_money_volatility_for_both_sides(self):
        chain = _chain(100, self.now, 0.04, 0.0, ['2026-12-18'], lambda K, T: 0.25)
        for c in chain:  # a noisy in-the-money quote must not change the greeks
            if c['type'] == 'call' and c['strike'] == 90:
                c['bid'], c['ask'] = c['bid'] - 0.3, c['ask'] + 0.4
        T = om.year_fraction('2026-12-18', self.now)
        row = next(x for x in om.greek_table(chain, 100, T, 0.04, 0.0) if x['strike'] == 90)
        self.assertAlmostEqual(row['iv'], 0.25, places=4)
        self.assertAlmostEqual(row['call']['iv'], row['put']['iv'])
        self.assertAlmostEqual(row['call']['schwabIv'], 0.25)  # Schwab's own figure, per contract, kept beside ours
        rows, _ = om.smile(chain, 100, T, 0.04, 0.0)
        r90 = next(x for x in rows if x['strike'] == 90)
        self.assertAlmostEqual(r90['schwabCallIv'], 0.25)
        self.assertAlmostEqual(r90['schwabPutIv'], 0.25)
        self.assertAlmostEqual(row['call']['delta'], om.greeks(100, 90, T, 0.04, row['iv'], 0.0, 'call')['delta'])

    def test_no_chain_is_an_error(self):
        with self.assertRaises(Exception):
            om.analytics([], 100, self.now, 0.04, 0.0)


class TearSheetMaths(unittest.TestCase):
    def test_historical_var_and_shortfall(self):
        r = np.round(np.arange(-0.10, 0.095, 0.01), 4)  # -10% .. +9%, 20 days
        var, cvar = ts.historical_var(r, 0.95)
        self.assertAlmostEqual(var, 0.0905)  # numpy's linear interpolation between the two worst days
        self.assertAlmostEqual(cvar, 0.10)

    def test_parametric_var_matches_jorion(self):
        # normal: VaR 95% = 1.645 sd, expected shortfall 95% = 2.063 sd (Jorion, Value at Risk, ch. 5)
        var, cvar = ts.parametric_var(0.0, 0.01, 0.95)
        self.assertAlmostEqual(var, 0.0164485, places=6)
        self.assertAlmostEqual(cvar, 0.0206271, places=6)
        var99, _ = ts.parametric_var(0.0, 0.01, 0.99)
        self.assertAlmostEqual(var99, 0.0232635, places=6)
        var10, _ = ts.parametric_var(0.0, 0.01, 0.95, 10)
        self.assertAlmostEqual(var10, 0.0164485 * math.sqrt(10), places=6)
        self.assertAlmostEqual(ts.parametric_var(0.001, 0.01, 0.95, 10)[0], 0.0164485 * math.sqrt(10) - 0.01, places=6)

    def test_horizon_returns_compound_overlapping_days(self):
        np.testing.assert_allclose(ts.horizon_returns([0.1, 0.1, -0.5], 2), [0.21, -0.45])

    def test_var_table_has_both_levels_and_horizons(self):
        rng = np.random.default_rng(3)
        rows = ts.var_table(rng.normal(0, 0.01, 2000))
        self.assertEqual([(x['level'], x['days']) for x in rows], [(0.95, 1), (0.99, 1), (0.95, 10), (0.99, 10)])
        for x in rows:
            self.assertGreater(x['historicalCvar'], x['historical'])
            self.assertAlmostEqual(x['historical'] / x['parametric'], 1, delta=0.15)  # normal data: the two agree

    def test_drawdown_table(self):
        d = [dt.date(2026, 1, 1) + dt.timedelta(days=i) for i in range(6)]
        out = ts.drawdowns([0.1, -0.5, 0.2, 1.0, -0.1], d)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], {'start': '2026-01-02', 'trough': '2026-01-03', 'recovered': '2026-01-05', 'depth': -0.5, 'days': 3, 'toTrough': 1})
        self.assertEqual(out[1]['start'], '2026-01-05')
        self.assertIsNone(out[1]['recovered'])
        self.assertAlmostEqual(out[1]['depth'], -0.1)
        self.assertEqual(out[1]['days'], 1)  # still under water: counted to the last day

    def test_monthly_table(self):
        d = [dt.date(2025, 12, 31), dt.date(2026, 1, 2), dt.date(2026, 1, 5), dt.date(2026, 2, 2)]
        out = ts.monthly_table([0.1, 0.1, -0.5], d)
        self.assertEqual(out[0]['year'], 2026)
        self.assertAlmostEqual(out[0]['months'][0], 0.21)
        self.assertAlmostEqual(out[0]['months'][1], -0.5)
        self.assertIsNone(out[0]['months'][2])
        self.assertAlmostEqual(out[0]['total'], 1.21 * 0.5 - 1)

    def test_monte_carlo_constant_returns_has_no_spread(self):
        mc = ts.monte_carlo(np.full(300, 0.001), 1000, years=3, paths=50)
        for p in ('5', '50', '95'):
            np.testing.assert_allclose(mc['percentiles'][p], [1000 * 1.001 ** (252 * k) for k in range(4)], rtol=1e-5)
        self.assertEqual(mc['lossChance'][1:], [0.0, 0.0, 0.0])

    def test_monte_carlo_is_seeded(self):
        r = np.random.default_rng(1).normal(0.0003, 0.01, 800)
        self.assertEqual(ts.monte_carlo(r, 1e5, 5, 200), ts.monte_carlo(r, 1e5, 5, 200))
        self.assertIsNone(ts.monte_carlo(r[:20], 1e5))

    def test_risk_split(self):
        rng = np.random.default_rng(5)
        a = rng.normal(0, 0.01, (5000, 2))
        share, vol_part, vol = ts.risk_split(a, [0.5, 0.5])
        self.assertAlmostEqual(share.sum(), 1.0)
        self.assertAlmostEqual(vol_part.sum(), vol)
        np.testing.assert_allclose(share, [0.5, 0.5], atol=0.03)
        share, _, _ = ts.risk_split(np.column_stack([a[:, 0], np.zeros(5000)]), [0.5, 0.5])  # cash adds no risk
        np.testing.assert_allclose(share, [1.0, 0.0])

    def test_rolling_beta_and_sharpe(self):
        b = np.random.default_rng(2).normal(0.0005, 0.01, 300)
        betas, sharpes = ts.rolling(2 * b, b, 0.0, window=126)
        self.assertEqual(len(betas), 300 - 126 + 1)
        np.testing.assert_allclose(betas, 2.0)
        x = 2 * b[-126:]
        self.assertAlmostEqual(sharpes[-1], x.mean() * 252 / (x.std(ddof=1) * math.sqrt(252)))


class TearSheetRequest(unittest.TestCase):
    def test_handler_on_made_up_prices(self):
        rng = np.random.default_rng(9)
        days = [dt.date(2022, 1, 3) + dt.timedelta(days=i) for i in range(700)]
        prices = np.cumprod(1 + rng.normal(0.0004, 0.01, (700, 3)), axis=0) * 100

        async def matrix(ctx, symbols, years):
            self.assertEqual(symbols, ['AAPL', 'MSFT', 'SPY'])
            return days, prices, {'last': prices[-1].tolist(), 'dividends': [True, True, False]}

        async def rf(ctx):
            return 0.04
        with mock.patch.object(ts.quant, 'price_matrix', matrix), mock.patch.object(ts.quant, 'risk_free', rf):
            out = asyncio.run(ts.tearsheet(None, {'holdings': [{'symbol': 'AAPL', 'weight': 50}, {'symbol': 'MSFT', 'weight': 30}, {'symbol': 'CASH', 'weight': 20}], 'value': 50000, 'horizon': 3}))
        self.assertEqual(out['symbols'], ['AAPL', 'MSFT', 'CASH'])
        self.assertEqual(out['correlation']['symbols'], ['AAPL', 'MSFT'])
        self.assertEqual(out['priceOnly'], ['SPY'])
        self.assertEqual(out['monteCarlo']['years'], 3)
        self.assertEqual(out['monteCarlo']['start'], 50000)
        self.assertAlmostEqual(sum(x['share'] for x in out['risk']), 1.0)
        self.assertEqual(next(x for x in out['risk'] if x['symbol'] == 'CASH')['share'], 0.0)
        self.assertEqual(len(out['var']), 4)
        self.assertLessEqual(len(out['drawdowns']), 5)

    def test_no_holdings(self):
        with self.assertRaises(Exception):
            asyncio.run(ts.tearsheet(None, {'holdings': [{'symbol': 'AAPL', 'weight': 0}]}))


def _core(revenue, gross, op, net, dna, eps, equity, debt, cash, shares, last_years=(80.0, 100.0)):
    from engine import research
    blank = {k: [None, None] for k, _, _ in research.INCOME + research.BALANCE + research.CASH_FLOW} | {'freeCashFlow': [None, None]}
    annual_keys = blank | {'revenue': list(last_years), 'grossProfit': [None, gross], 'operatingIncome': [None, op], 'netIncome': [None, net], 'dna': [None, dna],
                   'epsDiluted': [None, eps], 'equity': [None, equity], 'longTermDebt': [None, debt], 'cash': [None, cash], 'shortInvestments': [None, 0],
                   'dilutedShares': [None, shares]}
    q = {k: [None] * 4 for k in annual_keys}
    for k in ('equity', 'longTermDebt', 'cash', 'shortInvestments'):  # balance-sheet items come from the latest quarter
        q[k][-1] = annual_keys[k][-1]
    return {'statements': {'annual': {'periods': ['2024-12-31', '2025-12-31'], 'values': annual_keys}, 'quarterly': {'periods': [''] * 4, 'values': q}}, 'shares': shares}


class Comparables(unittest.TestCase):
    def test_metrics_by_hand(self):
        # revenue 100, EBITDA = 20 operating + 5 D&A = 25, net 10, equity 50, debt 30, cash 10, 10 shares at $40
        m = comps.metrics(_core(100, 40, 20, 10, 5, 1.0, 50, 30, 10, 10), 40.0)
        self.assertEqual(m['marketCap'], 400)
        self.assertEqual(m['enterpriseValue'], 420)
        self.assertAlmostEqual(m['evEbitda'], 16.8)
        self.assertAlmostEqual(m['pe'], 40)
        self.assertAlmostEqual(m['ps'], 4)
        self.assertAlmostEqual(m['pb'], 8)
        self.assertAlmostEqual(m['evSales'], 4.2)
        self.assertAlmostEqual(m['revenueGrowth'], 0.25)
        self.assertAlmostEqual(m['grossMargin'], 0.4)
        self.assertAlmostEqual(m['operatingMargin'], 0.2)
        self.assertAlmostEqual(m['netMargin'], 0.1)

    def test_losses_give_no_multiple(self):
        m = comps.metrics(_core(100, 40, -20, -10, 5, -1.0, -5, 30, 10, 10), 40.0)
        self.assertIsNone(m['evEbitda'])
        self.assertIsNone(m['pe'])
        self.assertIsNone(m['pb'])
        self.assertAlmostEqual(m['netMargin'], -0.1)

    def test_parse_browse_feed(self):
        text = ('<feed><entry><content type="text/xml"><company-info><cik>0000320193</cik><name>Apple</name></company-info></content>'
                '<id>urn:tag:www.sec.gov:cik=0000320193</id></entry><entry><id>urn:tag:www.sec.gov:cik=0001018724</id></entry></feed>')
        self.assertEqual(comps.parse_browse(text), [320193, 1018724])

    def test_handler_finds_sic_peers_and_reports_failures(self):
        core = _core(100, 40, 20, 10, 5, 1.0, 50, 30, 10, 10)
        listed = {'AAPL': {'cik': 1, 'name': 'Apple'}, 'DELL': {'cik': 2, 'name': 'Dell'}, 'HPQ': {'cik': 3, 'name': 'HP'}, 'BAD': {'cik': 4, 'name': 'Bad'}}

        async def company(ctx, s):
            return listed[s]

        async def tickers(ctx):
            return listed

        async def submissions(ctx, cik):
            return {'name': 'Apple Inc.', 'sic': '3571', 'sicDescription': 'Electronic Computers'}

        async def company_core(ctx, cik):
            if cik == 4:
                raise ValueError('no facts')
            return core

        async def quotes(ctx, symbols):
            return {s: {'price': 40.0} for s in symbols}

        class Resp:
            text = '<cik>0000000002</cik><cik>0000000003</cik><cik>0000000004</cik><cik>0000000001</cik>'

        async def sec_get(ctx, url):
            self.assertIn('SIC=3571', url)
            return Resp()

        async def revenues(ctx):
            return {2: 90, 3: 300, 4: 100}

        class Ctx:
            async def cached(self, key, age, load, **kw):
                return await load()

        with mock.patch.object(comps.sec, 'company', company), mock.patch.object(comps.sec, 'tickers', tickers), \
                mock.patch.object(comps.sec, 'submissions', submissions), mock.patch.object(comps.sec, 'sec_get', sec_get), \
                mock.patch.object(comps.research, 'company_core', company_core), mock.patch.object(comps.invest, 'quotes', quotes), \
                mock.patch.object(comps, '_revenues', revenues):
            out = asyncio.run(comps.comps(Ctx(), {'symbol': 'aapl'}))
            typed = asyncio.run(comps.comps(Ctx(), {'symbol': 'AAPL', 'peers': ['hpq', 'AAPL']}))
        self.assertEqual(out['sic'], '3571')
        self.assertEqual([p['symbol'] for p in out['peers']], ['DELL', 'HPQ'])  # BAD (closest in revenue) failed
        self.assertEqual(out['failed'][0]['symbol'], 'BAD')
        self.assertAlmostEqual(out['target']['evEbitda'], 16.8)
        self.assertEqual([p['symbol'] for p in typed['peers']], ['HPQ'])
        self.assertEqual(typed['peerSource'], 'your list')

    def test_research_company_still_loads_through_company_core(self):
        from engine import research
        core = _core(100, 40, 20, 10, 5, 1.0, 50, 30, 10, 10)

        async def company(ctx, s):
            return {'cik': 1, 'name': 'Apple'}

        async def submissions(ctx, cik):
            return {'name': 'Apple Inc.', 'sicDescription': 'Electronic Computers', 'filings': {'recent': {}}}

        async def company_core(ctx, cik):
            return core

        async def quote(ctx, s):
            return {'price': 40.0}

        async def beta(ctx, s):
            return 1.1

        async def total_returns(ctx, symbols):
            return {s: None for s in symbols}
        with mock.patch.object(research.sec, 'company', company), mock.patch.object(research.sec, 'submissions', submissions), \
                mock.patch.object(research, 'company_core', company_core), mock.patch.object(research, 'quote', quote), \
                mock.patch.object(research, 'beta', beta), mock.patch.object(research.dividends, 'total_returns', total_returns):
            out = asyncio.run(research.company(None, {'symbol': 'AAPL'}))
        self.assertEqual(out['valuation']['marketCap'], 400)

    def test_closest_by_revenue_on_a_log_scale(self):
        revs = {1: 50, 2: 210, 3: 1000, 4: 95}
        self.assertEqual(comps.closest_by_revenue(100, [1, 2, 3, 4, 5], revs, 5), [4, 1, 2, 3, 5])
        self.assertEqual(comps.closest_by_revenue(None, [3, 1], revs), [3, 1])


if __name__ == '__main__':
    unittest.main()
