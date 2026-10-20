# uses: base
# Tùy Duyên: win-stay, lose-shift. Keeps its move after a win, otherwise switches to one
# of the other two at random. First move is random.


def play(my_moves, opponent_moves):
    if not my_moves:
        return rnd()
    mine, theirs = my_moves[-1], opponent_moves[-1]
    won = theirs not in "RPS" or LOSE[mine] == theirs
    if won:
        return mine
    return random.choice([m for m in MOVES if m != mine])
