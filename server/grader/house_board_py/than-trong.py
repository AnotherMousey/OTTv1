# uses: board
# Thận Trọng: looks one move ahead. It scores every move with a position evaluation
# (pieces left, which kinds the enemy can no longer stop, distance to the goals), then
# checks your immediate answers: it won't leave you a winning move or a free capture.


def play(board, turn, max_turns):
    cells = setup(board)
    ms = moves(cells)
    if not ms:
        return (0, 0, 0, 0)
    for m in ms:
        if wins(cells, m):
            return to_move(m)

    def score(m):
        n = after(cells, m)
        s = evaluate(n)
        replies = moves(n, False)
        if any(wins(n, e, False) for e in replies):
            return s - WIN
        if any(captures(n, e) for e in replies):
            s -= 100
        return s

    scored = [(score(m), m) for m in ms]
    top = max(s for s, _ in scored)
    return to_move(pick([m for s, m in scored if s == top]))
