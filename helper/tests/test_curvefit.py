"""The fitted Treasury curve, rich/cheap readings, forwards, breakevens and the recession probit, on hand-worked values."""
import math
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import curvefit as c  # noqa: E402

FLAT = (0.04, 0.0, 0.0, 0.0, 1.0, 10.0)
#: an upward-sloping curve with a hump, like 2026's
SHAPE = (0.055, -0.015, -0.01, 0.012, 1.2, 12.0)
TENORS = sorted(c.TENORS.values())


class NelsonSiegelSvensson(unittest.TestCase):
    def test_flat_curve(self):
        for t in (0.1, 1, 7, 30):
            self.assertAlmostEqual(c.nss_zero(FLAT, t), 0.04, places=12)
            self.assertAlmostEqual(c.nss_forward(FLAT, t), 0.04, places=12)

    def test_limits(self):
        # short end -> b0 + b1, long end -> b0 (Svensson 1994)
        self.assertAlmostEqual(c.nss_zero(SHAPE, 1e-9), SHAPE[0] + SHAPE[1], places=8)
        self.assertAlmostEqual(c.nss_forward(SHAPE, 0), SHAPE[0] + SHAPE[1], places=12)
        self.assertAlmostEqual(c.nss_zero(SHAPE, 5000), SHAPE[0], places=3)

    def test_par_yields_on_a_flat_curve(self):
        # continuous 4% = 2(e^0.02 - 1) = 4.0403% semiannual: the par yield of every coupon bond on a flat curve
        semi = 2 * (math.exp(0.02) - 1)
        self.assertAlmostEqual(semi, 0.0404027, places=6)
        for t in (1, 2, 10, 30):
            self.assertAlmostEqual(c.par_yield(FLAT, t), semi, places=10)
        # a 3-month bill: (e^(0.04 x 0.25) - 1) / 0.25 = 4.0201% simple
        self.assertAlmostEqual(c.par_yield(FLAT, 0.25), 0.0402007, places=6)

    def test_forward_rate(self):
        self.assertAlmostEqual(c.forward(FLAT, 1, 2), 2 * (math.exp(0.02) - 1), places=12)
        # forward from zero rates: (z2 t2 - z1 t1) / (t2 - t1)
        z1, z2 = c.nss_zero(SHAPE, 5), c.nss_zero(SHAPE, 10)
        f = (10 * z2 - 5 * z1) / 5
        self.assertAlmostEqual(c.forward(SHAPE, 5, 10), 2 * (math.exp(f / 2) - 1), places=12)

    def test_vector_matches_scalar(self):
        vec = c._par_vector(TENORS)(SHAPE)
        for t, v in zip(TENORS, vec):
            self.assertAlmostEqual(v, c.par_yield(SHAPE, t), places=12)

    def test_fit_recovers_a_known_curve(self):
        ys = [c.par_yield(SHAPE, t) for t in TENORS]
        p, rmse = c.fit_nss(TENORS, ys)
        self.assertLess(rmse, 0.2)
        for t, y in zip(TENORS, ys):
            self.assertLess(abs(c.par_yield(p, t) - y) * 1e4, 0.5)

    def test_too_few_points(self):
        with self.assertRaises(ValueError):
            c.fit_nss([1, 2, 5], [0.04, 0.041, 0.042])


