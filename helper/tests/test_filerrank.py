"""Rank against every US filer (engine/filerrank.py): hand-worked on Coca-Cola's FY2025 figures as the SEC's XBRL
frames give them (checked live 2026-11-18: CY2025 frames for GrossProfit, OperatingIncomeLoss, NetIncomeLoss,
NetCashProvidedByUsedInOperatingActivities and Revenues, Assets and InventoryNet at CY2025Q4I / CY2024Q4I)."""
import datetime as dt
import math
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
        # only years that were counted, never a fall-through to an uncounted one
        self.assertIsNone(fr.pick_year(dt.date(2026, 11, 18), {2025: 0, 2024: 0, 2023: 0}))


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

    def test_revenue_uses_the_total_and_growth_one_definition(self):
        dur, rev, rev_prev, instants = frames()
        # fee income alone under one tag ($2B, both years), the total under the other (this year only)
        rev = {'RevenueFromContractWithCustomerExcludingAssessedTax': {KO: [2_000e6, END, 'x']}, 'Revenues': {KO: [47_941e6, END, 'x']}}
        rev_prev = {'RevenueFromContractWithCustomerExcludingAssessedTax': {KO: [1_600e6, '2024-12-31', 'x']}}
        row = fr.company_rows(dur, rev, rev_prev, instants)[KO]
        x = fr.readings(row)
        self.assertEqual(row['revTag'], 'Revenues')
        self.assertAlmostEqual(x['operatingMargin'], 0.287061, 6)  # on the total, not on fees
        self.assertIsNone(x['salesGrowth'])  # the total has no last year: never the fees' growth instead
        # gross of excise taxes (under twice net sales): the net contract line stays, with its growth
        rev = {'RevenueFromContractWithCustomerExcludingAssessedTax': {KO: [35_000e6, END, 'x']}, 'Revenues': {KO: [60_000e6, END, 'x']}}
        rev_prev = {'RevenueFromContractWithCustomerExcludingAssessedTax': {KO: [33_000e6, '2024-12-31', 'x']}}
        x = fr.readings(fr.company_rows(dur, rev, rev_prev, instants)[KO])
        self.assertAlmostEqual(x['operatingMargin'], 13_762 / 35_000, 6)
        self.assertAlmostEqual(x['salesGrowth'], 35_000 / 33_000 - 1, 6)

    def test_no_gross_profit_tag_no_reading(self):
        dur, rev, rev_prev, instants = frames()
        del dur['gp']  # Amazon and GE don't tag gross profit
        x = fr.readings(fr.company_rows(dur, rev, rev_prev, instants)[KO])
        self.assertIsNone(x['grossProfitability'])
        self.assertIsNotNone(x['returnOnAssets'])


