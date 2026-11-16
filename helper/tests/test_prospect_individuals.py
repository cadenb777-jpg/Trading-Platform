"""Registered individuals at a firm from the IAPD individual search (helper/engine/prospect_iapd.py). No network."""
import datetime as dt
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import prospect as pr  # noqa: E402
from engine import prospect_iapd as iapd  # noqa: E402

PAGE = {'hits': {'total': 3, 'hits': [
    {'_source': {'ind_source_id': '111', 'ind_firstname': 'JANE', 'ind_middlename': 'Q', 'ind_lastname': 'DOE',
                 'ind_ia_scope': 'Active', 'ind_bc_scope': 'Active', 'ind_industry_cal_date_iapd': '2011-06-01',
                 'ind_current_employments': [{'firm_id': '999', 'branch_city': 'Austin', 'branch_state': 'TX'}]}},
    {'_source': {'ind_source_id': '222', 'ind_firstname': 'BOB', 'ind_lastname': 'ROE', 'ind_ia_scope': 'Active',
                 'ind_bc_scope': 'InActive', 'ind_current_employments': '[{"firm_id": 999, "branch_city": "Dallas", "branch_state": "TX"}]'}},
    {'_source': {'ind_source_id': '333', 'ind_firstname': 'GONE', 'ind_lastname': 'ELSEWHERE', 'ind_ia_scope': 'Active',
                 'ind_current_employments': [{'firm_id': '555'}]}},
]}}


class Individuals(unittest.TestCase):
    def test_parse(self):
        total, people = iapd.parse_individuals(PAGE, 999, today=dt.date(2026, 11, 16))
        self.assertEqual(total, 3)
        self.assertEqual([p['name'] for p in people], ['JANE Q DOE', 'BOB ROE'])  # the third works elsewhere now
        jane, bob = people
        self.assertEqual((jane['crd'], jane['adviser'], jane['broker'], jane['branch'], jane['years']), (111, True, True, 'Austin, TX', 15))
        self.assertEqual((bob['broker'], bob['branch'], bob['years']), (False, 'Dallas, TX', None))
        self.assertEqual(iapd.individual_title(jane), 'Investment adviser representative (also a registered broker; Austin, TX; 15 yrs in the industry)')

    def test_unknown_shape(self):
        with self.assertRaises(iapd.ShapeError):
            iapd.parse_individuals({'results': []}, 999)

    def test_save_replaces(self):
        tmp = tempfile.mkdtemp()
        try:
            con = pr.connect(os.path.join(tmp, 'p.db'))
            _, people = iapd.parse_individuals(PAGE, 999)
            iapd.save_individuals(con, 999, people, '2026-11-16')
            iapd.save_individuals(con, 999, people[:1], '2026-11-16')
            rows = con.execute('SELECT name, source, source_ref FROM people WHERE firm_id = ?', ('crd-999',)).fetchall()
            self.assertEqual([tuple(r) for r in rows], [('JANE Q DOE', iapd.INDIVIDUALS_SOURCE, 'https://adviserinfo.sec.gov/individual/summary/111')])
            con.close()
        finally:
            shutil.rmtree(tmp)


if __name__ == '__main__':
    unittest.main()
