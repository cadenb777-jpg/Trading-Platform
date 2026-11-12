"""Fed rate odds (CME FedWatch method) worked by hand, and net liquidity."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import rates  # noqa: E402

D = dt.date


class FedOdds(unittest.TestCase):
    # EFFR 3.88 in a 3.75-4.00 range; November has no meeting; Dec 9 and Jan 27 meetings; February has none.
    IMPLIED = {(2026, 11): 3.88, (2026, 12): 3.79, (2027, 1): 3.70, (2027, 2): 3.55}
    MEETINGS = [D(2026, 12, 9), D(2027, 1, 27), D(2027, 3, 17)]

    def moves(self):
        return rates.meeting_moves(D(2026, 11, 12), self.MEETINGS, self.IMPLIED, 3.88)

    def test_december_rate_after_from_the_month_average(self):
        dec = self.moves()[0]
        # (3.79 x 31 - 3.88 x 9) / 22 = 3.753182 (January has a meeting, so December's own contract is used)
        self.assertAlmostEqual(dec['after'], (3.79 * 31 - 3.88 * 9) / 22, places=9)
        self.assertAlmostEqual(dec['steps'], -0.507273, places=5)

    def test_january_uses_february_contract_and_chain_stops_without_march(self):
        m = self.moves()
        self.assertEqual(len(m), 2)  # March needs the March contract (April also has a meeting): not given
        self.assertAlmostEqual(m[1]['before'], m[0]['after'])
        self.assertAlmostEqual(m[1]['after'], 3.55)

    def test_step_odds(self):
        self.assertEqual(rates.step_odds(2.0), {2: 1.0})
        odds = rates.step_odds(2.1103)
        self.assertAlmostEqual(odds[3], 0.1103, places=6)
        self.assertAlmostEqual(odds[2], 0.8897, places=6)
        odds = rates.step_odds(-0.4)
        self.assertAlmostEqual(odds[-1], 0.4)
        self.assertAlmostEqual(odds[0], 0.6)

    def test_tree_hand_worked(self):
        t = rates.tree(self.moves(), 3.75)
        dec, jan = t
        self.assertAlmostEqual(dec['pCut'], 0.507273, places=5)
        self.assertAlmostEqual(dec['pHold'], 0.492727, places=5)
        by = {r['lower']: r['p'] for r in jan['ranges']}
        self.assertAlmostEqual(by[3.25], 0.507273 * 0.812727, places=5)  # two cuts
        self.assertAlmostEqual(by[3.5], 0.507273 * 0.187273 + 0.492727 * 0.812727, places=5)
        self.assertAlmostEqual(by[3.75], 0.492727 * 0.187273, places=5)
        self.assertAlmostEqual(sum(by.values()), 1.0, places=9)
        self.assertAlmostEqual(jan['expectedChange'], 3.55 - 3.88, places=9)  # the tree keeps the futures' mean

    def test_symbols(self):
        self.assertEqual(rates.zq_symbol(2026, 12), '/ZQZ26')
        self.assertEqual(rates.zq_symbol(2027, 1), '/ZQF27')


class NetLiquidity(unittest.TestCase):
    def test_join_units_and_last_rrp(self):
        walcl = [('2025-01-01', 6_850_000.0), ('2025-01-08', 6_860_000.0)]
        tga = [('2025-01-01', 700_000.0), ('2025-01-08', 690_000.0)]
        rrp = [('2024-12-31', 470.0), ('2025-01-07', 200.0), ('2025-01-08', 210.0)]  # $ billions
        self.assertEqual(rates.wednesday_join(walcl, tga, rrp), [('2025-01-01', 6_850_000 - 700_000 - 470_000), ('2025-01-08', 6_860_000 - 690_000 - 210_000)])

    def test_change_correlation(self):
        a = [100 * 1.01 ** i * (1.02 if i % 2 else 0.99) for i in range(60)]
        res = rates.change_correlation(a, [2 * x for x in a])
        self.assertAlmostEqual(res['r'], 1.0, places=5)
        b = [100 + (i % 7) for i in range(60)]
        res = rates.change_correlation(a, b)
        self.assertLess(res['low'], res['r'])
        self.assertGreater(res['high'], res['r'])
        self.assertEqual(res['weeks'], 59)
        self.assertIsNone(rates.change_correlation(a[:5], a[:5]))


if __name__ == '__main__':
    unittest.main()
