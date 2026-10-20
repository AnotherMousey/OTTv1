// The 10 built-in sparring bots, from easiest to hardest.
// Each entry has create() -> brain(myMoves, oppMoves) -> 'R' | 'P' | 'S'.
// Histories are strings, oldest first ("my" = the bot's own moves); the opponent's
// history may contain 'X' (a forfeited turn).
//
// Bots 1–5 follow their rules exactly (one move, a fixed cycle, random, copycat,
// win-stay/lose-shift). Bots 6–9 predict you with their own algorithm (frequency,
// decay/window, Markov chain, n-gram) and then "second-guess" how to use that
// prediction: counter it directly, or assume you anticipated that, and so on, by
// whichever has been winning lately. Bot 10 does Bayesian inference over many theories
// of how you play (including "you are second-guessing me") and best-responds.
const MOVES = ['R', 'P', 'S'];
const BEAT = { R: 'P', P: 'S', S: 'R' }; // move -> the move that beats it
const LOSE = { R: 'S', P: 'R', S: 'P' }; // move -> the move it beats

const rnd = () => MOVES[Math.floor(Math.random() * 3)];
const clean = s => s.replace(/[^RPS]/g, 'R');
const shift = (m, k) => MOVES[(MOVES.indexOf(m) + k) % 3];

function mostCommon(seq) {
  const c = { R: 0, P: 0, S: 0 };
  for (const m of seq) c[m]++;
  const best = Math.max(c.R, c.P, c.S);
  const ties = MOVES.filter(m => c[m] === best);
  return ties[Math.floor(Math.random() * ties.length)];
}

// ---------- predictors: (my, opp) -> predicted next move of `opp`, or null ----------
const P = {
  last: () => (my, opp) => opp[opp.length - 1] || null,
  freq: (window = Infinity) => (my, opp) => (opp.length ? mostCommon(opp.slice(-window)) : null),
  decay: (rate, window) => (my, opp) => {
    if (!opp.length) return null;
    const w = { R: 0, P: 0, S: 0 };
    let k = 1;
    for (let i = opp.length - 1; i >= Math.max(0, opp.length - window); i--) { w[opp[i]] += k; k *= rate; }
    return MOVES.reduce((a, b) => (w[b] > w[a] ? b : a));
  },
  // what opp did right after the last time `seq` ended the same way (most recent match)
  ngram: (which, len) => (my, opp) => {
    const n = opp.length;
    if (n <= len) return null;
    const seq = which === 'opp' ? opp : which === 'my' ? my : null;
    const tok = i => (seq ? seq[i] : my[i] + opp[i]);
    outer: for (let end = n - 1; end >= len; end--) {
      for (let k = 1; k <= len; k++) if (tok(end - k) !== tok(n - k)) continue outer;
      return opp[end];
    }
    return null;
  },
  // first-order Markov chain on opp's own moves / on the joint (my, opp) pair
  markov: joint => (my, opp) => {
    const n = opp.length;
    if (n < 2) return null;
    const key = i => (joint ? my[i] + opp[i] : opp[i]);
    const c = { R: 0, P: 0, S: 0 };
    let seen = 0;
    for (let i = 0; i < n - 1; i++) if (key(i) === key(n - 1)) { c[opp[i + 1]] += 1 + i / n; seen++; }
    return seen ? MOVES.reduce((a, b) => (c[b] > c[a] ? b : a)) : null;
  },
};

