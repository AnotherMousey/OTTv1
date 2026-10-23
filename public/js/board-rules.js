// Rules of the board game ("Cờ OTT", after OTTv2), shared by the grader (require) and the
// replay page (<script>). A 9 x 9 grid; each side has 9 pieces: búa (R), bao (P), kéo (S).
//   - A piece moves one square in any of the 8 directions.
//   - It can't move onto its own piece, or onto an enemy piece of the same kind (blocked).
//   - Moving onto an enemy it beats (R > S > P > R) captures it; moving onto one that beats it
//     loses the attacker (the defender stays put).
//   - A side wins by reaching the enemy's home corner, or by eliminating every enemy piece.
//   - After MAX_TURNS moves (both sides counted, skipped turns too) without a winner: a draw.
// Coordinates: x = column 0..W-1 (a..i), y = row 0..H-1 (1..9). White starts bottom-left and
// heads for the top-right corner; black starts top-right and heads for (0, 0).
(function (root) {
  const W = 9, H = 9;
  const MAX_TURNS = 1000;
  const BEATS = { R: 'S', S: 'P', P: 'R' };
  // White's start (black's is the same rotated by 180°, so both sides see the same position).
  const WHITE_START = [[1, 0, 'R'], [2, 0, 'P'], [3, 0, 'S'], [1, 1, 'P'], [2, 1, 'S'], [3, 1, 'R'], [1, 2, 'S'], [2, 2, 'R'], [3, 2, 'P']];
  const GOAL = { white: [W - 1, H - 1], black: [0, 0] };
  const other = side => (side === 'white' ? 'black' : 'white');
  const square = (x, y) => String.fromCharCode(97 + x) + (y + 1);

  // board[y][x] = null | { side, kind, id }
  function initialBoard() {
    const board = Array.from({ length: H }, () => Array(W).fill(null));
    WHITE_START.forEach(([x, y, kind], i) => {
      board[y][x] = { side: 'white', kind, id: 'w' + i };
      board[H - 1 - y][W - 1 - x] = { side: 'black', kind, id: 'b' + i };
    });
    return board;
  }

  function newGame() {
    return { board: initialBoard(), toMove: 'white', turn: 0, winner: null, reason: null };
  }

  const count = (board, side) => board.reduce((n, row) => n + row.filter(c => c && c.side === side).length, 0);

  // Why a move is illegal, or null if it is fine.
  function problem(g, side, move) {
    if (!Array.isArray(move) || move.length !== 4 || !move.every(Number.isInteger)) return 'nước đi phải gồm 4 số nguyên x1 y1 x2 y2';
    const [x1, y1, x2, y2] = move;
    const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
    if (!inside(x1, y1) || !inside(x2, y2)) return 'ô nằm ngoài bàn cờ';
    const piece = g.board[y1][x1];
    if (!piece || piece.side !== side) return 'ô xuất phát không có quân của bạn';
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) return 'mỗi lượt chỉ được đi 1 ô (8 hướng)';
    const target = g.board[y2][x2];
    if (target && target.side === side) return 'không được đi vào ô có quân mình';
    if (target && target.kind === piece.kind) return 'hai quân cùng loại chặn nhau, không ăn được';
    return null;
  }

  function legalMoves(g, side = g.toMove) {
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = g.board[y][x];
      if (!p || p.side !== side) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const m = [x, y, x + dx, y + dy];
        if ((dx || dy) && !problem(g, side, m)) out.push(m);
      }
    }
    return out;
  }

  // Plays `move` (or skips the turn if move is null) for the side to move. Returns what happened:
  // { result: 'move' | 'capture' | 'bounce' | 'goal' | 'skip', piece, target } and updates g.
  function apply(g, move) {
    const side = g.toMove;
    let ev = { result: 'skip' };
    if (move) {
      const [x1, y1, x2, y2] = move;
      const piece = g.board[y1][x1], target = g.board[y2][x2];
      ev = { result: 'move', piece: piece.kind, target: target ? target.kind : null };
      g.board[y1][x1] = null;
      if (!target || BEATS[piece.kind] === target.kind) {
        g.board[y2][x2] = piece;
        if (target) ev.result = 'capture';
        const goal = GOAL[side];
        if (x2 === goal[0] && y2 === goal[1]) {
          ev.result = 'goal';
          g.winner = side;
          g.reason = 'goal';
        }
      } else {
        ev.result = 'bounce'; // the defender wins and the attacker is gone
      }
      if (!g.winner && count(g.board, other(side)) === 0) { g.winner = side; g.reason = 'wipeout'; }
      if (!g.winner && count(g.board, side) === 0) { g.winner = other(side); g.reason = 'wipeout'; }
    }
    g.turn++;
    g.toMove = other(side);
    if (!g.winner && g.turn >= MAX_TURNS) { g.winner = 'draw'; g.reason = 'limit-draw'; }
    return ev;
  }

  // The side whose bot crashed (or hung) loses the game.
  function forfeit(g, side) {
    g.winner = other(side);
    g.reason = 'forfeit';
  }

  // What a bot sees: the board from its own side (black's view is rotated 180°, so every bot
  // starts bottom-left and heads for the top-right corner). Uppercase = mine, lowercase = enemy,
  // '.' = empty; row y = 0 first. Moves the bot returns are mapped back with fromView.
  function view(g, side) {
    let s = '';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = side === 'white' ? g.board[y][x] : g.board[H - 1 - y][W - 1 - x];
      s += !c ? '.' : c.side === side ? c.kind : c.kind.toLowerCase();
    }
    return s;
  }
  const fromView = (side, [x1, y1, x2, y2]) => (side === 'white' ? [x1, y1, x2, y2] : [W - 1 - x1, H - 1 - y1, W - 1 - x2, H - 1 - y2]);

  // The game state a bot gets, in its own view: { ally, opponent } with each piece as
  // { pid, type, x, y }. pid = 1..9, fixed for the whole game (each side numbers its own pieces).
  function pieces(g, side) {
    const out = { ally: [], opponent: [] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = side === 'white' ? g.board[y][x] : g.board[H - 1 - y][W - 1 - x];
      if (c) out[c.side === side ? 'ally' : 'opponent'].push({ pid: +c.id.slice(1) + 1, type: c.kind, x, y });
    }
    out.ally.sort((a, b) => a.pid - b.pid);
    out.opponent.sort((a, b) => a.pid - b.pid);
    return out;
  }

  // A bot answers (pid, direction). Directions in its own view, up = toward its goal row:
  // 1 up-left, 2 up, 3 up-right, 4 right, 5 down-right, 6 down, 7 down-left, 8 left.
  const DIRS = [null, [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0]];
  // -> { move: [x1, y1, x2, y2] on the real board } or { error: why it isn't a legal move }
  function fromAnswer(g, side, pid, dir) {
    if (!Number.isInteger(pid) || !Number.isInteger(dir)) return { error: 'phải trả về 2 số nguyên: số hiệu quân và hướng' };
    if (dir < 1 || dir > 8) return { error: 'hướng phải từ 1 đến 8' };
    const p = pieces(g, side).ally.find(q => q.pid === pid);
    if (!p) return { error: `không có quân nào của bạn mang số ${pid}` };
    const [dx, dy] = DIRS[dir];
    const move = fromView(side, [p.x, p.y, p.x + dx, p.y + dy]);
    const why = problem(g, side, move);
    return why ? { error: why } : { move };
  }

  const api = { W, H, MAX_TURNS, BEATS, GOAL, DIRS, other, square, newGame, initialBoard, count, problem, legalMoves, apply, forfeit, view, fromView, pieces, fromAnswer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoardRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
