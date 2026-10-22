# uses: board
# Mẫu Bầy Đàn: advances as a group. It takes a capture when it has one, otherwise moves its
# rearmost piece (the one farthest from the goal) a step forward.


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
        return to_move(pick(caps))
    forward = [m for m in ms if dist(m[1]) < dist(m[0]) and not suicide(cells, m)]
    if not forward:
        return to_move(pick([m for m in ms if not suicide(cells, m)] or ms))
    last = max(dist(m[0]) for m in forward)
    return to_move(pick([m for m in forward if dist(m[0]) == last]))
