"""Game theory on textbook games: dominance, pure and mixed equilibria, backward induction and non-credible threats,
grim trigger, Shapley value and core, Nash bargaining; the handlers' parameter names; nashpy as an oracle when it is
installed. No network."""
import asyncio
import os
import random
import re
import sys
import unittest
from fractions import Fraction
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import gametheory as gt  # noqa: E402
from engine.core import HANDLERS  # noqa: E402


def two(rows, cols, cells):
    """A 2-player game from rows of (u1, u2) pairs."""
    return {'players': ['Row', 'Col'], 'strategies': [rows, cols], 'payoffs': cells}


PD = two(['Cooperate', 'Defect'], ['Cooperate', 'Defect'], [[[3, 3], [0, 5]], [[5, 0], [1, 1]]])
BOS = two(['Opera', 'Football'], ['Opera', 'Football'], [[[3, 2], [0, 0]], [[0, 0], [2, 3]]])
PENNIES = two(['Heads', 'Tails'], ['Heads', 'Tails'], [[[1, -1], [-1, 1]], [[-1, 1], [1, -1]]])
CHICKEN = two(['Swerve', 'Straight'], ['Swerve', 'Straight'], [[[0, 0], [-1, 1]], [[1, -1], [-10, -10]]])
STAG = two(['Stag', 'Hare'], ['Stag', 'Hare'], [[[4, 4], [0, 3]], [[3, 0], [3, 3]]])
# A 3x3 solved by strict dominance in four rounds: Down (by Up), Right (by Middle), Mid (by Up), Left (by Middle) -> (Up, Middle).
IESDS = two(['Up', 'Mid', 'Down'], ['Left', 'Middle', 'Right'],
            [[[1, 0], [1, 2], [0, 1]], [[0, 3], [0, 1], [2, 0]], [[0, 1], [0, 0], [-1, 2]]])


def solve(g, **kw):
    return gt.solve_normal(g['players'], g['strategies'], g['payoffs'], **kw)


def mixed_only(result):
    return [e for e in result['mixedNash'] if not e['pure']]