class IssuanceAndResearch(unittest.TestCase):
    """Helper 90: diluted share change and R&D intensity (frames checked live 2026-11-19)."""

    def test_coca_cola_shares(self):
        dur, rev, rev_prev, instants = frames()
        # WeightedAverageNumberOfDilutedSharesOutstanding CY2025 4,313 million, CY2024 4,320 million
        shares = {fr.SHARES_TAGS[0]: {KO: [4_313e6, END, 'x']}}
        shares_prev = {fr.SHARES_TAGS[0]: {KO: [4_320e6, '2024-12-31', 'x']}}
        x = fr.readings(fr.company_rows(dur, rev, rev_prev, instants, shares, shares_prev)[KO])
        # ln(4,313 / 4,320) = ln(1 - 7 / 4,320) = -0.0016217
        self.assertAlmostEqual(x['shareIssuance'], -0.0016217, 6)
        self.assertIsNone(x['rdIntensity'])  # Coca-Cola tags no R&D line

    def test_apple_research_and_shares(self):
        end, prev = '2025-09-27', '2024-09-28'
        dur = {'ni': {1: [112_010e6, end, 'x']}}
        rnd = {'ResearchAndDevelopmentExpense': {1: [34_550e6, end, 'x']}}
        rev = {'RevenueFromContractWithCustomerExcludingAssessedTax': {1: [416_161e6, end, 'x']}}
        rev_prev = {'RevenueFromContractWithCustomerExcludingAssessedTax': {1: [391_035e6, prev, 'x']}}
        shares = {fr.SHARES_TAGS[0]: {1: [15_004_697e3, end, 'x']}}
        shares_prev = {fr.SHARES_TAGS[0]: {1: [15_408_095e3, prev, 'x']}}
        x = fr.readings(fr.company_rows(dur, rev, rev_prev, {}, shares, shares_prev, rnd)[1])
        # 34,550 / 416,161
        self.assertAlmostEqual(x['rdIntensity'], 0.083021, 6)
        # ln(15,004.697 / 15,408.095): 2.6% fewer shares after buybacks
        self.assertAlmostEqual(x['shareIssuance'], -0.026530, 6)

    def test_splits_and_fallbacks(self):
        self.assertTrue(fr.split_like(2.0))
        self.assertTrue(fr.split_like(10.2))   # within 3% of 10-for-1
        self.assertFalse(fr.split_like(8.3))   # an 8.3x jump (a de-SPAC, say) is issuance, not a split
        self.assertTrue(fr.split_like(1 / 4))  # a 1-for-4 reverse split
        self.assertTrue(fr.split_like(1 / 100))  # a 1-for-100 reverse split, never a 99% buyback
        self.assertFalse(fr.split_like(1.5))
        self.assertFalse(fr.split_like(0.97))
        dur, rev, rev_prev, instants = frames()
        D = fr.SHARES_TAGS[0]

        def issuance(now, before, accn_now='a', accn_before='a', tag=D):
            return fr.readings(fr.company_rows(dur, rev, rev_prev, instants, {tag: {KO: [now, END, accn_now]}}, {tag: {KO: [before, '2024-12-31', accn_before]}})[KO])['shareIssuance']

        # both years from one filing are on one basis (the SEC restates for splits): a real doubling counts
        self.assertAlmostEqual(issuance(8_640e6, 4_320e6), math.log(2))
        # from two filings, a whole multiple is a split the older one wasn't restated for
        self.assertIsNone(issuance(8_640e6, 4_320e6, 'a', 'b'))
        self.assertAlmostEqual(issuance(4_313e6, 4_320e6, 'a', 'b'), -0.0016217, 6)
        # a loss-maker tagging only basic shares is still read, from that one tag both years
        self.assertAlmostEqual(issuance(110e6, 100e6, tag=fr.SHARES_TAGS[1]), math.log(1.1))
        # last year's count from a year that doesn't end about a year before is not compared
        x = fr.readings(fr.company_rows(dur, rev, rev_prev, instants, {D: {KO: [4_313e6, END, 'a']}}, {D: {KO: [4_320e6, '2024-06-30', 'a']}})[KO])
        self.assertIsNone(x['shareIssuance'])
        # R&D: recurring spending (excluding acquired in-process R&D) before the plain line when both are tagged
        rnd = {'ResearchAndDevelopmentExpense': {KO: [6_794.1e6, END, 'a']}, 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost': {KO: [4_794.1e6, END, 'a']}}
        x = fr.readings(fr.company_rows(dur, rev, rev_prev, instants, rnd=rnd)[KO])
        self.assertAlmostEqual(x['rdIntensity'], 0.1, 6)  # 4,794.1 / 47,941
        # diluted this year only, basic both years: the tag with both years is used
        B = fr.SHARES_TAGS[1]
        row = fr.company_rows(dur, rev, rev_prev, instants, {D: {KO: [130e6, END, 'a']}, B: {KO: [120e6, END, 'a']}}, {B: {KO: [100e6, '2024-12-31', 'a']}})[KO]
        self.assertEqual(row['sharesTag'], B)
        self.assertAlmostEqual(fr.readings(row)['shareIssuance'], math.log(1.2))

    def test_sources_name_the_exact_files(self):
        got = fr.sources(2025, '2025-06-30', {'rev': 'Revenues', 'shares': fr.SHARES_TAGS[1], 'rnd': fr.RND_TAGS[1]})
        labels = [s['label'] for s in got]
        self.assertIn('Revenues CY2024', labels)
        self.assertIn('Assets CY2025Q2I', labels)  # Microsoft-style June year-end: the June balance sheet
        self.assertIn('Assets CY2024Q2I', labels)
        self.assertIn(f'{fr.SHARES_TAGS[1]} CY2024', labels)
        self.assertIn('https://data.sec.gov/api/xbrl/frames/us-gaap/WeightedAverageNumberOfSharesOutstandingBasic/shares/CY2025.json', [s['url'] for s in got])


class Ranking(unittest.TestCase):
    def test_field_leaves_out_small_companies(self):
        rows = {1: {'end': END, 'gp': 30.0, 'assets': 150e6}, 2: {'end': END, 'gp': 5.0, 'assets': 50e6}, 3: {'end': END, 'gp': 5.0, 'assets': None}}
        by_metric, per = fr.field(rows)
        # every company keeps its readings (a small one is still ranked), only the field leaves them out
        self.assertEqual(sorted(per), [1, 2, 3])
        self.assertEqual(by_metric['grossProfitability'], [30.0 / 150e6])
        self.assertIsNone(per[3]['grossProfitability'])

    def test_percentile_against_the_others(self):
        field = {m: [] for m in fr.METRICS}
        field['assetGrowth'] = [0.01, 0.02, 0.02, 0.03, 0.04]
        r = fr.rank(field, {'assetGrowth': 0.02}, True)['assetGrowth']
        # itself taken out once: others 0.01, 0.02, 0.03, 0.04 -> one below, one tie -> (1 + 0.5) / 4
        self.assertEqual(r['n'], 4)
        self.assertAlmostEqual(r['percentile'], 37.5)
        self.assertAlmostEqual(r['median'], 0.025)
        self.assertAlmostEqual(r['p25'], 0.0175)  # position 0.75 between 0.01 and 0.02
        # a company outside the field never takes another company's tied value out: all five, two below, two ties
        outside = fr.rank(field, {'assetGrowth': 0.02}, False)['assetGrowth']
        self.assertEqual(outside['n'], 5)
        self.assertAlmostEqual(outside['percentile'], 40.0)
        self.assertIsNone(fr.rank(field, {'assetGrowth': None}, True)['assetGrowth'])
        self.assertIsNone(fr.rank(field, {'accruals': 0.1}, True)['accruals'])

    def test_quantile(self):
        self.assertEqual(fr.quantile([], 0.5), None)
        self.assertEqual(fr.quantile([7.0], 0.75), 7.0)
        self.assertAlmostEqual(fr.quantile([1, 2, 3, 4, 5], 0.75), 4)


if __name__ == '__main__':
    unittest.main()
