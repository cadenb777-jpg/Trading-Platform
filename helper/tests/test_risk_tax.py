"""Account risk, sectors and the tax view (helper/engine/risk.py, helper/engine/tax.py) on made-up data."""
import asyncio
import datetime as dt
import os
import random
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np  # noqa: E402

from engine import risk, tax  # noqa: E402


def run(coro):
    return asyncio.run(coro)


class Sectors(unittest.TestCase):
    def test_sic_codes_map_to_sectors(self):
        cases = {'3571': 'Information Technology', '7372': 'Information Technology', '3674': 'Information Technology',
                 '2834': 'Health Care', '3841': 'Health Care', '2080': 'Consumer Staples', '5411': 'Consumer Staples',
                 '2911': 'Energy', '1311': 'Energy', '4911': 'Utilities', '6021': 'Financials', '6726': 'Financials',
                 '6798': 'Real Estate', '5961': 'Consumer Discretionary', '3711': 'Consumer Discretionary',
                 '4813': 'Communication Services', '3531': 'Industrials', '3721': 'Industrials', '2821': 'Materials', 3312: 'Materials'}
        for sic, want in cases.items():
            self.assertEqual(risk.sector_of(sic), want, sic)

    def test_unknown_is_other_never_guessed(self):
        for sic in (None, '', 'abc', '9995', '0', 99999):
            self.assertEqual(risk.sector_of(sic), 'Other')

    def test_every_sector_is_one_of_eleven(self):
        names = {name for _, _, name in risk.SIC_SECTORS}
        self.assertEqual(len(names), 11)

    def test_funds_from_names(self):
        self.assertTrue(risk.is_fund('VANGUARD TOTAL STOCK MARKET ETF'))
        self.assertTrue(risk.is_fund('Some Fund', 'MUTUAL_FUND'))
        self.assertFalse(risk.is_fund('NORTHERN TRUST CORP'))
        self.assertEqual(risk.fund_type('VANGUARD TOTAL STOCK MARKET ETF'), 'broad market')
        self.assertEqual(risk.fund_type('SPDR S&P 500 ETF TRUST'), 'broad market')
        self.assertEqual(risk.fund_type('ISHARES CORE US AGGREGATE BOND ETF'), 'bond')
        self.assertEqual(risk.fund_type('TECHNOLOGY SELECT SECTOR SPDR'), 'sector')
        self.assertIsNone(risk.fund_type('SCHWAB US DIVIDEND EQUITY ETF'))

    def test_sector_lookup_uses_sec_and_caches(self):
        calls = []

        class Ctx:
            sec_contact = 'me@example.com'

            async def cached(self, key, max_age, load, persist=False, stale_ok=False):
                calls.append((key, max_age, persist))
                return await load()

        async def company(ctx, s):
            if s == 'ZZZZ':
                raise risk.EngineError('not listed')
            return {'cik': 1, 'name': 'x'}

        async def subs(ctx, cik):
            return {'sic': '3571', 'sicDescription': 'Electronic Computers'}
        with mock.patch.object(risk.sec, 'company', company), mock.patch.object(risk.sec, 'submissions', subs):
            r = run(risk.sector(Ctx(), 'AAPL', {'name': 'APPLE INC', 'assetType': 'EQUITY'}))
            self.assertEqual((r['sector'], r['sic']), ('Information Technology', '3571'))
            self.assertEqual(calls[0], (('sector', 'AAPL'), 30 * 86400, True))
            self.assertEqual(run(risk.sector(Ctx(), 'ZZZZ', {'name': 'Z CORP'}))['sector'], 'Other')
            fund = run(risk.sector(Ctx(), 'VTI', {'name': 'VANGUARD TOTAL STOCK MARKET ETF'}))
            self.assertEqual((fund['sector'], fund['fundType']), ('Fund', 'broad market'))

        class NoEmail(Ctx):
            sec_contact = ''
        with self.assertRaises(risk.EngineError):  # not remembered as "Other": the SEC just can't be asked yet
            run(risk.sector(NoEmail(), 'AAPL', {'name': 'APPLE INC'}))


