# uses: base predictors bayes
# Minh Triết (the boss): Bayesian inference over many theories of how you play (habits,
# patterns, and whether you are countering it), then the best response.
predictors = [p_last(), p_freq(), p_freq(10), p_decay(0.8, 20), p_markov(False), p_markov(True)]
for which in ("opp", "joint"):
    predictors += [p_ngram(which, n) for n in range(1, 5)]
brain = BayesBrain(theories_from(predictors), forget=0.9, eps=0.15, noise=0.05)


def play(my_moves, opponent_moves):
    return brain(my_moves, opponent_moves)
