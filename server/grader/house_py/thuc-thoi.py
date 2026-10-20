# uses: base predictors meta
# Thức Thời: decay/window frequencies (fast and slow) with a second-guessing layer.
brain = MetaBrain([p_decay(0.85, 20), p_decay(0.6, 8)], decay=0.85, noise=0.05, mirror=False)


def play(my_moves, opponent_moves):
    return brain(my_moves, opponent_moves)
