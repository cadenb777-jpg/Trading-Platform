"""The weekly Schwab login opens the browser by itself (no Enter key in the helper window).

Run from the repository root:  python -m unittest discover helper/tests
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    import schwab_helper  # noqa: E402
except ImportError as err:  # schwab-py not installed in this Python
    schwab_helper = None
    SKIP = str(err)


@unittest.skipIf(schwab_helper is None, 'needs the helper packages')
class SchwabLogin(unittest.TestCase):
    def test_login_does_not_wait_for_enter(self):
        with mock.patch.object(schwab_helper, 'easy_client') as easy:
            schwab_helper.schwab_login({'app_key': 'k', 'app_secret': 's'})
        kwargs = easy.call_args.kwargs
        self.assertIs(kwargs['interactive'], False)
        self.assertGreaterEqual(kwargs['callback_timeout'], 600)


if __name__ == '__main__':
    unittest.main()
