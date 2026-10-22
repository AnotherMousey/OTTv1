# uses: board search
# Mẫu Chiến Thuật: minimax two moves deep (its move, then your best reply), the same strength
# as the sparring bot Tính Toán.


def play(board, turn, max_turns):
    cells = setup(board)
    if not moves(cells):
        return (0, 0, 0, 0)
    m, _ = best_move(cells, 2)
    return to_move(m)
