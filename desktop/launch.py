"""
The desktop app's start-up screen and launcher, like the website helper's: the same intro and one 0-100% loading
bar (helper/splash.py) while it checks for an update (desktop_update.py), sets up Python and installs anything missing
(shared with the helper: helper/.venv), then opens the app. The app is the website itself, so it needs the website's
helper: if none is running, this window runs it (its start screen, Schwab login and self-updates, no Chrome tab).
If a fresh update won't start, the backup is put back.
Standard library only, so it runs before anything is installed. The start files call `python launch.py`.
"""
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HELPER = HERE.parent / 'helper'
sys.path.insert(0, str(HELPER))
import splash  # noqa: E402  (the helper's launcher: screen, bar, venv and pip steps)
import desktop_update  # noqa: E402
import shortcut  # noqa: E402  (the Trading Terminal icon on your desktop)
from tp_desktop import console, progress  # noqa: E402  (hiding the helper's window; the start screen's progress)
import private  # noqa: E402  (private mode: the platform from your own copy of the code)


def desktop_parts(bar, log):
    req, marker = HERE / 'requirements.txt', HELPER / '.venv' / 'installed-desktop.txt'
    if splash.same_file(req, marker):
        bar.stage("Checking the desktop app's parts...", 92, expect_seconds=0.3)
    else:
        code, tail = splash.pip_install(bar, log, str(req), "Downloading the desktop app's parts (Qt and its browser engine) - about 150-250 MB, once", 86, 92, 3)
        if code != 0:
            raise splash.LaunchError("Could not download the desktop app's parts.", tail, splash.NETWORK_HINTS)
        shutil.copyfile(req, marker)
    bar.finish()


#: Started without a console (the desktop icon runs pythonw.exe): the progress shows in the app's own start-up window
#: and the helper runs hidden. A start from the .bat files (a console) keeps the text screen.
GUI = os.name == 'nt' and (sys.stdout is None or '--gui' in sys.argv)
PROGRESS = splash.DATA_DIR / 'start-progress.json'


class FileBar(splash.Bar):
    """The same 0-100% bar logic as the text screen, written to the progress file the start-up window reads."""

    def __init__(self, path):
        super().__init__(splash.PALETTES[next(iter(splash.PALETTES))])
        self.path = path
        self._last = None

    def start(self):
        self._running = True
        self._thread = __import__('threading').Thread(target=self._animate, daemon=True)
        self._thread.start()
        return self

    def draw(self):
        now = (round(self.shown, 1), self.label)
        if now != self._last:
            self._last = now
            try:
                progress.write(self.path, pct=self.shown, label=self.label, state='working')
            except OSError:
                pass

    def stop(self, newline=True, failed=False):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1)


def console_python():
    """python.exe beside pythonw.exe (the helper has a console of its own, hidden until it needs you)."""
    exe = Path(sys.executable)
    twin = exe.with_name('python.exe')
    return str(twin) if exe.name.lower() == 'pythonw.exe' and twin.exists() else sys.executable


def quiet_children():
    """No console window flashing up for git, npm, pip or PowerShell when started without one."""
    flag = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    base = subprocess.Popen

    class Quiet(base):
        def __init__(self, *args, **kwargs):
            if not kwargs.get('creationflags'):
                kwargs['creationflags'] = flag
            super().__init__(*args, **kwargs)
    subprocess.Popen = Quiet
    splash.wait_for_enter = lambda: None  # no keyboard without a console


def instance_running(url):
    """Trading Terminal for this address is already open (in the tray): Qt's single-instance pipe exists."""
    if os.name != 'nt':
        return False
    user = ''.join(ch for ch in (__import__('getpass').getuser() or 'me') if ch.isalnum())[:40]
    name = 'TradingTerminal-' + user + ('-private' if url else '')
    return os.path.exists('\\\\.\\pipe\\' + name)


def desktop_ready():
    """The app's parts (Qt) are installed, so the start-up window can show from the first moment."""
    marker = HELPER / '.venv' / 'installed-desktop.txt'
    return Path(splash.venv_python()).exists() and marker.exists()


