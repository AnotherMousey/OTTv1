const Bot = require('./bot');

const TURNS = +process.env.TURNS || 100; // turns per game
const FIRST_MOVE_TIMEOUT_MS = +process.env.FIRST_MOVE_TIMEOUT_MS || 10000;
const MOVE_TIMEOUT_MS = +process.env.MOVE_TIMEOUT_MS || 1000;
const BEATS = { R: 'S', P: 'R', S: 'P' };

// Anything that isn't R, P or S becomes 'X' (a forfeited turn).
function normalize(raw) {
  const c = String(raw ?? '').trim().charAt(0).toUpperCase();
  return c && 'RPS'.includes(c) ? c : 'X';
}

// Win = 3, draw = 1, loss = 0. A forfeited turn ('X') loses to any real move.
function points(a, b) {
  const va = a !== 'X', vb = b !== 'X';
  if (!va && !vb) return [0, 0];
  if (!va) return [0, 3];
  if (!vb) return [3, 0];
  if (a === b) return [1, 1];
  return BEATS[a] === b ? [3, 0] : [0, 3];
}

async function runMatch(subA, subB, ensureBuilt) {
  const bots = [new Bot(subA), new Bot(subB)];
  const issues = [null, null];
  await Promise.all(bots.map(bot =>
    ensureBuilt(bot.sub).then(() => bot.start(), e => { bot.dead = true; bot.reason = 'biên dịch thất bại: ' + e.message; })));

  let movesA = '', movesB = '', scoreA = 0, scoreB = 0;
  try {
    for (let t = 0; t < TURNS; t++) {
      const timeout = t === 0 ? FIRST_MOVE_TIMEOUT_MS : MOVE_TIMEOUT_MS;
      const prevA = movesA.slice(-1) || '-', prevB = movesB.slice(-1) || '-';
      const raw = await Promise.all([bots[0].move(prevA, prevB, timeout), bots[1].move(prevB, prevA, timeout)]);
      const [a, b] = raw.map(normalize);
      [a, b].forEach((m, i) => {
        if (m === 'X' && !issues[i]) {
          issues[i] = raw[i] === null
            ? `Lượt ${t + 1}: bot ${bots[i].reason || 'không phản hồi'}`
            : `Lượt ${t + 1}: nước đi không hợp lệ "${String(raw[i]).slice(0, 20)}"`;
        }
      });
      const [pa, pb] = points(a, b);
      movesA += a; movesB += b; scoreA += pa; scoreB += pb;
    }
  } finally {
    bots.forEach(b => b.stop());
  }
  return {
    movesA, movesB, scoreA, scoreB,
    winner: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw',
    issues: { A: issues[0], B: issues[1] },
  };
}

// A submission against one of the built-in house bots (which runs in-process).
async function runVsHouse(sub, house, ensureBuilt) {
  const bot = new Bot(sub);
  try {
    await ensureBuilt(sub);
    bot.start();
  } catch (e) {
    bot.dead = true;
    bot.reason = 'biên dịch thất bại: ' + e.message;
  }
  const brain = house.create();
  let mine = '', theirs = '', scoreA = 0, scoreB = 0, issue = null;
  try {
    for (let t = 0; t < TURNS; t++) {
      const timeout = t === 0 ? FIRST_MOVE_TIMEOUT_MS : MOVE_TIMEOUT_MS;
      const raw = await bot.move(mine.slice(-1) || '-', theirs.slice(-1) || '-', timeout);
      const a = normalize(raw);
      const b = normalize(brain(theirs, mine));
      if (a === 'X' && !issue) {
        issue = raw === null ? `Lượt ${t + 1}: bot ${bot.reason || 'không phản hồi'}` : `Lượt ${t + 1}: nước đi không hợp lệ "${String(raw).slice(0, 20)}"`;
      }
      const [pa, pb] = points(a, b);
      mine += a; theirs += b; scoreA += pa; scoreB += pb;
    }
  } finally {
    bot.stop();
  }
  return { movesA: mine, movesB: theirs, scoreA, scoreB, winner: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw', issue };
}

module.exports = { runMatch, runVsHouse, normalize, points, TURNS, FIRST_MOVE_TIMEOUT_MS, MOVE_TIMEOUT_MS };
