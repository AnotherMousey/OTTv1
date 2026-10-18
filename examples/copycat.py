# Copies whatever the opponent did last turn.
def play(my_moves, opponent_moves):
    if not opponent_moves or opponent_moves[-1] not in "RPS":
        return "P"
    return opponent_moves[-1]
