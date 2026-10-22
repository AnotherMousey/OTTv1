# uses: base
# Mẫu Thiên Búa: plays rock 60% of the time, paper and scissors 20% each.


def play(my_moves, opponent_moves):
    return random.choices("RPS", weights=(3, 1, 1))[0]
