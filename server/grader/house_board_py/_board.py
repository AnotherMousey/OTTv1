import random
import time

# The game state (gameState.ally / .opponent: pieces with .pid .Type .x .y, x and y from 1) is turned
# into a flat board `cells`: cell i = (x, y) counted from 0, i = y * W + x, "R" "P" "S" = mine, "r" "p" "s" = enemy,
# "." = empty, "#" = a wall (the map's: no piece can enter it). The board is W x H (gameState.width /
# .height, 9 x 9 by default). I start bottom-left and win on the top-right corner; the enemy wins on (0, 0).
# A move is (from cell, to cell); to_move turns it into the answer (pid, direction).
BEATS = {"R": "S", "S": "P", "P": "R"}     # kind -> the kind it captures
BEATEN_BY = {"S": "R", "P": "S", "R": "P"}  # kind -> the kind that captures it
WIN = 100000
W = H = 9
NEIGH = []  # cell -> the cells next to it (8 directions), for a W x H board: see resize
PID = {}  # cell -> the pid of my piece on it
# (dx, dy) -> direction number of the answer
DIRECTION = {(-1, 1): 1, (0, 1): 2, (1, 1): 3, (1, 0): 4, (1, -1): 5, (0, -1): 6, (-1, -1): 7, (-1, 0): 8}


def resize(width, height):
    global W, H, NEIGH
    W, H = width, height
    NEIGH = [[(x + dx) + (y + dy) * W
              for dx in (-1, 0, 1) for dy in (-1, 0, 1)
              if (dx or dy) and 0 <= x + dx < W and 0 <= y + dy < H]
             for y in range(H) for x in range(W)]
    PATHS.clear()  # distances belong to a board size


def setup(state):
    if not NEIGH or (state.width, state.height) != (W, H):
        resize(state.width, state.height)
    cells = ["."] * (W * H)
    PID.clear()
    for p in state.ally:
        cells[(p.y - 1) * W + p.x - 1] = p.Type
        PID[(p.y - 1) * W + p.x - 1] = p.pid
    for p in state.opponent:
        cells[(p.y - 1) * W + p.x - 1] = p.Type.lower()
    for w in state.walls:
        cells[(w.y - 1) * W + w.x - 1] = "#"
    walls = frozenset(i for i, c in enumerate(cells) if c == "#")
    if PATHS.get("walls") != walls:
        measure(walls)
    return cells


# Distances count real steps around the walls (a piece moves one square in 8 directions), not a
# straight line. They only change with the walls, so they are worked out once per game:
#   PATHS[True] / PATHS[False] = steps from every cell to my goal / the enemy's goal,
#   PATHS["far"][me] = one more than the longest of those: what a walled-in cell counts as.
PATHS = {}


def flood(start, walls):
    # steps from `start` to every cell (None = no way there)
    d = [None] * (W * H)
    d[start] = 0
    queue = [start]
    for i in queue:
        for j in NEIGH[i]:
            if d[j] is None and j not in walls:
                d[j] = d[i] + 1
                queue.append(j)
    return d


def measure(walls):
    PATHS.clear()
    PATHS["walls"] = walls
    PATHS["far"] = {}
    PATHS["from"] = {}  # cell -> flood from it, filled in as steps() needs them
    for me in (True, False):
        d = flood(goal(me), walls)
        far = max(v for v in d if v is not None) + 1
        PATHS[me] = [far if v is None else v for v in d]
        PATHS["far"][me] = far


def steps(a, b):
    # steps from cell a to cell b around the walls (99 = no way through)
    if a not in PATHS["from"]:
        PATHS["from"][a] = flood(a, PATHS["walls"])
    d = PATHS["from"][a][b]
    return 99 if d is None else d


def mine(c, me=True):
    return c.isupper() if me else c.islower()


def goal(me=True):
    return W * H - 1 if me else 0


def xy(i):
    return i % W, i // W


def to_move(m):
    (x1, y1), (x2, y2) = xy(m[0]), xy(m[1])
    return (PID[m[0]], DIRECTION[(x2 - x1, y2 - y1)])


def dist(i, me=True):
    # steps from cell i to the goal (mine, or the enemy's), around the walls
    return PATHS[me][i]


def moves(cells, me=True):
    out = []
    for i, c in enumerate(cells):
        if c == "." or not mine(c, me):
            continue
        for j in NEIGH[i]:
            t = cells[j]
            if t == "." or (t != "#" and not mine(t, me) and t.upper() != c.upper()):
                out.append((i, j))
    return out


def after(cells, m):
    # the board after move m (the attacker is lost if the defender beats it)
    i, j = m
    c, t = cells[i], cells[j]
    n = cells[:]
    n[i] = "."
    if t == "." or BEATS[c.upper()] == t.upper():
        n[j] = c
    return n


def captures(cells, m):
    t = cells[m[1]]
    return t != "." and BEATS[cells[m[0]].upper()] == t.upper()


def suicide(cells, m):
    t = cells[m[1]]
    return t != "." and BEATS[t.upper()] == cells[m[0]].upper()


def wins(cells, m, me=True):
    return m[1] == goal(me) and not suicide(cells, m)


def threatened(cells, j, me=True):
    # can an enemy piece next to cell j capture the piece standing there?
    c = cells[j]
    for k in NEIGH[j]:
        t = cells[k]
        if t not in ".#" and not mine(t, me) and BEATS[t.upper()] == c.upper():
            return True
    return False


def evaluate(cells):
    # from my point of view
    have, foe = {"R": 0, "P": 0, "S": 0}, {"R": 0, "P": 0, "S": 0}
    near_me = near_foe = 99
    sum_me = sum_foe = 0
    adv_me = adv_foe = 0  # progress, growing faster the closer a piece gets (a walled-in piece: none)
    for i, c in enumerate(cells):
        if c in ".#":
            continue
        if c.isupper():
            have[c] += 1
            d = dist(i, True)
            near_me = min(near_me, d)
            sum_me += d
            adv_me += (PATHS["far"][True] - d) ** 2
        else:
            foe[c.upper()] += 1
            d = dist(i, False)
            near_foe = min(near_foe, d)
            sum_foe += d
            adv_foe += (PATHS["far"][False] - d) ** 2
    n_me, n_foe = sum(have.values()), sum(foe.values())
    if n_foe == 0:
        return WIN
    if n_me == 0:
        return -WIN
    score = 100 * (n_me - n_foe)
    for k in "RPS":
        # a kind the other side can no longer capture is hard to stop
        if have[k] and foe[BEATEN_BY[k]] == 0:
            score += 40 + 10 * have[k]
        if foe[k] and have[BEATEN_BY[k]] == 0:
            score -= 40 + 10 * foe[k]
    score += 30 * (near_foe - near_me)
    score += 2 * (sum_foe / n_foe - sum_me / n_me)
    score += (adv_me - adv_foe) / 2
    return score


def pick(options):
    return random.choice(options) if options else None
