"""The debt maturity ladder read from SEC company facts (helper 68), on the shape of Apple's FY2026 10-K."""
import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import research as r  # noqa: E402

T = 'LongTermDebtMaturitiesRepaymentsOfPrincipal'


def fact(end, val, accn, filed, form='10-K'):
    return {'end': end, 'val': val, 'accn': accn, 'filed': filed, 'form': form, 'fy': 2026, 'fp': 'FY'}


def facts(tags):
    return {'facts': {'us-gaap': {t: {'units': {'USD': rows}} for t, rows in tags.items()}}}


NEW, OLD = '0000320193-26-000026', '0000320193-25-000079'


class Ladder(unittest.TestCase):
    def test_newest_10k_own_date(self):
        # Apple FY2026 10-K (filed 2026-11-03): 9.991, 9.3, 5.175, 4.956, 3.75, 45.506 $bn; it repeats FY2025's table
        f = facts({
            T + 'InNextTwelveMonths': [fact('2025-09-27', 10.9e9, OLD, '2025-10-31'), fact('2026-09-26', 9.991e9, NEW, '2026-11-03'),
                                       fact('2025-09-27', 10.9e9, NEW, '2026-11-03')],
            T + 'InYearTwo': [fact('2026-09-26', 9.3e9, NEW, '2026-11-03')],
            T + 'InYearThree': [fact('2026-09-26', 5.175e9, NEW, '2026-11-03')],
            T + 'InYearFour': [fact('2026-09-26', 4.956e9, NEW, '2026-11-03')],
            T + 'InYearFive': [fact('2026-09-26', 3.75e9, NEW, '2026-11-03'), fact('2026-06-27', 1e9, '0000320193-26-000013', '2026-08-01', '10-Q')],
            T + 'AfterYearFive': [fact('2025-09-27', 50e9, OLD, '2025-10-31')],  # only in last year's filing
        })
        m = r.maturities(f)
        self.assertEqual((m['asOf'], m['filed'], m['accession']), ('2026-09-26', '2026-11-03', NEW))
        self.assertEqual(m['buckets'], {'next12': 9.991e9, 'year2': 9.3e9, 'year3': 5.175e9, 'year4': 4.956e9, 'year5': 3.75e9,
                                        'after5': None})  # never borrowed from the older filing

    def test_partial_amendment_never_hides_the_full_table(self):
        full = [fact('2026-09-26', v, NEW, '2026-11-03') for v in (1e9,)]
        f = facts({
            T + 'InNextTwelveMonths': full + [fact('2026-09-26', 1.1e9, 'amend', '2026-12-15', '10-K/A')],
            T + 'InYearTwo': [fact('2026-09-26', 2e9, NEW, '2026-11-03')],
            T + 'AfterYearFive': [fact('2026-09-26', 9e9, NEW, '2026-11-03')],
        })
        m = r.maturities(f)
        self.assertEqual(m['accession'], NEW)
        self.assertEqual((m['buckets']['next12'], m['buckets']['year2'], m['buckets']['after5']), (1e9, 2e9, 9e9))
        # an amendment of an older year never replaces the newest year's table
        f2 = facts({T + 'InYearTwo': [fact('2026-09-26', 2e9, NEW, '2026-11-03'), fact('2025-09-27', 3e9, 'old-amend', '2026-12-01', '10-K/A')]})
        self.assertEqual(r.maturities(f2)['asOf'], '2026-09-26')
        # a full amendment of the same year with as many buckets, filed later, wins
        f3 = facts({T + 'InYearTwo': [fact('2026-09-26', 2e9, NEW, '2026-11-03'), fact('2026-09-26', 2.5e9, 'amend', '2026-12-15', '10-K/A')]})
        self.assertEqual(r.maturities(f3)['buckets']['year2'], 2.5e9)

    def test_none_without_the_table(self):
        self.assertIsNone(r.maturities(facts({'LongTermDebt': [fact('2026-01-25', 8.468e9, 'x', '2026-02-25')]})))
        self.assertIsNone(r.maturities({'facts': {}}))
        # quarterly reports don't count
        self.assertIsNone(r.maturities(facts({T + 'InYearTwo': [fact('2026-06-27', 1e9, 'q', '2026-08-01', '10-Q')]})))

    def test_link(self):
        m = r._with_link({'accession': NEW}, 320193)
        self.assertEqual(m['url'], 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.htm')
        self.assertIsNone(r._with_link(None, 1))


class OldCache(unittest.TestCase):
    def test_copy_saved_before_68_gets_its_ladder(self):
        # saved by helper 67: no 'maturities' (its statements already have the helper-71 lines, so only the ladders load)
        old = {'statements': {'annual': {'values': {k: [] for k in r.STATEMENT_KEYS}}}, 'shares': 5}
        asked = []

        class Ctx:
            async def cached(self, key, ttl, load, persist=False, stale_ok=False):
                asked.append(key[0])
                return old if key[0] == 'sec-core' else await load()

        f = facts({T + 'InYearTwo': [fact('2026-09-26', 2e9, NEW, '2026-11-03')]})

        async def fake_json(ctx, url):
            return f
        with mock.patch.object(r.sec, '_json', fake_json):
            core = asyncio.run(r.company_core(Ctx(), 320193, with_maturities=True))
            self.assertEqual(core['maturities']['buckets']['year2'], 2e9)
            self.assertEqual(core['shares'], 5)
            self.assertIsNone(core['obligations'])
            self.assertEqual(asked, ['sec-core', 'sec-ladders'])
            # comps (no ladder wanted) never downloads it
            asked.clear()
            self.assertNotIn('maturities', asyncio.run(r.company_core(Ctx(), 320193)))
            self.assertEqual(asked, ['sec-core'])
            # a helper-68 copy (ladder but no obligations) also gets the new parts
            old.update(maturities=None)
            asked.clear()
            core = asyncio.run(r.company_core(Ctx(), 320193, with_maturities=True))
            self.assertEqual(asked, ['sec-core', 'sec-ladders'])
            self.assertEqual(core['maturities']['buckets']['year2'], 2e9)


L = 'LesseeOperatingLeaseLiabilityPaymentsDue'


class Obligations(unittest.TestCase):
    def test_apple_fy2026(self):
        # Apple FY2026 10-K: lease payments 1.98 / 2.053 / 1.921 / 1.617 / 1.41 / 6.362, total 15.343, present value
        # 12.912 ($bn); purchase commitments 24.844; unrecognized tax benefits 22.487
        rows = {L + s: [fact('2026-09-26', v, NEW, '2026-11-03')] for s, v in (
            ('NextTwelveMonths', 1.98e9), ('YearTwo', 2.053e9), ('YearThree', 1.921e9), ('YearFour', 1.617e9), ('YearFive', 1.41e9),
            ('AfterYearFive', 6.362e9), ('', 15.343e9))}
        rows['OperatingLeaseLiability'] = [fact('2026-09-26', 12.912e9, NEW, '2026-11-03')]
        rows['FinanceLeaseLiability'] = [fact('2026-09-26', 1.456e9, NEW, '2026-11-03')]
        rows['UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount'] = [fact('2026-09-26', 24.844e9, NEW, '2026-11-03')]
        # an older, bigger figure under the other tag never wins over the newer year
        rows['PurchaseObligation'] = [fact('2025-09-27', 45e9, OLD, '2025-10-31')]
        rows['UnrecognizedTaxBenefits'] = [fact('2026-09-26', 22.487e9, NEW, '2026-11-03'), fact('2025-09-27', 21e9, NEW, '2026-11-03')]
        o = r.obligations(facts(rows))
        b = o['leases']['buckets']
        self.assertEqual((b['next12'], b['after5'], b['total'], b['presentValue']), (1.98e9, 6.362e9, 15.343e9, 12.912e9))
        self.assertEqual(o['leases']['asOf'], '2026-09-26')
        self.assertEqual(o['financeLease']['value'], 1.456e9)
        self.assertEqual((o['purchase']['value'], o['purchase']['asOf'], o['purchase']['tag']),
                         (24.844e9, '2026-09-26', 'UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount'))
        self.assertEqual((o['uncertainTax']['value'], o['uncertainTax']['asOf']), (22.487e9, '2026-09-26'))

    def test_missing_parts(self):
        o = r.obligations(facts({'UnrecognizedTaxBenefits': [fact('2025-12-31', 857e6, 'ko', '2026-02-20')]}))
        self.assertEqual((o['leases'], o['financeLease'], o['purchase'], o['uncertainTax']['value']), (None, None, None, 857e6))
        self.assertIsNone(r.obligations(facts({})))
        # the same date under both purchase tags: the first (the total) wins
        two = r.obligations(facts({'PurchaseObligation': [fact('2026-01-25', 45e9, 'n', '2026-02-25')],
                                   'UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount': [fact('2026-01-25', 22.7e9, 'n', '2026-02-25')]}))
        self.assertEqual(two['purchase']['value'], 22.7e9)


class HealthLines(unittest.TestCase):
    def test_copy_without_the_newer_lines_is_read_again(self):
        # a helper-71..73 copy has the health lines but not the helper-74 inventory and payables: the same key is
        # reloaded now (max age 0), never a second copy
        old = {'statements': {'annual': {'values': {'receivables': [], 'ppe': [], 'retainedEarnings': []}}}, 'shares': 5,
               'maturities': None, 'obligations': None}
        fresh = {'statements': {'annual': {'values': {k: [1] for k in r.STATEMENT_KEYS}}}, 'shares': 6,
                 'maturities': None, 'obligations': None}
        asked = []

        class Ctx:
            async def cached(self, key, ttl, load, persist=False, stale_ok=False):
                asked.append((key, ttl))
                return old if ttl else fresh
        core = asyncio.run(r.company_core(Ctx(), 320193, with_maturities=True))
        self.assertEqual((core['shares'], asked), (6, [(('sec-core', 320193), 6 * 3600), (('sec-core', 320193), 0)]))
        # comps never asks for it
        asked.clear()
        asyncio.run(r.company_core(Ctx(), 320193))
        self.assertEqual(asked, [(('sec-core', 320193), 6 * 3600)])

    def test_a_failed_re_read_keeps_the_saved_copy(self):
        old = {'statements': {'annual': {'values': {'revenue': []}}}, 'shares': 5, 'maturities': None, 'obligations': None}

        class Ctx:
            async def cached(self, key, ttl, load, persist=False, stale_ok=False):
                if ttl == 0:
                    raise RuntimeError('SEC unreachable')
                return old
        core = asyncio.run(r.company_core(Ctx(), 320193, with_maturities=True))
        self.assertEqual(core['shares'], 5)  # the page still opens


class Yields(unittest.TestCase):
    def test_latest_of_each_and_failures(self):
        async def fred(ctx, sid):
            if sid == 'BAMLH0A0HYM2EY':
                raise RuntimeError('FRED down')
            return [['2026-11-09', 5.73], ['2026-11-10', None], ['2026-11-11', 5.84]]
        with mock.patch('engine.macro.fred', fred):
            y = asyncio.run(r.corp_yields(None))
        self.assertEqual(y, {'ig': {'value': 5.84, 'date': '2026-11-11', 'series': 'BAMLC0A0CMEY'}, 'hy': None,
                             # helper 83: Moody's Baa yield, the floor Research sets return on capital against
                             'baa': {'value': 5.84, 'date': '2026-11-11', 'series': 'BAA'}})


if __name__ == '__main__':
    unittest.main()
