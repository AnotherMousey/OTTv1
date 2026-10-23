// The board game ("Cờ OTT") on the client: piece art, starter bots and docs.
// Needs rps.js (the R / P / S characters) and board-rules.js.
const BOARD_KIND_NAME = { R: 'búa', P: 'bao', S: 'kéo' };
const BOARD_VERB = { R: 'đập', P: 'trùm', S: 'cắt' }; // what each kind does to the one it beats
const BOARD_REASON = {
  goal: 'chạm tới góc đích',
  wipeout: 'ăn sạch quân đối thủ',
  // limit-pieces / -nearest / -distance: games played before the limit became a plain draw
  'limit-pieces': 'hết lượt, còn nhiều quân hơn',
  'limit-nearest': 'hết lượt, có quân gần đích hơn',
  'limit-distance': 'hết lượt, tổng khoảng cách tới đích ngắn hơn',
  'limit-draw': 'hết lượt, hòa',
  forfeit: 'đối thủ bị lỗi hoặc bị treo',
  time: 'đối thủ dùng hết 180 giây CPU của ván',
};

// A piece token for a 64 x 64 box: a team-coloured disc with the R / P / S character on top.
function boardPieceMarkup(kind, color) {
  return `<circle cx="32" cy="34" r="29" fill="${color}" opacity=".9" stroke="#2b2b2b" stroke-width="3.5"/>
    <g transform="translate(9 9) scale(.72)">${rpsMarkup(kind)}</g>`;
}

