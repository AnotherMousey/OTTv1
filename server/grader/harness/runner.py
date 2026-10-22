# Grader harness for Python bots. Your bot.py must define:
#   def play(my_moves, opponent_moves) -> str                      (rock-paper-scissors)
#   def play(board, turn, max_turns) -> (x1, y1, x2, y2)            (board game, with --board)
#
#   python _runner.py bot.py                 trusted code (built-in and judge bots): runs as is
#   python _runner.py --restricted bot.py    player code: checked, then run with safe builtins only
#   python _runner.py --check bot.py         only check player code (prints the problem, exit 1)
#   --board (as the first argument)          speak the board game protocol instead of RPS
#
# Player code may only contain `import math` / `import random` (or `from ... import`) and one
# `def play(...)`. Inside it: no underscore names, only whitelisted attributes (methods of
# str/list/dict/set/tuple/int/float and functions of math/random), no classes, generators,
# `match` or imports, and only the builtins in SAFE_BUILTINS.
import ast
import builtins
import math
import random
import sys
import types

ALLOWED_MODULES = {"math": math, "random": random}

SAFE_BUILTINS = {n: getattr(builtins, n) for n in (
    "abs all any bool chr dict divmod enumerate filter float frozenset int isinstance iter len "
    "list map max min next ord pow print range reversed round set slice sorted str sum tuple zip "
    "Exception ArithmeticError IndexError KeyError LookupError StopIteration TypeError ValueError "
    "ZeroDivisionError"
).split()}


def _public(obj):
    return {n for n in dir(obj) if not n.startswith("_")}


ALLOWED_ATTRS = set().union(*(_public(t) for t in (str, list, dict, set, frozenset, tuple, int, float, bool, random.Random)))
for _m in ALLOWED_MODULES.values():
    ALLOWED_ATTRS |= {n for n in _public(_m) if not isinstance(getattr(_m, n), types.ModuleType)}
ALLOWED_ATTRS -= {"format", "format_map"}  # format strings can walk attributes

FORBIDDEN_NODES = {
    ast.ClassDef: "khai báo class", ast.AsyncFunctionDef: "async", ast.Await: "await",
    ast.AsyncFor: "async for", ast.AsyncWith: "async with", ast.Yield: "yield",
    ast.YieldFrom: "yield from", ast.Match: "match", ast.Import: "import bên trong hàm",
    ast.ImportFrom: "import bên trong hàm",
}


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level == 0 and name in ALLOWED_MODULES:
        return ALLOWED_MODULES[name]
    raise ImportError("chỉ được import math và random")


def check(src, board=False):
    """Returns None if the code is allowed, otherwise a message saying why not."""
    signature = "play(board, turn, max_turns)" if board else "play(my_moves, opponent_moves)"
    min_args = 3 if board else 2
    try:
        tree = ast.parse(src, "bot.py")
    except SyntaxError as e:
        return f"Dòng {e.lineno}: lỗi cú pháp ({e.msg})"
    bad = lambda node, why: f"Dòng {getattr(node, 'lineno', '?')}: {why}"

    plays = 0
    bound = set()
    for node in tree.body:
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name not in ALLOWED_MODULES:
                    return bad(node, f"không được import `{a.name}` (chỉ được dùng math và random)")
                bound.add(a.asname or a.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level or node.module not in ALLOWED_MODULES:
                return bad(node, f"không được import từ `{node.module}` (chỉ được dùng math và random)")
            for a in node.names:
                if a.name == "*" or a.name not in ALLOWED_ATTRS:
                    return bad(node, f"không được import `{a.name}` từ {node.module}")
                bound.add(a.asname or a.name)
        elif isinstance(node, ast.FunctionDef) and node.name == "play":
            plays += 1
            if node.decorator_list:
                return bad(node, "hàm play không được có decorator")
            if len(node.args.args) < min_args:
                return bad(node, f"hàm play phải nhận {min_args} tham số: {signature}")
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            pass  # docstring
        else:
            return bad(node, "ngoài hàm play chỉ được có dòng import math / import random")
    if plays != 1:
        return f"Bài nộp phải có đúng một hàm `def {signature}`"

    for node in ast.walk(tree):
        if node in tree.body and isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        for kind, what in FORBIDDEN_NODES.items():
            if isinstance(node, kind):
                return bad(node, f"không được dùng {what}")
        names = []
        if isinstance(node, ast.Name):
            names.append(node.id)
            if not isinstance(node.ctx, ast.Load):
                bound.add(node.id)
        elif isinstance(node, ast.arg):
            names.append(node.arg)
            bound.add(node.arg)
        elif isinstance(node, (ast.FunctionDef, ast.Global, ast.Nonlocal, ast.ExceptHandler, ast.keyword)):
            got = getattr(node, "names", None) or [getattr(node, "name", None) or getattr(node, "arg", None)]
            names += [n for n in got if n]
            if not isinstance(node, ast.keyword):
                bound.update(names)
        elif isinstance(node, ast.Attribute):
            if node.attr not in ALLOWED_ATTRS:
                return bad(node, f"không được dùng thuộc tính `.{node.attr}`")
        for n in names:
            if n.startswith("__"):
                return bad(node, f"không được dùng tên `{n}`")

    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id not in bound and node.id not in SAFE_BUILTINS:
            return bad(node, f"không được dùng `{node.id}`")
    return None


def load_restricted(path, board=False):
    src = open(path, encoding="utf-8").read()
    problem = check(src, board)
    if problem:
        sys.stderr.write(problem + "\n")
        sys.exit(1)
    env = {"__builtins__": {**SAFE_BUILTINS, "__import__": _safe_import}, "__name__": "bot"}
    exec(compile(src, "bot.py", "exec"), env)
    return env["play"]


def load_trusted(path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("bot", path)
    bot = importlib.util.module_from_spec(spec)
    sys.modules["bot"] = bot
    spec.loader.exec_module(bot)
    return bot.play


def board_move(play, line):
    # "TURN <turn> <maxTurns> <W> <H> <cells>" -> board[y][x], a list of rows of 1-letter strings
    parts = line.split()
    turn, max_turns, w, h, cells = int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4]), parts[5]
    board = [list(cells[y * w:(y + 1) * w]) for y in range(h)]
    move = play(board, turn, max_turns)
    try:
        return " ".join(str(int(v)) for v in move)
    except (TypeError, ValueError):
        return " ".join(str(move).split())[:30] or "X"


def main():
    args = sys.argv[1:]
    board = args[0] == "--board"
    if board:
        args = args[1:]
    if args[0] == "--check":
        problem = check(open(args[1], encoding="utf-8").read(), board)
        if problem:
            sys.stderr.write(problem + "\n")
            sys.exit(1)
        return

    real_stdout = sys.stdout
    sys.stdout = sys.stderr  # anything the bot prints goes to stderr
    play = load_restricted(args[1], board) if args[0] == "--restricted" else load_trusted(args[0])

    mine, theirs = [], []
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if line == "END":
            break
        if board:
            if line.startswith("TURN "):
                real_stdout.write("\nMOVE " + board_move(play, line) + "\n")
                real_stdout.flush()
            continue
        if not line.startswith("TURN ") or len(line) < 8:
            continue
        me, them = line[5], line[7]
        if me != "-":
            mine.append(me)
            theirs.append(them)
        move = " ".join(str(play(list(mine), list(theirs))).split())[:20] or "X"
        real_stdout.write("\nMOVE " + move + "\n")
        real_stdout.flush()


main()
