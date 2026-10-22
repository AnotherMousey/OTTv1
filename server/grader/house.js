// The 10 built-in sparring bots, from easiest to hardest.
// Their code is Python only (house_py/<id>.py), and they play like any other bot: compiled
// and run by the grader as a separate process on the server. Nothing here is sent to players.
//
// Bots 1–5 follow their rules exactly (one move, a fixed cycle, random, copycat,
// win-stay/lose-shift). Bots 6–9 predict you with their own algorithm (frequency,
// decay/window, Markov chain, n-gram) and then "second-guess" how to use that
// prediction: counter it directly, or assume you anticipated that, and so on, by
// whichever has been winning lately. Bot 10 does Bayesian inference over many theories
// of how you play (including "you are second-guessing me") and best-responds.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOUSE_BOTS = [
  { id: 'nhat-chieu-doat-menh', name: 'Kiên Định', desc: 'Picks one move (rock, paper or scissors) and plays it all game.' },
  { id: 'luan-hoi', name: 'Luân Hồi', desc: 'Cycles rock → paper → scissors forever.' },
  { id: 'vo-chieu', name: 'Vô Chiêu', desc: 'Plays a uniformly random move every turn.' },
  { id: 'tam-ma', name: 'Tâm Ma', desc: 'Copies your previous move. First move is random.' },
  { id: 'tuy-duyen', name: 'Tùy Duyên', desc: 'Win-stay, lose-shift: keeps its move after a win, otherwise switches to one of the other two at random. First move is random.' },
  { id: 'lieu-dich', name: 'Liệu Địch', desc: 'Frequency analysis (whole game and last 12 turns) with a second-guessing layer.' },
  { id: 'thuc-thoi', name: 'Thức Thời', desc: 'Decay/window frequencies (fast and slow) with a second-guessing layer.' },
  { id: 'thien-co', name: 'Thiên Cơ', desc: 'Markov chains on your moves and on both players\' moves, with a second-guessing layer.' },
  { id: 'muu-luoc', name: 'Mưu Lược', desc: "N-gram history matching (your moves and both players' moves), always backing whichever pattern has been right lately." },
  { id: 'minh-triet', name: 'Minh Triết', desc: 'The boss: Bayesian inference over many theories of how you play (habits, patterns, and whether you are countering it), then the best response.' },
];

// The 6 sparring bots of the board game (house_board_py/<id>.py), easiest first.
const BOARD_HOUSE_BOTS = [
  { id: 'loan-bo', name: 'Loạn Bộ', desc: 'Plays a random legal move every turn.' },
  { id: 'thang-tien', name: 'Thẳng Tiến', desc: 'Races for your corner, ignoring danger.' },
  { id: 'than-trong', name: 'Thận Trọng', desc: 'Looks one move ahead with a position evaluation and never leaves you a free capture or a winning move.' },
  { id: 'san-moi', name: 'Săn Mồi', desc: 'Captures whenever it can, otherwise hunts the nearest piece it beats while staying out of reach.' },
  { id: 'tinh-toan', name: 'Tính Toán', desc: 'Minimax two moves deep: its move, then your best reply.' },
  { id: 'thau-suot', name: 'Thấu Suốt', desc: 'The boss: alpha-beta search with iterative deepening, as deep as 0.3 s per move allows.' },
];
const houseBots = game => (game === 'board' ? BOARD_HOUSE_BOTS : HOUSE_BOTS);

