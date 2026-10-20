# uses: base
# Tâm Ma: copies your previous move. First move is random.


def play(my_moves, opponent_moves):
    last = opponent_moves[-1] if opponent_moves else None
    return last if last in ("R", "P", "S") else rnd()
