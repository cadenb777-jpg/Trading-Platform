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
        old = {'statements': {'x': 1}, 'shares': 5}          # saved by helper 67: no 'maturities'
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
            self.assertEqual(core['statements'], {'x': 1})
            self.assertEqual(asked, ['sec-core', 'sec-maturities'])
            # comps (no ladder wanted) never downloads it
            asked.clear()
            self.assertNotIn('maturities', asyncio.run(r.company_core(Ctx(), 320193)))
            self.assertEqual(asked, ['sec-core'])


if __name__ == '__main__':
    unittest.main()