const BOARD_TEMPLATES = {
  python: `import random

# gameState.ally = your pieces, gameState.opponent = the enemy's pieces. Each piece has
#   .pid (1-9, a piece keeps its number all game), .Type ('R' búa, 'P' bao, 'S' kéo), .x, .y
# Coordinates are 1-9, from your side: (1, 1) is bottom-left and y = 1 is your home row. You win by
# reaching the top-right corner (9, 9) or by capturing every enemy piece; the enemy heads for (1, 1).
# gameState.currentTurn = moves already played (both sides); the game is a draw at gameState.maxTurn.
# Return (pid, direction): move that piece one step. Directions (up = toward y = 9):
#   1 up-left     2 up     3 up-right
#   8 left                 4 right
#   7 down-left   6 down   5 down-right
# Only "import math" / "import random" / "import time" and the play function are allowed; helpers
# go inside play. The limit is 1 s of CPU per move: measure it with time.process_time().
# print() is fine for debugging.

def play(gameState):
    STEP = {1: (-1, 1), 2: (0, 1), 3: (1, 1), 4: (1, 0), 5: (1, -1), 6: (0, -1), 7: (-1, -1), 8: (-1, 0)}
    BEATS = {'R': 'S', 'S': 'P', 'P': 'R'}  # piece -> the piece it captures
    mine = {(p.x, p.y) for p in gameState.ally}
    enemy = {(p.x, p.y): p.Type for p in gameState.opponent}
    moves = []
    for p in gameState.ally:
        for d, (dx, dy) in STEP.items():
            nx, ny = p.x + dx, p.y + dy
            if not (1 <= nx <= 9 and 1 <= ny <= 9) or (nx, ny) in mine:
                continue
            t = enemy.get((nx, ny))
            # an empty square, or an enemy piece this one captures
            if t is None or BEATS[p.Type] == t:
                moves.append((max(9 - nx, 9 - ny), p.pid, d))
    if not moves:
        return (0, 0)  # no move: this turn is skipped
    # head for the goal: the move that ends closest to the top-right corner
    random.shuffle(moves)
    best = min(moves, key=lambda m: m[0])
    return (best[1], best[2])
`,
  cpp: `// gameState.ally = your pieces, gameState.opponent = the enemy's pieces. Each Piece has
//   pid (1-9, a piece keeps its number all game), Type ('R' búa, 'P' bao, 'S' kéo), x, y
// Coordinates are 1-9, from your side: (1, 1) is bottom-left and y = 1 is your home row. You win by
// reaching the top-right corner (9, 9) or by capturing every enemy piece; the enemy heads for (1, 1).
// gameState.currentTurn = moves already played (both sides); the game is a draw at gameState.maxTurn.
// Return {pid, direction}: move that piece one step. Directions (up = toward y = 9):
//   1 up-left     2 up     3 up-right
//   8 left                 4 right
//   7 down-left   6 down   5 down-right
// Don't write main(). The standard headers and the Piece / State structs are already included.
// Globals keep their values for the whole game. Debug with cerr.

std::pair<int, int> play(const State& gameState) {
    const int DX[9] = {0, -1, 0, 1, 1, 1, 0, -1, -1};
    const int DY[9] = {0, 1, 1, 1, 0, -1, -1, -1, 0};
    char at[10][10] = {};  // at[y][x] (1-9): 'R' 'P' 'S' = mine, 'r' 'p' 's' = enemy, 0 = empty
    for (const Piece& p : gameState.ally) at[p.y][p.x] = p.Type;
    for (const Piece& p : gameState.opponent) at[p.y][p.x] = p.Type - 'A' + 'a';
    std::pair<int, int> best{0, 0};  // stays invalid (turn skipped) if there is no move
    int bestDist = 1000;
    for (const Piece& p : gameState.ally)
        for (int d = 1; d <= 8; d++) {
            int nx = p.x + DX[d], ny = p.y + DY[d];
            if (nx < 1 || ny < 1 || nx > 9 || ny > 9) continue;
            char t = at[ny][nx];
            // an empty square, or an enemy piece this one captures
            bool captures = (p.Type == 'R' && t == 's') || (p.Type == 'S' && t == 'p') || (p.Type == 'P' && t == 'r');
            if (t != 0 && !captures) continue;
            // head for the goal: the move that ends closest to the top-right corner
            int dist = std::max(9 - nx, 9 - ny);
            if (dist < bestDist) { bestDist = dist; best = {p.pid, d}; }
        }
    return best;
}
`,
  java: `// gameState.ally = your pieces, gameState.opponent = the enemy's pieces (List<Piece>). Each Piece
// has pid (1-9, a piece keeps its number all game), Type ('R' búa, 'P' bao, 'S' kéo), x, y.
// Coordinates are 1-9, from your side: (1, 1) is bottom-left and y = 1 is your home row. You win by
// reaching the top-right corner (9, 9) or by capturing every enemy piece; the enemy heads for (1, 1).
// gameState.currentTurn = moves already played (both sides); the game is a draw at gameState.maxTurn.
// Return {pid, direction}: move that piece one step. Directions (up = toward y = 9):
//   1 up-left     2 up     3 up-right
//   8 left                 4 right
//   7 down-left   6 down   5 down-right
// The class must be called Bot (no package line). Piece and State are provided.
// One Bot object plays a whole game.

public class Bot {
    static final int[] DX = {0, -1, 0, 1, 1, 1, 0, -1, -1};
    static final int[] DY = {0, 1, 1, 1, 0, -1, -1, -1, 0};

    public int[] play(State gameState) {
        char[][] at = new char[10][10];  // at[y][x] (1-9): 'R' 'P' 'S' = mine, 'r' 'p' 's' = enemy, 0 = empty
        for (Piece p : gameState.ally) at[p.y][p.x] = p.Type;
        for (Piece p : gameState.opponent) at[p.y][p.x] = Character.toLowerCase(p.Type);
        int[] best = {0, 0};  // stays invalid (turn skipped) if there is no move
        int bestDist = 1000;
        for (Piece p : gameState.ally)
            for (int d = 1; d <= 8; d++) {
                int nx = p.x + DX[d], ny = p.y + DY[d];
                if (nx < 1 || ny < 1 || nx > 9 || ny > 9) continue;
                char t = at[ny][nx];
                // an empty square, or an enemy piece this one captures
                boolean captures = (p.Type == 'R' && t == 's') || (p.Type == 'S' && t == 'p') || (p.Type == 'P' && t == 'r');
                if (t != 0 && !captures) continue;
                // head for the goal: the move that ends closest to the top-right corner
                int dist = Math.max(9 - nx, 9 - ny);
                if (dist < bestDist) { bestDist = dist; best = new int[] {p.pid, d}; }
            }
        return best;
    }
}
`,
};