class RichCheap(unittest.TestCase):
    def test_gap_stats(self):
        hist = [1.0, 3.0] * 15  # mean 2, sample SD sqrt(30/29)
        st = c.gap_stats(hist, 5.0)
        self.assertAlmostEqual(st['mean'], 2.0)
        self.assertAlmostEqual(st['sd'], math.sqrt(30 / 29))
        self.assertAlmostEqual(st['z'], 3 / math.sqrt(30 / 29))
        self.assertIsNone(c.gap_stats([1.0] * 10, 2.0)['z'])

    def test_reading(self):
        self.assertIn('cheap', c.reading(4, 2.6))
        self.assertIn('rich', c.reading(-4, -2.6))
        self.assertEqual(c.reading(1, 2.0), 'in its usual place')
        self.assertEqual(c.reading(1, None), 'not enough history yet')

    def synthetic_days(self, n=131, bump=None):
        rng = random.Random(7)
        days = []
        for i in range(n):
            level = 0.001 * math.sin(i / 20)
            p = (SHAPE[0] + level, *SHAPE[1:])
            point = {t: round(100 * c.par_yield(p, t) + rng.gauss(0, 0.005), 3) for t in TENORS}
            days.append((f'2026-{1 + i // 28:02d}-{1 + i % 28:02d}', point))
        if bump:
            t, bp = bump
            days[-1][1][t] = round(days[-1][1][t] + bp / 100, 3)
        return days

    def test_a_cheap_maturity_is_found(self):
        days = self.synthetic_days(bump=(7.0, 12))
        real = [(days[-1][0], {5.0: 1.9, 10.0: 2.1})]
        known = {}
        out = c.analyse(days, real, None, known)
        self.assertEqual(out['cheapest']['label'], '7Y')
        row = next(r for r in out['rows'] if r['label'] == '7Y')
        self.assertGreater(row['gapBp'], 5)
        self.assertIn('cheap', row['reading'])
        # weekly samples: 27 fitted days for 131 trading days, a month back = 20 trading days
        self.assertEqual(out['fittedDays'], 27)
        self.assertEqual(out['monthAgoDate'], days[-21][0])
        # breakeven = nominal - real at the same maturity, only when both are the same day
        be = {b['label']: b for b in out['breakevens']}
        self.assertAlmostEqual(be['10Y']['breakeven'], days[-1][1][10.0] - 2.1, places=9)
        self.assertEqual(len(known), 27)
        # the drawn curve is smooth: no zig-zag between neighbouring points (a coupon curve drawn off coupon dates jumps)
        par = [p['par'] for p in out['curve']]
        steps = [b - a for a, b in zip(par, par[1:])]
        self.assertTrue(all(abs(x) < 0.15 for x in steps), max(map(abs, steps)))
        self.assertTrue(all(p['years'] <= 1 or abs(2 * p['years'] - round(2 * p['years'])) < 1e-9 for p in out['curve']))
        # saved fits are reused, and a revised day is refitted
        again = c.analyse(days, real, None, known)
        self.assertEqual(again['rows'], out['rows'])
        self.assertEqual(c.analyse(days, [('2025-01-01', {10.0: 2.0})], None, known)['breakevens'], [])

    def test_saved_fit_refitted_after_revision(self):
        days = self.synthetic_days(n=10)
        known = {}
        c.fit_days(days, known)
        before = known[days[0][0]]['p']
        days[0][1][10.0] += 0.5
        c.fit_days(days, known)
        self.assertNotEqual(known[days[0][0]]['p'], before)

    def test_parse_curve_csv(self):
        text = 'Date,"1 Mo","4 Mo","10 Yr"\n11/10/2026,4.05,N/A,4.98\n11/09/2026,4.04,4.20,\n'
        rows = c.parse_curve_csv(text.replace('"', ''), c.TENORS)
        self.assertEqual(rows, [('2026-11-09', {1 / 12: 4.04, 4 / 12: 4.20}), ('2026-11-10', {1 / 12: 4.05, 10.0: 4.98})])


