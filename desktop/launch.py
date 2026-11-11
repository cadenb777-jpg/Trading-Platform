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
from tp_desktop import console  # noqa: E402  (hiding this window once loading is done, Windows)
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


def main():
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
        bar.stage('Opening the desktop app...', 99, expect_seconds=2)
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
            splash.ok(f'Trading Terminal (private) icon {made}: double-click it next time.')
        return run_app(None, url=private.URL)
    made = shortcut.make(force='--shortcut' in sys.argv)
    if made.startswith('made'):
        splash.ok(f'Trading Terminal icon {made}: double-click it next time.')
    return run_app(updated)


def run_app(updated, url=None):
    """Opens the app beside the helper (started here when none is running); puts the previous version back if a fresh
    update stops within a minute.
    Windows: this window hides once the app's start screen shows (the app brings it back when the helper needs you, and
    from its tray icon); quitting the app stops the helper this window started. Elsewhere the helper keeps running in
    this window for the website when the app closes."""
    started = time.time()
    hidden = sys.platform == 'win32'
    env = {**os.environ, 'TP_HELPER_BY_LAUNCHER': '1'}  # the app opens the helper itself only without this flag
    if url:
        env[private.FLAG] = '1'  # private mode: the helper's online updates stay off (git pull updates it)
    if hidden:
        env[console.FLAG] = '1'
        console.NEEDS_YOU.unlink(missing_ok=True)  # left over from a helper that stopped while waiting for you
    extra = (['--choose'] if '--choose' in sys.argv else []) + (['--url', url] if url else [])
    app = subprocess.Popen([str(splash.venv_python()), '-m', 'tp_desktop', *extra], cwd=HERE, env=env)
    helper = None
    if helper_running():
        splash.ok('Opening Trading Terminal, using the helper that is already running.')
    else:
        # the website's own helper, beside the app in this window: its start screen, the Schwab login when it asks,
        # its updates; no Chrome tab of its own (the app opens the window or the browser you choose)
        splash.ok('Opening Trading Terminal. The helper runs here in the background' + (
            ' (this window hides; quit from the Trading Terminal icon by the clock).' if hidden else
            ': keep this window open while you use the platform.'))
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
