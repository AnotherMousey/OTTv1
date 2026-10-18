# Learns what the opponent tends to play after each of their moves.
import random
from collections import Counter, defaultdict

BEATS = {"R": "P", "P": "S", "S": "R"}

def play(my_moves, opponent_moves):
    if len(opponent_moves) < 2:
        return random.choice("RPS")
    after = defaultdict(Counter)
    for prev, nxt in zip(opponent_moves, opponent_moves[1:]):
        after[prev][nxt] += 1
    seen = after[opponent_moves[-1]]
    if not seen:
        return random.choice("RPS")
    guess = seen.most_common(1)[0][0]
    return BEATS.get(guess, "R")
