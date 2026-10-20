# ---------- the meta layer ----------
# For every predictor we build candidate moves:
#   a) predictor applied to the opponent -> counter it, plus the "rotations"
#      (opponent anticipated that, opponent anticipated our anticipation, ...)
#   b) (mirror) predictor applied to OURSELVES (what would the opponent predict about us?)
#      -> the opponent will counter that, so we counter their counter, plus rotations.
# Each candidate's recent record is scored with decay; we play the best one.
# The only randomness: with probability `noise` the bot plays a random move instead.
class MetaBrain:
    def __init__(self, predictors, decay=0.9, noise=0.05, random_when_losing=False, mirror=True, rotations=3):
        self.predictors = predictors
        self.decay = decay
        self.noise = noise
        self.random_when_losing = random_when_losing
        self.mirror = mirror
        self.rotations = rotations
        self.scores = None
        self.last_cands = None
        self.seen = 0

    def __call__(self, my_moves, opponent_moves):
        my, opp = clean(my_moves), clean(opponent_moves)
        # score last turn's candidates against what the opponent actually played
        if self.last_cands is not None and len(opp) > self.seen:
            actual = opp[-1]
            for i, c in enumerate(self.last_cands):
                self.scores[i] *= self.decay
                if c == BEAT[actual]:
                    self.scores[i] += 1
                elif c == LOSE[actual]:
                    self.scores[i] -= 1
        self.seen = len(opp)
        cands = []
        for p in self.predictors:
            them = p(my, opp) or rnd()
            for k in range(self.rotations):
                cands.append(shift(BEAT[them], k))
            if self.mirror:
                me = p(opp, my) or rnd()  # what the opponent would predict about us
                for k in range(self.rotations):
                    cands.append(shift(BEAT[BEAT[me]], k))
        if self.scores is None:
            self.scores = [0.0] * len(cands)
        self.last_cands = cands
        if not opp or random.random() < self.noise:
            return rnd()
        best = 0
        for i in range(1, len(cands)):
            if self.scores[i] > self.scores[best]:
                best = i
        if self.random_when_losing and self.scores[best] <= 0.5:
            return rnd()  # being out-thought: go unpredictable
        return cands[best]