class NormalForm(unittest.TestCase):
    def test_prisoners_dilemma_defect_dominates(self):
        r = solve(PD, welfare='sum')
        self.assertEqual(r['dominance']['strict']['remaining'], [[1], [1]])
        self.assertTrue(r['dominance']['strict']['solved'])
        self.assertEqual([e['labels'] for e in r['pureNash']], [['Defect', 'Defect']])
        self.assertFalse(r['pureNash'][0]['paretoOptimal'])  # (C, C) is better for both
        self.assertIn([0, 0], r['pareto'])
        self.assertEqual(r['welfare']['optimum'], 6)
        self.assertEqual(r['welfare']['priceOfAnarchy'], 3)
        self.assertEqual(mixed_only(r), [])

    def test_battle_of_the_sexes_two_pure_one_mixed(self):
        r = solve(BOS)
        self.assertEqual(sorted(e['profile'] for e in r['pureNash']), [[0, 0], [1, 1]])
        mixed = mixed_only(r)
        self.assertEqual(len(mixed), 1)
        self.assertEqual(mixed[0]['exact'], [['3/5', '2/5'], ['2/5', '3/5']])
        self.assertEqual(mixed[0]['payoffs'], [1.2, 1.2])
        self.assertFalse(r['degenerate'])
        self.assertEqual(r['dominance']['strict']['steps'], [])

    def test_matching_pennies_half_half(self):
        r = solve(PENNIES)
        self.assertEqual(r['pureNash'], [])
        self.assertEqual(len(r['mixedNash']), 1)
        self.assertEqual(r['mixedNash'][0]['probabilities'], [[0.5, 0.5], [0.5, 0.5]])
        self.assertEqual(r['mixedNash'][0]['payoffs'], [0, 0])

    def test_chicken(self):
        r = solve(CHICKEN)
        self.assertEqual(sorted(e['labels'] for e in r['pureNash']), [['Straight', 'Swerve'], ['Swerve', 'Straight']])
        mixed = mixed_only(r)
        self.assertEqual(len(mixed), 1)
        # indifference: -p_straight + ... swerve pays -q, straight pays 1 - 11q -> q = 1/10 straight
        self.assertEqual(mixed[0]['exact'], [['9/10', '1/10'], ['9/10', '1/10']])

    def test_stag_hunt_payoff_vs_risk(self):
        r = solve(STAG, welfare='sum')
        self.assertEqual(sorted(e['profile'] for e in r['pureNash']), [[0, 0], [1, 1]])
        self.assertTrue(next(e for e in r['pureNash'] if e['profile'] == [0, 0])['paretoOptimal'])
        self.assertFalse(next(e for e in r['pureNash'] if e['profile'] == [1, 1])['paretoOptimal'])
        self.assertEqual(mixed_only(r)[0]['exact'], [['3/4', '1/4'], ['3/4', '1/4']])
        self.assertEqual(r['welfare']['priceOfStability'], 1)
        self.assertEqual(r['welfare']['priceOfAnarchy'], Fraction(8, 6).__float__().__round__(6))

    def test_3x3_by_iesds(self):
        r = solve(IESDS)
        strict = r['dominance']['strict']
        self.assertTrue(strict['solved'])
        self.assertEqual(strict['remaining'], [[0], [1]])
        self.assertEqual([(s['round'], s['player'], s['label'], s['byLabel']) for s in strict['steps']],
                         [(1, 0, 'Down', 'Up'), (2, 1, 'Right', 'Middle'), (3, 0, 'Mid', 'Up'), (4, 1, 'Left', 'Middle')])
        self.assertEqual([e['labels'] for e in r['pureNash']], [['Up', 'Middle']])

    def test_weak_dominance_is_optional(self):
        g = two(['T', 'B'], ['L', 'R'], [[[1, 1], [0, 0]], [[0, 0], [0, 0]]])
        r = solve(g, weak=True)
        self.assertEqual(r['dominance']['strict']['steps'], [])
        self.assertTrue(r['dominance']['weak']['solved'])
        self.assertEqual(r['dominance']['weak']['remaining'], [[0], [0]])
        self.assertTrue(r['degenerate'])  # (B, R) is an equilibrium with two best replies each

    def test_best_responses_and_cells(self):
        r = solve(PD)
        row = r['bestResponses'][0]['rows']
        self.assertEqual([x['best'] for x in row], [[1], [1]])
        cell = next(c for c in r['cells'] if c['profile'] == [1, 1])
        self.assertTrue(cell['nash'])
        self.assertEqual(cell['bestFor'], [0, 1])

    def test_three_players_pure_only(self):
        # Each player gets 1 when everyone matches, else 0: two pure equilibria (all A, all B).
        pay = [[[[1, 1, 1] if (i == j == k) else [0, 0, 0] for k in range(2)] for j in range(2)] for i in range(2)]
        r = gt.solve_normal(['A', 'B', 'C'], [['a', 'b']] * 3, pay)
        self.assertEqual(sorted(e['profile'] for e in r['pureNash']), [[0, 0, 0], [1, 1, 1]])
        self.assertIsNone(r['mixedNash'])

    def test_decimals_are_exact_and_bad_input_is_explained(self):
        g = two(['A', 'B'], ['A', 'B'], [[['0.1', 0.2], [0, 0]], [[0, 0], [0.3, '1/3']]])
        self.assertEqual(len(solve(g)['pureNash']), 2)
        with self.assertRaises(gt.GameError):
            gt.solve_normal(['a', 'b'], [['x'], ['y']], [[[1]]])
        with self.assertRaises(gt.GameError):
            gt.solve_normal(['a', 'b'], [['x'], ['y']], [[[1, 'abc']]])

    def test_mixed_equilibria_are_equilibria_on_random_games(self):
        rnd = random.Random(4)
        for _ in range(40):
            m, k = rnd.randint(2, 4), rnd.randint(2, 4)
            cells = [[[rnd.randint(-5, 9), rnd.randint(-5, 9)] for _ in range(k)] for _ in range(m)]
            r = solve(two([f'r{i}' for i in range(m)], [f'c{j}' for j in range(k)], cells))
            self.assertTrue(r['mixedNash'], 'every finite game has an equilibrium')
            for e in r['mixedNash']:
                x, y = [Fraction(v) for v in e['exact'][0]], [Fraction(v) for v in e['exact'][1]]
                rows = [sum(cells[i][j][0] * y[j] for j in range(k)) for i in range(m)]
                cols = [sum(cells[i][j][1] * x[i] for i in range(m)) for j in range(k)]
                self.assertEqual(sum(x[i] * rows[i] for i in range(m)), max(rows))
                self.assertEqual(sum(y[j] * cols[j] for j in range(k)), max(cols))


try:
    import nashpy  # noqa: F401
    HAVE_NASHPY = True
except Exception:
    HAVE_NASHPY = False


