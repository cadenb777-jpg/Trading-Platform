"""Helper 84: income taxes paid in cash (the 10-K's supplemental cash-flow line) for Research's cash tax rate."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import research as r  # noqa: E402


def flow(start, end, val, filed='2026-07-29'):
    return {'start': start, 'end': end, 'val': val, 'accn': 'a', 'filed': filed, 'form': '10-K', 'fp': 'FY'}


class Lines(unittest.TestCase):
    def test_taxes_paid(self):
        # Microsoft's FY2026 10-K: IncomeTaxesPaidNet $21.188B
        facts = {'facts': {'us-gaap': {'IncomeTaxesPaidNet': {'units': {'USD': [flow('2025-07-01', '2026-06-30', 21.188e9)]}}}}}
        a = r.statements(facts)['annual']
        self.assertEqual(a['values']['taxesPaid'], [21.188e9])
        self.assertIn('taxesPaid', r.STATEMENT_KEYS)  # older saved copies are read again for it
        self.assertIn('taxesPaid', [k for k, _, _ in r.CASH_FLOW])


if __name__ == '__main__':
    unittest.main()