const BOARD_DOCS = {
  python: `<p>Tệp: <code>bot.py</code>, viết một hàm:</p>
    <pre>def play(gameState) -> (pid, direction)

gameState.ally         # list quân của bạn
gameState.opponent     # list quân địch
gameState.maxTurn      # 1000: tới đây thì hòa
gameState.currentTurn  # số nước đã đi trong ván (cả hai bên)
piece.pid, piece.Type, piece.x, piece.y</pre>
    <p>Chỉ được có dòng <code>import math</code> / <code>import random</code> / <code>import time</code> và hàm <code>play</code> (hàm phụ, hằng số đặt bên trong <code>play</code>). Không dùng được thư viện khác, <code>open</code>, <code>eval</code>, class hay tên bắt đầu bằng <code>__</code>. Muốn canh thời gian thì dùng <code>import time</code>: <code>time.process_time()</code> đo đúng thời gian CPU bị tính. Muốn nhớ gì giữa các lượt thì dùng tham số mặc định, ví dụ <code>def play(gameState, memo={})</code>.</p>`,
  cpp: `<p>Tệp: <code>bot.cpp</code> (C++17, biên dịch bằng g++ -O2), viết một hàm:</p>
    <pre>std::pair&lt;int, int&gt; play(const State&amp; gameState);  // trả về {pid, direction}

// có sẵn, đừng khai báo lại:
struct Piece { int pid; char Type; int x, y; };
struct State {
    std::vector&lt;Piece&gt; ally, opponent;
    int maxTurn, currentTurn;
};</pre>
    <p>Chỉ viết hàm (và hàm phụ, struct, biến toàn cục nếu cần). Các thư viện chuẩn thường dùng (<code>vector</code>, <code>string</code>, <code>algorithm</code>, <code>queue</code>, ... hoặc <code>bits/stdc++.h</code>) đã có sẵn. Không được dùng <code>#define</code>/<code>#pragma</code>, include thư viện khác, đọc ghi tệp hay gọi hệ thống. Muốn canh thời gian thì dùng <code>std::chrono::steady_clock::now()</code> (hoặc <code>clock()</code>).</p>`,
  java: `<p>Tệp: <code>Bot.java</code>, một lớp public tên <code>Bot</code> (không có dòng <code>package</code>) với phương thức:</p>
    <pre>public int[] play(State gameState)  // trả về {pid, direction}

// có sẵn, đừng khai báo lại:
class Piece { int pid; char Type; int x, y; }
class State { List&lt;Piece&gt; ally, opponent; int maxTurn, currentTurn; }</pre>
    <p>Chỉ viết lớp <code>Bot</code>. <code>java.util.*</code> và <code>Math</code> luôn có sẵn; không được import gì khác. Trong <code>System</code> chỉ dùng được <code>System.out.println</code>/<code>print</code>/<code>printf</code>, <code>System.nanoTime</code>, <code>System.currentTimeMillis</code>. Không dùng reflection, luồng, tệp hay tiến trình. Muốn canh thời gian thì dùng <code>System.nanoTime()</code>.</p>`,
};

