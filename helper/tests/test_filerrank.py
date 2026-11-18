"""Rank against every US filer (engine/filerrank.py): hand-worked on Coca-Cola's FY2025 figures as the SEC's XBRL
frames give them (checked live 2026-11-18: CY2025 frames for GrossProfit, OperatingIncomeLoss, NetIncomeLoss,
NetCashProvidedByUsedInOperatingActivities and Revenues, Assets and InventoryNet at CY2025Q4I / CY2024Q4I)."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import filerrank as fr  # noqa: E402

KO = 21344
END = '2025-12-31'


def frames():
    def one(v, end=END):
        return {KO: [v, end, '0001628280-26-010047']}
    dur = {'gp': one(29_544e6), 'op': one(13_762e6), 'ni': one(13_107e6), 'cfo': one(7_408e6)}
    rev = {'Revenues': one(47_941e6)}
    rev_prev = {'Revenues': one(47_061e6, '2024-12-31')}
    instants = {'assets': {'CY2025Q4I': one(104_816e6), 'CY2024Q4I': one(100_549e6, '2024-12-31')},
                'inventory': {'CY2025Q4I': one(4_425e6), 'CY2024Q4I': one(4_728e6, '2024-12-31')}}
    return dur, rev, rev_prev, instants


class QuarterFrames(unittest.TestCase):
    def test_nearest_quarter_end(self):
        self.assertEqual(fr.quarter_frame('2025-12-31'), 'CY2025Q4I')
        # NVIDIA's year ends on the last Sunday of January: 25 days after Dec 31, 65 before Mar 31
        self.assertEqual(fr.quarter_frame('2026-01-25'), 'CY2025Q4I')
        self.assertEqual(fr.quarter_frame('2025-06-30'), 'CY2025Q2I')  # Microsoft
        self.assertEqual(fr.quarter_frame('2025-09-27'), 'CY2025Q3I')  # Apple
        self.assertEqual(fr.year_before('2024-02-29'), dt.date(2023, 2, 28))

    def test_year_still_filling_up_uses_the_one_before(self):
        # live counts on 2026-11-18: CY2026 net income had 353 companies, CY2025 5,720
        self.assertEqual(fr.pick_year(dt.date(2026, 11, 18), {2025: 5720}), 2025)
        self.assertEqual(fr.pick_year(dt.date(2027, 2, 1), {2026: 900, 2025: 5720}), 2025)


class CocaCola(unittest.TestCase):
    def test_rows_and_readings(self):
        dur, rev, rev_prev, instants = frames()
        row = fr.company_rows(dur, rev, rev_prev, instants)[KO]
        self.assertEqual((row['end'], row['revTag'], row['assetsPrev'], row['inventoryPrev']), (END, 'Revenues', 100_549e6, 4_728e6))
        x = fr.readings(row)
        # 29,544 / 104,816
        self.assertAlmostEqual(x['grossProfitability'], 0.281865, 6)
        # 13,762 / 47,941
        self.assertAlmostEqual(x['operatingMargin'], 0.287061, 6)
        # 13,107 / ((104,816 + 100,549) / 2 = 102,682.5)
        self.assertAlmostEqual(x['returnOnAssets'], 0.127646, 6)
        # 47,941 / 47,061 - 1 = 880 / 47,061
        self.assertAlmostEqual(x['salesGrowth'], 0.018699, 6)
        # 104,816 / 100,549 - 1 = 4,267 / 100,549
        self.assertAlmostEqual(x['assetGrowth'], 0.042437, 6)
        # (13,107 - 7,408) / 102,682.5 = 5,699 / 102,682.5
        self.assertAlmostEqual(x['accruals'], 0.055501, 6)
        # 4,425 / 4,728 - 1 = -0.064086, less sales growth 0.018699
        self.assertAlmostEqual(x['inventoryVsSales'], -0.082785, 6)

    def test_mismatched_dates_are_left_out(self):
        dur, rev, rev_prev, instants = frames()
        # a balance dated a quarter away from the year-end is another date, not that year's balance
        instants['inventory']['CY2025Q4I'] = {KO: [4_425e6, '2025-10-03', 'x']}
        # last year's revenue under another tag: no growth (never mixes two definitions)
        rev_prev = {'RevenueFromContractWithCustomerExcludingAssessedTax': {KO: [47_061e6, '2024-12-31', 'x']}}
        row = fr.company_rows(dur, rev, rev_prev, instants)[KO]
        x = fr.readings(row)
        self.assertIsNone(row['inventory'])
        self.assertIsNone(x['salesGrowth'])
        self.assertIsNone(x['inventoryVsSales'])
        self.assertAlmostEqual(x['assetGrowth'], 0.042437, 6)

    def test_no_gross_profit_tag_no_reading(self):
        dur, rev, rev_prev, instants = frames()
        del dur['gp']  # Amazon and GE don't tag gross profit
        x = fr.readings(fr.company_rows(dur, rev, rev_prev, instants)[KO])
        self.assertIsNone(x['grossProfitability'])
        self.assertIsNotNone(x['returnOnAssets'])


class Ranking(unittest.TestCase):
    def test_field_leaves_out_small_companies(self):
        rows = {1: {'end': END, 'gp': 30.0, 'assets': 150e6}, 2: {'end': END, 'gp': 5.0, 'assets': 50e6}}
        by_metric, per = fr.field(rows)
        self.assertEqual(list(per), [1])
        self.assertEqual(len(by_metric['grossProfitability']), 1)

    def test_percentile_against_the_others(self):
        field = {m: [] for m in fr.METRICS}
        field['assetGrowth'] = [0.01, 0.02, 0.02, 0.03, 0.04]
        r = fr.rank(field, {'assetGrowth': 0.02})['assetGrowth']
        # itself taken out once: others 0.01, 0.02, 0.03, 0.04 -> one below, one tie -> (1 + 0.5) / 4
        self.assertEqual(r['n'], 4)
        self.assertAlmostEqual(r['percentile'], 37.5)
        self.assertAlmostEqual(r['median'], 0.025)
        self.assertAlmostEqual(r['p25'], 0.0175)  # position 0.75 between 0.01 and 0.02
        self.assertIsNone(fr.rank(field, {'assetGrowth': None})['assetGrowth'])
        self.assertIsNone(fr.rank(field, {'accruals': 0.1})['accruals'])

    def test_quantile(self):
        self.assertEqual(fr.quantile([], 0.5), None)
        self.assertEqual(fr.quantile([7.0], 0.75), 7.0)
        self.assertAlmostEqual(fr.quantile([1, 2, 3, 4, 5], 0.75), 4)


if __name__ == '__main__':
    unittest.main()
