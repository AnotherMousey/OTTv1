# uses: base predictors meta
# Liệu Địch: frequency analysis (whole game and last 12 turns) with a second-guessing layer.
brain = MetaBrain([p_freq(), p_freq(12)], decay=0.85, noise=0.05)


def play(my_moves, opponent_moves):
    return brain(my_moves, opponent_moves)
