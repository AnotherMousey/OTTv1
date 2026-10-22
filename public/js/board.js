// The board game ("Cờ OTT") on the client: piece art, starter bots and docs.
// Needs rps.js (the R / P / S characters) and board-rules.js.
const BOARD_KIND_NAME = { R: 'búa', P: 'bao', S: 'kéo' };
const BOARD_VERB = { R: 'đập', P: 'trùm', S: 'cắt' }; // what each kind does to the one it beats
const BOARD_REASON = {
  goal: 'chạm tới góc đích',
  wipeout: 'ăn sạch quân đối thủ',
  'limit-pieces': 'hết lượt, còn nhiều quân hơn',
  'limit-nearest': 'hết lượt, có quân gần đích hơn',
  'limit-distance': 'hết lượt, tổng khoảng cách tới đích ngắn hơn',
  'limit-draw': 'hết lượt, bất phân thắng bại',
  forfeit: 'đối thủ bị lỗi hoặc quá giờ',
};

// A piece token for a 64 x 64 box: a team-coloured disc with the R / P / S character on top.
function boardPieceMarkup(kind, color) {
  return `<circle cx="32" cy="34" r="29" fill="${color}" opacity=".9" stroke="#2b2b2b" stroke-width="3.5"/>
    <g transform="translate(9 9) scale(.72)">${rpsMarkup(kind)}</g>`;
}

const BOARD_TEMPLATES = {
  python: `import random

# board[y][x]: 'R' 'P' 'S' = your pieces (búa, bao, kéo), 'r' 'p' 's' = enemy pieces, '.' = empty.
# y = 0 is your home row: you start bottom-left and win by reaching the top-right corner
# (x = W - 1, y = H - 1) or by capturing every enemy piece. The enemy heads for (0, 0).
# Return (x1, y1, x2, y2): move your piece at (x1, y1) one step, in any of 8 directions.
# turn = moves already played in this game (both sides), max_turns = when the game stops.
# Only "import math" / "import random" and the play function are allowed; helpers go inside
# play. print() is fine for debugging.

def play(board, turn, max_turns):
    H, W = len(board), len(board[0])
    BEATS = {'R': 'S', 'S': 'P', 'P': 'R'}  # piece -> the piece it captures
    moves = []
    for y in range(H):
        for x in range(W):
            me = board[y][x]
            if me not in ('R', 'P', 'S'):
                continue
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if (dx or dy) and 0 <= nx < W and 0 <= ny < H:
                        t = board[ny][nx]
                        # an empty square, or an enemy piece this one captures
                        if t == '.' or (t in ('r', 'p', 's') and BEATS[me] == t.upper()):
                            moves.append((x, y, nx, ny))
    if not moves:
        return (0, 0, 0, 0)  # no move: this turn is skipped
    # head for the goal: the move that ends closest to the top-right corner
    random.shuffle(moves)
    return min(moves, key=lambda m: max(W - 1 - m[2], H - 1 - m[3]))
`,
  cpp: `// board[y][x]: 'R' 'P' 'S' = your pieces (búa, bao, kéo), 'r' 'p' 's' = enemy pieces, '.' = empty.
// y = 0 is your home row: you start bottom-left and win by reaching the top-right corner
// (x = W - 1, y = H - 1) or by capturing every enemy piece. The enemy heads for (0, 0).
// Return Move{fromX, fromY, toX, toY}: one step, in any of 8 directions.
// turn = moves already played in this game (both sides), maxTurns = when the game stops.
// Don't write main(). The standard headers and the Move struct are already included.
// Globals keep their values for the whole game. Debug with cerr.

Move play(const std::vector<std::string>& board, int turn, int maxTurns) {
    int H = board.size(), W = board[0].size();
    Move best{0, 0, 0, 0};  // stays invalid (turn skipped) if there is no move
    int bestDist = 1000;
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) {
            char me = board[y][x];
            if (me != 'R' && me != 'P' && me != 'S') continue;
            for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++) {
                    int nx = x + dx, ny = y + dy;
                    if ((dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    char t = board[ny][nx];
                    bool captures = (me == 'R' && t == 's') || (me == 'S' && t == 'p') || (me == 'P' && t == 'r');
                    if (t != '.' && !captures) continue;
                    // head for the goal: the move that ends closest to the top-right corner
                    int d = std::max(W - 1 - nx, H - 1 - ny);
                    if (d < bestDist) { bestDist = d; best = {x, y, nx, ny}; }
                }
        }
    return best;
}
`,
  java: `// board[y][x]: 'R' 'P' 'S' = your pieces (búa, bao, kéo), 'r' 'p' 's' = enemy pieces, '.' = empty.
// y = 0 is your home row: you start bottom-left and win by reaching the top-right corner
// (x = W - 1, y = H - 1) or by capturing every enemy piece. The enemy heads for (0, 0).
// Return {fromX, fromY, toX, toY}: one step, in any of 8 directions.
// turn = moves already played in this game (both sides), maxTurns = when the game stops.
// The class must be called Bot (no package line). One Bot object plays a whole game.

public class Bot {
    public int[] play(char[][] board, int turn, int maxTurns) {
        int H = board.length, W = board[0].length;
        int[] best = {0, 0, 0, 0};  // stays invalid (turn skipped) if there is no move
        int bestDist = 1000;
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++) {
                char me = board[y][x];
                if (me != 'R' && me != 'P' && me != 'S') continue;
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++) {
                        int nx = x + dx, ny = y + dy;
                        if ((dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                        char t = board[ny][nx];
                        boolean captures = (me == 'R' && t == 's') || (me == 'S' && t == 'p') || (me == 'P' && t == 'r');
                        if (t != '.' && !captures) continue;
                        // head for the goal: the move that ends closest to the top-right corner
                        int d = Math.max(W - 1 - nx, H - 1 - ny);
                        if (d < bestDist) { bestDist = d; best = new int[] {x, y, nx, ny}; }
                    }
            }
        return best;
    }
}
`,
};

