# uses: base predictors meta
# Thiên Cơ: Markov chains on your moves and on both players' moves, with a second-guessing layer.
brain = MetaBrain([p_markov(False), p_markov(True)], decay=0.92, noise=0.05, mirror=False)


def play(my_moves, opponent_moves):
    return brain(my_moves, opponent_moves)
