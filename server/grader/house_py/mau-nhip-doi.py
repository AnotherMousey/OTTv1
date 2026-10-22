# uses: base
# Mẫu Nhịp Đôi: plays each move twice, R R P P S S, over and over.


def play(my_moves, opponent_moves):
    return "RRPPSS"[len(my_moves) % 6]
