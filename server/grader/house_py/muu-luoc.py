# uses: base predictors meta
# Mưu Lược: n-gram history matching (your moves and both players' moves), always backing
# whichever pattern has been right lately.
predictors = [p_ngram("opp", n) for n in range(1, 4)] + [p_ngram("joint", n) for n in range(1, 3)]
brain = MetaBrain(predictors, decay=0.9, noise=0.05, mirror=True, rotations=1)


def play(my_moves, opponent_moves):
    return brain(my_moves, opponent_moves)
