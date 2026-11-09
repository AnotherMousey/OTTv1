// Rules of the board game ("Cờ OTT", after OTTv2), shared by the grader (require) and the
// replay page (<script>). A grid, 9 x 9 by default; each side has 9 pieces: búa (R), bao (P), kéo (S).
//   - A piece moves one square in any of the 8 directions.
//   - It can't move onto its own piece, or onto an enemy piece of the same kind (blocked).
//   - Moving onto an enemy it beats (R > S > P > R) captures it; moving onto one that beats it
//     loses the attacker (the defender stays put).
//   - A side wins by reaching its goal (the enemy's home corner, or the goal squares the map gives
//     it: by default any one of them, or all of them at once when the map says so), or by
//     eliminating every enemy piece.
//   - After MAX_TURNS moves (both sides counted, skipped turns too) without a winner: a draw.
//   - A map (the judge's, per tournament) may set the board's size, where the pieces start, walls
//     (squares no piece can enter), each side's goal squares, whether one of them or all of them
//     must be taken (goalMode), and its own move limit instead of MAX_TURNS.
// Coordinates: x = column 0..W-1 (a, b, ...), y = row 0..H-1 (1, 2, ...), W x H = the game's size
// (g.W, g.H). White starts bottom-left and heads for the top-right corner; black starts top-right
// and heads for (0, 0).
(function (root) {
  const W = 9, H = 9; // the standard board
  const MAX_TURNS = 1000;
  const TURN_LIMITS = [10, 5000]; // the move limit a map may set
  const SIZE_LIMITS = [4, 15];    // the width and height a map may have
  const BEATS = { R: 'S', S: 'P', P: 'R' };
  // White's start (black's is the same rotated by 180°, so both sides see the same position).
  const WHITE_START = [[1, 0, 'R'], [2, 0, 'P'], [3, 0, 'S'], [1, 1, 'P'], [2, 1, 'S'], [3, 1, 'R'], [1, 2, 'S'], [2, 2, 'R'], [3, 2, 'P']];
  // A map's goals: w * h characters like its layout, 'w' = a goal square of white (the side moving
  // first), 'b' = one of black's, '.' = neither. null = the standard goals: the corner the other side
  // starts in (white heads for the top-right corner, black for (0, 0)).
  const defaultGoals = (w = W, h = H) => Array.from({ length: w * h }, (_, i) => (i === w * h - 1 ? 'w' : i === 0 ? 'b' : '.')).join('');
  // goalMode: 'any' = a side wins as soon as one of its pieces steps onto one of its goal squares,
  // 'all' = when its pieces stand on every one of its goal squares at once.
  const GOAL_MODES = ['any', 'all'];
  // Each side's goal squares ([[x, y], ...]) from a goals string (null: the standard corners).
  function goalSquares(goals, w = W, h = H) {
    const g = goals || defaultGoals(w, h), out = { white: [], black: [] };
    for (let i = 0; i < w * h; i++) if (g[i] === 'w' || g[i] === 'b') out[g[i] === 'w' ? 'white' : 'black'].push([i % w, Math.floor(i / w)]);
    return out;
  }
  const other = side => (side === 'white' ? 'black' : 'white');
  const square = (x, y) => String.fromCharCode(97 + x) + (y + 1);

  // A map is a layout: w * h characters (its width and height), row y = 0 first, 'R' 'P' 'S' = white's pieces,
  // 'r' 'p' 's' = black's, '#' = a wall, '.' = empty. null = the standard start (DEFAULT_LAYOUT).
  const DEFAULT_LAYOUT = (() => {
    const cells = Array(W * H).fill('.');
    WHITE_START.forEach(([x, y, kind]) => {
      cells[y * W + x] = kind;
      cells[(H - 1 - y) * W + W - 1 - x] = kind.toLowerCase();
    });
    return cells.join('');
  })();

  // Why a w x h layout (with its goals, null = the standard corners, and goal mode) can't be played,
  // or null if it is fine.
  function layoutProblem(layout, w = W, h = H, goals = null, goalMode = 'any') {
    const [lo, hi] = SIZE_LIMITS;
    if (![w, h].every(n => Number.isInteger(n) && n >= lo && n <= hi)) return `chiều rộng và chiều cao phải là số nguyên từ ${lo} đến ${hi}`;
    if (typeof layout !== 'string' || layout.length !== w * h || /[^RPSrps#.]/.test(layout)) return `bản đồ phải gồm ${w * h} ô, mỗi ô là R P S (bên đi trước), r p s (bên đi sau), # (tường) hoặc . (trống)`;
    if (!/[RPS]/.test(layout)) return 'bên đi trước cần ít nhất một quân';
    if (!/[rps]/.test(layout)) return 'bên đi sau cần ít nhất một quân';
    if (goals !== null && (typeof goals !== 'string' || goals.length !== w * h || /[^wb.]/.test(goals))) return `ô đích phải gồm ${w * h} ô, mỗi ô là w (đích bên đi trước), b (đích bên đi sau) hoặc . (không)`;
    if (!GOAL_MODES.includes(goalMode)) return 'cách thắng bằng ô đích phải là "chạm 1 ô" hoặc "chiếm tất cả"';
    const g = goals || defaultGoals(w, h), at = ([x, y]) => layout[y * w + x], sq = goalSquares(g, w, h);
    const name = { white: 'bên đi trước', black: 'bên đi sau' }, own = { white: /[RPS]/, black: /[rps]/ };
    for (const side of ['white', 'black']) {
      if (!sq[side].length) return `${name[side]} cần ít nhất một ô đích`;
      if (sq[side].some(c => at(c) === '#')) return `không được đặt tường lên ô đích của ${name[side]}`;
      if (sq[side].some(c => own[side].test(at(c)))) return `quân ${name[side]} không được đứng sẵn trên ô đích của mình`;
      const n = (layout.match(side === 'white' ? /[RPS]/g : /[rps]/g) || []).length;
      if (goalMode === 'all' && sq[side].length > n) return `${name[side]} có ${sq[side].length} ô đích nhưng chỉ có ${n} quân, không bao giờ chiếm hết được`;
    }
    return null;
  }

  // board[y][x] = null | { side, kind, id }; wall[y][x] = true on a wall. Each side numbers its
  // pieces in reading order from its own side (bottom row first, left to right; black's view is
  // rotated 180°): ids w0, w1... and b0, b1..., so pid = number + 1.
  function initialBoard(layout = DEFAULT_LAYOUT, W = 9, H = 9) {
    const board = Array.from({ length: H }, () => Array(W).fill(null));
    const wall = Array.from({ length: H }, () => Array(W).fill(false));
    let w = 0, b = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = layout[y * W + x], d = layout[(H - 1 - y) * W + W - 1 - x];
      if (c === '#') wall[y][x] = true;
      if ('RPS'.includes(c)) board[y][x] = { side: 'white', kind: c, id: 'w' + w++ };
      if ('rps'.includes(d)) board[H - 1 - y][W - 1 - x] = { side: 'black', kind: d.toUpperCase(), id: 'b' + b++ };
    }
    return { board, wall };
  }

  // Why a map's move limit can't be used, or null if it is fine.
  function turnsProblem(n) {
    return Number.isInteger(n) && n >= TURN_LIMITS[0] && n <= TURN_LIMITS[1] ? null : `số nước tối đa phải là số nguyên từ ${TURN_LIMITS[0]} đến ${TURN_LIMITS[1]}`;
  }

  // map = { layout, maxTurns, width, height, goals, goalMode } (anything carrying them, e.g. a recorded
  // game), or null / no layout for the standard game. g.W x g.H = the board's size; g.goal = each
  // side's goal squares ([[x, y], ...]), g.goalMode = 'any' | 'all'.
  function newGame(map) {
    const custom = map && map.layout;
    const w = custom ? map.width || W : W, h = custom ? map.height || H : H;
    const goal = goalSquares(custom ? map.goals || null : null, w, h);
    return { ...initialBoard(custom || DEFAULT_LAYOUT, w, h), W: w, H: h, goal, goalMode: (custom && map.goalMode) || 'any', maxTurns: (map && map.maxTurns) || MAX_TURNS, toMove: 'white', turn: 0, winner: null, reason: null };
  }

  // Has `side` reached its goal, its last move having ended on (x, y)?
  function reached(g, side, x, y) {
    const goal = g.goal[side];
    if (!goal.some(([gx, gy]) => gx === x && gy === y)) return false;
    return g.goalMode !== 'all' || goal.every(([gx, gy]) => g.board[gy][gx] && g.board[gy][gx].side === side);
  }

  const count = (board, side) => board.reduce((n, row) => n + row.filter(c => c && c.side === side).length, 0);

  // Why a move is illegal, or null if it is fine.
  function problem(g, side, move) {
    if (!Array.isArray(move) || move.length !== 4 || !move.every(Number.isInteger)) return 'nước đi phải gồm 4 số nguyên x1 y1 x2 y2';
    const [x1, y1, x2, y2] = move;
    const inside = (x, y) => x >= 0 && x < g.W && y >= 0 && y < g.H;
    if (!inside(x1, y1) || !inside(x2, y2)) return 'ô nằm ngoài bàn cờ';
    const piece = g.board[y1][x1];
    if (!piece || piece.side !== side) return 'ô xuất phát không có quân của bạn';
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) return 'mỗi lượt chỉ được đi 1 ô (8 hướng)';
    if (g.wall[y2][x2]) return 'không được đi vào tường';
    const target = g.board[y2][x2];
    if (target && target.side === side) return 'không được đi vào ô có quân mình';
    if (target && target.kind === piece.kind) return 'hai quân cùng loại chặn nhau, không ăn được';
    return null;
  }

  function legalMoves(g, side = g.toMove) {
    const out = [];
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
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
        if (reached(g, side, x2, y2)) {
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
    if (!g.winner && g.turn >= g.maxTurns) { g.winner = 'draw'; g.reason = 'limit-draw'; }
    return ev;
  }

  // The side whose bot crashed (or hung) loses the game.
  function forfeit(g, side) {
    g.winner = other(side);
    g.reason = 'forfeit';
  }

  // What a bot sees: the board from its own side (black's view is rotated 180°, so every bot
  // starts bottom-left and heads for the top-right corner). Uppercase = mine, lowercase = enemy,
  // '#' = wall, '.' = empty; row y = 0 first. Moves the bot returns are mapped back with fromView.
  function view(g, side) {
    const { W, H } = g;
    let s = '';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [rx, ry] = side === 'white' ? [x, y] : [W - 1 - x, H - 1 - y];
      const c = g.board[ry][rx];
      s += g.wall[ry][rx] ? '#' : !c ? '.' : c.side === side ? c.kind : c.kind.toLowerCase();
    }
    return s;
  }
  const fromView = (g, side, [x1, y1, x2, y2]) => (side === 'white' ? [x1, y1, x2, y2] : [g.W - 1 - x1, g.H - 1 - y1, g.W - 1 - x2, g.H - 1 - y2]);

  // The game state a bot gets, in its own view: { ally, opponent, walls, goals, enemyGoals } with each
  // piece as { pid, type, x, y } and each square as { x, y } (goals = its own goal squares,
  // enemyGoals = the enemy's). pid = 1, 2, ..., fixed for the whole game (each side numbers its own
  // pieces); x = 1..W, y = 1..H, (1, 1) = bottom-left (the board itself counts from 0).
  function pieces(g, side) {
    const { W, H } = g;
    const mine = ([x, y]) => (side === 'white' ? { x: x + 1, y: y + 1 } : { x: W - x, y: H - y });
    const byPlace = (a, b) => a.y - b.y || a.x - b.x;
    const out = { ally: [], opponent: [], walls: [], goals: g.goal[side].map(mine).sort(byPlace), enemyGoals: g.goal[other(side)].map(mine).sort(byPlace) };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [rx, ry] = side === 'white' ? [x, y] : [W - 1 - x, H - 1 - y];
      const c = g.board[ry][rx];
      if (g.wall[ry][rx]) out.walls.push({ x: x + 1, y: y + 1 });
      if (c) out[c.side === side ? 'ally' : 'opponent'].push({ pid: +c.id.slice(1) + 1, type: c.kind, x: x + 1, y: y + 1 });
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
    const move = fromView(g, side, [p.x - 1, p.y - 1, p.x - 1 + dx, p.y - 1 + dy]);
    const why = problem(g, side, move);
    return why ? { error: why } : { move };
  }

  const api = { W, H, MAX_TURNS, TURN_LIMITS, SIZE_LIMITS, BEATS, DIRS, GOAL_MODES, defaultGoals, goalSquares, reached, DEFAULT_LAYOUT, other, square, layoutProblem, turnsProblem, newGame, initialBoard, count, problem, legalMoves, apply, forfeit, view, fromView, pieces, fromAnswer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoardRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
