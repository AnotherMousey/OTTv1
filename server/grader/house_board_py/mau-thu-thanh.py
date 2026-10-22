# uses: board
# Mẫu Thủ Thành: stays home. It captures any enemy piece it can (and takes a free win if one
# appears), otherwise shuffles its pieces around inside its first three rows.


def play(board, turn, max_turns):
    cells = setup(board)
    ms = moves(cells)
    if not ms:
        return (0, 0, 0, 0)
    for m in ms:
        if wins(cells, m):
            return to_move(m)
    caps = [m for m in ms if captures(cells, m)]
    if caps:
        return to_move(pick(caps))
    home = [m for m in ms if xy(m[1])[1] < 3 and not suicide(cells, m)]
    return to_move(pick(home or ms))
