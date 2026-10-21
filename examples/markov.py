# Learns what the opponent tends to play after each of their moves.
import random


def play(my_moves, opponent_moves):
    BEATS = {"R": "P", "P": "S", "S": "R"}
    if len(opponent_moves) < 2:
        return random.choice("RPS")
    after = {}
    for prev, nxt in zip(opponent_moves, opponent_moves[1:]):
        seen = after.setdefault(prev, {})
        seen[nxt] = seen.get(nxt, 0) + 1
    seen = after.get(opponent_moves[-1])
    if not seen:
        return random.choice("RPS")
    guess = max(seen, key=seen.get)
    return BEATS.get(guess, "R")