@unittest.skipUnless(HAVE_NASHPY, 'nashpy is optional (requirements-extra.txt)')
class NashpyOracle(unittest.TestCase):
    def test_same_equilibria_as_nashpy(self):
        for g in (PD, BOS, PENNIES, CHICKEN, STAG, IESDS):
            r = solve(g)
            self.assertTrue(r['crossCheck']['agrees'], g['strategies'])

    def test_random_nondegenerate_games_agree(self):
        rnd = random.Random(11)
        for _ in range(25):
            m, k = rnd.randint(2, 4), rnd.randint(2, 4)
            cells = [[[rnd.random() * 10, rnd.random() * 10] for _ in range(k)] for _ in range(m)]
            r = solve(two([f'r{i}' for i in range(m)], [f'c{j}' for j in range(k)], cells))
            self.assertFalse(r['degenerate'])
            self.assertTrue(r['crossCheck']['agrees'])


class WithoutNashpy(unittest.TestCase):
    def test_falls_back_to_exact_enumeration(self):
        with mock.patch.object(gt, '_load_nashpy', return_value=None):
            r = solve(BOS)
        self.assertIsNone(r['crossCheck'])
        self.assertEqual(len(r['mixedNash']), 3)


ENTRY = {'label': 'Entrant', 'player': 0, 'moves': [
    {'action': 'Out', 'next': {'label': 'Stay out', 'payoffs': [0, 2]}},
    {'action': 'In', 'next': {'label': 'Incumbent', 'player': 1, 'moves': [
        {'action': 'Fight', 'next': {'label': 'Price war', 'payoffs': [-1, -1]}},
        {'action': 'Accommodate', 'next': {'label': 'Share', 'payoffs': [1, 1]}},
    ]}},
]}


class Trees(unittest.TestCase):
    def test_entry_deterrence_fight_is_not_credible(self):
        r = gt.solve_tree(ENTRY, ['Entrant', 'Incumbent'])
        self.assertEqual([s['action'] for s in r['path']], ['In', 'Accommodate'])
        self.assertEqual(r['payoffs'], [1, 1])
        self.assertEqual(len(r['nonCredibleThreats']), 1)
        t = r['nonCredibleThreats'][0]
        self.assertEqual((t['name'], t['action'], t['bestThere']), ('Incumbent', 'Fight', 'Accommodate'))
        self.assertEqual(t['wouldInduce'], ['Out'])
        self.assertEqual(t['payoffsIfBelieved'], [0, 2])

    def test_tree_errors(self):
        with self.assertRaises(gt.GameError):
            gt.solve_tree({'player': 0, 'moves': [{'action': 'a', 'next': {'payoffs': [1]}}]}, ['A', 'B'])
        with self.assertRaises(gt.GameError):
            gt.solve_tree({'player': 5, 'moves': []}, ['A', 'B'])


class Repeated(unittest.TestCase):
    def test_grim_trigger_prisoners_dilemma(self):
        r = gt.repeated(PD['players'], PD['strategies'], PD['payoffs'], ['Cooperate', 'Cooperate'], delta=0.6)
        self.assertEqual(r['punishLabels'], ['Defect', 'Defect'])
        self.assertEqual(r['threshold'], 0.5)  # (5 - 3) / (5 - 1)
        self.assertEqual(r['players'][0]['exact'], '1/2')
        self.assertTrue(r['holdsAtDelta'])

    def test_unsustainable(self):
        r = gt.repeated(PD['players'], PD['strategies'], PD['payoffs'], [0, 1])  # (C, D): row gets 0 < 1
        self.assertFalse(r['sustainable'])


GLOVES = [{'members': ['L', 'R1'], 'value': 1}, {'members': ['L', 'R2'], 'value': 1}, {'members': ['L', 'R1', 'R2'], 'value': 1}]


