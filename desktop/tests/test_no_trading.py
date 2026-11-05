"""The desktop app never trades: no order request names in its code, and its helper refuses them in desktop mode."""
import os
import re
import unittest

HERE = os.path.dirname(__file__)
APP = os.path.join(HERE, '..', 'tp_desktop')
HELPER = os.path.join(HERE, '..', '..', 'helper', 'schwab_helper.py')


class NoTrading(unittest.TestCase):
    def test_app_sends_no_order_requests(self):
        for name in os.listdir(APP):
            if name.endswith('.py'):
                text = open(os.path.join(APP, name), encoding='utf-8').read()
                self.assertIsNone(re.search(r'(preview|place|cancel)_order', text), name)

    def test_desktop_helper_blocks_orders(self):
        import sys
        text = open(HELPER, encoding='utf-8').read()
        self.assertIn('elif DESKTOP and desktop_blocked(kind):', text)
        # the rule itself, without importing the helper (its packages may not be installed here)
        src = text[text.index('def desktop_blocked'):]
        src = src[:src.index('\n\n\n')]
        ns = {}
        exec(src, ns)
        for kind in ('webull.preview_order', 'webull.place_order', 'webull.cancel_order'):
            self.assertTrue(ns['desktop_blocked'](kind), kind)
        self.assertFalse(ns['desktop_blocked']('webull.snapshot'))

if __name__ == '__main__':
    unittest.main()