const BOARD_DOCS = {
  python: `<p>Tệp: <code>bot.py</code>, viết một hàm:</p>
    <pre>def play(board: list[list[str]], turn: int, max_turns: int) -> (x1, y1, x2, y2)</pre>
    <p>Chỉ được có dòng <code>import math</code> / <code>import random</code> và hàm <code>play</code> (hàm phụ, hằng số đặt bên trong <code>play</code>). Không dùng được thư viện khác, <code>open</code>, <code>eval</code>, class hay tên bắt đầu bằng <code>__</code>. Muốn nhớ gì giữa các lượt thì dùng tham số mặc định, ví dụ <code>memo={}</code>.</p>`,
  cpp: `<p>Tệp: <code>bot.cpp</code> (C++17, biên dịch bằng g++ -O2), viết một hàm:</p>
    <pre>Move play(const std::vector&lt;std::string&gt;&amp; board, int turn, int maxTurns);
struct Move { int fromX, fromY, toX, toY; };  // có sẵn, đừng khai báo lại</pre>
    <p>Chỉ viết hàm (và hàm phụ, struct, biến toàn cục nếu cần). Các thư viện chuẩn thường dùng (<code>vector</code>, <code>string</code>, <code>algorithm</code>, <code>queue</code>, ... hoặc <code>bits/stdc++.h</code>) đã có sẵn. Không được dùng <code>#define</code>/<code>#pragma</code>, include thư viện khác, đọc ghi tệp hay gọi hệ thống.</p>`,
  java: `<p>Tệp: <code>Bot.java</code>, một lớp public tên <code>Bot</code> (không có dòng <code>package</code>) với phương thức:</p>
    <pre>public int[] play(char[][] board, int turn, int maxTurns)  // trả về {fromX, fromY, toX, toY}</pre>
    <p>Chỉ viết lớp <code>Bot</code>. <code>java.util.*</code> và <code>Math</code> luôn có sẵn; không được import gì khác. Trong <code>System</code> chỉ dùng được <code>System.out.println</code>/<code>print</code>/<code>printf</code>, <code>System.nanoTime</code>, <code>System.currentTimeMillis</code>. Không dùng reflection, luồng, tệp hay tiến trình.</p>`,
};

// Rules shared by both modes (the submit page adds the brawl / campaign specifics).
function boardRules(maxTurns, cooldownMs) {
  return `
    <li><b>Bàn cờ 9×9</b>, mỗi bên 9 quân: 3 <b>búa</b> (<code>R</code>), 3 <b>bao</b> (<code>P</code>), 3 <b>kéo</b> (<code>S</code>). <code>board[y][x]</code>: chữ hoa là quân của bạn, chữ thường là quân địch, <code>.</code> là ô trống.</li>
    <li>Bot luôn nhìn bàn cờ <b>từ phía mình</b>: quân của bạn xuất phát ở góc <b>dưới trái</b> (hàng <code>y = 0</code> là hàng nhà), đích của bạn là góc <b>trên phải</b> <code>(8, 8)</code>; đích của địch là góc <code>(0, 0)</code> nhà bạn. Bên đi sau được xoay bàn 180° nên thấy y hệt.</li>
    <li>Mỗi lượt đi <b>một quân, một ô</b> theo 8 hướng. Không được đi vào ô có quân mình, hay vào quân địch <b>cùng loại</b> (hai quân cùng loại chặn nhau).</li>
    <li>Đi vào quân địch: <b>búa đập kéo, kéo cắt bao, bao trùm búa</b>. Quân bị khắc thì mất. Lao vào quân khắc mình thì quân của <b>bạn</b> mất, quân địch đứng yên.</li>
    <li><b>Thắng</b> khi có quân chạm góc đích, hoặc ăn hết quân địch. Sau <b>${maxTurns} nước</b> (tính cả hai bên) mà chưa ai thắng: bên còn nhiều quân hơn thắng, rồi bên có quân gần đích nhất, rồi bên có tổng khoảng cách tới đích ngắn hơn; nếu vẫn bằng thì hòa. Khoảng cách = số bước vua đi, <code>max(|dx|, |dy|)</code>.</li>
    <li>Mỗi trận gồm <b>2 ván</b>, mỗi bên được đi trước một ván. Mỗi ván: thắng = <b>3</b> điểm, hòa = <b>1</b>, thua = <b>0</b>.</li>
    <li>Bạn có <b>1 giây</b> cho mỗi nước (nước đầu của mỗi ván được 10 giây). Nước đi không hợp lệ thì <b>mất lượt</b>. Bot bị lỗi hoặc quá giờ thì <b>thua ván đó</b>. Mỗi ván bot được khởi động lại từ đầu.</li>
    <li>Khi nộp, hệ thống biên dịch bot và cho đi thử 5 nước. Chỉ bot ✅ mới được tham gia.</li>
    <li>Mỗi lần nộp cách nhau ít nhất <b>${Math.round(cooldownMs / 1000)} giây</b>.</li>`;
}
