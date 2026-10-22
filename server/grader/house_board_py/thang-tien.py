# uses: board
# Thẳng Tiến: races for the enemy's corner. Every turn it makes the step that gets one of its
# pieces as close to the goal as possible, ignoring danger (it only refuses to walk into a
# piece that beats it).


def play(board, turn, max_turns):
    cells = setup(board)
    ms = [m for m in moves(cells) if not suicide(cells, m)] or moves(cells)
    if not ms:
        return (0, 0, 0, 0)
    for m in ms:
        if wins(cells, m):
            return to_move(m)
    # closest destination first; among those, the move that gains the most ground
    best = min((dist(m[1]), dist(m[1]) - dist(m[0])) for m in ms)
    return to_move(pick([m for m in ms if (dist(m[1]), dist(m[1]) - dist(m[0])) == best]))
