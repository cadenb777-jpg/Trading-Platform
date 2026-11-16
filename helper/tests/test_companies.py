"""Private companies from the SBA PPP list (helper/engine/companies.py) on a hand-made CSV. No network."""
import csv
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import companies as co  # noqa: E402
from engine.core import EngineError  # noqa: E402

HEAD = ['LoanNumber', 'DateApproved', 'ProcessingMethod', 'BorrowerName', 'BorrowerAddress', 'BorrowerCity', 'BorrowerState', 'BorrowerZip',
        'CurrentApprovalAmount', 'FranchiseName', 'ServicingLenderName', 'BusinessAgeDescription', 'JobsReported', 'NAICSCode',
        'BusinessType', 'NonProfit', 'ForgivenessAmount']
ROWS = [
    ['1', '04/15/2020', 'PPP', "Joe's Grill LLC", '1 Main St', 'AUSTIN', 'TX', '78701-1234', '250000', '', 'Bank A', 'Existing or more than 2 years old', '40', '722511', 'LLC', '', '252000'],
    ['2', '02/01/2021', 'PPS', 'JOES GRILL, L.L.C.', '1 Main St', 'AUSTIN', 'TX', '78701', '350000', '', 'Bank A', '', '45', '722511', 'LLC', '', ''],
    ['3', '05/01/2020', 'PPP', 'Acme Builders Inc', '9 Oak', 'DALLAS', 'TX', '75201', '1000000', '', 'Bank B', '', '80', '236220', 'Corporation', '', ''],
    ['4', '05/01/2020', 'PPP', 'Helping Hands', '2 Elm', 'Miami', 'FL', '33101', '200000', '', 'Bank C', '', '30', '624190', 'Non-Profit Organization', 'Y', ''],
]


def write(path, head=HEAD, rows=ROWS):
    with open(path, 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(head)
        w.writerows(rows)


class Companies(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.con = co.connect(os.path.join(self.tmp, 'c.db'))

    def tearDown(self):
        self.con.close()
        shutil.rmtree(self.tmp)

    def test_estimates(self):
        self.assertEqual(co.payroll_from_loan(250000, '722511', False), 1_200_000)
        self.assertAlmostEqual(co.payroll_from_loan(350000, '722511', True), 1_200_000)  # 3.5 months for restaurants' 2nd draw
        self.assertEqual(co.payroll_from_loan(250000, '236220', True), 1_200_000)
        low, mid, high = co.revenue_range(1_200_000, '722511')
        self.assertLess(low, mid)
        self.assertLess(mid, high)
        self.assertAlmostEqual(mid, 1_200_000 / 0.31)

    def test_build_merges_draws_and_searches(self):
        path = os.path.join(self.tmp, 'ppp.csv')
        write(path)
        self.assertEqual(co.build(self.con, [path]), 3)  # Joe's two loans are one company
        grill = co.search(self.con, {'group': 'restaurants'})
        self.assertEqual(grill['total'], 1)
        g = grill['rows'][0]
        self.assertEqual((g['draws'], g['jobs'], g['city'], g['zip'], g['approved']), (2, 45, 'Austin', '78701', '2020-04-15'))
        self.assertEqual(co.search(self.con, {'group': 'construction', 'state': 'tx'})['rows'][0]['name'], 'Acme Builders Inc')
        self.assertEqual(co.search(self.con, {'noNonprofits': True})['total'], 2)
        self.assertEqual(co.search(self.con, {'revenueMin': 10_000_000})['rows'][0]['name'], 'Acme Builders Inc')  # 4.8M / 0.22
        self.assertEqual([r['name'] for r in co.search(self.con, {})['rows']][0], 'Acme Builders Inc')  # biggest revenue first
        st = co.status(self.con)
        self.assertEqual((st['count'], st['byGroup']['restaurants'], st['byGroup']['construction']), (3, 1, 1))

    def test_unknown_layout_changes_nothing(self):
        good, bad = os.path.join(self.tmp, 'g.csv'), os.path.join(self.tmp, 'b.csv')
        write(good)
        co.build(self.con, [good])
        write(bad, head=['Name', 'City'], rows=[['x', 'y']])
        with self.assertRaises(EngineError):
            co.build(self.con, [bad])
        self.assertEqual(co.status(self.con)['count'], 3)

    def test_catalog(self):
        cat = {'result': {'resources': [{'url': 'https://data.sba.gov/x/public_150k_plus_240930.csv'}, {'url': 'https://data.sba.gov/x/public_up_to_150k_1_240930.csv'}, {'url': 'https://data.sba.gov/x/dict.xlsx'}]}}
        self.assertEqual(co.pick_files(cat), ['https://data.sba.gov/x/public_150k_plus_240930.csv'])
        with self.assertRaises(EngineError):
            co.pick_files({'oops': 1})


if __name__ == '__main__':
    unittest.main()
