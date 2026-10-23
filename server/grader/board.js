// Board game matches ("Cờ OTT", rules in public/js/board-rules.js).
// Every game starts each bot as a fresh process. The bot is asked for a move on its own turns:
//   grader -> bot : "STATE <currentTurn> <maxTurn> <n> <pid type x y> * n <m> <pid type x y> * m"
//                   (its n pieces, then the enemy's m, from the bot's own side: see R.pieces)
//   bot -> grader : "MOVE <pid> <direction 1-8>"
// The harnesses turn this into play(gameState) -> (pid, direction).
// Time per move, as in Battlecode (which counts bytecodes): the limit is on the bot's computation.
// A bot runs under a meter (harness/meter.py) that counts its CPU time, so a busy server doesn't
// make it lose turns. Each move may use MOVE_CPU_MS of CPU (FIRST_MOVE_TIMEOUT_MS for a game's first,
// which includes starting up); the moment a bot goes over, the meter stops it, answers for it and
// restarts it for its next turn. The wall clock only stops a bot that waits or hangs (MOVE_WALL_MS).
// An illegal move, too much CPU or no answer in time skips that turn (a late answer is thrown away).
// A bot that crashes, or misses HUNG_TURNS turns in a row (stuck), loses the game.
// A match is 2 games with the sides swapped (white moves first): win = 3, draw = 1, loss = 0 per game.
const Bot = require('./bot');
const { MOVE_CPU_MS, FIRST_MOVE_TIMEOUT_MS } = require('./languages');
const R = require('../../public/js/board-rules');

const GAMES = 2;
const MOVE_WALL_MS = +process.env.MOVE_WALL_MS || 3 * MOVE_CPU_MS;
const HUNG_TURNS = 5;
// CPU a bot may use over a whole game (every move counted, the first one too); past it, it loses
const GAME_CPU_MS = +process.env.GAME_CPU_MS || 180000;
// CPU time over the limit for this move, or null if it is fine
const overCpu = (bot, first) => (bot.cpu !== null && bot.cpu > (first ? FIRST_MOVE_TIMEOUT_MS : MOVE_CPU_MS) ? bot.cpu : null);
const MAX_SCORE = GAMES * 3; // best possible match score

function request(g, side) {
  const { ally, opponent } = R.pieces(g, side);
  const list = ps => [ps.length, ...ps.map(p => `${p.pid} ${p.type} ${p.x} ${p.y}`)].join(' ');
  return `STATE ${g.turn} ${R.MAX_TURNS} ${list(ally)} ${list(opponent)}`;
}

// "pid direction" -> { move } on the real board, or { error }.
function parse(g, raw, side) {
  const nums = String(raw ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length !== 2) return { error: 'phải trả về 2 số: số hiệu quân và hướng (1-8)' };
  return R.fromAnswer(g, side, nums[0], nums[1]);
}

// The error line a crashed bot left behind ("ZeroDivisionError: division by zero"), if any. Only
// a line that looks like an error: anything else in stderr is the bot's own printing.
function crashLine(bot) {
  const lines = String(bot.stderr || '').split('\n').map(l => l.trim()).filter(Boolean);
  const line = [...lines].reverse().find(l => /^[\w.:]*(Error|Exception|Exit|Interrupt)\b|^terminate called|^Segmentation fault|^Aborted/.test(l));
  return line ? line.slice(0, 160) : '';
}

