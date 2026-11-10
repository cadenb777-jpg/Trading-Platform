"""The launcher reuses a helper that is already running and starts one only when none answers."""
import os
import socket
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import launch  # noqa: E402


class HelperCheck(unittest.TestCase):
    def test_sees_a_running_helper(self):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            s.listen(1)
            self.assertTrue(launch.helper_running(s.getsockname()[1]))

    def test_nothing_listening(self):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]  # bound but not listening, then closed: nobody answers
        self.assertFalse(launch.helper_running(port))

    def test_runs_the_websites_helper_without_chrome(self):
        text = open(launch.__file__, encoding='utf-8').read()
        self.assertIn("'splash.py'), 'run', '--no-browser'", text)


class Proc:
    """A stand-in process: exits with `code`; `alive` = still running when asked."""
    def __init__(self, code=0, alive=False):
        self.code, self.alive, self.waited = code, alive, False

    def wait(self):
        self.waited, self.alive = True, False
        return self.code

    def poll(self):
        return None if self.alive else self.code


class RunApp(unittest.TestCase):
    def run_with(self, app, helper, running, updated=None, platform='linux'):
        procs = iter([app, helper])
        self.stopped = []
        with mock.patch.object(launch.sys, 'platform', platform), \
                mock.patch.object(launch, 'stop_tree', side_effect=self.stopped.append), \
                mock.patch.object(launch.console, 'show'), \
                mock.patch.object(launch.subprocess, 'Popen', side_effect=lambda *a, **k: next(procs)) as popen, \
                mock.patch.object(launch, 'helper_running', return_value=running), \
                mock.patch.object(launch.desktop_update, 'restore') as restore, \
                mock.patch.object(launch.splash, 'wait_for_enter'), mock.patch.object(launch.splash, 'ok'), \
                mock.patch.object(launch.splash, 'warn'), mock.patch.object(launch.splash, 'fail'):
            code = launch.run_app(updated)
        return code, popen, restore

    def test_uses_a_running_helper(self):
        code, popen, _ = self.run_with(Proc(0), None, running=True)
        self.assertEqual(code, 0)
        self.assertEqual(popen.call_count, 1)  # only the app
        self.assertEqual(popen.call_args.kwargs['env'].get('TP_HELPER_BY_LAUNCHER'), '1')  # so the app won't start a second

    def test_starts_the_helper_beside_the_app_and_keeps_it_after_the_app_closes(self):
        helper = Proc(0, alive=True)
        code, popen, _ = self.run_with(Proc(0), helper, running=False)
        self.assertEqual(popen.call_count, 2)
        self.assertIn('--no-browser', popen.call_args_list[1].args[0])
        self.assertTrue(helper.waited)  # this window stays the helper's until you close it
        self.assertEqual(code, 0)

    def test_a_fresh_update_that_crashes_is_put_back_even_with_the_helper_running(self):
        helper = Proc(0, alive=True)
        code, _, restore = self.run_with(Proc(1), helper, running=False, updated=(None, (2, 0), 'backup-folder'))
        restore.assert_called_once_with('backup-folder')

    def test_windows_hides_this_window_and_quitting_stops_the_helper(self):
        helper = Proc(0, alive=True)
        code, popen, _ = self.run_with(Proc(0), helper, running=False, platform='win32')
        self.assertEqual(popen.call_args_list[0].kwargs['env'].get(launch.console.FLAG), '1')
        self.assertEqual(popen.call_args_list[1].kwargs['env'].get(launch.console.FLAG), '1')
        self.assertEqual(self.stopped, [helper])  # nothing left running unseen
        self.assertEqual(code, 0)

    def test_windows_leaves_a_helper_it_did_not_start(self):
        code, _, _ = self.run_with(Proc(0), None, running=True, platform='win32')
        self.assertEqual(self.stopped, [])
        self.assertEqual(code, 0)

    def test_a_crash_without_an_update_waits_for_enter(self):
        code, _, restore = self.run_with(Proc(1), None, running=True)
        self.assertEqual(code, 2)
        restore.assert_not_called()


if __name__ == '__main__':
    unittest.main()
