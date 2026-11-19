"""
Private mode: the whole platform from your own copy of the code (a git clone), for while the GitHub repository is
private (GitHub only serves the website, the app's updates and the download for public repositories).

start-private-windows.bat (in the clone's top folder) runs `launch.py --private`, which:
  1. gets the latest changes with `git pull` (GitHub sign-in remembered by Windows, or an SSH key),
  2. installs the website's parts with npm when package-lock.json changed, and builds the website (npm run build) when
     the code changed since the last build,
  3. serves that build on this computer only (http://127.0.0.1:4173/, an address the helper already accepts),
  4. opens the Terminal app on it, with the helper beside it as usual; the online updaters stay off (git pull is the
     update), so nothing ever overwrites your copy.
Standard library only (it runs before anything is installed).
"""
import functools
import hashlib
import http.server
import shutil
import subprocess
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
HOST, PORT = '127.0.0.1', 4173
URL = f'http://{HOST}:{PORT}/'
FLAG = 'TP_PRIVATE'
NODE_HINTS = ['Install Node.js (the LTS version) from nodejs.org with the default options, then start this again.']
GIT_HINTS = ['Install Git for Windows from git-scm.com, get the code with git clone (see PRIVATE-MODE.md), then start this again.']


class StepError(Exception):
    def __init__(self, message, details=(), hints=()):
        super().__init__(message)
        self.details, self.hints = list(details), list(hints)


def is_clone(root=ROOT):
    return (Path(root) / '.git').exists()


def _run(cmd, log, cwd=ROOT, timeout=1800):
    """Runs a command with its output in the launcher log only; returns (exit code, last lines)."""
    log.write(f'$ {" ".join(map(str, cmd))}\n')
    log.flush()
    try:
        done = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as err:
        log.write(f'{err}\n')
        return 1, [str(err)]
    out = (done.stdout or '') + (done.stderr or '')
    log.write(out + '\n')
    return done.returncode, [line for line in out.splitlines() if line.strip()][-8:]


def tool(name):
    """npm / git / node as installed (on Windows npm is npm.cmd)."""
    return shutil.which(name) or shutil.which(name + '.cmd')


def pull(log):
    """Latest changes from GitHub (fast-forward only: your own edits are never merged or lost). Returns a short note;
    never stops the start (your copy still works offline). A failure says why and how to fix it in plain words, and
    uses the GitHub key from Settings when git's own sign-in is refused (codeupdate.py)."""
    if not tool('git'):
        raise StepError('Git is not installed.', hints=GIT_HINTS)
    import codeupdate  # the helper folder is on the path (launch.py)
    log.write('$ git pull --ff-only\n')
    res = codeupdate.pull(ROOT, github_key())
    log.write(f"{res}\n")
    log.flush()
    if not res['ok']:
        return f"Could not get the latest changes: {res['reason']} {res['fix']} Using the copy you have."
    return 'Got the latest changes.' if res['changed'] else 'Up to date.'


def github_key():
    """The GitHub key saved in Settings (needed while the repository is private), or ''."""
    try:
        import json
        return json.loads((Path.home() / '.trading-platform' / 'settings.json').read_text(encoding='utf-8')).get('github_token') or ''
    except (OSError, ValueError, AttributeError):
        return ''


def fingerprint(root=ROOT, log=None):
    """What the website build depends on: the commit plus any local edits (so a rebuild only happens after a change)."""
    git = tool('git')
    if not git:
        return None
    parts = []
    for args in (['rev-parse', 'HEAD'], ['status', '--porcelain', '--', 'src', 'index.html', 'public', 'package-lock.json', 'vite.config.ts']):
        try:
            parts.append(subprocess.run([git, *args], cwd=root, capture_output=True, text=True, timeout=30).stdout)
        except (OSError, subprocess.TimeoutExpired):
            return None
    return hashlib.sha256(''.join(parts).encode()).hexdigest()


def file_hash(path):
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError:
        return None


def build(log, step=lambda text: None):
    """npm ci when package-lock.json changed, npm run build when the code changed. Returns True when it built."""
    npm = tool('npm')
    if not npm:
        raise StepError('Node.js is not installed (it builds the website on this computer).', hints=NODE_HINTS)
    lock, stamp = file_hash(ROOT / 'package-lock.json'), ROOT / 'node_modules' / '.tp-lock'
    if lock is None or not stamp.exists() or stamp.read_text().strip() != lock:
        step('Installing the website’s parts (npm, once and after updates)...')
        code, tail = _run([npm, 'ci', '--no-audit', '--no-fund'], log)
        if code != 0:
            raise StepError('Could not install the website’s parts.', tail, ['Check the internet connection, then start this again.'])
        if lock:
            stamp.write_text(lock)
    now, built = fingerprint(log=log), DIST / '.tp-built'
    if (DIST / 'index.html').exists() and now and built.exists() and built.read_text().strip() == now:
        return False
    step('Building the platform on this computer (about a minute)...')
    code, tail = _run([npm, 'run', 'build'], log)
    if code != 0 or not (DIST / 'index.html').exists():
        raise StepError('Could not build the website.', tail, ['Send me a screenshot of this window and the launcher log.'])
    if now:
        built.write_text(now)
    return True


class _Quiet(http.server.SimpleHTTPRequestHandler):
    """Serves the built website; never caches (a rebuild shows at once) and logs nothing."""

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


class _Server(http.server.ThreadingHTTPServer):
    """Refuses a port already in use (Python's default lets a second server share it on Windows)."""
    allow_reuse_address = False

    def server_bind(self):
        import socket
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):  # Windows: nobody else may bind this port while we serve
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def serve(dist=DIST, host=HOST, port=PORT):
    """Serves the build on this computer only, in a background thread. Returns the server, or None when the port is
    taken (another private start is already serving it: that one is used)."""
    handler = functools.partial(_Quiet, directory=str(dist))
    try:
        server = _Server((host, port), handler)
    except OSError:
        return None
    threading.Thread(target=server.serve_forever, name='private-site', daemon=True).start()
    return server