class RiskMaths(unittest.TestCase):
    def test_effective_holdings_and_top5(self):
        c = risk.concentration({'A': 50, 'B': 25, 'C': 25})
        self.assertAlmostEqual(c['effective'], 1 / (0.25 + 0.0625 + 0.0625))
        self.assertEqual(c['largest'], {'symbol': 'A', 'weight': 0.5})
        self.assertAlmostEqual(c['top5'], 1.0)
        eq = risk.concentration({str(i): 10 for i in range(10)})
        self.assertAlmostEqual(eq['effective'], 10)
        self.assertAlmostEqual(eq['top5'], 0.5)
        self.assertIsNone(risk.concentration({})['effective'])

    def test_value_at_risk_is_the_fifth_percentile_loss(self):
        returns = [-0.05, -0.03] + [0.001] * 18  # 20 days: the 5th percentile sits between the two worst days
        self.assertAlmostEqual(risk.value_at_risk(returns), -np.percentile(returns, 5))
        self.assertGreater(risk.value_at_risk(returns), 0.02)
        self.assertLess(risk.value_at_risk([0.01] * 20), 0)  # never lost money: no loss at 95%

    def test_beta(self):
        rnd = random.Random(3)
        bench = np.array([rnd.gauss(0, 0.01) for _ in range(250)])
        self.assertAlmostEqual(risk.beta(2 * bench, bench), 2.0)
        self.assertAlmostEqual(risk.beta(0.5 * bench + 0.001, bench), 0.5)
        self.assertIsNone(risk.beta(bench, np.zeros(250)))

    def test_risk_stats_cash_is_zero_risk(self):
        rnd = random.Random(5)
        bench = np.array([rnd.gauss(0, 0.01) for _ in range(250)])
        stock = 1.5 * bench
        dates = [dt.date(2025, 1, 1) + dt.timedelta(days=i) for i in range(251)]
        full = risk.risk_stats(stock.reshape(-1, 1), bench, [1.0], dates)
        half = risk.risk_stats(stock.reshape(-1, 1), bench, [0.5], dates)  # the other half is cash
        self.assertAlmostEqual(half['volatility'], full['volatility'] / 2)
        self.assertAlmostEqual(half['beta'], 0.75)
        self.assertAlmostEqual(half['var95'], full['var95'] / 2)
        self.assertAlmostEqual(full['assets'][0]['beta'], 1.5)
        self.assertAlmostEqual(full['assets'][0]['riskShare'], 1.0)
        self.assertLessEqual(full['maxDrawdown'], 0)

    def test_risk_shares_add_up(self):
        rnd = random.Random(8)
        r = np.array([[rnd.gauss(0, 0.02), rnd.gauss(0, 0.01)] for _ in range(250)])
        dates = [dt.date(2025, 1, 1) + dt.timedelta(days=i) for i in range(251)]
        s = risk.risk_stats(r, r[:, 1], [0.3, 0.3], dates)
        self.assertAlmostEqual(sum(a['riskShare'] for a in s['assets']), 1.0)
        self.assertGreater(s['assets'][0]['riskShare'], s['assets'][1]['riskShare'])  # the jumpier stock carries more

    def test_handler_measures_account(self):
        rnd = random.Random(11)
        start = dt.datetime(2025, 9, 1, tzinfo=dt.timezone.utc)
        bench = []
        p = 500.0
        for i in range(400):
            p *= 1 + rnd.gauss(0, 0.01)
            bench.append([int((start + dt.timedelta(days=i)).timestamp()), p])
        stock = [[t, c * 0.2] for t, c in bench]
        young = bench[-30:]  # a recent listing: too short to judge a year

        async def closes(ctx, s):
            return {'SPY': bench, 'AAA': stock, 'NEW': young}[s]

        async def quotes(ctx, symbols):
            return {s: {'name': f'{s} INC', 'assetType': 'EQUITY'} for s in symbols}

        async def sector(ctx, s, q):
            return {'sector': 'Information Technology', 'source': 'SEC'}

        with mock.patch.object(risk.invest, 'closes', closes), mock.patch.object(risk.invest, 'quotes', quotes), mock.patch.object(risk, 'sector', sector):
            out = run(risk.account(object(), {'holdings': [{'symbol': 'AAA', 'value': 6000}, {'symbol': 'CASH', 'value': 4000, 'kind': 'cash'},
                                                           {'symbol': 'NEW', 'value': 1000}, {'symbol': 'BCRED', 'value': 500, 'kind': 'alt'}]}))
        self.assertEqual(out['missing'], ['NEW'])
        self.assertEqual(out['alts'], ['BCRED'])
        self.assertAlmostEqual(out['stats']['beta'], 0.6, places=6)  # 60% in a stock that moves exactly with SPY
        self.assertAlmostEqual(out['assets']['AAA']['weight'], 0.6)
        self.assertAlmostEqual(out['concentration']['weights']['CASH'], 4000 / 11000)
        self.assertEqual(out['sectors']['AAA']['sector'], 'Information Technology')