// ---------- the meta layer ----------
// For every predictor we build 6 candidate moves:
//   a) predictor applied to the opponent -> counter it, plus the 2 "rotations"
//      (opponent anticipated that, opponent anticipated our anticipation, ...)
//   b) predictor applied to OURSELVES (what would the opponent predict about us?) -> the
//      opponent will counter that, so we counter their counter, plus rotations.
// Each candidate's recent record is scored with decay; we play the best one.
// The only randomness: with probability `noise` a bot plays a random move instead.
function metaBrain(predictors, { decay = 0.9, noise = 0.05, randomWhenLosing = false, mirror = true, rotations = 3 } = {}) {
  let scores = null, lastCands = null, seen = 0;
  return (myRaw, oppRaw) => {
    const my = clean(myRaw), opp = clean(oppRaw);
    // score last turn's candidates against what the opponent actually played
    if (lastCands && opp.length > seen) {
      const actual = opp[opp.length - 1];
      lastCands.forEach((c, i) => {
        scores[i] *= decay;
        if (c === BEAT[actual]) scores[i] += 1; else if (c === LOSE[actual]) scores[i] -= 1;
      });
    }
    seen = opp.length;
    const cands = [];
    for (const p of predictors) {
      const them = p(my, opp) || rnd();
      for (let k = 0; k < rotations; k++) cands.push(shift(BEAT[them], k));
      if (mirror) {
        const me = p(opp, my) || rnd();                // what the opponent would predict about us
        for (let k = 0; k < rotations; k++) cands.push(shift(BEAT[BEAT[me]], k));
      }
    }
    if (!scores) scores = new Array(cands.length).fill(0);
    lastCands = cands;
    if (!opp.length || Math.random() < noise) return rnd();
    let best = 0;
    for (let i = 1; i < cands.length; i++) if (scores[i] > scores[best]) best = i;
    if (randomWhenLosing && scores[best] <= 0.5) return rnd(); // being out-thought: go unpredictable
    return cands[best];
  };
}

// Bayesian inference: every theory predicts the opponent's next move (or null = "no idea",
// i.e. uniform). A theory that predicted move m gives the actual move probability 1-eps if it
// was m, eps/2 otherwise. Posterior ∝ prior × likelihood, with old evidence slowly forgotten.
// We then play the best response (win 3, draw 1) to the posterior-predictive distribution.
function bayesBrain(theories, { forget = 0.9, eps = 0.15, noise = 0.05 } = {}) {
  let logw = null, lastPreds = null, seen = 0;
  return (myRaw, oppRaw) => {
    const my = clean(myRaw), opp = clean(oppRaw);
    if (lastPreds && opp.length > seen) {
      const actual = opp[opp.length - 1];
      lastPreds.forEach((p, i) => {
        const lik = p === null ? 1 / 3 : p === actual ? 1 - eps : eps / 2;
        logw[i] = forget * logw[i] + Math.log(lik);
      });
    }
    seen = opp.length;
    const preds = theories.map(t => t(my, opp));
    if (!logw) logw = new Array(preds.length).fill(0);
    lastPreds = preds;
    if (!opp.length || Math.random() < noise) return rnd();
    const top = Math.max(...logw);
    const dist = { R: 0, P: 0, S: 0 };
    preds.forEach((p, i) => {
      const w = Math.exp(logw[i] - top);
      for (const m of MOVES) dist[m] += w * (p === null ? 1 / 3 : p === m ? 1 - eps : eps / 2);
    });
    const ev = m => 3 * dist[LOSE[m]] + dist[m];
    return MOVES.reduce((a, b) => (ev(b) > ev(a) ? b : a));
  };
}

// Theories for the Bayesian bot: for each predictor, "you play what it predicts", "you play
// what beats that", "you play what beats *that*", plus the same three built from what YOU
// would predict about ME (i.e. you are countering my habits). And one "you are random" theory.
function theoriesFrom(predictors) {
  const out = [() => null];
  for (const p of predictors) {
    for (let k = 0; k < 3; k++) out.push((my, opp) => { const x = p(my, opp); return x ? shift(x, k) : null; });
    for (let k = 0; k < 3; k++) out.push((my, opp) => { const me = p(opp, my); return me ? shift(BEAT[me], k) : null; });
  }
  return out;
}

