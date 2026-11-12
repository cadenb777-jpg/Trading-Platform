"""Statements "as reported" from a filing's own layout: a small made-up company ('ex') whose files have the same shape as a
real 10-K (schema role titles, presentation tree with a revenue table, labels with total/negated roles, instance)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import asreported as ar, segments as sg  # noqa: E402

L = 'xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"'
ROLE = 'http://ex.com/role/'
XSD = f'''<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" {L}><xs:annotation><xs:appinfo>
<link:roleType roleURI="{ROLE}Ops"><link:definition>0000002 - Statement - CONSOLIDATED STATEMENTS OF OPERATIONS</link:definition></link:roleType>
<link:roleType roleURI="{ROLE}OpsP"><link:definition>0000003 - Statement - CONSOLIDATED STATEMENTS OF OPERATIONS (Parenthetical)</link:definition></link:roleType>
<link:roleType roleURI="{ROLE}Bal"><link:definition>0000004 - Statement - CONSOLIDATED BALANCE SHEETS</link:definition></link:roleType>
<link:roleType roleURI="{ROLE}Cash"><link:definition>0000005 - Statement - CONSOLIDATED STATEMENTS OF CASH FLOWS</link:definition></link:roleType>
<link:roleType roleURI="{ROLE}Inv"><link:definition>0000040 - Disclosure - Inventories (Details)</link:definition></link:roleType>
<link:roleType roleURI="{ROLE}InvT"><link:definition>0000041 - Disclosure - Inventories (Tables)</link:definition></link:roleType>
</xs:appinfo></xs:annotation></xs:schema>'''


def pre_link(role, arcs):
    names = sorted({n for a in arcs for n in a[:2]})
    locs = ''.join(f'<link:loc xlink:type="locator" xlink:label="{n}" xlink:href="ex.xsd#{n.replace(":", "_", 1)}"/>' for n in names)
    body = ''.join(f'<link:presentationArc xlink:type="arc" xlink:from="{a[0]}" xlink:to="{a[1]}" order="{a[2]}"'
                   + (f' preferredLabel="http://www.xbrl.org/2003/role/{a[3]}"' if len(a) > 3 else '') + '/>' for a in arcs)
    return f'<link:presentationLink xlink:type="extended" xlink:role="{ROLE}{role}">{locs}{body}</link:presentationLink>'


PRE = f'<link:linkbase {L}>' + pre_link('Ops', [
    ('us-gaap:IncomeStatementAbstract', 'srt:ProductOrServiceAxis', 1), ('us-gaap:IncomeStatementAbstract', 'us-gaap:StatementTable', 0),
    ('us-gaap:StatementTable', 'srt:ProductOrServiceAxis', 1), ('srt:ProductOrServiceAxis', 'srt:ProductsAndServicesDomain', 1),
    ('srt:ProductsAndServicesDomain', 'ex:WidgetsMember', 1), ('srt:ProductsAndServicesDomain', 'us-gaap:ServiceMember', 2),
    ('us-gaap:StatementTable', 'us-gaap:StatementLineItems', 2),
    ('us-gaap:StatementLineItems', 'us-gaap:Revenues', 1, 'totalLabel'), ('us-gaap:StatementLineItems', 'us-gaap:CostOfRevenue', 2),
    ('us-gaap:StatementLineItems', 'us-gaap:OperatingExpensesAbstract', 3),
    ('us-gaap:OperatingExpensesAbstract', 'us-gaap:ResearchAndDevelopmentExpense', 1),
    ('us-gaap:OperatingExpensesAbstract', 'us-gaap:EmptyThing', 2),
    ('us-gaap:StatementLineItems', 'us-gaap:NetIncomeLoss', 4, 'totalLabel'),
][1:]) + pre_link('OpsP', [('us-gaap:IncomeStatementAbstract', 'us-gaap:Revenues', 1)]) + pre_link('Bal', [
    ('us-gaap:StatementOfFinancialPositionAbstract', 'us-gaap:AssetsAbstract', 1),
    ('us-gaap:AssetsAbstract', 'us-gaap:Cash', 1), ('us-gaap:AssetsAbstract', 'us-gaap:InventoryNet', 2),
    ('us-gaap:AssetsAbstract', 'us-gaap:Assets', 3, 'totalLabel'),
]) + pre_link('Cash', [
    ('us-gaap:StatementOfCashFlowsAbstract', 'us-gaap:Cash', 0, 'periodStartLabel'),
    ('us-gaap:StatementOfCashFlowsAbstract', 'us-gaap:NetIncomeLoss', 1),
    ('us-gaap:StatementOfCashFlowsAbstract', 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 2, 'negatedLabel'),
    ('us-gaap:StatementOfCashFlowsAbstract', 'us-gaap:Cash', 3, 'periodEndLabel'),
]) + pre_link('Inv', [('us-gaap:InventoryAbstract', 'us-gaap:InventoryNet', 1)]) + '</link:linkbase>'

LABELS = {
    'us-gaap:Revenues': {'label': 'Revenues', 'totalLabel': 'Total net sales'},
    'us-gaap:CostOfRevenue': {'label': 'Cost of revenue', 'terseLabel': 'Cost of sales'},
    'us-gaap:OperatingExpensesAbstract': {'label': 'Operating expenses [Abstract]'},
    'us-gaap:ResearchAndDevelopmentExpense': {'label': 'Research and development'},
    'us-gaap:NetIncomeLoss': {'label': 'Net income', 'totalLabel': 'Net income'},
    'ex:WidgetsMember': {'label': 'Widgets [Member]'}, 'us-gaap:ServiceMember': {'label': 'Service [Member]', 'terseLabel': 'Services'},
    'us-gaap:Cash': {'label': 'Cash', 'periodStartLabel': 'Cash, beginning balance', 'periodEndLabel': 'Cash, ending balance'},
    'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment': {'label': 'Capital spending', 'negatedLabel': 'Payments for property'},
}


def lab_xml():
    parts = []
    for i, (q, roles) in enumerate(LABELS.items()):
        parts.append(f'<link:loc xlink:type="locator" xlink:label="loc{i}" xlink:href="ex.xsd#{q.replace(":", "_", 1)}"/>')
        for role, text in roles.items():
            parts.append(f'<link:label xlink:type="resource" xlink:label="lab{i}" xlink:role="http://www.xbrl.org/2003/role/{role}">{text}</link:label>')
        parts.append(f'<link:labelArc xlink:type="arc" xlink:from="loc{i}" xlink:to="lab{i}"/>')
    return f'<link:linkbase {L}><link:labelLink xlink:type="extended">{"".join(parts)}</link:labelLink></link:linkbase>'


YEARS = [('2024-10-01', '2025-09-30'), ('2023-10-01', '2024-09-30')]


def instance():
    ctxs, facts, n = [], [], 0

    def context(start=None, end=None, instant=None, dim=None):
        nonlocal n
        n += 1
        period = f'<xbrli:instant>{instant}</xbrli:instant>' if instant else f'<xbrli:startDate>{start}</xbrli:startDate><xbrli:endDate>{end}</xbrli:endDate>'
        seg = f'<xbrli:segment><xbrldi:explicitMember dimension="{dim[0]}">{dim[1]}</xbrldi:explicitMember></xbrli:segment>' if dim else ''
        ctxs.append(f'<xbrli:context id="c{n}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>{seg}</xbrli:entity><xbrli:period>{period}</xbrli:period></xbrli:context>')
        return f'c{n}'

    def fact(concept, ref, value):
        facts.append(f'<{concept} contextRef="{ref}" unitRef="usd" decimals="-6">{value}</{concept}>')

    for (start, end), (rev, wid, svc, cost, rd, net, capex) in zip(YEARS, [(1000, 700, 300, 600, 150, 200, 80), (900, 650, 250, 560, 140, 160, 70)]):
        c = context(start, end)
        for concept, v in (('us-gaap:Revenues', rev), ('us-gaap:CostOfRevenue', cost), ('us-gaap:ResearchAndDevelopmentExpense', rd),
                           ('us-gaap:NetIncomeLoss', net), ('us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', capex)):
            fact(concept, c, v)
        fact('us-gaap:Revenues', context(start, end, dim=('srt:ProductOrServiceAxis', 'ex:WidgetsMember')), wid)
        fact('us-gaap:Revenues', context(start, end, dim=('srt:ProductOrServiceAxis', 'us-gaap:ServiceMember')), svc)
    # a quarter: must not become a column of the annual statement
    fact('us-gaap:Revenues', context('2025-07-01', '2025-09-30'), 260)
    for day, cash, inv in (('2025-09-30', 500, 120), ('2024-09-30', 380, 100), ('2023-09-30', 300, 90)):
        c = context(instant=day)
        fact('us-gaap:Cash', c, cash)
        fact('us-gaap:InventoryNet', c, inv)
        fact('us-gaap:Assets', c, cash + inv)
    return ('<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" '
            'xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:srt="http://fasb.org/srt/2025" xmlns:ex="http://ex.com/2025">'
            + ''.join(ctxs) + ''.join(facts) + '</xbrli:xbrl>')


class AsReported(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.roles = ar.parse_roles(XSD)
        cls.pre = ar.parse_presentation(PRE)
        cls.labels = ar.parse_all_labels(lab_xml())
        cls.contexts, cls.facts = sg.parse_instance(instance())

    def build(self, role):
        return ar.build_statement(ROLE + role, self.pre, self.contexts, self.facts, self.labels, 'annual')

    def test_catalogue_lists_statements_first_and_skips_parenthetical_and_tables(self):
        items = ar.catalogue(self.roles, self.pre)
        self.assertEqual([i['kind'] for i in items], ['income', 'balance', 'cashflow', 'details'])
        self.assertEqual(items[0]['title'], 'Consolidated Statements of Operations')
        self.assertEqual(items[3]['title'], 'Inventories')

    def test_income_statement_in_the_company_order_with_product_drill_down(self):
        s = self.build('Ops')
        self.assertEqual(s['columns'], [{'start': '2024-10-01', 'end': '2025-09-30'}, {'start': '2023-10-01', 'end': '2024-09-30'}])
        rows = [(r['kind'], r['label'], r['values']) for r in s['rows']]
        self.assertEqual(rows, [
            ('total', 'Total net sales', [1000, 900]),
            ('member', 'Widgets', [700, 650]),
            ('member', 'Services', [300, 250]),
            ('line', 'Cost of sales', [600, 560]),
            ('heading', 'Operating expenses', [None, None]),
            ('line', 'Research and development', [150, 140]),
            ('total', 'Net income', [200, 160]),
        ])
        self.assertEqual(s['rows'][1]['depth'], s['rows'][0]['depth'] + 1)
        self.assertEqual(s['rows'][5]['depth'], s['rows'][4]['depth'] + 1)

    def test_drill_down_adds_up(self):
        rows = self.build('Ops')['rows']
        self.assertEqual(rows[1]['values'][0] + rows[2]['values'][0], rows[0]['values'][0])

    def test_balance_sheet_uses_year_end_dates(self):
        s = self.build('Bal')
        self.assertEqual([c['end'] for c in s['columns']], ['2025-09-30', '2024-09-30', '2023-09-30'])
        self.assertEqual([(r['kind'], r['label'], r['depth']) for r in s['rows']], [('heading', 'Assets', 0), ('line', 'Cash', 1), ('line', 'Inventory Net', 1), ('total', 'Assets', 1)])
        self.assertEqual(s['rows'][-1]['values'][:2], [620, 480])

    def test_cash_flow_negated_label_and_start_end_balances(self):
        rows = {r['label']: r['values'] for r in self.build('Cash')['rows']}
        self.assertEqual(rows['Payments for property'], [-80, -70])
        self.assertEqual(rows['Cash, beginning balance'], [380, 300])
        self.assertEqual(rows['Cash, ending balance'], [500, 380])

    def test_member_names_without_brackets(self):
        self.assertEqual(ar.label_for('ex:WidgetsMember', self.labels), 'Widgets')
        self.assertEqual(ar.label_for('ex:UnknownThingMember', {}), 'Unknown Thing')


if __name__ == '__main__':
    unittest.main()
