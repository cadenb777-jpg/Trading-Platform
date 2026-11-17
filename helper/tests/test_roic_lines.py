"""Helper 83: current debt (the total, else the sum of its parts) and long-term marketable securities, so Research can
work out invested capital for return on capital."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import research as r  # noqa: E402


def inst(end, val, filed='2026-11-03'):
    return {'end': end, 'val': val, 'accn': 'a', 'filed': filed, 'form': '10-K', 'fp': 'FY'}


def facts(gaap):
    return {'facts': {'us-gaap': {t: {'units': {'USD': rows}} for t, rows in gaap.items()}}}


class Lines(unittest.TestCase):
    def test_parts_summed_when_no_total(self):
        # Apple's FY2026 10-K: current part of long-term debt $9.910B + commercial paper $1.993B, no DebtCurrent total
        a = r.statements(facts({
            'LongTermDebtCurrent': [inst('2026-09-26', 9.910e9)],
            'CommercialPaper': [inst('2026-09-26', 1.993e9)],
            'MarketableSecuritiesNoncurrent': [inst('2026-09-26', 80.213e9)],
        }))['annual']
        self.assertAlmostEqual(a['values']['currentDebt'][-1], 11.903e9)
        self.assertEqual(a['values']['longInvestments'][-1], 80.213e9)
        for part, _ in r.CURRENT_DEBT_PARTS:
            self.assertNotIn(part, a['values'])  # the parts never reach the page

    def test_total_wins_over_parts(self):
        # Exxon FY2025 tags the total ($9.30B) and its parts ($6.20B + $3.06B): count it once
        a = r.statements(facts({
            'DebtCurrent': [inst('2025-12-31', 9.30e9)],
            'LongTermDebtCurrent': [inst('2025-12-31', 6.20e9)],
            'CommercialPaper': [inst('2025-12-31', 3.06e9)],
        }))['annual']
        self.assertEqual(a['values']['currentDebt'], [9.30e9])

    def test_borrowings_already_hold_commercial_paper(self):
        # ShortTermBorrowings $5B includes the $3B of commercial paper: $1B + $5B, not + $8B
        a = r.statements(facts({
            'LongTermDebtCurrent': [inst('2025-12-31', 1e9)],
            'ShortTermBorrowings': [inst('2025-12-31', 5e9)],
            'CommercialPaper': [inst('2025-12-31', 3e9)],
        }))['annual']
        self.assertEqual(a['values']['currentDebt'], [6e9])

    def test_none_tagged_stays_none(self):
        a = r.statements(facts({'Assets': [inst('2025-12-31', 1e9)]}))['annual']
        self.assertEqual(a['values']['currentDebt'], [None])

    def test_coca_cola_short_term_investments(self):
        a = r.statements(facts({'OtherShortTermInvestments': [inst('2025-12-31', 3.6e9)]}))['annual']
        self.assertEqual(a['values']['shortInvestments'], [3.6e9])

    def test_reloaded_and_shown(self):
        for k in ('currentDebt', 'longInvestments'):
            self.assertIn(k, r.STATEMENT_KEYS)
            self.assertIn(k, [key for key, _, _ in r.BALANCE])
        self.assertIn(('baa', 'BAA'), r.CORP_YIELDS)


if __name__ == '__main__':
    unittest.main()
