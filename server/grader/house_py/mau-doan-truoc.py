# uses: base
# Mẫu Đoán Trước: assumes you will play whatever beats its own last move, and beats that.


def play(my_moves, opponent_moves):
    if not my_moves:
        return rnd()
    last = clean(my_moves[-1:])
    return BEAT[BEAT[last]]
