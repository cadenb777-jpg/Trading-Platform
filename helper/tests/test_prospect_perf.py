"""A prospect's 13F holdings-based return and its effect on the revenue estimate."""
import asyncio
import datetime as dt
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import prospect as pr  # noqa: E402
from engine import prospect_perf as pp  # noqa: E402


def ts(day):
    return int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp())


PRICES = {  # quarter ends 2026-03-31, 06-30, 09-30
    'AAA': {'2026-03-31': 100, '2026-06-30': 110, '2026-09-30': 121},
    'BBB': {'2026-03-31': 50, '2026-06-30': 45, '2026-09-30': 45},
    'SPY': {'2026-03-31': 500, '2026-06-30': 510, '2026-09-30': 520},
}


class Ctx:
    async def daily_bars(self, t, years):
        return [{'time': ts(d), 'close': c} for d, c in sorted(PRICES.get(t, {}).items())]


class Perf(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = Path(self.dir.name) / 'p.db'
        con = pr.connect(self.db)
        con.execute("INSERT INTO firms (id, name, cik, has13f, aum_total, client_mix, fees, employees) VALUES ('f1', 'Fund Co', 77, 1, 2e9, ?, ?, 20)",
                    (json.dumps({'pooled': {'count': 4, 'aum': 1e9}, 'pensions': {'count': 2, 'aum': 1e9}}), json.dumps(['Percentage of assets', 'Performance-based'])))
        for period, rows in (('2026-03-31', [('A1', 'AAA', 600), ('B1', 'BBB', 400)]), ('2026-06-30', [('A1', 'AAA', 1000)]), ('2026-09-30', [('A1', 'AAA', 1100)])):
            for cusip, _t, value in rows:
                con.execute("INSERT INTO holdings_13f (cik, period, cusip, issuer, class, value, shares, share_type, put_call) VALUES (77, ?, ?, ?, 'COM', ?, 1, 'SH', '')",
                            (period, cusip, cusip, value))
        con.execute("INSERT INTO cusip_map (cusip, ticker) VALUES ('A1', 'AAA'), ('B1', 'BBB')")
        con.commit()
        con.close()

    def tearDown(self):
        self.dir.cleanup()

    def test_holdings_return_and_revenue(self):
        with mock.patch.object(pr, 'DB_PATH', self.db), mock.patch.object(pp, '_reported_revenue', new=mock.AsyncMock(return_value=None)):
            out = asyncio.run(pp.performance(Ctx(), {'firmId': 'f1'}))
        full = [q for q in out['quarters'] if not q['partial']]
        self.assertEqual(len(full), 2)
        # Q2: 60% AAA +10%, 40% BBB -10% -> +2%; Q3: 100% AAA +10%
        self.assertAlmostEqual(full[0]['return'], 0.02)
        self.assertAlmostEqual(full[1]['return'], 0.10)
        self.assertAlmostEqual(out['oneYear'], 1.02 * 1.10 - 1)
        self.assertAlmostEqual(out['spyOneYear'], 520 / 500 - 1)
        perf = out['revenue']['performance']
        self.assertAlmostEqual(perf['likely'], 1e9 * (1.02 * 1.10 - 1) * 0.2)
        self.assertIn('13F', perf['source'])


if __name__ == '__main__':
    unittest.main()