class TaxView(unittest.TestCase):
    def test_account_types(self):
        self.assertEqual(tax.tax_type('Webull Roth IRA ••1234'), 'roth')
        self.assertEqual(tax.tax_type('Webull Traditional IRA ••5678'), 'deferred')
        self.assertEqual(tax.tax_type('Rollover IRA'), 'deferred')
        self.assertEqual(tax.tax_type('Webull Cash ••4444'), 'taxable')
        self.assertEqual(tax.tax_type('Schwab brokerage'), 'taxable')
        self.assertEqual(tax.tax_type('Schwab brokerage', 'roth'), 'roth')  # the owner's own choice wins
        self.assertEqual(tax.tax_type('Roth IRA', 'nonsense'), 'roth')

    ACCOUNTS = [
        {'name': 'Webull Roth IRA ••1234', 'holdings': [{'symbol': 'AAPL', 'shares': 10, 'value': 2300, 'cost': 1800}]},
        {'name': 'Webull Traditional IRA ••5678', 'holdings': [{'symbol': 'VTI', 'shares': 5, 'value': 1500, 'cost': 1200}]},
        {'name': 'Rollover IRA', 'holdings': [{'symbol': 'CASH', 'value': 300, 'kind': 'cash'}]},
        {'name': 'Webull Margin ••3333', 'holdings': [
            {'symbol': 'NVDA', 'shares': 8, 'value': 1028, 'cost': 1300},
            {'symbol': 'MSFT', 'shares': 5, 'value': 2076, 'cost': 2010},
            {'symbol': 'T', 'shares': 10, 'value': 225, 'cost': 260},
            {'symbol': 'KO', 'shares': 4, 'value': 280},
            {'symbol': 'CASH', 'value': 500, 'kind': 'cash'}]},
    ]

    def test_groups_by_tax_type(self):
        v = tax.tax_view(self.ACCOUNTS)
        self.assertEqual([g['type'] for g in v['groups']], ['roth', 'deferred', 'taxable'])
        deferred = v['groups'][1]
        self.assertEqual(deferred['accounts'], ['Webull Traditional IRA ••5678', 'Rollover IRA'])
        self.assertAlmostEqual(deferred['value'], 1800)
        self.assertAlmostEqual(v['groups'][2]['value'], 1028 + 2076 + 225 + 280 + 500)
        self.assertEqual({x['symbol'] for x in v['taxable']}, {'NVDA', 'MSFT', 'T', 'KO'})  # IRAs never appear; cash isn't a holding

    def test_gains_harvest_and_unknown_periods(self):
        v = tax.tax_view(self.ACCOUNTS)
        rows = {x['symbol']: x for x in v['taxable']}
        self.assertAlmostEqual(rows['NVDA']['gain'], -272)
        self.assertTrue(rows['NVDA']['harvest'])
        self.assertFalse(rows['T']['harvest'])  # a $35 loss is under the $100 line
        self.assertIsNone(rows['KO']['gain'])  # no cost basis: nothing invented
        self.assertEqual(v['totals']['noCost'], 1)
        self.assertTrue(all(x['term'] == 'unknown' and x['recentShares'] is None for x in v['taxable']))
        self.assertEqual(rows['NVDA']['washSale'], [])
        self.assertAlmostEqual(v['totals']['harvest'], -272)
        self.assertEqual(v['taxable'][0]['symbol'], 'NVDA')  # biggest loss first

    def test_recent_buys_mark_short_term_and_wash_sales(self):
        buys = [{'symbol': 'NVDA', 'qty': 2, 'account': 'Roth IRA ••1234'}, {'symbol': 'MSFT', 'qty': 9, 'account': 'Margin ••3333'}]
        rows = {x['symbol']: x for x in tax.tax_view(self.ACCOUNTS, buys)['taxable']}
        self.assertEqual((rows['NVDA']['term'], rows['NVDA']['recentShares']), ('mixed', 2))
        self.assertEqual(rows['NVDA']['washSale'], ['Roth IRA ••1234'])  # a buy in an IRA counts too
        self.assertEqual((rows['MSFT']['term'], rows['MSFT']['recentShares']), ('short', 5))
        self.assertEqual(rows['MSFT']['washSale'], [])  # a gain can't be a wash sale
        self.assertEqual(rows['T']['term'], 'unknown')

    def test_handler_without_webull(self):
        with mock.patch('engine.webull.available', return_value=False):
            out = run(tax.account(object(), {'accounts': self.ACCOUNTS}))
        self.assertFalse(out['buysKnown'])
        self.assertIn('wash sales', out['buysNote'])
        self.assertIn('not tax advice', out['notAdvice'])


if __name__ == '__main__':
    unittest.main()
