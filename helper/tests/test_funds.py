"""Fund profiles (engine/funds.py) from a Yahoo quoteSummary reply shaped like the real one."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine import funds  # noqa: E402
from engine.core import EngineError  # noqa: E402

R = lambda v: {'raw': v, 'fmt': str(v)}  # noqa: E731

REPLY = {'quoteSummary': {'error': None, 'result': [{
    'quoteType': {'symbol': 'VTI', 'quoteType': 'ETF', 'longName': 'Vanguard Total Stock Market Index Fund ETF Shares'},
    'price': {'symbol': 'VTI', 'currency': 'USD', 'quoteType': 'ETF'},
    'summaryDetail': {'yield': R(0.0124), 'totalAssets': R(1.9e12), 'navPrice': R(301.2)},
    'defaultKeyStatistics': {'fundFamily': 'Vanguard', 'fundInceptionDate': R(990403200), 'legalType': 'Exchange Traded Fund',
                             'morningStarOverallRating': R(4), 'morningStarRiskRating': R(3), 'beta3Year': R(1.02)},
    'fundProfile': {'family': 'Vanguard', 'categoryName': 'Large Blend', 'legalType': 'Exchange Traded Fund',
                    'feesExpensesInvestment': {'annualReportExpenseRatio': R(0.0003), 'annualHoldingsTurnover': R(0.02), 'twelveBOne': {}}},
    'topHoldings': {'stockPosition': R(0.995), 'bondPosition': R(0.0), 'cashPosition': R(0.005),
                    'holdings': [{'symbol': 'AAPL', 'holdingName': 'Apple Inc', 'holdingPercent': R(0.062)},
                                 {'symbol': 'MSFT', 'holdingName': 'Microsoft Corp', 'holdingPercent': R(0.058)}],
                    'sectorWeightings': [{'technology': R(0.31)}, {'realestate': R(0.03)}, {'energy': R(0)}],
                    'equityHoldings': {'priceToEarnings': R(24.1), 'priceToBook': R(4.2), 'medianMarketCap': R(180000)},
                    'bondRatings': [{'us_government': R(0)}], 'bondHoldings': {}},
    'fundPerformance': {'trailingReturns': {'asOfDate': R(1793404800), 'ytd': R(0.16), 'oneYear': R(0.21), 'threeYear': R(0.09)},
                        'trailingReturnsCat': {'ytd': R(0.14), 'oneYear': R(0.19), 'threeYear': R(0.08)},
                        'annualTotalReturns': {'returns': [{'year': '2024', 'annualValue': R(0.237)}, {'year': '2025', 'annualValue': R(0.17)}],
                                               'returnsCat': [{'year': '2024', 'annualValue': R(0.21)}]},
                        'riskOverviewStatistics': {'riskStatistics': [{'year': '3y', 'alpha': R(-0.1), 'beta': R(1.02), 'rSquared': R(99.5), 'stdDev': R(17.4), 'sharpeRatio': R(0.48)}],
                                                   'riskStatisticsCat': [{'year': '3y', 'alpha': R(-1.2), 'beta': R(0.98), 'rSquared': R(95), 'stdDev': R(17.0), 'sharpeRatio': R(0.41)}]},
                        'performanceOverview': {'bestOneYrTotalReturn': R(0.33), 'worstOneYrTotalReturn': R(-0.37), 'numYearsUp': R(19), 'numYearsDown': R(5)}},
    'assetProfile': {'longBusinessSummary': 'The fund seeks to track the CRSP US Total Market Index.'},
}]}}


class FundProfile(unittest.TestCase):
    def test_reads_the_fund_basics_costs_and_holdings(self):
        f = funds.parse_fund(REPLY)
        self.assertEqual((f['kind'], f['family'], f['category']), ('etf', 'Vanguard', 'Large Blend'))
        self.assertEqual(f['expenseRatio'], 0.0003)
        self.assertEqual(f['inception'], '2001-05-21')
        self.assertIsNone(f['twelveB1'])  # Yahoo's empty {} means not given, not zero
        self.assertEqual([h['symbol'] for h in f['holdings']], ['AAPL', 'MSFT'])
        self.assertAlmostEqual(f['holdingsShare'], 0.12)
        self.assertEqual([s['sector'] for s in f['sectors']], ['Technology', 'Real estate'])  # zero weights dropped
        self.assertEqual([m['label'] for m in f['mix']], ['Stocks', 'Cash'])
        self.assertEqual(f['ratings'], [])
        self.assertEqual(f['objective'], 'The fund seeks to track the CRSP US Total Market Index.')

    def test_returns_and_risk_against_the_category(self):
        f = funds.parse_fund(REPLY)
        self.assertEqual(f['trailing'][0], {'period': 'Year to date', 'fund': 0.16, 'category': 0.14})
        self.assertEqual([a['year'] for a in f['annual']], ['2025', '2024'])  # newest first
        self.assertEqual(f['annual'][1]['category'], 0.21)
        self.assertEqual(f['risk'][0]['years'], '3y')
        self.assertEqual(f['risk'][0]['category']['sharpeRatio'], 0.41)
        self.assertEqual((f['yearsUp'], f['yearsDown']), (19, 5))

    def test_a_stock_or_an_unknown_symbol_is_said_plainly(self):
        stock = {'quoteSummary': {'result': [{'quoteType': {'symbol': 'AAPL', 'quoteType': 'EQUITY'}}]}}
        with self.assertRaises(EngineError) as cm:
            funds.parse_fund(stock)
        self.assertIn("isn't a fund", str(cm.exception))
        with self.assertRaises(EngineError):
            funds.parse_fund({'quoteSummary': {'result': None, 'error': {'description': 'Quote not found for symbol: ZZZZ'}}})


if __name__ == '__main__':
    unittest.main()
