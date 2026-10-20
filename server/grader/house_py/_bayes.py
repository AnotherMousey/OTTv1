# ---------- Bayesian inference ----------
# Every theory predicts the opponent's next move (or None = "no idea", i.e. uniform). A theory
# that predicted move m gives the actual move probability 1-eps if it was m, eps/2 otherwise.
# Posterior ~ prior x likelihood, with old evidence slowly forgotten. We then play the best
# response (win 3, draw 1) to the posterior-predictive distribution.
class BayesBrain:
    def __init__(self, theories, forget=0.9, eps=0.15, noise=0.05):
        self.theories = theories
        self.forget = forget
        self.eps = eps
        self.noise = noise
        self.logw = None
        self.last_preds = None
        self.seen = 0

    def prob(self, pred, move):
        if pred is None:
            return 1 / 3
        return 1 - self.eps if pred == move else self.eps / 2

    def __call__(self, my_moves, opponent_moves):
        my, opp = clean(my_moves), clean(opponent_moves)
        if self.last_preds is not None and len(opp) > self.seen:
            actual = opp[-1]
            for i, p in enumerate(self.last_preds):
                self.logw[i] = self.forget * self.logw[i] + math.log(self.prob(p, actual))
        self.seen = len(opp)
        preds = [t(my, opp) for t in self.theories]
        if self.logw is None:
            self.logw = [0.0] * len(preds)
        self.last_preds = preds
        if not opp or random.random() < self.noise:
            return rnd()
        top = max(self.logw)
        dist = {"R": 0.0, "P": 0.0, "S": 0.0}
        for i, p in enumerate(preds):
            w = math.exp(self.logw[i] - top)
            for m in MOVES:
                dist[m] += w * self.prob(p, m)
        expected = {m: 3 * dist[LOSE[m]] + dist[m] for m in MOVES}
        return best_of(expected)


# Theories for the Bayesian bot: for each predictor, "you play what it predicts", "you play
# what beats that", "you play what beats *that*", plus the same three built from what YOU
# would predict about ME (i.e. you are countering my habits). And one "you are random" theory.
def theories_from(predictors):
    def plays(p, k):
        def theory(my, opp):
            x = p(my, opp)
            return shift(x, k) if x else None
        return theory

    def counters(p, k):
        def theory(my, opp):
            me = p(opp, my)
            return shift(BEAT[me], k) if me else None
        return theory

    out = [lambda my, opp: None]
    for p in predictors:
        out += [plays(p, k) for k in range(3)]
        out += [counters(p, k) for k in range(3)]
    return out
