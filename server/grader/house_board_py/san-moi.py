# uses: board
# Săn Mồi: a hunter. Captures whenever it can (safe captures first). Otherwise it walks a
# piece toward the nearest enemy it beats, avoiding squares where it would be captured,
# and only then heads for the goal.


def play(board, turn, max_turns):
    cells = setup(board)
    ms = moves(cells)
    if not ms:
        return (0, 0, 0, 0)
    for m in ms:
        if wins(cells, m):
            return to_move(m)
    caps = [m for m in ms if captures(cells, m)]
    if caps:
        safe = [m for m in caps if not threatened(after(cells, m), m[1])]
        return to_move(pick(safe or caps))
    ok = [m for m in ms if not suicide(cells, m) and not threatened(after(cells, m), m[1])] or ms

    def prey_distance(m):
        kind = cells[m[0]]
        x, y = xy(m[1])
        d = [max(abs(x - xy(k)[0]), abs(y - xy(k)[1])) for k, t in enumerate(cells)
             if t != "." and t.islower() and BEATS[kind] == t.upper()]
        return min(d) if d else 99

    best = min((prey_distance(m), dist(m[1])) for m in ok)
    return to_move(pick([m for m in ok if (prey_distance(m), dist(m[1])) == best]))