// One game. bots = { white: Bot, black: Bot }. Returns { moves, verdicts, winner, reason, end, issues }
// where moves[k] is [x1, y1, x2, y2] or null (a skipped turn), verdicts[k] says how the bot did on
// that move (shown in the replay): the CPU ms it used (a number, null if unknown) for a legal move,
// or why the turn was lost: ['timeout', wall ms] | ['cpu', limit ms] | ['invalid', answer, why].
// end = { side, why } when a bot lost the game by crashing or hanging; issues = { white, black }.
async function playGame(bots) {
  const g = R.newGame();
  const moves = [];
  const verdicts = [];
  let end = null;
  const issues = { white: null, black: null };
  const asked = { white: 0, black: 0 };
  const missed = { white: 0, black: 0 }; // turns in a row without an answer in time
  const used = { white: 0, black: 0 };   // CPU ms each bot has used this game
  while (!g.winner) {
    const side = g.toMove;
    const bot = bots[side];
    const first = !asked[side]++;
    const timeout = first ? FIRST_MOVE_TIMEOUT_MS : MOVE_WALL_MS;
    const raw = await bot.ask(request(g, side), timeout, { skipLate: true });
    if (raw === null && !bot.dead && ++missed[side] < HUNG_TURNS) {
      if (!issues[side]) issues[side] = `Lượt ${g.turn + 1}: bot không trả lời trong ${timeout} ms, mất lượt`;
      R.apply(g, null);
      moves.push(null);
      verdicts.push(['timeout', timeout]);
      continue;
    }
    if (raw === null) {
      if (!bot.dead) bot.fail(`không ra nước ${HUNG_TURNS} lượt liền`);
      issues[side] = `Lượt ${g.turn + 1}: bot ${bot.reason || 'không phản hồi'}`;
      const err = crashLine(bot);
      end = { side, why: `${bot.reason || 'không phản hồi'}${err ? `: ${err}` : ''}` };
      R.forfeit(g, side);
      break;
    }
    missed[side] = 0;
    used[side] += bot.cpu || 0;
    if (used[side] > GAME_CPU_MS) {
      const s = GAME_CPU_MS / 1000;
      issues[side] = `Lượt ${g.turn + 1}: bot đã dùng hết ${s} giây CPU của ván, thua ván`;
      end = { side, why: `dùng hết ${s} giây CPU của cả ván (${Math.round(used[side] / 100) / 10} giây)` };
      R.forfeit(g, side);
      g.reason = 'time';
      break;
    }
    const cpu = overCpu(bot, first);
    if (cpu !== null) {
      if (!issues[side]) issues[side] = `Lượt ${g.turn + 1}: bot dùng quá ${first ? FIRST_MOVE_TIMEOUT_MS : MOVE_CPU_MS} ms CPU nên bị dừng giữa chừng (và chạy lại từ đầu), mất lượt`;
      R.apply(g, null);
      moves.push(null);
      verdicts.push(['cpu', first ? FIRST_MOVE_TIMEOUT_MS : MOVE_CPU_MS]);
      continue;
    }
    const { move, error } = parse(g, raw, side);
    if (error && !issues[side]) issues[side] = `Lượt ${g.turn + 1}: nước đi "${String(raw).slice(0, 30)}" không hợp lệ (${error}), mất lượt`;
    R.apply(g, move || null);
    moves.push(move || null);
    verdicts.push(error ? ['invalid', String(raw).slice(0, 30), error] : bot.cpu);
  }
  return { moves, verdicts, winner: g.winner, reason: g.reason, end, issues };
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
    record.push({ white, moves: game.moves, verdicts: game.verdicts, winner, reason: game.reason, ...(game.end ? { end: game.end } : {}) });
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
      const raw = await bot.ask(request(g, 'white'), i === 0 ? FIRST_MOVE_TIMEOUT_MS : MOVE_WALL_MS);
      if (raw === null) return { ok: false, message: `Bot của bạn ${bot.reason || 'không phản hồi'} ở nước thử thứ ${i + 1}.`, bot };
      const cpu = overCpu(bot, i === 0);
      if (cpu !== null) return { ok: false, message: `Ở nước thử thứ ${i + 1}, bot của bạn dùng quá ${i === 0 ? FIRST_MOVE_TIMEOUT_MS : MOVE_CPU_MS} ms CPU nên bị dừng.`, bot };
      const { move, error } = parse(g, raw, 'white');
      if (error) return { ok: false, message: `Nước thử thứ ${i + 1} của bot ("${String(raw).slice(0, 30)}") không hợp lệ: ${error}.\n${describe(g)}`, bot };
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

// What the bot saw (white's view), for error messages: its pieces, then the board drawn top row
// first (uppercase = its own pieces, lowercase = the enemy's).
function describe(g) {
  const { ally } = R.pieces(g, 'white');
  const v = R.view(g, 'white');
  const rows = [`Quân của bạn lúc đó (pid Type x y): ${ally.map(p => `${p.pid} ${p.type} ${p.x} ${p.y}`).join(' · ')}`, `Bàn cờ (hàng trên cùng là y = ${R.H}):`];
  for (let y = R.H - 1; y >= 0; y--) rows.push(`${y + 1} ${v.slice(y * R.W, (y + 1) * R.W).split('').join(' ')}`);
  rows.push('  ' + Array.from({ length: R.W }, (_, x) => x + 1).join(' '));
  return rows.join('\n');
}

module.exports = { GAME_CPU_MS, runMatch, smokeTest: sub => smokeTest(sub, describe), GAMES, MAX_SCORE, MAX_TURNS: R.MAX_TURNS };
