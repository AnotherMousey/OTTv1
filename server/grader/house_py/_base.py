import math
import random

MOVES = "RPS"
BEAT = {"R": "P", "P": "S", "S": "R"}  # move -> the move that beats it
LOSE = {"R": "S", "P": "R", "S": "P"}  # move -> the move it beats


def rnd():
    return random.choice(MOVES)


def clean(seq):
    # a forfeited turn ('X') is treated as rock
    return "".join(m if m in "RPS" else "R" for m in seq)


def shift(move, k):
    return MOVES[(MOVES.index(move) + k) % 3]


def best_of(scores):
    # the move with the highest score; ties go to the earliest of R, P, S
    best = "R"
    for m in "PS":
        if scores[m] > scores[best]:
            best = m
    return best
