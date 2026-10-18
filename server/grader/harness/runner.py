# Grader harness for Python bots. Your bot.py must define:
#   def play(my_moves, opponent_moves) -> str
import importlib.util
import sys

real_stdout = sys.stdout
sys.stdout = sys.stderr  # anything the bot prints goes to stderr

spec = importlib.util.spec_from_file_location("bot", sys.argv[1])
bot = importlib.util.module_from_spec(spec)
sys.modules["bot"] = bot
spec.loader.exec_module(bot)
play = bot.play

mine, theirs = [], []
while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if line == "END":
        break
    if not line.startswith("TURN ") or len(line) < 8:
        continue
    me, them = line[5], line[7]
    if me != "-":
        mine.append(me)
        theirs.append(them)
    move = " ".join(str(play(list(mine), list(theirs))).split())[:20] or "X"
    real_stdout.write("\nMOVE " + move + "\n")
    real_stdout.flush()
