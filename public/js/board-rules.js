// Rules of the board game ("Cờ OTT", after OTTv2), shared by the grader (require) and the
// replay page (<script>). A 9 x 9 grid; each side has 9 pieces: búa (R), bao (P), kéo (S).
//   - A piece moves one square in any of the 8 directions.
//   - It can't move onto its own piece, or onto an enemy piece of the same kind (blocked).
//   - Moving onto an enemy it beats (R > S > P > R) captures it; moving onto one that beats it
//     loses the attacker (the defender stays put).
//   - A side wins by reaching the enemy's home corner, or by eliminating every enemy piece.
//   - After MAX_TURNS moves (both sides counted): more pieces wins, then the piece nearest to
//     its goal, then the smaller total distance to the goal; otherwise a draw.
// Coordinates: x = column 0..W-1 (a..i), y = row 0..H-1 (1..9). White starts bottom-left and
// heads for the top-right corner; black starts top-right and heads for (0, 0).
(function (root) {
  const W = 9, H = 9;
  const MAX_TURNS = 4 * W * H;
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
    if (!g.winner && g.turn >= MAX_TURNS) finishAtLimit(g);
    return ev;
  }

  const dist = (x, y, [gx, gy]) => Math.max(Math.abs(gx - x), Math.abs(gy - y));
  function distances(board, side) {
    const out = [];
    board.forEach((row, y) => row.forEach((c, x) => { if (c && c.side === side) out.push(dist(x, y, GOAL[side])); }));
    return out;
  }

  function finishAtLimit(g) {
    const w = count(g.board, 'white'), b = count(g.board, 'black');
    if (w !== b) { g.winner = w > b ? 'white' : 'black'; g.reason = 'limit-pieces'; return; }
    const dw = distances(g.board, 'white'), db = distances(g.board, 'black');
    const nw = Math.min(...dw), nb = Math.min(...db);
    if (nw !== nb) { g.winner = nw < nb ? 'white' : 'black'; g.reason = 'limit-nearest'; return; }
    const sum = a => a.reduce((s, d) => s + d, 0);
    if (sum(dw) !== sum(db)) { g.winner = sum(dw) < sum(db) ? 'white' : 'black'; g.reason = 'limit-distance'; return; }
    g.winner = 'draw';
    g.reason = 'limit-draw';
  }

  // The side that lost on time / crashed loses the game.
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

  const api = { W, H, MAX_TURNS, BEATS, GOAL, other, square, newGame, initialBoard, count, problem, legalMoves, apply, forfeit, view, fromView };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoardRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
