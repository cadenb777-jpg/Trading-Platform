"""
Updates for a copy of the code made with git (a clone, or the desktop app's private mode): there `git pull` is the
update, because a downloaded ZIP would overwrite your copy. Also the running-helper note the desktop launcher reads to
replace an old helper that is still running after an update.

Standard library only (the desktop launcher imports it too).

- status(): fetches, then says how many changes GitHub has that this copy doesn't (and whether pulling can work).
- pull(): `git pull --ff-only` (never merges, never touches your own edits) and explains a failure in plain words with
  the fix: local edits in the way, a copy that has gone its own way, a GitHub sign-in, no internet, git missing.
- A GitHub key from Settings (needed while the repository is private) is used only when git's own sign-in fails, only
  for https://github.com/, and passed in the environment (never on the command line, never written to git's config).
"""
import base64
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNING = Path.home() / '.trading-platform' / 'helper-running.json'
TIMEOUT = 90


def is_git_copy(root=ROOT):
    return (Path(root) / '.git').exists()


def git_path():
    return shutil.which('git') or shutil.which('git.exe')


def _env(token=''):
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never', 'LC_ALL': 'C'}
    if token:
        basic = base64.b64encode(f'x-access-token:{token}'.encode()).decode()
        try:
            n = int(env.get('GIT_CONFIG_COUNT') or 0)  # added after any settings already passed this way
        except ValueError:
            n = 0
        env.update({'GIT_CONFIG_COUNT': str(n + 1), f'GIT_CONFIG_KEY_{n}': 'http.https://github.com/.extraHeader',
                    f'GIT_CONFIG_VALUE_{n}': f'Authorization: Basic {basic}'})
    return env


def _git(args, root=ROOT, token='', timeout=TIMEOUT, run=subprocess.run):
    git = git_path()
    if not git:
        return 127, 'git is not installed'
    try:
        done = run([git, *args], cwd=root, env=_env(token), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, 'timed out'
    except OSError as err:
        return 126, str(err)
    return done.returncode, ((done.stdout or '') + '\n' + (done.stderr or '')).strip()


AUTH = re.compile(r'authentication failed|could not read username|terminal prompts disabled|403|401|repository not found|'
                  r'permission denied|access denied|invalid username or password', re.I)
OFFLINE = re.compile(r'could not resolve host|failed to connect|network is unreachable|timed out|connection (reset|refused)', re.I)
LOCAL_EDITS = re.compile(r'local changes .* would be overwritten|untracked working tree files would be overwritten|'
                         r'please commit your changes or stash them', re.I | re.S)
DIVERGED = re.compile(r'not possible to fast-forward|diverging branches|have diverged|refusing to merge', re.I)


def explain(code, text):
    """(reason, fix) in plain words for a failed git command."""
    if code == 127:
        return 'Git is not installed on this computer.', 'Install Git for Windows from git-scm.com (default options), then click Check for updates again.'
    if LOCAL_EDITS.search(text):
        return ('Some files in your platform folder were changed on this computer, and the update changes them too.',
                'Open PowerShell in the platform folder and run: git stash  (this puts your edits aside), then click Check for updates again.')
    if DIVERGED.search(text):
        return ('Your copy has its own commits that GitHub doesn\'t have, so it can\'t simply move forward.',
                'Open PowerShell in the platform folder and run: git pull --rebase  (or ask Claude to sort it out).')
    if AUTH.search(text):
        return ('GitHub asked for a sign-in (the repository is private).',
                'Add a GitHub key in Settings > Data connections > GitHub updates, or run: git pull  once in PowerShell in the platform folder and sign in.')
    if OFFLINE.search(text) or code == 124:
        return 'GitHub could not be reached (no internet, or it timed out).', 'Check the internet connection and try again.'
    last = text.strip().splitlines()[-1] if text.strip() else f'git stopped with code {code}'
    return f'git said: {last[:200]}', 'Open PowerShell in the platform folder and run: git pull  to see the full message.'


def _with_key(args, root, token, run):
    code, text = _git(args, root, run=run)
    if code != 0 and token and AUTH.search(text):
        code, text = _git(args, root, token=token, run=run)
    return code, text


def status(root=ROOT, token='', run=subprocess.run):
    """{'behind', 'ahead', 'edited', 'head', 'ok', 'reason', 'fix'} after fetching from GitHub."""
    code, text = _with_key(['fetch', '--quiet'], root, token, run)
    if code != 0:
        reason, fix = explain(code, text)
        return {'ok': False, 'behind': None, 'ahead': None, 'reason': reason, 'fix': fix}
    code, text = _git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], root, run=run)
    if code != 0:
        return {'ok': False, 'behind': None, 'ahead': None, 'reason': 'This copy has no GitHub branch to follow.',
                'fix': 'Open PowerShell in the platform folder and run: git checkout main'}
    try:
        ahead, behind = (int(n) for n in text.split()[:2])
    except ValueError:
        ahead = behind = 0
    _, edits = _git(['status', '--porcelain', '--untracked-files=no'], root, run=run)
    _, head = _git(['rev-parse', '--short', 'HEAD'], root, run=run)
    return {'ok': True, 'behind': behind, 'ahead': ahead, 'edited': bool(edits.strip()), 'head': head.strip()[:12],
            'reason': '', 'fix': ''}


def pull(root=ROOT, token='', run=subprocess.run):
    """{'ok', 'changed', 'reason', 'fix'}: fast-forward only, so your own work is never merged or lost."""
    _, before = _git(['rev-parse', 'HEAD'], root, run=run)
    code, text = _with_key(['pull', '--ff-only'], root, token, run)
    if code != 0:
        reason, fix = explain(code, text)
        return {'ok': False, 'changed': False, 'reason': reason, 'fix': fix}
    _, after = _git(['rev-parse', 'HEAD'], root, run=run)
    return {'ok': True, 'changed': before.strip() != after.strip(), 'reason': '', 'fix': ''}


def version_on_disk(root=ROOT):
    """HELPER_VERSION in the helper file as it is now on disk (after a pull it is newer than the running one)."""
    try:
        text = (Path(root) / 'helper' / 'schwab_helper.py').read_text(encoding='utf-8')
    except OSError:
        return None
    m = re.search(r'^HELPER_VERSION\s*=\s*(\d+)', text, re.M)
    return int(m.group(1)) if m else None


def note_running(version, port, path=RUNNING):
    """Which helper is running (the desktop launcher replaces an older one instead of reusing it)."""
    try:
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({'pid': os.getpid(), 'version': version, 'port': port}), encoding='utf-8')
    except OSError:
        pass


def clear_running(path=RUNNING):
    try:
        if json.loads(path.read_text(encoding='utf-8')).get('pid') == os.getpid():
            path.unlink()
    except (OSError, ValueError):
        pass


def read_running(path=RUNNING):
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return {'pid': int(data['pid']), 'version': int(data['version']), 'port': int(data.get('port', 8765))}
    except (OSError, ValueError, KeyError, TypeError):
        return None