class Recession(unittest.TestCase):
    def test_bill_bond_equivalent(self):
        # 4% discount, 91 days: 365 x 0.04 / (360 - 91 x 0.04) = 4.0970%
        self.assertAlmostEqual(c.bill_bey(4.0), 4.09698, places=4)

    def test_norm_cdf(self):
        self.assertAlmostEqual(c.norm_cdf(0), 0.5)
        self.assertAlmostEqual(c.norm_cdf(1.96), 0.975, places=3)

    def test_probit_recovers_coefficients(self):
        rng = random.Random(3)
        xs = [rng.uniform(-3, 4) for _ in range(4000)]
        ys = [1 if rng.random() < c.norm_cdf(-0.6 - 0.7 * x) else 0 for x in xs]
        a, b = c.probit_fit(xs, ys)
        self.assertAlmostEqual(a, -0.6, delta=0.08)
        self.assertAlmostEqual(b, -0.7, delta=0.06)

    def test_auc(self):
        # positives 0.9, 0.3; negatives 0.8, 0.1: 3 of 4 pairs ordered right
        self.assertAlmostEqual(c.auc([0.9, 0.8, 0.3, 0.1], [1, 0, 1, 0]), 0.75)
        self.assertIsNone(c.auc([0.1], [0]))

    def test_record(self):
        months = [f'2000-{m:02d}' for m in range(1, 13)] + [f'2001-{m:02d}' for m in range(1, 13)]
        probs = [0.1] * 24
        rec = [0] * 24
        probs[2] = probs[3] = 0.5     # alarm in March-April 2000 ...
        rec[8:11] = [1, 1, 1]          # ... recession from September 2000: flagged
        probs[14] = 0.4               # alarm in March 2001, no recession after, judged (lead 6 is over)
        r = c.recession_record(months, probs, rec, alarm=0.3, lead=6)
        self.assertEqual(r['recessions'], [{'start': '2000-09', 'flagged': True}])
        self.assertEqual([e['from'] for e in r['falseAlarms']], ['2001-03'])
        probs[22] = 0.4               # too recent to judge
        r = c.recession_record(months, probs, rec, alarm=0.3, lead=6)
        self.assertEqual([e['from'] for e in r['open']], ['2001-11'])
        # NBER hasn't dated the last 12 months yet: the March 2001 alarm (outcome window to Sep 2001) is still open
        r = c.recession_record(months, probs, rec, alarm=0.3, lead=6, known_until='2001-06')
        self.assertEqual(r['falseAlarms'], [])
        self.assertEqual([e['from'] for e in r['open']], ['2001-03', '2001-11'])

    def test_months_back(self):
        self.assertEqual(c.months_back('2026-10', 12), '2025-10')
        self.assertEqual(c.months_back('2026-01', 1), '2025-12')
        self.assertEqual(c.months_back('2026-03', 15), '2024-12')

    def test_no_fred_still_fits_the_curve(self):
        days = RichCheap().synthetic_days(n=40)
        out, known, notes = c._job(days, [], None, None, None, {})
        self.assertIsNone(out['recession'])
        self.assertEqual(notes, ['Recession odds unavailable: FRED could not be reached.'])
        out, _, notes = c._job(days, [], {}, {}, {}, known)  # empty series (FRED answered with nothing)
        self.assertIsNone(out['recession'])

    def test_model_only_learns_from_known_outcomes(self):
        rng = random.Random(5)
        months = [f'{1960 + i // 12}-{1 + i % 12:02d}' for i in range(600)]
        gs10 = {m: 5 + rng.gauss(0, 1) for m in months}
        tb3 = {m: 4 + rng.gauss(0, 1) for m in months}
        usrec = {m: 0 for m in months}
        for i, m in enumerate(months[12:], 12):
            if gs10[months[i - 12]] - c.bill_bey(tb3[months[i - 12]]) < -0.5:
                usrec[m] = 1
        out = c.recession_model(gs10, tb3, usrec, months[-13])
        self.assertLess(out['b'], 0)  # a lower spread means higher odds
        self.assertEqual(out['n'], 600 - 12 - 12)
        # the record is out of sample: in January 1982 the known outcomes run to January 1981, so spreads up to
        # January 1980 qualify: 241 months, the first January with the 240 needed
        self.assertEqual(out['testFrom'], '1982-01')
        self.assertGreater(out['auc'], 0.9)

    def test_out_of_sample_uses_only_the_past(self):
        # a recession-free history, then one recession: before it, no fit exists that could have "known" it
        rng = random.Random(9)
        months = [f'{1960 + i // 12}-{1 + i % 12:02d}' for i in range(480)]
        gs10 = {m: 5 + rng.gauss(0, 1) for m in months}
        tb3 = {m: 4 + rng.gauss(0, 1) for m in months}
        usrec = {m: 0 for m in months}
        for i in (30, 31, 200, 201, 300, 301, 400, 401):
            usrec[months[i]] = 1
        out = c.recession_model(gs10, tb3, usrec, months[-13])
        # 240 known outcomes plus a year's NBER lag: never scored before January 1982, and only from a January
        self.assertGreaterEqual(out['testFrom'], '1982-01')
        self.assertTrue(out['testFrom'].endswith('-01'))


if __name__ == '__main__':
    unittest.main()
