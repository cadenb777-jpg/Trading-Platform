"""
Game theory for the Strategy Lab and the Equilibrium-Prime AI mode: exact, standard-library maths (fractions), so the AI
computes equilibria instead of guessing them.

- Normal form (any number of players, pure strategies): iterated elimination of strictly (optionally weakly) dominated
  strategies, every pure-strategy Nash equilibrium, best-response tables, Pareto optimality, and the price of anarchy /
  stability for a welfare function. Two players: mixed equilibria by support enumeration (exact for non-degenerate
  games; a degenerate game is flagged, since it can have more equilibria than equal-sized supports find).
- Extensive form: backward induction (subgame-perfect equilibrium) on perfect-information trees, and the non-credible
  threats: off-path moves a player would like to promise but would not carry out.
- Repeated games: the grim-trigger discount-factor threshold delta* for keeping a cooperative profile.
- Cooperative games: the Shapley value (exact, up to 12 players), the core (exact linear programme, up to 10 players)
  and the Nash bargaining solution with a disagreement point.

Two-player mixed equilibria are also cross-checked with nashpy (MIT, optional, requirements-extra.txt) when it is
installed: its vertex enumeration adds any extreme equilibrium of a degenerate game that equal-sized supports miss, and
a disagreement on a non-degenerate game is reported. Without nashpy the exact enumeration here stands alone.

Payoffs are utilities: more is better. Dominance is checked against pure strategies only (dominance by a mixture
is not tested; the result says so). Handlers: game.solve_normal, game.solve_tree, game.repeated, game.shapley,
game.bargain. Parameter names never use `id` or `type` (reserved in helper messages).
"""
import itertools
import math
import warnings
from fractions import Fraction

from .core import EngineError, handler

MAX_PLAYERS = 4
MAX_STRATEGIES = 8
MAX_PROFILES = 4096
MAX_SUPPORT_SYSTEMS = 60000
MAX_SHAPLEY_PLAYERS = 12
MAX_CORE_PLAYERS = 10
MAX_TREE_NODES = 400
DOMINANCE_NOTE = 'Dominance is checked against pure strategies only (a strategy beaten only by a mixture is not removed).'


class GameError(EngineError):
    """A game that can't be read or solved, with a message worth showing as-is."""


# ---------- numbers ----------

