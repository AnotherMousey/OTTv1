# uses: board search
# Thấu Suốt: the boss. Alpha-beta search with iterative deepening: it searches 2, 3, 4, ...
# moves ahead until its thinking time (0.3 s per move) runs out, and plays the best move of
# the deepest search it finished.
THINK = 0.3


def play(board, turn, max_turns):
    cells = setup(board)
    if not moves(cells):
        return (0, 0, 0, 0)
    deadline = time.time() + THINK
    m, _ = best_move(cells, 2)
    depth = 3
    while depth <= 8:
        try:
            m, v = best_move(cells, depth, deadline)
        except OutOfTime:
            break
        if abs(v) >= WIN:
            break  # a forced win (or loss) is already in sight
        depth += 1
    return to_move(m)
