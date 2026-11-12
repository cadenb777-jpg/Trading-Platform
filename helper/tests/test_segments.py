"""Segment and product revenue from an XBRL filing: Apple's FY2025 10-K figures (millions), laid out the way Apple's
instance and label files tag them."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import segments as sg  # noqa: E402

PRODUCTS = {  # FY2025, FY2024 (Apple 10-K, Note 2 / Item 7)
    'aapl:IPhoneMember': (209586, 201183), 'aapl:MacMember': (33708, 29984), 'aapl:IPadMember': (28023, 26694),
    'aapl:WearablesHomeandAccessoriesMember': (35686, 37005), 'us-gaap:ServiceMember': (109158, 96169),
}
REGIONS = {  # reportable segments, FY2025 and FY2024
    'aapl:AmericasSegmentMember': (178353, 167045), 'aapl:EuropeSegmentMember': (111032, 101328),
    'aapl:GreaterChinaSegmentMember': (64377, 66952), 'aapl:JapanSegmentMember': (28703, 25052),
    'aapl:RestOfAsiaPacificSegmentMember': (33696, 30658),
}
TOTAL = (416161, 391035)
LABELS = {'aapl:IPhoneMember': 'iPhone [Member]', 'aapl:MacMember': 'Mac [Member]', 'aapl:IPadMember': 'iPad [Member]',
          'aapl:WearablesHomeandAccessoriesMember': 'Wearables, Home and Accessories [Member]', 'us-gaap:ServiceMember': 'Services [Member]',
          'aapl:GreaterChinaSegmentMember': 'Greater China [Member]'}


def instance():
    ctx, facts, n = [], [], 0
    years = [('2024-09-29', '2025-09-27'), ('2023-10-01', '2024-09-28')]

    def context(start, end, dim=None):
        nonlocal n
        n += 1
        seg = (f'<xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier><xbrli:segment>'
               f'<xbrldi:explicitMember dimension="{dim[0]}">{dim[1]}</xbrldi:explicitMember></xbrli:segment></xbrli:entity>') if dim else \
            '<xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier></xbrli:entity>'
        ctx.append(f'<xbrli:context id="c{n}">{seg}<xbrli:period><xbrli:startDate>{start}</xbrli:startDate><xbrli:endDate>{end}</xbrli:endDate></xbrli:period></xbrli:context>')
        return f'c{n}'

    rev = 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax'
    for y, (start, end) in enumerate(years):
        facts.append(f'<{rev} contextRef="{context(start, end)}" unitRef="usd" decimals="-6">{TOTAL[y] * 1_000_000}</{rev}>')
        for member, vals in PRODUCTS.items():
            facts.append(f'<{rev} contextRef="{context(start, end, ("srt:ProductOrServiceAxis", member))}" unitRef="usd" decimals="-6">{vals[y] * 1_000_000}</{rev}>')
        for member, vals in REGIONS.items():
            facts.append(f'<{rev} contextRef="{context(start, end, ("us-gaap:StatementBusinessSegmentsAxis", member))}" unitRef="usd" decimals="-6">{vals[y] * 1_000_000}</{rev}>')
    # a quarter and a product x region combination: both must be ignored by the annual one-dimension breakdown
    facts.append(f'<{rev} contextRef="{context("2025-06-29", "2025-09-27")}" unitRef="usd">102466000000</{rev}>')
    two = context('2024-09-29', '2025-09-27', ('srt:ProductOrServiceAxis', 'aapl:IPhoneMember'))
    ctx[-1] = ctx[-1].replace('</xbrli:segment>', '<xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">aapl:AmericasSegmentMember</xbrldi:explicitMember></xbrli:segment>')
    facts.append(f'<{rev} contextRef="{two}" unitRef="usd">1</{rev}>')
    # synthetic segment operating income for Americas, to check the margin maths (not Apple's figure)
    oi = 'us-gaap:OperatingIncomeLoss'
    facts.append(f'<{oi} contextRef="{context(*years[0], ("us-gaap:StatementBusinessSegmentsAxis", "aapl:AmericasSegmentMember"))}" unitRef="usd">71341200000</{oi}>')
    return ('<?xml version="1.0"?><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" '
            'xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:srt="http://fasb.org/srt/2025" xmlns:aapl="http://www.apple.com/20250927">'
            + ''.join(ctx) + ''.join(facts) + '</xbrli:xbrl>')


def labels():
    parts = []
    for i, (q, text) in enumerate(LABELS.items()):
        frag = q.replace(':', '_', 1)
        parts.append(f'<link:loc xlink:type="locator" xlink:href="aapl-20250927.xsd#{frag}" xlink:label="loc{i}"/>'
                     f'<link:label xlink:type="resource" xlink:label="lab{i}" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="en-US">{text}</link:label>'
                     f'<link:labelArc xlink:type="arc" xlink:from="loc{i}" xlink:to="lab{i}"/>')
    return ('<?xml version="1.0"?><link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">'
            '<link:labelLink xlink:type="extended">' + ''.join(parts) + '</link:labelLink></link:linkbase>')


class AppleFY2025(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contexts, facts = sg.parse_instance(instance())
        cls.data = sg.build(contexts, facts, sg.parse_labels(labels()))

    def section(self, axis):
        return next(s for s in self.data['sections'] if s['axis'] == axis)

    def test_products(self):
        s = self.section('ProductOrServiceAxis')
        names = [i['name'] for i in s['items']]
        self.assertEqual(names, ['iPhone', 'Services', 'Wearables, Home and Accessories', 'Mac', 'iPad'])
        iphone = s['items'][0]
        self.assertEqual(iphone['value'], 209586e6)
        self.assertAlmostEqual(iphone['share'], 209586 / 416161)
        self.assertAlmostEqual(iphone['growth'], 209586 / 201183 - 1)  # +4%, as Apple reported
        self.assertTrue(s['complete'])  # the five parts add up to total net sales

    def test_regions_and_margin(self):
        s = self.section('StatementBusinessSegmentsAxis')
        self.assertEqual(len(s['items']), 5)
        self.assertTrue(s['complete'])
        china = next(i for i in s['items'] if i['member'] == 'aapl:GreaterChinaSegmentMember')
        self.assertEqual(china['name'], 'Greater China')
        self.assertLess(china['growth'], 0)  # Greater China fell in FY2025
        americas = s['items'][0]
        self.assertEqual(americas['name'], 'Americas')  # no label in the file: spelled from the code
        self.assertAlmostEqual(americas['margin'], 0.4, places=3)

    def test_total_and_period(self):
        self.assertEqual(self.data['periodEnd'], '2025-09-27')
        self.assertEqual(self.data['total'], 416161e6)
        self.assertEqual(self.data['priorTotal'], 391035e6)

    def test_incomplete_breakdown_says_so(self):
        contexts, facts = sg.parse_instance(instance())
        facts = [f for f in facts if not (contexts[f['context']]['dims'].get('srt:ProductOrServiceAxis') == 'us-gaap:ServiceMember')]
        s = next(s for s in sg.build(contexts, facts, {})['sections'] if s['axis'] == 'ProductOrServiceAxis')
        self.assertFalse(s['complete'])
        self.assertLess(s['coverage'], 0.8)

    def test_files_in_a_filing_folder(self):
        names = ['aapl-20250927.htm', 'aapl-20250927_htm.xml', 'aapl-20250927_lab.xml', 'aapl-20250927_pre.xml', 'FilingSummary.xml']
        self.assertEqual(sg.pick_files(names), ('aapl-20250927_htm.xml', 'aapl-20250927_lab.xml'))

    def test_unsafe_xml_refused(self):
        from engine import safexml
        with self.assertRaises(safexml.UnsafeXML):
            sg.parse_instance('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>')


if __name__ == '__main__':
    unittest.main()
