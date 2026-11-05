"""
The desktop app's start-up screen and launcher, like the website helper's: the same intro and one 0-100% loading
bar (helper/splash.py) while it checks for an update (desktop_update.py), sets up Python and installs anything missing
(shared with the helper: helper/.venv), then opens the app. If a fresh update won't start, the backup is put back.
Standard library only, so it runs before anything is installed. The start files call `python launch.py`.
"""
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HELPER = HERE.parent / 'helper'
sys.path.insert(0, str(HELPER))
import splash  # noqa: E402  (the helper's launcher: screen, bar, venv and pip steps)
import desktop_update  # noqa: E402

RESTART_CODE = 75  # the app asks for this after Help > Check for updates found one


def desktop_parts(bar, log):
    req, marker = HERE / 'requirements.txt', HELPER / '.venv' / 'installed-desktop.txt'
    if splash.same_file(req, marker):
        bar.stage("Checking the desktop app's parts...", 92, expect_seconds=0.3)
    else:
        code, tail = splash.pip_install(bar, log, str(req), "Downloading the desktop app's parts (Qt, charts) - about 80 MB", 86, 92, 3)
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
    try:
        bar.stage('Checking for a newer desktop app...', 6, expect_seconds=3)
        try:
            updated = desktop_update.update_if_newer(lambda s: log.write(s + '\n'))
        except desktop_update.UpdateError as err:
            log.write(f'Update failed, nothing changed: {err}\n')
        bar.finish()
        splash.prepare(bar, log)  # the helper's Python and parts (quick when the website helper already did it)
        desktop_parts(bar, log)
        bar.stage('Opening the desktop app...', 99, expect_seconds=2)
    except splash.LaunchError as err:
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
    splash.ok('The desktop app is open. Keep this window open while you use it (closing it closes the app).')
    started = time.time()
    code = subprocess.call([str(splash.venv_python()), '-m', 'tp_desktop'], cwd=HERE)
    if code == RESTART_CODE:
        return main()
    if code not in splash.STOPPED_CODES:
        if updated and time.time() - started < 60:
            desktop_update.restore(updated[2])
            splash.warn('The new version stopped right after starting, so the previous version was put back. Start it again.')
        else:
            splash.fail(f'The desktop app stopped with an error (code {code}). Take a screenshot of this window and send it.')
        splash.wait_for_enter()
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
