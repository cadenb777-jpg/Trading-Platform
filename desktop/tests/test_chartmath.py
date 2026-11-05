import os, sys, unittest
from datetime import datetime, timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from tp_desktop.chartmath import clock_text, grid_columns, is_daily, nice_step, session_phase


def utc(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp()


class ChartMath(unittest.TestCase):
    def test_clock(self):
        self.assertEqual(clock_text(9, 30), '9:30 AM')
        self.assertEqual(clock_text(0, 0), '12:00 AM')
        self.assertEqual(clock_text(16, 5), '4:05 PM')
        self.assertEqual(clock_text(16, 5, '24h'), '16:05')

    def test_sessions(self):
        self.assertEqual(session_phase(utc('2026-11-05T09:00:00')), 'pre')
        self.assertEqual(session_phase(utc('2026-11-05T14:30:00')), 'regular')
        self.assertEqual(session_phase(utc('2026-11-05T21:00:00')), 'post')
        self.assertEqual(session_phase(utc('2026-11-06T01:00:00')), 'closed')
        self.assertEqual(session_phase(utc('2026-11-07T15:00:00')), 'closed')  # Saturday

    def test_nice_step(self):
        self.assertEqual(nice_step(100, 10), 10)
        self.assertEqual(nice_step(37, 8), 5)
        self.assertEqual(nice_step(0), 1.0)

    def test_grid_columns_carry_past_data(self):
        cols = grid_columns(0, 120, 40, 4)  # 4 px per bar, 40 px cells -> every 10 bars
        self.assertEqual(cols[:3], [0, 10, 20])
        self.assertEqual(cols[-1], 120)
        self.assertEqual(grid_columns(5, 30, 40, 4), [10, 20, 30])  # anchored, not shifted by the scroll

    def test_is_daily(self):
        self.assertTrue(is_daily([i * 86400 for i in range(10)]))
        self.assertFalse(is_daily([i * 300 for i in range(10)]))


if __name__ == '__main__':
    unittest.main()
