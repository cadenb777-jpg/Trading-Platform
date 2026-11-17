"""Private mode: the platform from a copy of the code (serving the build, skipping rebuilds, the start flags)."""
import os
import socket
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import private  # noqa: E402
import launch  # noqa: E402


class Serve(unittest.TestCase):
    def test_serves_the_build_on_this_computer_only(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'index.html').write_text('<title>ok</title>')
            with socket.socket() as s:
                s.bind(('127.0.0.1', 0))
                port = s.getsockname()[1]
            server = private.serve(Path(d), port=port)
            try:
                self.assertEqual(server.server_address[0], '127.0.0.1')
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/') as r:
                    self.assertIn(b'ok', r.read())
                    self.assertEqual(r.headers['Cache-Control'], 'no-cache')
                self.assertIsNone(private.serve(Path(d), port=port))  # taken: the running one is used
            finally:
                server.shutdown()
                server.server_close()

    def test_the_helper_accepts_the_private_address(self):
        text = (private.ROOT / 'helper' / 'schwab_helper.py').read_text(encoding='utf-8')
        self.assertIn(f"'http://127.0.0.1:{private.PORT}'", text)


class Build(unittest.TestCase):
    def test_no_node_says_how_to_get_it(self):
        with mock.patch.object(private, 'tool', return_value=None):
            with self.assertRaises(private.StepError) as cm:
                private.build(open(os.devnull, 'w'))
        self.assertIn('nodejs.org', ' '.join(cm.exception.hints))

    def test_no_git_says_how_to_get_it(self):
        with mock.patch.object(private, 'tool', return_value=None):
            with self.assertRaises(private.StepError):
                private.pull(open(os.devnull, 'w'))


class Icon(unittest.TestCase):
    def test_the_private_copy_takes_the_trading_terminal_icon(self):
        import shortcut
        env = shortcut.windows_env(name=shortcut.NAME, target=private.ROOT / 'start-private-windows.bat')
        self.assertEqual(env['TP_LNK_NAME'], 'Trading Terminal.lnk')
        self.assertTrue(env['TP_LNK_TARGET'].endswith('start-private-windows.bat'))
        script = shortcut.private_script()
        self.assertIn("-Filter 'Trading Terminal*.lnk'", script)  # every other Trading Terminal shortcut is checked
        self.assertIn('$keep -notcontains $_.FullName.ToLower()', script)  # every one but the one just made goes
        self.assertNotIn(str(private.ROOT), script)  # the copy's folder only comes through $env

    def test_made_again_once_for_a_new_icon_version(self):
        import shortcut
        with tempfile.TemporaryDirectory() as d:
            marker = Path(d) / 'm.json'
            marker.write_text('{"made": true}')  # the first private icon (no version)
            self.assertFalse(shortcut.private_marker_current(marker))
            marker.write_text(f'{{"made": true, "v": {shortcut.PRIVATE_ICON_VERSION}}}')
            self.assertTrue(shortcut.private_marker_current(marker))


class NoConsole(unittest.TestCase):
    def test_icon_starts_pythonw_with_the_private_launcher(self):
        import shortcut
        with tempfile.TemporaryDirectory() as d:
            python = Path(d) / 'python.exe'
            python.write_text('')
            Path(d, 'pythonw.exe').write_text('')
            target, args = shortcut.private_target(python)
            self.assertEqual(target.name, 'pythonw.exe')
            self.assertTrue(args.endswith('launch.py" --private'))
            Path(d, 'pythonw.exe').unlink()
            target, args = shortcut.private_target(python)  # no pythonw: the .bat (a text screen) instead
            self.assertEqual(target.name, 'start-private-windows.bat')

    def test_progress_file_round_trip(self):
        from tp_desktop import progress
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'p.json'
            self.assertEqual(progress.read(f)['state'], 'working')  # not there yet
            progress.write(f, pct=140, label='Building', state='working')
            self.assertEqual(progress.read(f)['pct'], 100)
            progress.write(f, pct=40, label='', state='failed', message='No Node', hints=['Install it'])
            self.assertEqual(progress.read(f)['message'], 'No Node')
            f.write_text('{"state": "nonsense"}')
            self.assertEqual(progress.read(f)['state'], 'working')

    def test_progress_write_survives_windows_lock(self):
        """Windows refuses the swap while the start screen is reading the file (owner's crash, 2026-11-17)."""
        from unittest import mock
        from tp_desktop import progress
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'p.json'
            denied = PermissionError(5, 'Access is denied')
            with mock.patch.object(progress.os, 'replace', side_effect=denied), mock.patch.object(progress.time, 'sleep'):
                progress.write(f, pct=100, label='Ready', state='ready')
            self.assertEqual(progress.read(f)['state'], 'ready')
            self.assertFalse((Path(d) / 'p.json.tmp').exists())
            # locked for a moment, then free: the swap is used
            with mock.patch.object(progress.os, 'replace', side_effect=[denied, denied, None]) as rep, mock.patch.object(progress.time, 'sleep'):
                progress.write(f, pct=50, label='Half', state='working')
            self.assertEqual(rep.call_count, 3)
            # nothing writable at all: a working update is skipped, a final one raises
            with mock.patch.object(Path, 'write_text', side_effect=denied):
                progress.write(f, pct=10, label='x', state='working')
                with self.assertRaises(OSError):
                    progress.write(f, pct=100, label='Ready', state='ready')

    def test_file_bar_writes_the_progress(self):
        from tp_desktop import progress
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'p.json'
            bar = launch.FileBar(f)
            bar.stage('Checking the platform...', 20)
            bar.shown = 12.0
            bar.draw()
            got = progress.read(f)
            self.assertEqual((got['pct'], got['label']), (12.0, 'Checking the platform...'))

    def test_helper_window_requests(self):
        from tp_desktop import console
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'helper-window'
            console.request_helper_window('show', f)
            self.assertEqual(f.read_text(), 'show')