def num(value, what='payoff'):
    """A payoff as an exact fraction (decimals are read as written: 0.1 is 1/10)."""
    if isinstance(value, bool):
        raise GameError(f'Each {what} must be a number')
    if isinstance(value, Fraction):
        return value
    if isinstance(value, int):
        return Fraction(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise GameError(f'Each {what} must be a finite number')
        return Fraction(repr(value))
    if isinstance(value, str):
        text = value.strip().replace('−', '-')
        try:
            return Fraction(text)
        except (ValueError, ZeroDivisionError):
            pass
    raise GameError(f'Each {what} must be a number (got {str(value)[:20]!r})')


def out(x, digits=6):
    """A fraction for JSON: a float rounded to `digits` places (ints stay ints)."""
    if x is None:
        return None
    if isinstance(x, Fraction) and x.denominator == 1:
        return int(x)
    return round(float(x), digits)


def fraction_text(x):
    """'1/3' for exact fractions (shown next to the decimal for the maths-minded)."""
    x = Fraction(x)
    return str(x.numerator) if x.denominator == 1 else f'{x.numerator}/{x.denominator}'


# ---------- normal form ----------

class NormalGame:
    """players: names; strategies: one list of labels per player; pay[profile] = tuple of payoffs (Fractions)."""

    def __init__(self, players, strategies, pay):
        self.players = players
        self.strategies = strategies
        self.pay = pay
        self.n = len(players)

    def profiles(self, alive=None):
        alive = alive or [list(range(len(s))) for s in self.strategies]
        return itertools.product(*alive)

    def label(self, profile):
        return [self.strategies[p][s] for p, s in enumerate(profile)]


def _labels(raw, count, prefix):
    raw = list(raw or [])
    names = []
    for i in range(count):
        text = str(raw[i]).strip()[:40] if i < len(raw) and raw[i] is not None else ''
        names.append(text or f'{prefix}{i + 1}')
    return names


def parse_normal(players, strategies, payoffs):
    """Reads a game: payoffs is a nested list with one level per player, ending in a list of every player's payoff
    (two players: payoffs[row][col] = [row player's, column player's])."""
    if not isinstance(strategies, list) or not strategies:
        raise GameError('List each player’s strategies')
    n = len(strategies)
    if n < 2 or n > MAX_PLAYERS:
        raise GameError(f'A game here has 2 to {MAX_PLAYERS} players')
    names = _labels(players, n, 'Player ')
    strats = []
    for p, s in enumerate(strategies):
        if not isinstance(s, list) or not 1 <= len(s) <= MAX_STRATEGIES:
            raise GameError(f'{names[p]} needs 1 to {MAX_STRATEGIES} strategies')
        strats.append(_labels(s, len(s), 'S'))
    total = math.prod(len(s) for s in strats)
    if total > MAX_PROFILES:
        raise GameError(f'Too many strategy combinations ({total}); the limit is {MAX_PROFILES}')
    pay = {}
    for profile in itertools.product(*(range(len(s)) for s in strats)):
        cell = payoffs
        try:
            for s in profile:
                cell = cell[s]
        except (IndexError, KeyError, TypeError):
            raise GameError(f'Missing payoffs for {" / ".join(strats[p][s] for p, s in enumerate(profile))}') from None
        if not isinstance(cell, (list, tuple)) or len(cell) != n:
            raise GameError(f'Each cell needs {n} payoffs (one per player)')
        pay[profile] = tuple(num(v) for v in cell)
    return NormalGame(names, strats, pay)


def _swap(profile, player, strategy):
    return profile[:player] + (strategy,) + profile[player + 1:]


def _others(game, player, alive):
    return itertools.product(*(alive[q] if q != player else [None] for q in range(game.n)))


def dominates(game, player, a, b, alive, weak=False):
    """Does player's strategy a dominate b (against every surviving profile of the others)?"""
    strictly_better_somewhere = False
    for rest in _others(game, player, alive):
        ua = game.pay[_swap(rest, player, a)][player]
        ub = game.pay[_swap(rest, player, b)][player]
        if weak:
            if ua < ub:
                return False
            if ua > ub:
                strictly_better_somewhere = True
        elif ua <= ub:
            return False
    return strictly_better_somewhere if weak else True


def iesds(game, weak=False):
    """Iterated elimination of dominated strategies. Strict elimination removes everything dominated in a round at
    once (the order doesn't matter). Weak elimination removes one strategy at a time, lowest player and strategy
    first, because its result can depend on the order (said in the note)."""
    alive = [list(range(len(s))) for s in game.strategies]
    steps = []
    rnd = 0
    while True:
        rnd += 1
        removed = []
        for p in range(game.n):
            for b in alive[p]:
                if len(alive[p]) - sum(1 for q, _ in removed if q == p) <= 1:
                    break
                by = next((a for a in alive[p] if a != b and (p, a) not in removed and dominates(game, p, a, b, alive, weak)), None)
                if by is not None:
                    removed.append((p, b))
                    steps.append({'round': rnd, 'player': p, 'strategy': b, 'label': game.strategies[p][b], 'by': by,
                                  'byLabel': game.strategies[p][by], 'kind': 'weak' if weak else 'strict'})
                    if weak:
                        break
            if weak and removed:
                break
        if not removed:
            break
        for p, b in removed:
            alive[p].remove(b)
    return {'remaining': alive, 'steps': steps, 'solved': all(len(a) == 1 for a in alive),
            'note': DOMINANCE_NOTE + (' Weak elimination can depend on the order; this removes one strategy at a time.' if weak else '')}


def best_responses(game):
    """For every player and every profile of the others: the strategies that give that player the most."""
    alive = [list(range(len(s))) for s in game.strategies]
    table = []
    for p in range(game.n):
        rows = []
        for rest in _others(game, p, alive):
            values = [game.pay[_swap(rest, p, s)][p] for s in alive[p]]
            top = max(values)
            others = [s for q, s in enumerate(rest) if q != p]
            rows.append({'against': others, 'againstLabels': [game.strategies[q][s] for q, s in enumerate(rest) if q != p],
                         'best': [s for s, v in zip(alive[p], values) if v == top], 'payoff': out(top)})
        table.append({'player': p, 'name': game.players[p], 'rows': rows})
    return table


def is_best_response(game, profile, player):
    mine = game.pay[profile][player]
    return all(game.pay[_swap(profile, player, s)][player] <= mine for s in range(len(game.strategies[player])))


def pure_nash(game):
    return [prof for prof in game.profiles() if all(is_best_response(game, prof, p) for p in range(game.n))]


def pareto_optimal(game):
    """Profiles no other profile beats for everyone (at least as good for all, better for one)."""
    cells = list(game.pay.items())
    best = []
    for prof, u in cells:
        beaten = any(all(v[i] >= u[i] for i in range(game.n)) and any(v[i] > u[i] for i in range(game.n)) for _, v in cells)
        if not beaten:
            best.append(prof)
    return best


def _solve_linear(rows, rhs):
    """Exact Gaussian elimination; None when singular."""
    n = len(rows)
    m = [list(r) + [b] for r, b in zip(rows, rhs)]
    for c in range(n):
        pivot = next((r for r in range(c, n) if m[r][c] != 0), None)
        if pivot is None:
            return None
        m[c], m[pivot] = m[pivot], m[c]
        inv = 1 / m[c][c]
        m[c] = [x * inv for x in m[c]]
        for r in range(n):
            if r != c and m[r][c] != 0:
                f = m[r][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[r][n] for r in range(n)]


def _indifferent(payoff, support, other_support, size_other):
    """Mixture over other_support that makes every strategy in `support` pay the same (payoff(i, j) is the payoff to
    the player choosing i). Returns (probabilities over all of the other's strategies, value) or None."""
    k = len(support)
    rows, rhs = [], []
    for i in support:
        rows.append([payoff(i, j) for j in other_support] + [Fraction(-1)])
        rhs.append(Fraction(0))
    rows.append([Fraction(1)] * k + [Fraction(0)])
    rhs.append(Fraction(1))
    sol = _solve_linear(rows, rhs)
    if sol is None or any(x < 0 for x in sol[:k]):
        return None
    probs = [Fraction(0)] * size_other
    for j, x in zip(other_support, sol[:k]):
        probs[j] = x
    return probs, sol[k]


def mixed_nash(game):
    """Two players: all equilibria with equal-sized supports (every equilibrium of a non-degenerate game). Returns
    (equilibria, degenerate) where degenerate is True when some equilibrium has more best replies than its support."""
    if game.n != 2:
        raise GameError('Mixed equilibria are computed for 2-player games')
    m, k = len(game.strategies[0]), len(game.strategies[1])
    systems = sum(math.comb(m, s) * math.comb(k, s) for s in range(1, min(m, k) + 1))
    if systems > MAX_SUPPORT_SYSTEMS:
        raise GameError('This game is too large for exact mixed equilibria')
    A = lambda i, j: game.pay[(i, j)][0]  # noqa: E731
    B = lambda i, j: game.pay[(i, j)][1]  # noqa: E731
    found, degenerate = [], False
    for size in range(1, min(m, k) + 1):
        for I in itertools.combinations(range(m), size):
            for J in itertools.combinations(range(k), size):
                col = _indifferent(lambda i, j: A(i, j), I, J, k)  # column mixture y makes the row player indifferent on I
                if col is None:
                    continue
                row = _indifferent(lambda j, i: B(i, j), J, I, m)  # row mixture x makes the column player indifferent on J
                if row is None:
                    continue
                y, v = col
                x, w = row
                if any(p == 0 for p in (y[j] for j in J)) or any(p == 0 for p in (x[i] for i in I)):
                    continue  # a smaller support finds this one
                row_pay = [sum(A(i, j) * y[j] for j in range(k)) for i in range(m)]
                col_pay = [sum(B(i, j) * x[i] for i in range(m)) for j in range(k)]
                if any(row_pay[i] > v for i in range(m)) or any(col_pay[j] > w for j in range(k)):
                    continue
                if (x, y) in [(e['x'], e['y']) for e in found]:
                    continue
                if sum(1 for i in range(m) if row_pay[i] == v) > size or sum(1 for j in range(k) if col_pay[j] == w) > size:
                    degenerate = True
                found.append({'x': x, 'y': y, 'payoffs': (v, w), 'support': (list(I), list(J))})
    return found, degenerate


def _load_nashpy():
    """nashpy when installed (optional), else None. Imported on first use only."""
    try:
        import nashpy  # noqa: PLC0415
        import numpy  # noqa: PLC0415
        return nashpy, numpy
    except Exception:  # missing or broken: the exact enumeration here is used alone
        return None


def nashpy_equilibria(game):
    """(x, y) float equilibria from nashpy's vertex enumeration (every extreme equilibrium, degenerate games
    included), or None when nashpy isn't available or fails."""
    lib = _load_nashpy()
    if lib is None or game.n != 2:
        return None
    nashpy, np = lib
    m, k = len(game.strategies[0]), len(game.strategies[1])
    A = np.array([[float(game.pay[(i, j)][0]) for j in range(k)] for i in range(m)])
    B = np.array([[float(game.pay[(i, j)][1]) for j in range(k)] for i in range(m)])
    try:
        with warnings.catch_warnings(), np.errstate(all='ignore'):
            warnings.simplefilter('ignore')
            found = list(nashpy.Game(A, B).vertex_enumeration())
    except Exception:
        return None
    clean = []
    for x, y in found:
        x = [max(0.0, float(v)) for v in x]
        y = [max(0.0, float(v)) for v in y]
        sx, sy = sum(x), sum(y)
        if sx <= 0 or sy <= 0:
            continue
        x, y = [v / sx for v in x], [v / sy for v in y]
        if not any(_close(x, a) and _close(y, b) for a, b in clean):
            clean.append((x, y))
    return clean


def _close(a, b, tol=1e-6):
    return len(a) == len(b) and all(abs(float(u) - float(v)) <= tol for u, v in zip(a, b))


def welfare_of(payoffs, welfare):
    if welfare == 'sum':
        return sum(payoffs)
    if welfare == 'min':
        return min(payoffs)
    if isinstance(welfare, list):
        return sum(num(w, 'welfare weight') * u for w, u in zip(welfare, payoffs))
    raise GameError('welfare is "sum", "min" or a list of weights, one per player')


def _ratio(a, b):
    if a is None or b is None or b <= 0 or a <= 0:
        return None
    return a / b


def solve_normal(players, strategies, payoffs, weak=False, welfare=None, mixed=True):
    game = parse_normal(players, strategies, payoffs)
    strict = iesds(game, weak=False)
    weak_result = iesds(game, weak=True) if weak else None
    psne = pure_nash(game)
    pareto = set(pareto_optimal(game))
    result = {
        'players': game.players, 'strategies': game.strategies,
        'dominance': {'strict': strict, 'weak': weak_result},
        'pureNash': [{'profile': list(p), 'labels': game.label(p), 'payoffs': [out(u) for u in game.pay[p]], 'paretoOptimal': p in pareto} for p in psne],
        'pareto': [list(p) for p in sorted(pareto)],
        'bestResponses': best_responses(game),
        'cells': [{'profile': list(p), 'payoffs': [out(u) for u in game.pay[p]], 'nash': p in psne, 'pareto': p in pareto,
                   'bestFor': [q for q in range(game.n) if is_best_response(game, p, q)]} for p in game.profiles()],
        'mixedNash': None, 'degenerate': None, 'notes': [],
    }
    eq_welfare = []
    if game.n == 2 and mixed:
        eqs, degenerate = mixed_nash(game)
        result['degenerate'] = degenerate
        result['mixedNash'] = [{
            'probabilities': [[out(p) for p in e['x']], [out(q) for q in e['y']]],
            'exact': [[fraction_text(p) for p in e['x']], [fraction_text(q) for q in e['y']]],
            'payoffs': [out(e['payoffs'][0]), out(e['payoffs'][1])],
            'support': [e['support'][0], e['support'][1]],
            'pure': len(e['support'][0]) == 1 and len(e['support'][1]) == 1,
        } for e in eqs]
        cross = nashpy_equilibria(game)
        result['crossCheck'] = None if cross is None else {'library': 'nashpy', 'method': 'vertex enumeration', 'found': len(cross)}
        if cross is not None:
            mine = [([float(p) for p in e['x']], [float(q) for q in e['y']]) for e in eqs]
            extra = [(x, y) for x, y in cross if not any(_close(x, a) and _close(y, b) for a, b in mine)]
            missing = [e for e, (a, b) in zip(eqs, mine) if not any(_close(x, a) and _close(y, b) for x, y in cross)]
            m, k = len(game.strategies[0]), len(game.strategies[1])
            for x, y in extra:
                fx = [Fraction(v).limit_denominator(10000) for v in x]
                fy = [Fraction(v).limit_denominator(10000) for v in y]
                u = [sum(game.pay[(i, j)][q] * fx[i] * fy[j] for i in range(m) for j in range(k)) for q in range(2)]
                result['mixedNash'].append({
                    'probabilities': [[round(v, 6) for v in x], [round(v, 6) for v in y]],
                    'exact': [[fraction_text(v) for v in fx], [fraction_text(v) for v in fy]],
                    'payoffs': [out(u[0]), out(u[1])],
                    'support': [[i for i in range(m) if x[i] > 1e-9], [j for j in range(k) if y[j] > 1e-9]],
                    'pure': sum(1 for v in x if v > 1e-9) == 1 and sum(1 for v in y if v > 1e-9) == 1,
                    'source': 'nashpy vertex enumeration',
                })
                eqs.append({'payoffs': (u[0], u[1])})
            if extra:
                degenerate = result['degenerate'] = True
            result['crossCheck']['agrees'] = not extra and not missing
            if missing and not degenerate:
                result['notes'].append('nashpy’s vertex enumeration did not confirm every equilibrium found here; treat the list with care.')
        if degenerate:
            result['notes'].append('The game is degenerate (an equilibrium has more best replies than strategies it uses), so it can '
                                   'have more equilibria than listed, possibly a whole continuum.')
        eq_welfare = [e['payoffs'] for e in eqs]
    else:
        eq_welfare = [game.pay[p] for p in psne]
        if game.n > 2:
            result['notes'].append('Mixed equilibria are computed for 2-player games only; pure equilibria are complete.')
    if not psne and not result['mixedNash']:
        result['notes'].append('No pure-strategy equilibrium.')
    if welfare is not None:
        values = {p: welfare_of(u, welfare) for p, u in game.pay.items()}
        best = max(values.values())
        eqv = [welfare_of(list(u), welfare) for u in eq_welfare]
        worst_eq, best_eq = (min(eqv), max(eqv)) if eqv else (None, None)
        poa, pos = _ratio(best, worst_eq), _ratio(best, best_eq)
        result['welfare'] = {
            'kind': welfare if isinstance(welfare, str) else 'weighted', 'optimum': out(best),
            'optimumProfiles': [list(p) for p, v in values.items() if v == best],
            'worstEquilibrium': out(worst_eq), 'bestEquilibrium': out(best_eq),
            'priceOfAnarchy': out(poa), 'priceOfStability': out(pos),
            'note': None if poa is not None or not eqv else 'The price of anarchy needs positive welfare at the optimum and the equilibria.',
        }
    return result


# ---------- extensive form ----------

def _read_tree(node, n_players, count, path='root'):
    if not isinstance(node, dict):
        raise GameError('Each tree node is an object')
    count[0] += 1
    if count[0] > MAX_TREE_NODES:
        raise GameError(f'The tree is limited to {MAX_TREE_NODES} nodes')
    label = str(node.get('label') or path)[:60]
    if node.get('payoffs') is not None:
        pay = node['payoffs']
        if not isinstance(pay, list) or len(pay) != n_players:
            raise GameError(f'End point "{label}" needs {n_players} payoffs')
        return {'label': label, 'payoffs': [num(v) for v in pay]}
    moves = node.get('moves')
    player = node.get('player')
    if not isinstance(player, int) or isinstance(player, bool) or not 0 <= player < n_players:
        raise GameError(f'Decision "{label}" needs a player number from 0 to {n_players - 1}')
    if not isinstance(moves, list) or not moves:
        raise GameError(f'Decision "{label}" needs at least one move (or payoffs, if it is an end point)')
    kids = []
    for i, mv in enumerate(moves):
        if not isinstance(mv, dict):
            raise GameError(f'Each move of "{label}" is an object')
        action = str(mv.get('action') or f'move {i + 1}')[:40]
        kids.append((action, _read_tree(mv.get('next'), n_players, count, f'{path}/{action}')))
    return {'label': label, 'player': player, 'moves': kids}


def _induct(node, forced=None, nodes=None, path=()):
    """Backward induction. Returns the payoff vector reached; records at each decision node its best moves and the
    move chosen (the first best one, or the forced one). forced: {path: action index}."""
    if 'payoffs' in node:
        return node['payoffs']
    p = node['player']
    values = [_induct(child, forced, nodes, path + (i,)) for i, (_, child) in enumerate(node['moves'])]
    top = max(v[p] for v in values)
    best = [i for i, v in enumerate(values) if v[p] == top]
    choice = forced[path] if forced and path in forced else best[0]
    if nodes is not None:
        nodes[path] = {'best': best, 'choice': choice, 'values': values}
    return values[choice]


def _walk(node, nodes, path=()):
    """The equilibrium path from `path`: [(path, action index)...] and the end payoffs."""
    steps = []
    while 'payoffs' not in node:
        choice = nodes[path]['choice']
        steps.append((path, choice))
        node = node['moves'][choice][1]
        path = path + (choice,)
    return steps, node['payoffs']


def _node_at(root, path):
    node = root
    for i in path:
        node = node['moves'][i][1]
    return node


def solve_tree(tree, players):
    """Subgame-perfect equilibrium of a perfect-information game tree by backward induction.
    tree = {label, player (index), moves: [{action, next: node}]}; an end point is {label, payoffs: [...]}."""
    if not isinstance(players, list) or not 1 <= len(players) <= 6:
        raise GameError('List 1 to 6 players')
    names = _labels(players, len(players), 'Player ')
    root = _read_tree(tree, len(names), [0])
    nodes = {}
    _induct(root, None, nodes)
    path, payoffs = _walk(root, nodes)
    on_path = {p for p, _ in path}
    decisions = []
    ties = False
    for p, info in sorted(nodes.items(), key=lambda kv: (len(kv[0]), kv[0])):
        node = _node_at(root, p)
        if len(info['best']) > 1:
            ties = True
        decisions.append({'path': list(p), 'label': node['label'], 'player': node['player'], 'name': names[node['player']],
                          'choice': info['choice'], 'action': node['moves'][info['choice']][0], 'best': info['best'],
                          'onPath': p in on_path, 'actions': [a for a, _ in node['moves']],
                          'values': [[out(x) for x in v] for v in info['values']]})
    # Non-credible threats: a move the mover would not make at that point (it pays less there), yet if others believed it,
    # an earlier player would act differently and the mover would end up better off than in the subgame-perfect outcome.
    threats = []
    for p, info in nodes.items():
        if not p:
            continue
        node = _node_at(root, p)
        mover = node['player']
        for a in range(len(node['moves'])):
            if a in info['best']:
                continue
            forced_nodes = {}
            _induct(root, {p: a}, forced_nodes)
            new_path, new_pay = _walk(root, forced_nodes)
            if new_pay[mover] > payoffs[mover] and p not in {q for q, _ in new_path}:
                threats.append({'path': list(p), 'label': node['label'], 'player': mover, 'name': names[mover],
                                'action': node['moves'][a][0], 'carriedOut': [out(x) for x in info['values'][a]],
                                'bestThere': node['moves'][info['best'][0]][0],
                                'wouldInduce': [_node_at(root, q)['moves'][c][0] for q, c in new_path],
                                'payoffsIfBelieved': [out(x) for x in new_pay]})
    return {'players': names, 'path': [{'path': list(p), 'action': _node_at(root, p)['moves'][c][0],
                                         'player': _node_at(root, p)['player']} for p, c in path],
            'payoffs': [out(x) for x in payoffs], 'decisions': decisions, 'nonCredibleThreats': threats,
            'notes': ['Some player is indifferent at a decision, so there is more than one subgame-perfect equilibrium; '
                      'this one takes the first best move.'] if ties else []}


# ---------- repeated games ----------

def _profile_index(game, profile, what):
    if not isinstance(profile, list) or len(profile) != game.n:
        raise GameError(f'{what} needs one strategy per player')
    idx = []
    for p, s in enumerate(profile):
        if isinstance(s, int) and not isinstance(s, bool) and 0 <= s < len(game.strategies[p]):
            idx.append(s)
        elif isinstance(s, str) and s in game.strategies[p]:
            idx.append(game.strategies[p].index(s))
        else:
            raise GameError(f'{what}: {s!r} is not one of {game.players[p]}’s strategies')
    return tuple(idx)


def grim_threshold(game, cooperate, punish):
    """delta*_i = (d_i - c_i) / (d_i - p_i): the patience each player needs so cooperating forever beats deviating once
    and being punished forever after (punish should be a stage-game Nash equilibrium)."""
    c = game.pay[cooperate]
    p = game.pay[punish]
    per = []
    for i in range(game.n):
        dev = max(range(len(game.strategies[i])), key=lambda s: game.pay[_swap(cooperate, i, s)][i])
        d = game.pay[_swap(cooperate, i, dev)][i]
        if d <= c[i]:
            need = Fraction(0)
        elif c[i] <= p[i]:
            need = None  # cooperating pays no more than the punishment: grim trigger can't hold it
        else:
            need = (d - c[i]) / (d - p[i])
        per.append({'player': i, 'name': game.players[i], 'cooperate': out(c[i]), 'deviate': out(d), 'deviation': game.strategies[i][dev],
                    'punish': out(p[i]), 'threshold': out(need), 'exact': None if need is None else fraction_text(need)})
    needs = [x['threshold'] for x in per]
    return per, (None if any(x is None for x in needs) else max(needs))


def repeated(players, strategies, payoffs, cooperate, punish=None, delta=None):
    game = parse_normal(players, strategies, payoffs)
    coop = _profile_index(game, cooperate, 'cooperate')
    eqs = pure_nash(game)
    notes = []
    if punish is not None:
        candidates = [_profile_index(game, punish, 'punish')]
        if candidates[0] not in eqs:
            notes.append('The punishment profile is not a Nash equilibrium of the stage game, so the threat to play it forever is not credible.')
    elif eqs:
        candidates = eqs
    else:
        raise GameError('The stage game has no pure Nash equilibrium to fall back to; give a punish profile')
    best = None
    for cand in candidates:
        per, need = grim_threshold(game, coop, cand)
        if best is None or (need is not None and (best[2] is None or need < best[2])):
            best = (cand, per, need)
    cand, per, need = best
    result = {'cooperate': list(coop), 'cooperateLabels': game.label(coop), 'punish': list(cand), 'punishLabels': game.label(cand),
              'players': per, 'threshold': need, 'sustainable': need is not None, 'notes': notes}
    if need is None:
        result['notes'].append('Someone gets no more from cooperating than from the punishment, so grim trigger cannot sustain this profile.')
    elif need == 0:
        result['notes'].append('No one gains by deviating: the profile is already a stage-game equilibrium.')
    if delta is not None:
        d = float(num(delta, 'discount factor'))
        if not 0 <= d < 1:
            raise GameError('The discount factor delta is between 0 and 1')
        result['delta'] = d
        result['holdsAtDelta'] = need is not None and d >= need
    return result


# ---------- cooperative games ----------

def _coalition_values(players, coalitions):
    if not isinstance(players, list) or not 1 <= len(players) <= MAX_SHAPLEY_PLAYERS:
        raise GameError(f'List 1 to {MAX_SHAPLEY_PLAYERS} players')
    names = _labels(players, len(players), 'P')
    if len(set(names)) != len(names):
        raise GameError('Player names must be different')
    index = {name: i for i, name in enumerate(names)}
    v = {0: Fraction(0)}
    if not isinstance(coalitions, list):
        raise GameError('coalitions is a list of {members, value}')
    for c in coalitions:
        if not isinstance(c, dict):
            raise GameError('Each coalition is {members, value}')
        members = c.get('members')
        if not isinstance(members, list):
            raise GameError('Each coalition lists its members')
        mask = 0
        for m in members:
            if isinstance(m, int) and not isinstance(m, bool) and 0 <= m < len(names):
                mask |= 1 << m
            elif str(m) in index:
                mask |= 1 << index[str(m)]
            else:
                raise GameError(f'{m!r} is not one of the players')
        v[mask] = num(c.get('value'), 'coalition value')
    full = (1 << len(names)) - 1
    if full not in v:
        raise GameError('Give the value of the whole group (every player together)')
    return names, v


def shapley_values(n, v):
    """Exact Shapley value: each player's average extra value over every order of joining. v: mask -> Fraction (missing = 0)."""
    fact = [math.factorial(k) for k in range(n + 1)]
    get = lambda m: v.get(m, Fraction(0))  # noqa: E731
    phi = []
    for i in range(n):
        bit = 1 << i
        total = Fraction(0)
        for mask in range(1 << n):
            if mask & bit:
                continue
            s = bin(mask).count('1')
            total += Fraction(fact[s] * fact[n - s - 1], fact[n]) * (get(mask | bit) - get(mask))
        phi.append(total)
    return phi


def _simplex_max(c, A, b):
    """max c.x s.t. A x <= b, x >= 0 with b >= 0 (the origin is feasible). Exact, Bland's rule. Returns (value, duals)
    where duals[i] is the shadow price of row i (the solution of the dual)."""
    m, n = len(A), len(c)
    T = [list(A[i]) + [Fraction(1 if j == i else 0) for j in range(m)] + [b[i]] for i in range(m)]
    z = [-x for x in c] + [Fraction(0)] * m + [Fraction(0)]
    basis = [n + i for i in range(m)]
    while True:
        col = next((j for j in range(n + m) if z[j] < 0), None)
        if col is None:
            break
        best = None
        for i in range(m):
            if T[i][col] > 0:
                ratio = T[i][-1] / T[i][col]
                if best is None or ratio < best[0] or (ratio == best[0] and basis[i] < basis[best[1]]):
                    best = (ratio, i)
        if best is None:
            raise GameError('The linear programme is unbounded')
        r = best[1]
        piv = T[r][col]
        T[r] = [x / piv for x in T[r]]
        for i in range(m):
            if i != r and T[i][col] != 0:
                f = T[i][col]
                T[i] = [x - f * y for x, y in zip(T[i], T[r])]
        if z[col] != 0:
            f = z[col]
            z = [x - f * y for x, y in zip(z, T[r])]
        basis[r] = col
    return z[-1], [z[n + i] for i in range(m)]


def core_check(n, v, allocation=None):
    """Is the core empty? Finds an allocation in it (exact LP), and lists the coalitions that block `allocation`."""
    get = lambda m: v.get(m, Fraction(0))  # noqa: E731
    full = (1 << n) - 1
    single = [get(1 << i) for i in range(n)]
    result = {'nonEmpty': None, 'allocation': None, 'blocking': None}
    if n <= MAX_CORE_PLAYERS:
        # min sum(y) s.t. sum_{i in S} y_i >= v(S) - sum_{i in S} v(i), y >= 0 (y = x - v(i)); solved through its dual.
        coalitions = [m for m in range(1, full + 1) if bin(m).count('1') >= 2]
        rhs = [get(m) - sum(single[i] for i in range(n) if m >> i & 1) for m in coalitions]
        A = [[Fraction(1 if m >> i & 1 else 0) for m in coalitions] for i in range(n)]
        best, y = _simplex_max(rhs, A, [Fraction(1)] * n)
        best = max(best, Fraction(0))
        x = [single[i] + y[i] for i in range(n)]
        spare = get(full) - sum(x)
        result['nonEmpty'] = spare >= 0
        if spare >= 0:
            x = [xi + spare / n for xi in x]
            result['allocation'] = [out(xi) for xi in x]
        result['minimumNeeded'] = out(sum(single) + best)
    if allocation is not None:
        if not isinstance(allocation, list) or len(allocation) != n:
            raise GameError('The allocation needs one amount per player')
        alloc = [num(a, 'allocation') for a in allocation]
        blocking = []
        for m in range(1, full + 1):
            got = sum(alloc[i] for i in range(n) if m >> i & 1)
            if got < get(m):
                blocking.append({'members': [i for i in range(n) if m >> i & 1], 'value': out(get(m)), 'gets': out(got)})
        result['blocking'] = blocking[:50]
        result['efficient'] = sum(alloc) == get(full)
        result['inCore'] = not blocking and sum(alloc) == get(full)
    return result


def shapley(players, coalitions, allocation=None):
    names, v = _coalition_values(players, coalitions)
    n = len(names)
    phi = shapley_values(n, v)
    full = (1 << n) - 1
    core = core_check(n, v, allocation) if n <= MAX_CORE_PLAYERS or allocation is not None else {'nonEmpty': None}
    shap_core = core_check(n, v, [out(p, 12) for p in phi]) if n <= MAX_CORE_PLAYERS else None
    notes = ['Coalitions not listed are worth 0.']
    superadditive = all(v.get(a | b, 0) >= v.get(a, 0) + v.get(b, 0) for a in range(1, full + 1) for b in range(1, full + 1) if not a & b) if n <= 8 else None
    if superadditive is False:
        notes.append('The game is not superadditive (some groups are worth less together than apart).')
    if n > MAX_CORE_PLAYERS:
        notes.append(f'The core is checked for up to {MAX_CORE_PLAYERS} players.')
    return {'players': names, 'shapley': [out(p) for p in phi], 'exact': [fraction_text(p) for p in phi], 'total': out(v[full]),
            'core': core, 'shapleyInCore': None if shap_core is None else shap_core.get('inCore'),
            'shapleyBlocking': None if shap_core is None else shap_core.get('blocking'), 'superadditive': superadditive, 'notes': notes}


def _hull_frontier(points):
    """The upper-right (Pareto) frontier of the convex hull of 2-D points, left to right."""
    pts = sorted(set(points))
    if len(pts) <= 1:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    upper.reverse()  # left to right along the upper hull
    # keep the part that slopes down (Pareto): from the highest point to the rightmost point
    top = max(range(len(upper)), key=lambda i: (upper[i][1], upper[i][0]))
    right = max(range(len(upper)), key=lambda i: (upper[i][0], upper[i][1]))
    return upper[top:right + 1]


def bargain(points, disagreement, power=None):
    """Nash bargaining: the feasible point (convex hull of `points`) above the disagreement point d that maximises
    (u1 - d1)^a (u2 - d2)^(1 - a); a = bargaining power of player 1 (0.5 = the symmetric Nash solution)."""
    if not isinstance(points, list) or len(points) < 1:
        raise GameError('Give the possible outcomes as [player 1 payoff, player 2 payoff] points')
    pts = []
    for p in points:
        if not isinstance(p, list) or len(p) != 2:
            raise GameError('Each outcome is [player 1 payoff, player 2 payoff]')
        pts.append((num(p[0]), num(p[1])))
    if not isinstance(disagreement, list) or len(disagreement) != 2:
        raise GameError('The disagreement point is [player 1 payoff, player 2 payoff]')
    d = (num(disagreement[0]), num(disagreement[1]))
    a = Fraction(1, 2) if power is None else num(power, 'bargaining power')
    if not 0 < a < 1:
        raise GameError('Bargaining power is between 0 and 1')
    frontier = _hull_frontier(pts)
    candidates = list(frontier)
    for P, Q in zip(frontier, frontier[1:]):
        da, db = Q[0] - P[0], Q[1] - P[1]
        if da == 0 or db == 0:
            continue
        t = -(a * da * (P[1] - d[1]) + (1 - a) * db * (P[0] - d[0])) / (da * db)
        if 0 < t < 1:
            candidates.append((P[0] + t * da, P[1] + t * db))
    good = [c for c in candidates if c[0] > d[0] and c[1] > d[1]]
    if not good:
        return {'solution': None, 'disagreement': [out(x) for x in d], 'power': out(a), 'frontier': [[out(x) for x in p] for p in frontier],
                'notes': ['No outcome is better than the disagreement point for both players, so there is no deal to make.']}
    af = float(a)
    best = max(good, key=lambda c: af * math.log(c[0] - d[0]) + (1 - af) * math.log(c[1] - d[1]))
    return {'solution': [out(x) for x in best], 'exact': [fraction_text(x) for x in best], 'disagreement': [out(x) for x in d], 'power': out(a),
            'gains': [out(best[0] - d[0]), out(best[1] - d[1])], 'frontier': [[out(x) for x in p] for p in frontier],
            'nashProduct': out((best[0] - d[0]) * (best[1] - d[1])) if a == Fraction(1, 2) else None, 'notes': []}


# ---------- handlers (also the AI's game.* tools) ----------

def _flag(value):
    return bool(value) and value not in ('0', 'false', 'no')


@handler('game.solve_normal')
async def h_solve_normal(ctx, msg):
    return solve_normal(msg.get('players'), msg.get('strategies'), msg.get('payoffs'), weak=_flag(msg.get('weak')),
                        welfare=msg.get('welfare'), mixed=msg.get('mixed', True) is not False)


@handler('game.solve_tree')
async def h_solve_tree(ctx, msg):
    return solve_tree(msg.get('tree'), msg.get('players'))


@handler('game.repeated')
async def h_repeated(ctx, msg):
    return repeated(msg.get('players'), msg.get('strategies'), msg.get('payoffs'), msg.get('cooperate'), msg.get('punish'), msg.get('delta'))


@handler('game.shapley')
async def h_shapley(ctx, msg):
    return shapley(msg.get('players'), msg.get('coalitions'), msg.get('allocation'))


@handler('game.bargain')
async def h_bargain(ctx, msg):
    return bargain(msg.get('points'), msg.get('disagreement'), msg.get('power'))


#: The parameters each request reads (checked by a test: none may be `id` or `type`).
PARAMS = {
    'game.solve_normal': ('players', 'strategies', 'payoffs', 'weak', 'welfare', 'mixed'),
    'game.solve_tree': ('tree', 'players'),
    'game.repeated': ('players', 'strategies', 'payoffs', 'cooperate', 'punish', 'delta'),
    'game.shapley': ('players', 'coalitions', 'allocation'),
    'game.bargain': ('points', 'disagreement', 'power'),
}


# ---------- one-line summaries (shown under Equilibrium-Prime answers) ----------

def _profile_text(labels):
    return '(' + ', '.join(labels) + ')'


def summary(name, result):
    """A short plain-text line of what a game.* request found, so every equilibrium claim in an answer is traceable."""
    if not isinstance(result, dict):
        return 'no result'
    if name == 'game.solve_normal':
        parts = []
        pure = result.get('pureNash') or []
        parts.append('pure NE: ' + ('; '.join(_profile_text(e['labels']) for e in pure) if pure else 'none'))
        mixed = [e for e in (result.get('mixedNash') or []) if not e.get('pure')]
        for e in mixed:
            probs = ' vs '.join('(' + ', '.join(p) + ')' for p in e['exact'])
            parts.append(f'mixed NE {probs}, payoffs {e["payoffs"]}')
        steps = (result.get('dominance') or {}).get('strict', {}).get('steps') or []
        if steps:
            parts.append('IESDS removes ' + ', '.join(s['label'] for s in steps))
        w = result.get('welfare')
        if w and w.get('priceOfAnarchy') is not None:
            parts.append(f'PoA {w["priceOfAnarchy"]}')
        if result.get('degenerate'):
            parts.append('degenerate game')
        return '; '.join(parts)
    if name == 'game.solve_tree':
        line = 'SPNE path: ' + ' → '.join(s['action'] for s in result.get('path') or []) + f', payoffs {result.get("payoffs")}'
        threats = result.get('nonCredibleThreats') or []
        if threats:
            line += '; non-credible: ' + ', '.join(f'{t["name"]} "{t["action"]}"' for t in threats)
        return line
    if name == 'game.repeated':
        need = result.get('threshold')
        return (f'grim trigger keeps {_profile_text(result.get("cooperateLabels") or [])} for δ ≥ {need}' if need is not None
                else f'grim trigger cannot keep {_profile_text(result.get("cooperateLabels") or [])}')
    if name == 'game.shapley':
        core = (result.get('core') or {}).get('nonEmpty')
        return (f'Shapley {dict(zip(result.get("players") or [], result.get("exact") or []))}; core '
                + ('empty' if core is False else 'non-empty' if core else 'not checked'))
    if name == 'game.bargain':
        sol = result.get('solution')
        return f'Nash bargaining solution {sol} from d = {result.get("disagreement")}' if sol else 'no mutually better deal'
    return 'done'
