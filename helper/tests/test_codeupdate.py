"""git pull updates for a copy made with git (codeupdate.py): plain-words reasons, key only on a refused sign-in."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import codeupdate  # noqa: E402


class Done:
    def __init__(self, code, out='', err=''):
        self.returncode, self.stdout, self.stderr = code, out, err


def runner(answers):
    calls = []

    def run(cmd, **kw):
        calls.append((cmd[1:], kw['env']))
        for prefix, reply in answers:
            if cmd[1:1 + len(prefix)] == prefix:
                return reply(kw['env']) if callable(reply) else reply
        return Done(0)
    return run, calls


class Explain(unittest.TestCase):
    def test_reasons_in_plain_words(self):
        cases = {
            'error: Your local changes to the following files would be overwritten by merge': 'git stash',
            'fatal: Not possible to fast-forward, aborting.': 'git pull --rebase',
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled": 'GitHub key',
            "fatal: unable to access: Could not resolve host: github.com": 'internet',
        }
        for text, fix in cases.items():
            reason, how = codeupdate.explain(1, text)
            self.assertIn(fix, reason + how, text)
        self.assertIn('git-scm.com', codeupdate.explain(127, '')[1])


@mock.patch.object(codeupdate, 'git_path', return_value='git')
class GitSteps(unittest.TestCase):
    def test_status_counts_what_github_has(self, _):
        run, calls = runner([(['rev-list'], Done(0, '0\t3\n')), (['rev-parse'], Done(0, 'abc123\n'))])
        st = codeupdate.status('.', run=run)
        self.assertEqual((st['ok'], st['behind'], st['ahead'], st['edited']), (True, 3, 0, False))
        self.assertTrue(all(env['GIT_TERMINAL_PROMPT'] == '0' for _, env in calls))  # never hangs on a hidden prompt

    def test_the_key_is_used_only_after_a_refused_sign_in_and_only_for_github(self, _):
        def keyed(env):
            return any(v.startswith('Authorization:') for v in env.values())

        def fetch(env):
            return Done(0) if keyed(env) else Done(128, err='fatal: Authentication failed')
        run, calls = runner([(['fetch'], fetch), (['rev-list'], Done(0, '0\t0'))])
        st = codeupdate.status('.', token='secret', run=run)
        self.assertTrue(st['ok'])
        fetches = [env for args, env in calls if args[0] == 'fetch']
        self.assertFalse(keyed(fetches[0]))
        n = int(fetches[1]['GIT_CONFIG_COUNT']) - 1
        self.assertEqual(fetches[1][f'GIT_CONFIG_KEY_{n}'], 'http.https://github.com/.extraHeader')
        self.assertTrue(all('secret' not in ' '.join(args) for args, _ in calls))  # never on the command line

    def test_pull_reports_change_and_failure(self, _):
        heads = iter(['a\n', 'b\n'])
        run, _ = runner([(['rev-parse'], lambda env: Done(0, next(heads))), (['pull'], Done(0, 'Fast-forward'))])
        self.assertEqual(codeupdate.pull('.', run=run)['changed'], True)
        run, _ = runner([(['pull'], Done(1, err='fatal: Not possible to fast-forward, aborting.'))])
        res = codeupdate.pull('.', run=run)
        self.assertFalse(res['ok'])
        self.assertIn('rebase', res['fix'])

    def test_a_hung_git_is_a_timeout_not_a_freeze(self, _):
        def run(cmd, **kw):
            raise subprocess.TimeoutExpired(cmd, 1)
        self.assertIn('reached', codeupdate.status('.', run=run)['reason'])


class RunningNote(unittest.TestCase):
    def test_note_read_and_clear(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'helper-running.json'
            codeupdate.note_running(90, 8765, path)
            self.assertEqual(codeupdate.read_running(path)['version'], 90)
            codeupdate.clear_running(path)
            self.assertIsNone(codeupdate.read_running(path))

    def test_version_on_disk(self):
        self.assertEqual(codeupdate.version_on_disk(), int(__import__('re').search(
            r'^HELPER_VERSION = (\d+)', (codeupdate.ROOT / 'helper' / 'schwab_helper.py').read_text(), __import__('re').M).group(1)))


if __name__ == '__main__':
    unittest.main()
