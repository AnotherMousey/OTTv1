class OutOfTime(Exception):
    pass


def ordered(cells, ms, me):
    # winning and capturing moves first, then the ones that get closer to the goal
    def key(m):
        if wins(cells, m, me):
            return -1000
        return (-100 if captures(cells, m) else 0) + (50 if suicide(cells, m) else 0) + dist(m[1], me)
    return sorted(ms, key=key)


def negamax(cells, me, depth, alpha, beta, deadline):
    # value of the position for the side to move (`me` = True: my pieces move)
    if deadline and time.time() > deadline:
        raise OutOfTime()
    if depth == 0:
        v = evaluate(cells)
        return v if me else -v
    ms = moves(cells, me)
    if not ms:
        if not any(c != "." and mine(c, me) for c in cells):
            return -WIN - depth
        return -negamax(cells, not me, depth - 1, -beta, -alpha, deadline)  # no legal move: the turn is skipped
    best = -WIN * 10
    for m in ordered(cells, ms, me):
        if wins(cells, m, me):
            return WIN + depth
        n = after(cells, m)
        if not any(c != "." and mine(c, not me) for c in n):
            return WIN + depth
        v = -negamax(n, not me, depth - 1, -beta, -alpha, deadline)
        if v > best:
            best = v
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break
    return best


def best_move(cells, depth, deadline=None):
    # the best of my moves, searching `depth` plies (ties broken at random)
    ms = moves(cells, True)
    for m in ms:
        if wins(cells, m, True):
            return m, WIN
    scored = []
    alpha = -WIN * 10
    for m in ordered(cells, ms, True):
        n = after(cells, m)
        v = -negamax(n, False, depth - 1, -WIN * 10, -alpha + 1, deadline)
        scored.append((v, m))
        alpha = max(alpha, v)
    top = max(v for v, _ in scored)
    return random.choice([m for v, m in scored if v == top]), top
