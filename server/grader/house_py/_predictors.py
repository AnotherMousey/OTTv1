# ---------- predictors: (my, opp) -> predicted next move of `opp`, or None ----------
# `my` and `opp` are strings of the moves so far, oldest first.


def most_common(seq):
    counts = {"R": 0, "P": 0, "S": 0}
    for m in seq:
        counts[m] += 1
    top = max(counts.values())
    return random.choice([m for m in MOVES if counts[m] == top])


def p_last():
    def predict(my, opp):
        return opp[-1] if opp else None
    return predict


def p_freq(window=None):
    # most frequent move over the whole game, or over the last `window` turns
    def predict(my, opp):
        if not opp:
            return None
        return most_common(opp if window is None else opp[-window:])
    return predict


def p_decay(rate, window):
    # recent moves count more: weights 1, rate, rate^2, ... over the last `window` turns
    def predict(my, opp):
        if not opp:
            return None
        weights = {"R": 0.0, "P": 0.0, "S": 0.0}
        k = 1.0
        for i in range(len(opp) - 1, max(0, len(opp) - window) - 1, -1):
            weights[opp[i]] += k
            k *= rate
        return best_of(weights)
    return predict


def p_ngram(which, length):
    # what opp did right after the last time the history ended the same way
    # (which = "opp": opp's moves, "my": my moves, "joint": both together)
    def predict(my, opp):
        n = len(opp)
        if n <= length:
            return None
        if which == "opp":
            tok = lambda i: opp[i]
        elif which == "my":
            tok = lambda i: my[i]
        else:
            tok = lambda i: my[i] + opp[i]
        for end in range(n - 1, length - 1, -1):
            if all(tok(end - k) == tok(n - k) for k in range(1, length + 1)):
                return opp[end]
        return None
    return predict


def p_markov(joint):
    # first-order Markov chain on opp's own moves (or on the (my, opp) pair);
    # later observations weigh a little more
    def predict(my, opp):
        n = len(opp)
        if n < 2:
            return None
        key = (lambda i: my[i] + opp[i]) if joint else (lambda i: opp[i])
        counts = {"R": 0.0, "P": 0.0, "S": 0.0}
        seen = 0
        last = key(n - 1)
        for i in range(n - 1):
            if key(i) == last:
                counts[opp[i + 1]] += 1 + i / n
                seen += 1
        return best_of(counts) if seen else None
    return predict