def tree(path):
    """The committed version of a folder (changes when an update touched it)."""
    git = private.tool('git')
    if not git:
        return None
    try:
        return subprocess.run([git, 'rev-parse', f'HEAD:{path}'], cwd=private.ROOT, capture_output=True, text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None


def gui_main():
    """The desktop icon: the app's start-up window opens at once and shows this start-up's progress, then becomes the
    Terminal-or-Web choice; the helper runs hidden. One window from the click to the platform."""
    quiet_children()
    mine = '--private' in sys.argv
    url = private.URL if mine else None
    if instance_running(url):  # already open: the app brings its window back (no second start)
        subprocess.Popen([str(splash.venv_python()), '-m', 'tp_desktop', *app_args(url)], cwd=HERE, env=app_env(url))
        return 0
    if not desktop_ready():  # the very first start: the parts aren't there yet, so the text screen does it once
        args = [a for a in sys.argv[1:] if a != '--gui']
        subprocess.Popen([console_python(), str(Path(__file__).resolve()), *args], cwd=HERE, creationflags=getattr(subprocess, 'CREATE_NEW_CONSOLE', 0))
        return 0
    PROGRESS.parent.mkdir(parents=True, exist_ok=True)
    progress.write(PROGRESS, pct=0, label='Starting...', state='working')
    app = subprocess.Popen([str(splash.venv_python()), '-m', 'tp_desktop', '--starting', str(PROGRESS), *app_args(url)],
                           cwd=HERE, env=app_env(url))
    bar = FileBar(PROGRESS).start()
    log = splash.open_log()
    updated = None
    before = tree('desktop') if mine else None
    try:
        if mine:
            bar.stage('Getting the latest changes...', 10, expect_seconds=4)
            log.write(private.pull(log) + '\n')
            bar.finish()
            bar.stage('Checking the platform...', 20, expect_seconds=1)
            private.build(log, step=lambda text: (bar.finish(), bar.stage(text, 45, expect_seconds=60)))
            bar.finish()
        else:
            bar.stage('Checking for a newer version...', 10, expect_seconds=3)
            try:
                updated = None if private.is_clone() else desktop_update.update_if_newer(lambda s: log.write(s + '\n'))
            except desktop_update.UpdateError as err:
                log.write(f'Update failed, nothing changed: {err}\n')
            bar.finish()
        splash.prepare(bar, log)
        desktop_parts(bar, log)
        if mine and private.serve() is None:
            log.write('The platform is already served on this computer: using it.\n')
        (shortcut.make_private if mine else shortcut.make)(log=lambda s: log.write(s + '\n'))
        bar.stage('Opening...', 100, expect_seconds=0.3)
        bar.finish('Ready')
        bar.wait(100, timeout=1)
    except (splash.LaunchError, private.StepError) as err:
        bar.stop()
        log.write(f'Start-up failed: {err}\n' + '\n'.join(err.details) + '\n')
        log.close()
        progress.write(PROGRESS, pct=bar.shown, label='', state='failed', message=str(err), details=err.details[-6:], hints=err.hints)
        app.wait()
        return 2
    finally:
        log.close()
    bar.stop()
    if updated or (mine and before and tree('desktop') != before):
        # the update changed the app itself: the start-up window closes and the new app opens
        progress.write(PROGRESS, pct=100, label='Updated: opening the new version...', state='restart')
        app.wait()
        app = None
    else:
        progress.write(PROGRESS, pct=100, label='Ready', state='ready')
    return run_app(updated, url=url, app=app)


def app_args(url):
    return (['--choose'] if '--choose' in sys.argv else []) + (['--url', url] if url else [])


def app_env(url):
    env = {**os.environ, 'TP_HELPER_BY_LAUNCHER': '1'}  # the app opens the helper itself only without this flag
    if url:
        env[private.FLAG] = '1'  # private mode: the helper's online updates stay off (git pull updates it)
        env['TP_PLATFORM_URL'] = url  # and its start screen shows this computer's address
    if sys.platform == 'win32':
        env[console.FLAG] = '1'
    return env


def main():
    if GUI:
        return gui_main()
    splash.enable_colors()
    look = splash.pick(None)
    splash.clear_screen()
    splash.banner(look)
    bar = splash.Bar(splash.PALETTES[look['theme']]).start()
    log = splash.open_log()
    updated = None
    mine = '--private' in sys.argv
    notes = []
    try:
        if mine:  # your own copy: git pull is the update, and this computer builds the website
            bar.stage('Getting the latest changes (git pull)...', 6, expect_seconds=4)
            notes.append(private.pull(log))
            bar.finish()
            bar.stage('Checking the website build...', 12, expect_seconds=1)
            if private.build(log, step=lambda text: (bar.finish(), bar.stage(text, 30, expect_seconds=60))):
                notes.append('Built the platform from your copy of the code.')
            bar.finish()
        else:
            bar.stage('Checking for a newer desktop app...', 6, expect_seconds=3)
            try:
                # a copy of the code (git clone) is updated with git pull, never overwritten by a download
                updated = None if private.is_clone() else desktop_update.update_if_newer(lambda s: log.write(s + '\n'))
            except desktop_update.UpdateError as err:
                log.write(f'Update failed, nothing changed: {err}\n')
            bar.finish()
        splash.prepare(bar, log)  # the helper's Python and parts (quick when the website helper already did it)
        desktop_parts(bar, log)
        bar.stage('Opening the desktop app...', 100, expect_seconds=0.5)
        bar.finish('Ready')  # all done: the bar ends at 100% (it froze part-way when the steps were quick)
        bar.wait(100, timeout=2)
    except (splash.LaunchError, private.StepError) as err:
        bar.stop(failed=True)
        log.close()
        print()
        splash.fail(str(err))
        for line in err.details[-6:]:
            print('     ' + line[:200])
        for hint in err.hints:
            splash.warn(hint)
        splash.warn(f"Full details: {splash.DATA_DIR / 'launcher.log'}")
        splash.wait_for_enter()
        return 2
    finally:
        log.close()
    bar.stop()
    print()
    if updated:
        splash.ok(f"Updated the desktop app to version {'.'.join(map(str, updated[1]))}.")
    for note in notes:
        splash.ok(note)
    if mine:
        if private.serve() is None:
            splash.ok('Your platform is already being served on this computer: using it.')
        made = shortcut.make_private(force='--shortcut' in sys.argv)
        if made.startswith('made'):
            splash.ok(f'Trading Terminal icon {made} (it opens this private copy): double-click it next time.')
        return run_app(None, url=private.URL)
    made = shortcut.make(force='--shortcut' in sys.argv)
    if made.startswith('made'):
        splash.ok(f'Trading Terminal icon {made}: double-click it next time.')
    return run_app(updated)


def run_app(updated, url=None, app=None):
    """Opens the app beside the helper (started here when none is running); puts the previous version back if a fresh
    update stops within a minute.
    Windows: this window hides once the app's start screen shows (the app brings it back when the helper needs you, and
    from its tray icon); quitting the app stops the helper this window started. Elsewhere the helper keeps running in
    this window for the website when the app closes."""
    started = time.time()
    hidden = sys.platform == 'win32'
    env = app_env(url)
    if hidden:
        console.NEEDS_YOU.unlink(missing_ok=True)  # left over from a helper that stopped while waiting for you
    if app is None:  # (the start-up window's app is already running when it showed this start's progress)
        app = subprocess.Popen([str(splash.venv_python()), '-m', 'tp_desktop', *app_args(url)], cwd=HERE, env=env)
    helper = None
    if helper_running():
        splash.ok('Opening Trading Terminal, using the helper that is already running.')
    else:
        # the website's own helper, beside the app in this window: its start screen, the Schwab login when it asks,
        # its updates; no Chrome tab of its own (the app opens the window or the browser you choose)
        splash.ok('Opening Trading Terminal. The helper runs here in the background' + (
            ' (this window hides; quit from the Trading Terminal icon by the clock).' if hidden else
            ': keep this window open while you use the platform.'))
        if GUI:  # in a console of its own, hidden: it shows itself only when it needs you (or from the tray menu)
            info = subprocess.STARTUPINFO()
            info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            info.wShowWindow = 0  # SW_HIDE
            helper = subprocess.Popen([console_python(), str(HELPER / 'splash.py'), 'run', '--no-browser'], cwd=HELPER, env=env,
                                      creationflags=subprocess.CREATE_NEW_CONSOLE, startupinfo=info)
        else:
            helper = subprocess.Popen([sys.executable, str(HELPER / 'splash.py'), 'run', '--no-browser'], cwd=HELPER, env=env)
    code = app.wait()
    crashed = code not in splash.STOPPED_CODES
    if hidden:
        if helper is not None and helper.poll() is None:
            stop_tree(helper)  # you quit Trading Terminal: its helper stops too (nothing left running unseen)
        if crashed:
            console.show()
        console.NEEDS_YOU.unlink(missing_ok=True)
    if crashed and updated and time.time() - started < 60:
        desktop_update.restore(updated[2])
        splash.warn('The new version of the app stopped right after starting, so the previous version was put back. '
                    'Close this window and start Trading Terminal again.')
    elif crashed:
        splash.fail(f'The app stopped with an error (code {code}). Take a screenshot of this window and send it.')
    if helper is not None and helper.poll() is None:
        print()
        splash.ok('The helper keeps running here for the website; close this window to stop it.')
        helper.wait()
        return 0
    if crashed:
        splash.wait_for_enter()
        return 2
    return 0


def stop_tree(proc):
    """Stops the helper and the process it runs (its start screen starts the helper itself)."""
    try:
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        proc.kill()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass


def helper_running(port=8765):
    """True when a helper already answers on this computer (started from the website's start file or another window)."""
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.5):
            return True
    except OSError:
        return False


if __name__ == '__main__':
    sys.exit(main())
