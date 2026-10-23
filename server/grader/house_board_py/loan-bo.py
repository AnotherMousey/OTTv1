# uses: board
# Loạn Bộ: plays a random legal move every turn, even ones that throw a piece away.


def play(gameState):
    cells = setup(gameState)
    m = pick(moves(cells))
    return to_move(m) if m else (0, 0)
