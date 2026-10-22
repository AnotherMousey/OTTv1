# uses: board search
# Tính Toán: minimax two moves deep (its move, then your best reply), with the same
# evaluation as Thận Trọng. It never misses a win in one and sees most one-move threats.


def play(board, turn, max_turns):
    cells = setup(board)
    if not moves(cells):
        return (0, 0, 0, 0)
    m, _ = best_move(cells, 2)
    return to_move(m)
