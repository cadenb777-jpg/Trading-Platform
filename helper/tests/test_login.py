"""The weekly Schwab login opens the browser by itself (no Enter key in the helper window).

Run from the repository root:  python -m unittest discover helper/tests
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path
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


@unittest.skipIf(schwab_helper is None, 'needs the helper packages')
class RefusedLogin(unittest.TestCase):
    """When Schwab refuses the saved login (even a young one), the login page opens and the new login is used in place."""

    def test_recognises_a_refused_login(self):
        refused = schwab_helper.schwab_login_refused
        self.assertTrue(refused(Exception('refresh_token_authentication_error: Failed refresh token authentication')))
        self.assertTrue(refused(Exception("OAuthError: invalid_grant")))
        self.assertTrue(refused(Exception("Client error '401 Unauthorized' for url 'https://api.schwabapi.com/trader/v1/userPreference'")))
        self.assertTrue(refused(schwab_helper.HelperError('Schwab login expired (401)')))
        self.assertFalse(refused(ConnectionResetError('Connection reset by peer')))
        self.assertFalse(refused(TimeoutError('timed out')))

    def _market(self):
        client = mock.Mock()
        client.session, client.token_metadata = 'old-session', 'old-meta'
        m = schwab_helper.Market(client, stream_factory=mock.Mock(), news=mock.Mock(http=None), engine_ctx=mock.Mock(news=1))
        m.config = {'app_key': 'k', 'app_secret': 's'}
        m.set_status = mock.Mock()
        return m, client

    def test_new_login_is_used_in_place(self):
        async def go():
            m, client = self._market()
            fresh = mock.Mock(session='new-session', token_metadata='new-meta')
            with tempfile.TemporaryDirectory() as d, \
                    mock.patch.object(schwab_helper, 'TOKEN_PATH', Path(d) / 'schwab_token.json'), \
                    mock.patch.object(schwab_helper, 'schwab_login', return_value=fresh) as login:
                (Path(d) / 'schwab_token.json').write_text('{}')
                reply = await m.relogin('test', manual=True)
                self.assertFalse((Path(d) / 'schwab_token.json').exists())  # the refused login was removed
            self.assertEqual(reply['type'], 'schwab_login')
            self.assertEqual((client.session, client.token_metadata), ('new-session', 'new-meta'))
            login.assert_called_once()
        asyncio.run(go())

    def test_opens_by_itself_at_most_every_30_minutes(self):
        async def go():
            m, _ = self._market()
            with tempfile.TemporaryDirectory() as d, \
                    mock.patch.object(schwab_helper, 'TOKEN_PATH', Path(d) / 't.json'), \
                    mock.patch.object(schwab_helper, 'schwab_login', side_effect=RuntimeError('timed out')) as login:
                with self.assertRaises(schwab_helper.HelperError):
                    await m.relogin('stream')
                with self.assertRaises(schwab_helper.HelperError):
                    await m.relogin('stream')  # too soon: no second login page
                self.assertEqual(login.call_count, 1)
                with self.assertRaises(schwab_helper.HelperError):
                    await m.relogin('button', manual=True)  # the button always works
                self.assertEqual(login.call_count, 2)
        asyncio.run(go())

    def test_status_goes_back_to_live_after_login(self):
        async def go():
            m, _ = self._market()
            m.stream_live = True  # the open stream kept working; a chart request found the refused login
            with tempfile.TemporaryDirectory() as d, \
                    mock.patch.object(schwab_helper, 'TOKEN_PATH', Path(d) / 't.json'), \
                    mock.patch.object(schwab_helper, 'schwab_login', return_value=mock.Mock(session=mock.AsyncMock(), token_metadata='m')):
                await m.relogin('chart history', manual=True)
            self.assertEqual(m.set_status.call_args.args[0], 'live')
        asyncio.run(go())

    def test_uses_the_other_helpers_newer_login_without_a_page(self):
        async def go():
            m, client = self._market()
            other = mock.Mock(session='other-session', token_metadata='other-meta')
            with mock.patch.object(schwab_helper, 'newer_saved_login', return_value=other), \
                    mock.patch.object(schwab_helper, 'schwab_login') as login:
                await m.relogin('stream')
            login.assert_not_called()
            self.assertEqual(client.session, 'other-session')
        asyncio.run(go())

    def test_no_update_restart_while_the_login_page_is_open(self):
        async def go():
            m, _ = self._market()
            self.assertTrue(m.safe_to_restart())
            m.login_task = asyncio.get_running_loop().create_future()  # still waiting for the owner
            self.assertFalse(m.safe_to_restart())
            m.login_task.set_result(None)
            self.assertTrue(m.safe_to_restart())
        asyncio.run(go())


if __name__ == '__main__':
    unittest.main()
