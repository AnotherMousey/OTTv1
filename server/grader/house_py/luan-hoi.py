# uses: base
# Luân Hồi: cycles rock -> paper -> scissors forever.


def play(my_moves, opponent_moves):
    return MOVES[len(my_moves) % 3]
