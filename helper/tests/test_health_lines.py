"""Helper 71: the statements carry receivables, property and equipment and retained earnings (Beneish and Altman on
Research), from the tags Apple's FY2026 10-K uses."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import research as r  # noqa: E402


def inst(end, val, filed):
    return {'end': end, 'val': val, 'accn': 'a', 'filed': filed, 'form': '10-K', 'fp': 'FY'}


class Lines(unittest.TestCase):
    def test_new_balance_lines(self):
        gaap = {
            'AccountsReceivableNetCurrent': [inst('2025-09-27', 39.777e9, '2025-10-31'), inst('2026-09-26', 43.817e9, '2026-11-03')],
            'PropertyPlantAndEquipmentNet': [inst('2026-09-26', 52.084e9, '2026-11-03')],
            'RetainedEarningsAccumulatedDeficit': [inst('2025-09-27', -14.264e9, '2025-10-31'), inst('2026-09-26', 13.7e9, '2026-11-03')],
            'Assets': [inst('2026-09-26', 404.548e9, '2026-11-03')],
        }
        facts = {'facts': {'us-gaap': {t: {'units': {'USD': rows}} for t, rows in gaap.items()}}}
        a = r.statements(facts)['annual']
        self.assertEqual(a['periods'][-1], '2026-09-26')
        self.assertEqual(a['values']['receivables'][-2:], [39.777e9, 43.817e9])
        self.assertEqual(a['values']['ppe'][-1], 52.084e9)
        self.assertEqual(a['values']['retainedEarnings'][-2:], [-14.264e9, 13.7e9])  # a deficit stays negative

    def test_shown_in_the_balance_sheet(self):
        keys = [k for k, _, _ in r.BALANCE]
        for k in ('receivables', 'ppe', 'retainedEarnings', 'inventory', 'payables', 'deferredRevenue', 'goodwill'):
            self.assertIn(k, keys)
        flows = [k for k, _, _ in r.INCOME]
        self.assertIn('goodwillImpairment', flows)
        self.assertIn('intangibleImpairment', flows)
        for k in ('deferredRevenue', 'goodwill', 'goodwillImpairment', 'intangibleImpairment'):
            self.assertIn(k, r.STATEMENT_KEYS)  # older saved copies are read again for them
        tags = dict((k, t) for k, _, t in r.BALANCE)
        # ASC 606 renamed the current deferred revenue tag in 2018: both are the same current concept
        self.assertEqual(tags['deferredRevenue'], ['ContractWithCustomerLiabilityCurrent', 'DeferredRevenueCurrent'])
        self.assertIn('ReceivablesNetCurrent', tags['receivables'])
        # payables only on their own line (a combined payables-and-accrued line would overstate days to pay)
        self.assertEqual(tags['payables'], ['AccountsPayableCurrent', 'AccountsPayableTradeCurrent'])


if __name__ == '__main__':
    unittest.main()
