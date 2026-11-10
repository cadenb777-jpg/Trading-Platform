"""The desktop app's own code never sends order requests: orders happen only on the website's Trade page (preview,
then the confirm window), exactly as in Chrome. The window just shows the website."""
import os
import re
import unittest

APP = os.path.join(os.path.dirname(__file__), '..', 'tp_desktop')


class NoTrading(unittest.TestCase):
    def test_app_sends_no_order_requests(self):
        for name in os.listdir(APP):
            if name.endswith('.py'):
                text = open(os.path.join(APP, name), encoding='utf-8').read()
                self.assertIsNone(re.search(r'(preview|place|cancel)_order|webull\.', text), name)


if __name__ == '__main__':
    unittest.main()
