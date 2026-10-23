// Board game matches ("Cờ OTT", rules in public/js/board-rules.js).
// Every game starts each bot as a fresh process. The bot is asked for a move on its own turns:
//   grader -> bot : "TURN <turn> <maxTurns> <W> <H> <cells>"  (cells: W*H chars, row y = 0 first,
//                   from the bot's own side: uppercase = mine, lowercase = enemy, '.' = empty)
//   bot -> grader : "MOVE x1 y1 x2 y2"
// An illegal move, or one that takes over MOVE_TIMEOUT_MS, skips that turn (a late answer is thrown
// away). A bot that crashes, or misses HUNG_TURNS turns in a row (stuck), loses the game.
// A match is 2 games with the sides swapped (white moves first): win = 3, draw = 1, loss = 0 per game.
const Bot = require('./bot');
const R = require('../../public/js/board-rules');

const GAMES = 2;
const FIRST_MOVE_TIMEOUT_MS = +process.env.FIRST_MOVE_TIMEOUT_MS || 10000;
const MOVE_TIMEOUT_MS = +process.env.MOVE_TIMEOUT_MS || 1000;
const HUNG_TURNS = 5;
const MAX_SCORE = GAMES * 3; // best possible match score

const request = (g, side) => `TURN ${g.turn} ${R.MAX_TURNS} ${R.W} ${R.H} ${R.view(g, side)}`;

// "x1 y1 x2 y2" (in the bot's view) -> a move on the real board, or null.
function parse(raw, side) {
  const nums = String(raw ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length !== 4 || !nums.every(Number.isInteger)) return null;
  return R.fromView(side, nums);
}

// One game. bots = { white: Bot, black: Bot }. Returns { moves, winner, reason, issues } where
// moves[k] is [x1, y1, x2, y2] or null (a skipped turn) and issues = { white, black }.
async function playGame(bots) {
  const g = R.newGame();
  const moves = [];
  const issues = { white: null, black: null };
  const asked = { white: 0, black: 0 };
  const missed = { white: 0, black: 0 }; // turns in a row without an answer in time
  while (!g.winner) {
    const side = g.toMove;
    const bot = bots[side];
    const timeout = asked[side]++ ? MOVE_TIMEOUT_MS : FIRST_MOVE_TIMEOUT_MS;
    const raw = await bot.ask(request(g, side), timeout, { skipLate: true });
    if (raw === null && !bot.dead && ++missed[side] < HUNG_TURNS) {
      if (!issues[side]) issues[side] = `Lượt ${g.turn + 1}: bot mất quá ${timeout} ms để ra nước, mất lượt`;
      R.apply(g, null);
      moves.push(null);
      continue;
    }
    if (raw === null) {
      if (!bot.dead) bot.fail(`không ra nước ${HUNG_TURNS} lượt liền`);
      issues[side] = `Lượt ${g.turn + 1}: bot ${bot.reason || 'không phản hồi'}`;
      R.forfeit(g, side);
      break;
    }
    missed[side] = 0;
    const move = parse(raw, side);
    const why = move ? R.problem(g, side, move) : `"${String(raw).slice(0, 30)}" không phải 4 số x1 y1 x2 y2`;
    if (why && !issues[side]) issues[side] = `Lượt ${g.turn + 1}: nước đi "${String(raw).slice(0, 30)}" không hợp lệ (${why}), mất lượt`;
    R.apply(g, why ? null : move);
    moves.push(why ? null : move);
  }
  return { moves, winner: g.winner, reason: g.reason, issues };
}

// games: how many games; aWhite: whether A takes white (moves first) in the first one.
async function runMatch(subA, subB, ensureBuilt, { games = GAMES, aWhite = true } = {}) {
  const built = await Promise.all([subA, subB].map(s => ensureBuilt(s).then(() => null, e => 'biên dịch thất bại: ' + e.message)));
  const record = [];
  const issues = { A: null, B: null };
  let scoreA = 0, scoreB = 0;
  for (let k = 0; k < games; k++) {
    const white = (k % 2 === 0) === aWhite ? 'A' : 'B';
    const sideOf = { A: white === 'A' ? 'white' : 'black', B: white === 'A' ? 'black' : 'white' };
    const bots = { A: new Bot(subA), B: new Bot(subB) };
    for (const [i, who] of ['A', 'B'].entries()) {
      if (built[i]) { bots[who].dead = true; bots[who].reason = built[i]; } else bots[who].start();
    }
    let game;
    try {
      game = await playGame({ [sideOf.A]: bots.A, [sideOf.B]: bots.B });
    } finally {
      bots.A.stop();
      bots.B.stop();
    }
    const winner = game.winner === 'draw' ? 'draw' : game.winner === sideOf.A ? 'A' : 'B';
    scoreA += winner === 'A' ? 3 : winner === 'draw' ? 1 : 0;
    scoreB += winner === 'B' ? 3 : winner === 'draw' ? 1 : 0;
    for (const who of ['A', 'B']) if (!issues[who] && game.issues[sideOf[who]]) issues[who] = `Ván ${k + 1}, ${game.issues[sideOf[who]].charAt(0).toLowerCase()}${game.issues[sideOf[who]].slice(1)}`;
    record.push({ white, moves: game.moves, winner, reason: game.reason });
  }
  return {
    games: record, scoreA, scoreB,
    winner: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw',
    issues,
  };
}

// A few moves against a random mover, to make sure the bot answers with legal moves.
async function smokeTest(sub, describe) {
  const bot = new Bot(sub);
  bot.start();
  const g = R.newGame();
  try {
    for (let i = 0; i < 5; i++) {
      const raw = await bot.ask(request(g, 'white'), i === 0 ? FIRST_MOVE_TIMEOUT_MS : MOVE_TIMEOUT_MS);
      if (raw === null) return { ok: false, message: `Bot của bạn ${bot.reason || 'không phản hồi'} ở nước thử thứ ${i + 1}.`, bot };
      const move = parse(raw, 'white');
      const why = move ? R.problem(g, 'white', move) : `"${String(raw).slice(0, 30)}" không phải 4 số x1 y1 x2 y2`;
      if (why) return { ok: false, message: `Nước thử thứ ${i + 1} của bot ("${String(raw).slice(0, 30)}") không hợp lệ: ${why}.\nBàn cờ lúc đó (board[y][x], hàng trên cùng là y = ${R.H - 1}):\n${describe(g)}`, bot };
      R.apply(g, move);
      if (g.winner) break;
      const replies = R.legalMoves(g);
      R.apply(g, replies.length ? replies[Math.floor(Math.random() * replies.length)] : null);
      if (g.winner) break;
    }
    return { ok: true, message: 'Biên dịch thành công và đi thử 5 nước hợp lệ. Sẵn sàng ra trận!', bot };
  } finally {
    bot.stop();
  }
}

// The board as the bot saw it (white's view), top row first, for error messages.
function describe(g) {
  const v = R.view(g, 'white');
  const rows = [];
  for (let y = R.H - 1; y >= 0; y--) rows.push(`${y} ${v.slice(y * R.W, (y + 1) * R.W).split('').join(' ')}`);
  rows.push('  ' + Array.from({ length: R.W }, (_, x) => x).join(' '));
  return rows.join('\n');
}

module.exports = { runMatch, smokeTest: sub => smokeTest(sub, describe), GAMES, MAX_SCORE, MAX_TURNS: R.MAX_TURNS };
