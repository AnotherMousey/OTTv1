# OTTv1 — rock · paper · scissors bot tournaments

A rock-paper-scissors bot tournament site. Players log in, submit a bot (C++, Java or Python) before
a tournament's countdown runs out, and then everyone is pulled into a live leaderboard while the
bots fight it out round by round.

## Running it

Requirements: Node 18+, and for the grader `g++`, `javac`/`java` and `python` on the PATH.

```bash
npm install
npm start            # http://localhost:3000
```

On first start a **judge** account is created and its password is printed in the console
(set `JUDGE_PASSWORD=...` before the first start to choose it yourself).

Players can sign up themselves at `/register` (the judge can switch this off on the Judge desk; new accounts are always players). Accounts can also be added to the `users` list in `data/db.json`. **Stop the server
first**, because a running server keeps its own copy in memory and overwrites the file. Write the
password in plain text:

```json
"users": [
  { "username": "judge", "password": "judgepw", "role": "judge" },
  { "username": "alice", "password": "s3cret", "teamName": "Team Alice" }
]
```

On the next start the server hashes each `password` (and removes the plain text), and fills in
`id`, `createdAt`, `role` (default `player`) and `teamName` (default: the username). To change a
password, put a `password` field back on that user and restart. The same can be done from the command line:

```bash
node scripts/users.js add alice s3cret "Team Alice"     # add --judge for another judge
node scripts/users.js passwd alice newpass
node scripts/users.js list
```

### Quick demo

```bash
npm run demo -- 60   # 7 demo teams (password "demo") + "Demo Cup" closing in 60 s
npm start
```

Log in as e.g. `rocky` / `demo`, wait for the countdown, and you'll be dragged to the live page.

## Tournament modes

The judge picks a mode when creating a tournament (older tournaments without one are brawls):

- **⚔️ Brawl:** the format described below. At the deadline every team's newest working bot enters
  round-robin elimination rounds until a champion is left.
- **🗺️ Campaign:** a race against the 10 sparring bots. Players submit as many bots as they like, and
  each submission picks one sparring bot and plays up to 5 games (100 turns each) against it. A sparring
  bot counts as beaten when one submission wins all 5; the first loss or draw ends that series. A player **finishes** once all 10
  are beaten, by any mix of their submissions. Their finish time is the *submission time* of the bot
  that beat the last remaining one. The leaderboard ranks finishers by finish time, then everyone
  else by bots beaten (earlier progress first). Everyone sees which sparring bots each team has beaten
  (square *i* on the board = bot *i*) and finish times; only the player (and the judge) sees
  their game-by-game results. At the deadline submissions close, bots
  submitted before it finish grading, and the results freeze. No elimination matches are played.

  While a campaign is open the judge can add extra sparring bots to it on the Judge desk
  (**bot đấu tập** button): a name plus code in any of the three languages, written exactly like a
  player's bot. Each is compiled and smoke-tested; once ✅ it joins the list after the 10 built-in
  bots and players must beat it too to finish. Removing a bot also removes the credit for beating it.

### Editing the sparring bots

The 10 built-in bots are written in Python
([server/grader/house_py/](server/grader/house_py/), assembled from shared pieces `_base.py`,
`_predictors.py`, `_meta.py`, `_bayes.py`) and are run by the grader on the server like any other bot. On the
Judge desk (**bot đấu tập** on any open tournament) the judge can open that Python code, change it and
save: it is compiled and given the 5-turn test, and once it passes, *that tournament* uses it instead
of the built-in bot (other tournaments are unaffected; in a brawl it only changes the practice games).
**↺ mặc định** goes back to the original. Bots added to a campaign can be edited the same way
(name, language and code). While a new version is being checked, or if it fails, the last working
version keeps playing. Credit for beating a bot earlier is kept when its code changes.

### Who can take part

When creating a tournament the judge also picks who may enter it:

