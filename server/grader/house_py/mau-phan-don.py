# uses: base
# Mẫu Phản Đòn: beats your most frequent move of your last 5 (random on turn 1).


def play(my_moves, opponent_moves):
    recent = clean(opponent_moves[-5:])
    if not recent:
        return rnd()
    return BEAT[best_of({m: recent.count(m) for m in MOVES})]
