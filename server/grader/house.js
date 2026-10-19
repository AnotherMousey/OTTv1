// The 10 built-in sparring bots used for practice evaluations.
// Each entry has create() -> brain(myMoves, oppMoves) -> 'R' | 'P' | 'S'.
// Histories are strings, oldest first; the opponent's history may contain 'X'
// (a forfeited turn), which every bot treats as "no information".
const MOVES = ['R', 'P', 'S'];
const COUNTER = { R: 'P', P: 'S', S: 'R' }; // move -> the move that beats it
const BEATS = { R: 'S', P: 'R', S: 'P' };   // move -> the move it beats

const rnd = () => MOVES[Math.floor(Math.random() * 3)];
const valid = m => m === 'R' || m === 'P' || m === 'S';

// Pick the key with the highest weight, breaking ties at random.
function argmax(weights) {
  let best = -Infinity, picks = [];
  for (const m of MOVES) {
    const w = weights[m] || 0;
    if (w > best + 1e-12) { best = w; picks = [m]; } else if (Math.abs(w - best) <= 1e-12) picks.push(m);
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

// Given a probability distribution over the opponent's next move, play the
// move with the best expected score (win 3, draw 1, lose 0).
function bestResponse(dist) {
  const ev = {};
  for (const m of MOVES) ev[m] = 3 * (dist[BEATS[m]] || 0) + 1 * (dist[m] || 0);
  return argmax(ev);
}

function normalizeDist(counts) {
  const total = MOVES.reduce((s, m) => s + (counts[m] || 0), 0);
  if (!total) return null;
  return Object.fromEntries(MOVES.map(m => [m, (counts[m] || 0) / total]));
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
    desc: "Copies your previous move. First move is random.",
    create() {
      return (my, opp) => {
        const last = opp[opp.length - 1];
        return valid(last) ? last : rnd();
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
        const won = !valid(theirs) || BEATS[mine] === theirs;
        if (won) return mine;
        const others = MOVES.filter(m => m !== mine);
        return others[Math.floor(Math.random() * 2)];
      };
    },
  },
  {
    id: 'lieu-dich',
    name: 'Liệu Địch',
    desc: 'Frequency analysis: counts all your moves and counters your favourite.',
    create() {
      return (my, opp) => {
        const counts = {};
        for (const m of opp) if (valid(m)) counts[m] = (counts[m] || 0) + 1;
        const dist = normalizeDist(counts);
        return dist ? bestResponse(dist) : rnd();
      };
    },
  },
  {
    id: 'thuc-thoi',
    name: 'Thức Thời',
    desc: 'Decay/window: looks at your last 20 moves, weighting recent ones more (decay 0.85), and counters the favourite.',
    create() {
      const WINDOW = 20, DECAY = 0.85;
      return (my, opp) => {
        const weights = {};
        let w = 1;
        for (let k = opp.length - 1; k >= Math.max(0, opp.length - WINDOW); k--) {
          if (valid(opp[k])) weights[opp[k]] = (weights[opp[k]] || 0) + w;
          w *= DECAY;
        }
        const dist = normalizeDist(weights);
        return dist ? bestResponse(dist) : rnd();
      };
    },
  },
  {
    id: 'thien-co',
    name: 'Thiên Cơ',
    desc: 'Markov chain: learns what you play after each of your moves, predicts your next one and counters it.',
    create() {
      return (my, opp) => {
        const last = opp[opp.length - 1];
        if (!valid(last)) return rnd();
        const counts = {};
        for (let k = 1; k < opp.length; k++) {
          if (opp[k - 1] === last && valid(opp[k])) counts[opp[k]] = (counts[opp[k]] || 0) + 1;
        }
        const dist = normalizeDist(counts);
        return dist ? bestResponse(dist) : rnd();
      };
    },
  },
  {
    id: 'muu-luoc',
    name: 'Mưu Lược',
    desc: 'N-gram: finds earlier spots where the last few turns (both players, up to 4) repeated, and counters what you did next.',
    create() {
      const MAX_N = 4;
      return (my, opp) => {
        const len = opp.length;
        const token = k => my[k] + opp[k]; // one turn = both moves
        for (let n = Math.min(MAX_N, len - 1); n >= 1; n--) {
          const counts = {};
          for (let end = n; end < len; end++) {
            // does the n turns before `end` match the n most recent turns?
            let same = true;
            for (let k = 0; k < n && same; k++) same = token(end - n + k) === token(len - n + k);
            if (same && valid(opp[end])) counts[opp[end]] = (counts[opp[end]] || 0) + 1;
          }
          const dist = normalizeDist(counts);
          if (dist) return bestResponse(dist);
        }
        return rnd();
      };
    },
  },
  {
    id: 'minh-triet',
    name: 'Minh Triết',
    desc: "Bayesian inference: keeps a belief over several theories of how you play (fixed, cycler, copycat, counter-puncher, frequency…), updates it every turn and best-responds.",
    create() {
      const EPS = 0.1; // every theory admits a little noise
      const next = m => MOVES[(MOVES.indexOf(m) + 1) % 3];
      const prev = m => MOVES[(MOVES.indexOf(m) + 2) % 3];
      const point = m => Object.fromEntries(MOVES.map(x => [x, x === m ? 1 - EPS : EPS / 2]));
      const uniform = { R: 1 / 3, P: 1 / 3, S: 1 / 3 };
      // Each theory: (my, opp, t) -> distribution over the opponent's move at turn t.
      const theories = [
        ...MOVES.map(c => () => point(c)),                                                       // always c
        (my, opp, t) => (valid(opp[t - 1]) ? point(next(opp[t - 1])) : uniform),               // cycles up
        (my, opp, t) => (valid(opp[t - 1]) ? point(prev(opp[t - 1])) : uniform),               // cycles down
        (my, opp, t) => (valid(opp[t - 1]) ? point(opp[t - 1]) : uniform),                      // repeats itself
        (my, opp, t) => (valid(my[t - 1]) ? point(my[t - 1]) : uniform),                        // copies me
        (my, opp, t) => (valid(my[t - 1]) ? point(COUNTER[my[t - 1]]) : uniform),               // beats my last
        (my, opp, t) => (valid(my[t - 1]) ? point(BEATS[my[t - 1]]) : uniform),                 // loses to my last
        (my, opp, t) => {                                                                       // follows its own frequencies
          const c = { R: 1, P: 1, S: 1 };
          for (let k = 0; k < t; k++) if (valid(opp[k])) c[opp[k]]++;
          return normalizeDist(c);
        },
        () => uniform,                                                                          // pure random
      ];
      let logPost = theories.map(() => 0);
      let seen = 0;
      return (my, opp) => {
        // fold in any turns we haven't scored yet
        for (; seen < opp.length; seen++) {
          if (!valid(opp[seen]) || seen === 0) continue;
          // slowly forget old evidence so it notices when you switch styles
          theories.forEach((th, i) => { logPost[i] = 0.97 * logPost[i] + Math.log(th(my, opp, seen)[opp[seen]] || 1e-9); });
        }
        if (!opp.length) return rnd();
        const maxLog = Math.max(...logPost);
        const weights = logPost.map(l => Math.exp(l - maxLog));
        const z = weights.reduce((a, b) => a + b, 0);
        const dist = { R: 0, P: 0, S: 0 };
        theories.forEach((th, i) => {
          const d = th(my, opp, opp.length);
          for (const m of MOVES) dist[m] += (weights[i] / z) * d[m];
        });
        return bestResponse(dist);
      };
    },
  },
];

module.exports = { HOUSE_BOTS };