class Launch(unittest.TestCase):
    def test_private_start_opens_the_app_on_the_local_build_with_updates_off(self):
        class Proc:
            def wait(self):
                return 0

            def poll(self):
                return 0
        calls = []
        with mock.patch.object(launch.subprocess, 'Popen', side_effect=lambda *a, **k: calls.append((a, k)) or Proc()), \
                mock.patch.object(launch, 'helper_running', return_value=False), \
                mock.patch.object(launch.sys, 'platform', 'linux'), \
                mock.patch.object(launch.splash, 'ok'), mock.patch.object(launch.splash, 'wait_for_enter'):
            launch.run_app(None, url=private.URL)
        app_cmd, app_env = calls[0][0][0], calls[0][1]['env']
        self.assertEqual(app_cmd[-2:], ['--url', private.URL])
        self.assertEqual(app_env.get(private.FLAG), '1')
        self.assertEqual(calls[1][1]['env'].get(private.FLAG), '1')  # the helper too: no online updates
        self.assertEqual(calls[1][1]['env'].get('TP_PLATFORM_URL'), private.URL)  # its screen shows the local address


class StartUpWindowFlow(unittest.TestCase):
    """gui_main with the outside steps faked: what the start-up window is told."""

    def run_flow(self, fail=None, desktop_changed=False):
        from tp_desktop import progress
        d = tempfile.mkdtemp()
        f = Path(d) / 'p.json'
        seen = []

        class App:
            def wait(self):
                seen.append(progress.read(f)['state'])
                return 0

            def poll(self):
                return 0
        trees = iter(['a', 'b' if desktop_changed else 'a'])
        steps = mock.patch.multiple(launch, PROGRESS=f, instance_running=mock.DEFAULT, desktop_ready=mock.DEFAULT,
                                    quiet_children=mock.DEFAULT, run_app=mock.DEFAULT, desktop_parts=mock.DEFAULT, tree=mock.DEFAULT,
                                    helper_running=mock.DEFAULT)
        with steps as m, mock.patch.object(launch.subprocess, 'Popen', return_value=App()) as popen, \
                mock.patch.object(launch.private, 'pull', return_value='Up to date.'), \
                mock.patch.object(launch.private, 'build', side_effect=fail), \
                mock.patch.object(launch.private, 'serve', return_value=object()), \
                mock.patch.object(launch.shortcut, 'make_private', return_value='already made'), \
                mock.patch.object(launch.splash, 'prepare'), mock.patch.object(launch.splash, 'open_log', return_value=open(os.devnull, 'w')), \
                mock.patch.object(launch.sys, 'argv', ['launch.py', '--private']):
            m['instance_running'].return_value = False
            m['desktop_ready'].return_value = True
            m['tree'].side_effect = lambda path: next(trees)
            m['run_app'].return_value = 0
            m['helper_running'].return_value = False  # (the same on every machine, whatever runs on port 8765)
            code = launch.gui_main()
        return code, progress.read(f), popen, m['run_app'], seen

    def test_ready_hands_the_running_app_on(self):
        code, last, popen, run_app, _ = self.run_flow()
        self.assertEqual(last['state'], 'ready')
        self.assertIn('--starting', popen.call_args_list[0].args[0])  # the start-up window opened straight away
        self.assertIsNotNone(run_app.call_args.kwargs['app'])  # the same app carries on (no second window)
        self.assertEqual(run_app.call_args.kwargs['url'], private.URL)

    def test_a_failure_is_shown_in_the_window(self):
        code, last, _, run_app, seen = self.run_flow(fail=private.StepError('Could not build the website.', ['npm ERR!'], ['Try again']))
        self.assertEqual(code, 2)
        self.assertEqual(seen, ['failed'])
        self.assertEqual(last['message'], 'Could not build the website.')
        run_app.assert_not_called()

    def test_an_update_to_the_app_restarts_it(self):
        code, last, _, run_app, seen = self.run_flow(desktop_changed=True)
        self.assertEqual(seen, ['restart'])
        self.assertIsNone(run_app.call_args.kwargs['app'])  # a fresh app with the new code


class HelperFirst(unittest.TestCase):
    """The platform opens only once the helper answers (no "start the helper" message on screen)."""

    class Proc:
        def __init__(self, code=None):
            self.code = code

        def poll(self):
            return self.code

    def test_waits_until_the_helper_answers(self):
        answers = iter([False, False, True])
        bar = mock.Mock()
        with mock.patch.object(launch.console, 'helper_needs_you', return_value=False):
            self.assertTrue(launch.wait_for_helper(self.Proc(), bar, check=lambda: next(answers), sleep=lambda s: None))

    def test_a_stopped_helper_doesnt_hold_the_window(self):
        with mock.patch.object(launch.console, 'helper_needs_you', return_value=False):
            self.assertFalse(launch.wait_for_helper(self.Proc(code=1), mock.Mock(), check=lambda: False, sleep=lambda s: None))

    def test_a_schwab_login_is_explained_on_the_bar(self):
        answers = iter([False, True])
        bar = mock.Mock()
        with mock.patch.object(launch.console, 'helper_needs_you', return_value=True):
            launch.wait_for_helper(self.Proc(), bar, check=lambda: next(answers), sleep=lambda s: None)
        self.assertIn('needs you', bar.stage.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
