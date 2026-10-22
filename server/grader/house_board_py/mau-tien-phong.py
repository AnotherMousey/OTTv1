# uses: board
# Mẫu Tiên Phong: sends one piece at a time toward your corner. The piece already closest to
# the goal keeps going (around blockers, never into a piece that beats it); the rest wait.


def play(board, turn, max_turns):
    cells = setup(board)
    ms = moves(cells)
    if not ms:
        return (0, 0, 0, 0)
    for m in ms:
        if wins(cells, m):
            return to_move(m)
    ok = [m for m in ms if not suicide(cells, m)] or ms
    lead = min(dist(m[0]) for m in ok)
    mine = [m for m in ok if dist(m[0]) == lead]
    best = min(dist(m[1]) for m in mine)
    return to_move(pick([m for m in mine if dist(m[1]) == best]))