// Sample bots ("bot mẫu"): the yardstick of a daily brawl. Before each day's round robin every
// team's bot plays each of them; the result is the team's evaluation points (see daily.js).
// Same files and shared pieces as the sparring bots of their game.
const SAMPLE_BOTS = {
  rps: [
    { id: 'mau-thien-bua', name: 'Mẫu Thiên Búa', desc: 'Plays rock 60% of the time, paper and scissors 20% each.' },
    { id: 'mau-nhip-doi', name: 'Mẫu Nhịp Đôi', desc: 'Plays each move twice: R R P P S S, over and over.' },
    { id: 'mau-phan-don', name: 'Mẫu Phản Đòn', desc: "Beats your most frequent move of your last 5." },
    { id: 'mau-doan-truoc', name: 'Mẫu Đoán Trước', desc: 'Assumes you will counter its last move, and beats that counter.' },
  ],
  board: [
    { id: 'mau-thu-thanh', name: 'Mẫu Thủ Thành', desc: 'Stays home: captures what comes close, otherwise shuffles inside its first 3 rows.' },
    { id: 'mau-tien-phong', name: 'Mẫu Tiên Phong', desc: 'Sends one piece at a time toward your corner; the rest wait.' },
    { id: 'mau-bay-dan', name: 'Mẫu Bầy Đàn', desc: 'Advances as a group: always moves its rearmost piece forward, capturing on the way.' },
    { id: 'mau-chien-thuat', name: 'Mẫu Chiến Thuật', desc: 'Minimax two moves deep, the same as the sparring bot Tính Toán.' },
  ],
};
const sampleBots = game => SAMPLE_BOTS[game === 'board' ? 'board' : 'rps'];
// every built-in bot by id, with its game
const BUILT_IN = new Map([
  ...HOUSE_BOTS.map(b => [b.id, { ...b, game: 'rps', kind: 'Sparring' }]),
  ...BOARD_HOUSE_BOTS.map(b => [b.id, { ...b, game: 'board', kind: 'Sparring' }]),
  ...SAMPLE_BOTS.rps.map(b => [b.id, { ...b, game: 'rps', kind: 'Sample' }]),
  ...SAMPLE_BOTS.board.map(b => [b.id, { ...b, game: 'board', kind: 'Sample' }]),
]);

// A bot file starts with "# uses: base predictors ..." naming the shared pieces
// (house_py/_<piece>.py, or house_board_py/ for the board game) it needs; they are pasted in so
// the result stands alone. The judge sees and edits this source; an edited copy then plays
// instead in that tournament.
const PY_DIR = path.join(__dirname, 'house_py');
const BOARD_PY_DIR = path.join(__dirname, 'house_board_py');
const HEADS = {
  rps: '# Same interface as a player bot: play(my_moves, opponent_moves) -> "R" | "P" | "S".\n' +
    '# my_moves / opponent_moves: lists of the previous turns, oldest first (may contain "X").\n' +
    '# The process lives for one game (100 turns), so module-level state is per game.',
  board: '# Same interface as a player bot: play(board, turn, max_turns) -> (x1, y1, x2, y2).\n' +
    '# board[y][x]: "R" "P" "S" = mine, "r" "p" "s" = enemy, "." = empty; y = 0 is my home row and\n' +
    '# I win on the top-right corner. The process lives for one game, so module-level state is per game.',
};

function pythonSource(id) {
  const bot = BUILT_IN.get(id);
  if (!bot) return null;
  const { game } = bot;
  const dir = game === 'board' ? BOARD_PY_DIR : PY_DIR;
  const piece = name => fs.readFileSync(path.join(dir, `_${name}.py`), 'utf8').replace(/\r\n/g, '\n').trim();
  const src = fs.readFileSync(path.join(dir, `${id}.py`), 'utf8').replace(/\r\n/g, '\n');
  const [first, ...rest] = src.split('\n');
  const uses = (first.match(/^# uses:(.*)$/) || [, ''])[1].trim().split(/\s+/).filter(Boolean);
  const head = `# ${bot.kind} bot "${bot.name}": the built-in bot.\n` + HEADS[game];
  return [head, ...uses.map(piece), rest.join('\n').trim()].join('\n\n\n') + '\n';
}

// The default bot in runnable form (shaped like a submission). The build id carries a hash of
// the code, so changing a house_py file gets it rebuilt instead of reusing a stale build.
function defaultRunnable(id) {
  const code = pythonSource(id);
  const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
  return { id: `house-${id}-${hash}`, language: 'python', code, trusted: true, game: BUILT_IN.get(id).game };
}

module.exports = { HOUSE_BOTS, BOARD_HOUSE_BOTS, houseBots, sampleBots, pythonSource, defaultRunnable };