class Cooperative(unittest.TestCase):
    def test_glove_game(self):
        r = gt.shapley(['L', 'R1', 'R2'], GLOVES)
        self.assertEqual(r['exact'], ['2/3', '1/6', '1/6'])
        self.assertTrue(r['core']['nonEmpty'])
        self.assertEqual(r['core']['allocation'], [1, 0, 0])  # the core is the single point (1, 0, 0)
        self.assertFalse(r['shapleyInCore'])
        self.assertTrue(r['shapleyBlocking'])

    def test_empty_core_majority_game(self):
        maj = [{'members': list(s), 'value': 1} for s in (['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'B', 'C'])]
        r = gt.shapley(['A', 'B', 'C'], maj)
        self.assertFalse(r['core']['nonEmpty'])
        self.assertEqual(r['core']['minimumNeeded'], 1.5)
        self.assertEqual(r['exact'], ['1/3', '1/3', '1/3'])

    def test_twelve_players_symmetric(self):
        names = [f'P{i}' for i in range(12)]
        r = gt.shapley(names, [{'members': names, 'value': 12}])
        self.assertEqual(r['shapley'], [1] * 12)

    def test_nash_bargaining_asymmetric_disagreement(self):
        r = gt.bargain([[10, 0], [0, 10]], [4, 0])
        self.assertEqual(r['solution'], [7, 3])  # each gets half of the surplus above d
        self.assertEqual(r['gains'], [3, 3])
        weighted = gt.bargain([[10, 0], [0, 10]], [4, 0], power=0.75)
        self.assertEqual(weighted['solution'], [8.5, 1.5])

    def test_bargaining_on_points_and_no_deal(self):
        r = gt.bargain([[0, 0], [6, 2], [2, 6]], [0, 0])
        self.assertEqual(r['solution'], [4, 4])
        self.assertIsNone(gt.bargain([[1, 1]], [2, 2])['solution'])


class Handlers(unittest.TestCase):
    def test_registered_and_params_never_reserved(self):
        for name, params in gt.PARAMS.items():
            self.assertIn(name, HANDLERS)
            self.assertNotIn('id', params)
            self.assertNotIn('type', params)
        source = Path(gt.__file__).read_text()
        for key in re.findall(r"msg\.get\('(\w+)'", source):
            self.assertNotIn(key, ('id', 'type'))

    def test_handler_round_trip(self):
        r = asyncio.run(HANDLERS['game.solve_normal'](None, {**PD, 'welfare': 'sum'}))
        self.assertEqual(r['pureNash'][0]['labels'], ['Defect', 'Defect'])
        r = asyncio.run(HANDLERS['game.bargain'](None, {'points': [[10, 0], [0, 10]], 'disagreement': [4, 0]}))
        self.assertEqual(r['solution'], [7, 3])


class AiMode(unittest.TestCase):
    """The game.* AI tools and the Equilibrium-Prime mode (ai.py imports the anthropic SDK)."""

    @classmethod
    def setUpClass(cls):
        try:
            from engine import ai
        except ImportError as err:  # the SDK is in requirements-extra.txt
            raise unittest.SkipTest(f'anthropic SDK not installed: {err}')
        cls.ai = ai

    def test_tools_map_to_handlers_and_never_use_reserved_names(self):
        ai = self.ai
        for tool in ai.GAME_TOOLS:
            self.assertIn(tool['name'], ai.TOOL_FUNCS)
            self.assertIn(ai.GAME_REQUESTS[tool['name']], HANDLERS)
            props = tool['input_schema']['properties']
            self.assertNotIn('id', props)
            self.assertNotIn('type', props)
            self.assertTrue(set(props) <= set(gt.PARAMS[ai.GAME_REQUESTS[tool['name']]]), tool['name'])
        self.assertTrue({t['name'] for t in ai.GAME_TOOLS} <= {t['name'] for t in ai.TOOLS})

    def test_tool_call_is_logged_for_the_answer(self):
        ai = self.ai
        log = []
        ai._game_log.set(log)
        asyncio.run(ai.TOOL_FUNCS['game_solve_normal'](None, dict(PD), []))
        self.assertEqual(log[0][0], 'game.solve_normal')
        note = ai.computations_note(log, 'The equilibrium is...')
        self.assertIn('`game.solve_normal`', note)
        self.assertIn('(Defect, Defect)', note)
        self.assertIn('unverified', ai.computations_note([], 'Nash equilibrium is X'))
        self.assertEqual(ai.computations_note([], 'Hello'), '')

    def test_prompt_is_loaded_from_the_file(self):
        ai = self.ai
        text = ai.mode_prompt('equilibrium_prime')
        source = (Path(ai.__file__).parent / 'prompts' / 'equilibrium_prime.md').read_text()
        self.assertTrue(text.startswith(source.strip()))
        for phrase in ('Players ($N$)', 'Harsanyi', 'trembling-hand', 'grim trigger', '[SOLVE]', '[RED TEAM]', '[REDESIGN / MECHANISM]',
                       '[TUTOR]', '[SUMMARY MATRIX]', 'price of anarchy', 'moral hazard', 'game_solve_normal'):
            self.assertIn(phrase, text)
        with self.assertRaises(Exception):
            ai.mode_prompt('nope')


if __name__ == '__main__':
    unittest.main()