- **🌍 Every player** (default): everyone sees it and can submit.
- **🔒 Only assigned teams:** players can't join by themselves. The judge ticks the teams that may play
  (Judge desk → **người chơi** on the tournament's row). Everyone else doesn't see the tournament at
  all: it isn't in their list, and they can't submit, open its leaderboard or watch it live. When the
  deadline hits, only the assigned players (and judges) are pulled to the live page. The list can be
  changed, or the tournament switched between the two modes, until the deadline. Removing a team
  that already submitted drops its bots from the tournament.

## How a tournament works (brawl)

1. The judge creates a tournament with a deadline. The main page lists it with a countdown.
2. Players press **Submit code**, pick a language and paste or upload their bot. Each submission
   is compiled and given a 5-turn test run. The newest ✅ submission is the one that plays.
   Every ✅ bot also plays a practice game (100 turns) against each of 10 built-in sparring bots
   ([server/grader/house_py/](server/grader/house_py/)): Kiên Định (one fixed move), Luân Hồi (R→P→S cycle),
   Vô Chiêu (random), Tâm Ma (copies you), Tùy Duyên (win-stay/lose-shift), Liệu Địch (frequency analysis),
   Thức Thời (decay/window), Thiên Cơ (Markov chain), Mưu Lược (n-gram) and Minh Triết (Bayesian inference).
   The submit page shows a practice board with every team's total (max 3000). Only you (and the judge)
   can open your per-bot scores. Practice games don't affect the tournament.
3. When the countdown hits zero, submissions close and **every logged-in user (judge too) is
   redirected** to the tournament's live page. Players see only the leaderboard. The judge also
   sees a feed of finished matches with replay links.
4. Every round is a **round robin** among the remaining teams. After a round the
   `min(3, t − 2)` lowest teams (t = teams in the round) are eliminated. Ties are broken by
   match wins, then total points over all rounds, then earliest submission. When 2 teams remain
   they play the final.
5. Each match is **100 turns**: win = 3 points, draw = 1, loss = 0. Players can submit at most once every 90 seconds.
6. Once the tournament is finished, everyone can watch every replay.

## Writing a bot

| Language | File | Signature |
|---|---|---|
| Python | `bot.py` | `def play(my_moves, opponent_moves) -> str` |
| C++17 | `bot.cpp` | `char play(const std::vector<char>& myMoves, const std::vector<char>& opponentMoves)` |
| Java | `Bot.java` | `public class Bot { public char play(List<Character> myMoves, List<Character> opponentMoves) }` |

The histories hold every previous turn, oldest first (`'R'`, `'P'`, `'S'`; `'X'` = a forfeited turn).
Return `R`, `P` or `S`. The bot process lives for the whole match, so statics, fields and (Python) a
default argument like `memo={}` keep their state.

Player code is restricted so it can only compute a move. It can't read files (other bots' code,
`data/db.json`), start processes or use the network:

- **Python:** only `import math` / `import random` and one `def play(...)`. Everything else goes inside
  `play`. No other imports, classes, generators, `match`, names starting with `__`, attributes other
  than methods of the basic types and `math`/`random`, and only safe builtins (no `open`, `eval`,
  `getattr`, ...). Checked by [runner.py](server/grader/harness/runner.py) on submit and again at
  run time, where the code also runs with a restricted builtins table.
- **C++:** just the functions. The headers in [prelude.hpp](server/grader/harness/prelude.hpp) are
  always available. `#include` of one of them (or `bits/stdc++.h`) is accepted, and any other
  preprocessor line is rejected. So are `extern`, `asm`, `reinterpret_cast`, names starting with `_`
  and file/process/network functions.
- **Java:** just the `Bot` class. `java.util.*` and `Math` are available, nothing else may be
  imported, and fully-qualified `java.` names, reflection (`getClass`, `.class`, `Class`), `Runtime`,
  `Thread` and `System` (except `System.out`/`err` printing and the clocks) are rejected.

C++ and Java are checked in [restrict.js](server/grader/restrict.js). Built-in and judge-written
bots are trusted and not restricted. Builds made before these rules existed are rebuilt (and
re-checked) before they play. Printing is allowed: only lines starting with `MOVE ` are read. You get 1 s per move
(10 s for the first). A crash or timeout forfeits the rest of the match.
See [examples/](examples/) for sample bots.

Under the hood each language has a small harness ([server/grader/harness/](server/grader/harness/))
that speaks a line protocol with the grader: `TURN <myPrev> <oppPrev>` in, `MOVE <R|P|S>` out.

## Data

Everything is stored in `data/db.json`:

- `users`: accounts (passwords hashed with scrypt)
- `tournaments`: deadline, status, entries, rounds and eliminations
- `submissions`: code plus compile/test results
- `matches[<tournamentId>]["round X - team A vs team B"]`: both move strings, scores, winner

Compiled bots go in `data/builds/`. If the server restarts mid-tournament it resumes where it
left off; matches already played are kept.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `JUDGE_PASSWORD` | random | password for the auto-created judge |
| `PYTHON_CMD` | `python` (Windows) / `python3` | Python interpreter |
| `CXX`, `JAVAC`, `JAVA` | `g++`, `javac`, `java` | compilers/runtimes |
| `PARALLEL_MATCHES` | CPUs / 2 | matches run at the same time |
| `MATCH_PACE_MS` | 1500 | minimum time per match, so the live leaderboard has some drama |
| `ROUND_BREAK_MS` | 5000 | pause between rounds |
| `PRACTICE_PARALLEL` | 2 | practice games run at the same time |
| `SIGNUP_LIMIT` | 30 | max self-registrations per hour from one IP address |
| `TURNS` | 100 | turns per game |
| `CAMPAIGN_GAMES` | 5 | games a campaign submission must win in a row to beat a sparring bot |
| `SUBMIT_COOLDOWN_MS` | 90000 | minimum time between two submissions from one player |
| `MOVE_TIMEOUT_MS` / `FIRST_MOVE_TIMEOUT_MS` | 1000 / 10000 | per-move time limits |

## ⚠️ Security note

Submitted code runs as ordinary processes on the server with no sandbox. Only run this for people
you trust, or inside a VM/container.