const HOUSE_BOTS = [
  {
    id: 'nhat-chieu-doat-menh',
    name: 'Kiên Định',
    desc: 'Picks one move (rock, paper or scissors) and plays it all game.',
    create() {
      const fixed = rnd();
      return () => fixed;
    },
  },
  {
    id: 'luan-hoi',
    name: 'Luân Hồi',
    desc: 'Cycles rock → paper → scissors forever.',
    create() {
      return my => MOVES[my.length % 3];
    },
  },
  {
    id: 'vo-chieu',
    name: 'Vô Chiêu',
    desc: 'Plays a uniformly random move every turn.',
    create() {
      return () => rnd();
    },
  },
  {
    id: 'tam-ma',
    name: 'Tâm Ma',
    desc: 'Copies your previous move. First move is random.',
    create() {
      return (my, opp) => {
        const last = opp[opp.length - 1];
        return last === 'R' || last === 'P' || last === 'S' ? last : rnd();
      };
    },
  },
  {
    id: 'tuy-duyen',
    name: 'Tùy Duyên',
    desc: 'Win-stay, lose-shift: keeps its move after a win, otherwise switches to one of the other two at random. First move is random.',
    create() {
      return (my, opp) => {
        const mine = my[my.length - 1], theirs = opp[opp.length - 1];
        if (!mine) return rnd();
        const won = !'RPS'.includes(theirs) || LOSE[mine] === theirs;
        if (won) return mine;
        const others = MOVES.filter(m => m !== mine);
        return others[Math.floor(Math.random() * 2)];
      };
    },
  },
  {
    id: 'lieu-dich',
    name: 'Liệu Địch',
    desc: 'Frequency analysis (whole game and last 12 turns) with a second-guessing layer.',
    create() {
      return metaBrain([P.freq(), P.freq(12)], { decay: 0.85, noise: 0.05 });
    },
  },
  {
    id: 'thuc-thoi',
    name: 'Thức Thời',
    desc: 'Decay/window frequencies (fast and slow) with a second-guessing layer.',
    create() {
      return metaBrain([P.decay(0.85, 20), P.decay(0.6, 8)], { decay: 0.85, noise: 0.05, mirror: false });
    },
  },
  {
    id: 'thien-co',
    name: 'Thiên Cơ',
    desc: 'Markov chains on your moves and on both players\' moves, with a second-guessing layer.',
    create() {
      return metaBrain([P.markov(false), P.markov(true)], { decay: 0.92, noise: 0.05, mirror: false });
    },
  },
  {
    id: 'muu-luoc',
    name: 'Mưu Lược',
    desc: "N-gram history matching (your moves and both players' moves), always backing whichever pattern has been right lately.",
    create() {
      const preds = [];
      for (let len = 1; len <= 3; len++) preds.push(P.ngram('opp', len));
      for (let len = 1; len <= 2; len++) preds.push(P.ngram('joint', len));
      return metaBrain(preds, { decay: 0.9, noise: 0.05, mirror: true, rotations: 1 });
    },
  },
  {
    id: 'minh-triet',
    name: 'Minh Triết',
    desc: 'The boss: Bayesian inference over many theories of how you play (habits, patterns, and whether you are countering it), then the best response.',
    create() {
      const preds = [P.last(), P.freq(), P.freq(10), P.decay(0.8, 20), P.markov(false), P.markov(true)];
      for (const which of ['opp', 'joint']) for (let len = 1; len <= 4; len++) preds.push(P.ngram(which, len));
      return bayesBrain(theoriesFrom(preds), { forget: 0.9, eps: 0.15, noise: 0.05 });
    },
  },
];

// ---------- Python versions ----------
// Each built-in bot also exists as a Python bot (house_py/<id>.py) with the same behaviour.
// The judge sees and edits that version; an edited copy then plays instead of the JS one in
// that tournament. A bot file starts with "# uses: base predictors ..." naming the shared
// pieces (house_py/_<piece>.py) it needs; they are pasted in so the result stands alone.
const fs = require('fs');
const path = require('path');
const PY_DIR = path.join(__dirname, 'house_py');
const piece = name => fs.readFileSync(path.join(PY_DIR, `_${name}.py`), 'utf8').trim();

function pythonSource(id) {
  const bot = HOUSE_BOTS.find(h => h.id === id);
  if (!bot) return null;
  const src = fs.readFileSync(path.join(PY_DIR, `${id}.py`), 'utf8').replace(/\r\n/g, '\n');
  const [first, ...rest] = src.split('\n');
  const uses = (first.match(/^# uses:(.*)$/) || [, ''])[1].trim().split(/\s+/).filter(Boolean);
  const head = `# Sparring bot "${bot.name}": Python version of the built-in bot.\n` +
    '# Same interface as a player bot: play(my_moves, opponent_moves) -> "R" | "P" | "S".\n' +
    '# my_moves / opponent_moves: lists of the previous turns, oldest first (may contain "X").\n' +
    '# The process lives for one game (100 turns), so module-level state is per game.';
  return [head, ...uses.map(piece), rest.join('\n').trim()].join('\n\n\n') + '\n';
}

module.exports = { HOUSE_BOTS, pythonSource };