// Rules shared by both modes (the submit page adds the brawl / campaign specifics).
function boardRules(maxTurns, cooldownMs) {
  return `
    <li><b>Bàn cờ 9×9</b>, mỗi bên 9 quân: 3 <b>búa</b> (<code>R</code>), 3 <b>bao</b> (<code>P</code>), 3 <b>kéo</b> (<code>S</code>). Mỗi lượt bot nhận <code>gameState</code>: <code>ally</code> là các quân của bạn, <code>opponent</code> là các quân địch; mỗi quân có <code>pid</code> (số hiệu 1–9, giữ nguyên cả ván), <code>Type</code> (<code>R</code>/<code>P</code>/<code>S</code>), <code>x</code>, <code>y</code> (1–9).</li>
    <li>Bot luôn nhìn bàn cờ <b>từ phía mình</b>: quân của bạn xuất phát ở góc <b>dưới trái</b> (góc <code>(1, 1)</code>, hàng <code>y = 1</code> là hàng nhà), đích của bạn là góc <b>trên phải</b> <code>(9, 9)</code>; đích của địch là góc <code>(1, 1)</code> nhà bạn. Bên đi sau được xoay bàn 180° nên thấy y hệt.</li>
    <li>Bot trả về <b>(pid, hướng)</b>: quân nào đi, đi hướng nào. Hướng (lên = về phía hàng <code>y = 9</code>): <b>1</b> lên-trái, <b>2</b> lên, <b>3</b> lên-phải, <b>4</b> phải, <b>5</b> xuống-phải, <b>6</b> xuống, <b>7</b> xuống-trái, <b>8</b> trái.</li>
    <li>Mỗi lượt đi <b>một quân, một ô</b> theo 8 hướng. Không được đi vào ô có quân mình, hay vào quân địch <b>cùng loại</b> (hai quân cùng loại chặn nhau).</li>
    <li>Đi vào quân địch: <b>búa đập kéo, kéo cắt bao, bao trùm búa</b>. Quân bị khắc thì mất. Lao vào quân khắc mình thì quân của <b>bạn</b> mất, quân địch đứng yên.</li>
    <li><b>Thắng</b> khi có quân chạm góc đích, hoặc ăn hết quân địch. Sau <b>${maxTurns} nước</b> (tính cả hai bên, tức ${maxTurns / 2} nước mỗi bên, kể cả lượt bị mất) mà chưa ai thắng thì <b>hòa</b>.</li>
    <li>Mỗi trận gồm <b>2 ván</b>, mỗi bên được đi trước một ván. Mỗi ván: thắng = <b>3</b> điểm, hòa = <b>1</b>, thua = <b>0</b>.</li>
    <li>Mỗi nước được dùng <b>1 giây CPU</b> (nước đầu của mỗi ván được 10 giây, tính cả lúc khởi động), và cả ván bot được dùng tổng cộng <b>180 giây CPU</b> (mọi nước đều tính, cả nước đầu): dùng hết thì <b>thua ván đó</b>. Giống giới hạn bytecode của Battlecode, chỉ thời gian bot <b>thực sự tính toán</b> mới bị tính, nên máy chủ bận không làm bạn mất lượt. Đo bằng <code>time.process_time()</code> (Python), <code>clock()</code> (C++) hoặc <code>System.nanoTime()</code> (Java, luôn ≥ thời gian CPU).</li>
    <li>Dùng quá 1 giây CPU thì bot <b>bị dừng ngay</b> và <b>mất lượt</b>; lượt sau bot được chạy lại từ đầu, nên mọi thứ bot nhớ giữa các lượt (biến toàn cục, <code>memo</code>) bị mất. Nước đi không hợp lệ, hoặc không trả lời trong 3 giây (bot ngủ hay bị treo) cũng <b>mất lượt</b> (câu trả lời muộn bị bỏ qua). Bot bị lỗi và dừng, hoặc không trả lời 5 lượt liền, thì <b>thua ván đó</b>. Mỗi ván bot được khởi động lại từ đầu.</li>
    <li>Khi nộp, hệ thống biên dịch bot và cho đi thử 5 nước. Chỉ bot ✅ mới được tham gia.</li>
    <li>Mỗi lần nộp cách nhau ít nhất <b>${Math.round(cooldownMs / 1000)} giây</b>.</li>`;
}
