"""Helper 81: depreciation on its own line (capital spending vs depreciation on Research), and fiscal years read only
from annual reports (Amazon's 10-Qs also report trailing-twelve-month cash flows)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import research as r  # noqa: E402


def flow(start, end, val, filed, form='10-K', fp='FY'):
    return {'start': start, 'end': end, 'val': val, 'accn': 'a', 'filed': filed, 'form': form, 'fp': fp}


def facts(gaap):
    return {'facts': {'us-gaap': {t: {'units': {'USD': rows}} for t, rows in gaap.items()}}}


class Lines(unittest.TestCase):
    def test_depreciation_line(self):
        # Microsoft's FY2026 10-K: Depreciation $34.3B, no D&A tag at all
        a = r.statements(facts({
            'Depreciation': [flow('2024-07-01', '2025-06-30', 22.0e9, '2025-07-30'), flow('2025-07-01', '2026-06-30', 34.3e9, '2026-07-29')],
            'PaymentsToAcquirePropertyPlantAndEquipment': [flow('2025-07-01', '2026-06-30', 115.948e9, '2026-07-29')],
        }))['annual']
        self.assertEqual(a['values']['depreciation'][-2:], [22.0e9, 34.3e9])
        self.assertEqual(a['values']['dna'][-1], None)  # never filled in from depreciation
        self.assertIn('depreciation', r.STATEMENT_KEYS)  # older saved copies are read again for it
        self.assertIn('depreciation', [k for k, _, _ in r.CASH_FLOW])

    def test_trailing_twelve_months_in_a_10q_is_not_a_fiscal_year(self):
        # Amazon: the 10-K's FY2025 operating cash flow $139.514B; its Q3 2026 10-Q also reports the twelve months to
        # September 30, 2026 ($168.3B), which must not become a fiscal year ending at a quarter end
        a = r.statements(facts({
            'NetCashProvidedByUsedInOperatingActivities': [
                flow('2025-01-01', '2025-12-31', 139.514e9, '2026-02-06'),
                flow('2025-10-01', '2026-09-30', 168.3e9, '2026-10-31', form='10-Q', fp='Q3'),
            ],
        }))['annual']
        self.assertEqual(a['periods'], ['2025-12-31'])
        self.assertEqual(a['values']['operatingCashFlow'], [139.514e9])

    def test_fourth_quarter_still_worked_out_from_the_10k_year(self):
        rows = [flow('2025-01-01', '2025-12-31', 100.0, '2026-02-06')]
        for i, (s, e) in enumerate([('2025-01-01', '2025-03-31'), ('2025-04-01', '2025-06-30'), ('2025-07-01', '2025-09-30')]):
            rows.append(flow(s, e, 20.0 + i, '2025-11-01', form='10-Q', fp=f'Q{i + 1}'))
        q = r.statements(facts({'Revenues': rows}))['quarterly']
        self.assertEqual(q['periods'][-1], '2025-12-31')
        self.assertEqual(q['values']['revenue'][-1], 100.0 - 20 - 21 - 22)


if __name__ == '__main__':
    unittest.main()
