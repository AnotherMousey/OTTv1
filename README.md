# OTTv1 — rock · paper · scissors bot tournaments

A rock-paper-scissors bot tournament site. Players log in, submit a bot (C++, Java or Python) before
a tournament's countdown runs out, and then everyone is pulled into a live leaderboard while the
bots fight it out round by round.

## Running it

### In production: Docker + PostgreSQL

On a server with Docker (with the Compose plugin):

```bash
cp .env.example .env      # then set HOST_DATA_DIR, POSTGRES_PASSWORD (and JUDGE_PASSWORD)
docker compose up -d --build
docker compose logs -f app
```

This starts three things (see [docker-compose.yml](docker-compose.yml)):

- **db**: PostgreSQL 16. Its data lives in the `pgdata` Docker volume and survives rebuilds and restarts.
- **bot-image**: builds the sandbox image `ottv1-bot` ([docker/bot.Dockerfile](docker/bot.Dockerfile):
  g++, JDK 17, Python 3), then exits.
- **app**: the web server on `PORT`. It runs no submitted code itself. Every compile, check and bot
  process runs in its **own throwaway container** from `ottv1-bot`, started through the host's Docker
  (the app gets `/var/run/docker.sock`). Each container has no network, `SANDBOX_MEMORY` (512 MB),
  `SANDBOX_CPUS` (1 CPU), at most `SANDBOX_PIDS` (128) processes, no capabilities, a read-only
  filesystem except a small `/tmp`, and runs as `nobody`. It sees only that one submission's build
  folder, read-only while the bot plays. A bot that times out has its container removed.

The startup log says whether the sandbox is ready (`[grader] Docker sandbox ready`). Compiled bots go in
`HOST_DATA_DIR/builds` on the host. Back up the database with
`docker compose exec db pg_dump -U ottv1 ottv1 > backup.sql`.

**Moving an existing `data/db.json` over:** put it in `HOST_DATA_DIR` before the first start. When the
database is empty, the server imports it (users, tournaments, submissions with their code, matches)
and renames the file to `db.json.imported-<date>`.

Note: access to the Docker socket is equivalent to root on the host, so keep the app container
(and the server) to yourself. Players' code never gets it: it only ever runs in the sandbox containers.

### Locally, for development

Requirements: Node 18+, and `g++`, `javac`/`java` and `python` on the PATH.

```bash
npm install
npm start            # http://localhost:3000
```

Without `DATABASE_URL` everything is kept in `data/db.json`, and without `SANDBOX=docker` submitted
code runs as ordinary processes. Both are fine for trying things out, not for an event. Set
`DATABASE_URL=postgres://user:pass@host:5432/db` (a UTF-8 database) to use PostgreSQL locally, and
`SANDBOX=docker` (after `docker build -f docker/bot.Dockerfile -t ottv1-bot .`) to use the sandbox.

On first start a **judge** account is created and its password is printed in the console
(set `JUDGE_PASSWORD=...` before the first start to choose it yourself).

Players can sign up themselves at `/register` (the judge can switch this off on the Judge desk; new accounts are always players). With the JSON file, accounts can also be added to the `users` list in `data/db.json`. **Stop the server
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
password, put a `password` field back on that user and restart. The same can be done from the command
line, which also works with PostgreSQL (stop the server first there too, then start it again):

```bash
node scripts/users.js add alice s3cret "Team Alice"     # add --judge for another judge
node scripts/users.js passwd alice newpass
node scripts/users.js list
# in Docker:
docker compose stop app && docker compose run --rm app node scripts/users.js passwd alice newpass && docker compose start app
```

### Quick demo

```bash
npm run demo -- 60   # 7 demo teams (password "demo") + "Demo Cup" closing in 60 s
npm start
```

Log in as e.g. `rocky` / `demo`. The demo brawl plays its daily round robin at the deadline's time of
day (the judge can also press **⚡ đấu ngay**), and the results appear on its leaderboard 10 minutes later.

## Games

When creating a tournament the judge also picks the game (older tournaments are rock-paper-scissors).
Brawl, campaign, invite-only and hidden tournaments work the same way for both.

- **✊ Oẳn tù tì:** the rock-paper-scissors game described in the rest of this file.
- **♟️ Cờ OTT** (after [OTTv2](https://github.com/AnotherMousey/OTTv2)): a 9×9 board, 9 pieces a side
  (3 búa / R, 3 bao / P, 3 kéo / S). A piece moves one square in any of 8 directions. It can't move onto
  its own piece or onto an enemy of the same kind. Moving onto an enemy it beats (R > S > P > R)
  captures it, and moving onto one that beats it loses the attacker. You win by reaching the enemy's
  home corner or by eliminating every enemy piece. After 1000 moves (both sides) the game is a draw.
  Each move may use 1 second of **CPU time** (10 s for a game's first move, start-up included), and a bot may use 180 s of CPU over a whole game (`GAME_CPU_MS`); past that it loses the game. As with
  Battlecode's bytecode limit, only the bot's own computation counts, so a busy server doesn't cost it
  turns: every board bot runs under [meter.py](server/grader/harness/meter.py), which reads the bot's
  CPU time (`/proc` on Linux) every few ms. The moment a move goes over 1 s of CPU the meter kills the
  bot, the turn is lost and the bot is started afresh for its next turn (anything it kept in memory is
  gone). The wall clock only catches bots that
  wait or hang (3 s, `MOVE_WALL_MS`). An illegal move, too much CPU or no answer loses the turn (a late
  answer is thrown away); a bot that crashes, or misses 5 turns in a row, loses the game. A match is
  2 games, one with each side moving first, scored 3 / 1 / 0 per game (6 points max). In a campaign
  each of the 5 games in a series is a single game, with the sides taking turns at moving first.
  Rules live in [board-rules.js](public/js/board-rules.js), shared by the grader and the replay page.

  Bots always see the board from their own side (black's view is rotated 180°): you start
  bottom-left at `(1, 1)`, your goal is the top-right corner `(9, 9)`, and the enemy's goal is `(1, 1)`.
  Every turn the bot gets `gameState`: `ally` (its pieces), `opponent` (the enemy's), `maxTurn`
  (1000) and `currentTurn` (moves played so far, both sides). Each piece has `pid` (1–9, kept for
  the whole game), `Type` (`'R'`, `'P'` or `'S'`), `x` and `y` (1–9). The bot returns
  `(pid, direction)`, direction 1–8 clockwise from up-left: 1 up-left, 2 up, 3 up-right, 4 right,
  5 down-right, 6 down, 7 down-left, 8 left (up = toward its goal row).

  | Language | Signature |
  |---|---|
  | Python | `def play(gameState) -> (pid, direction)` |
  | C++17 | `std::pair<int, int> play(const State& gameState)` (`struct Piece { int pid; char Type; int x, y; }` and `struct State { std::vector<Piece> ally, opponent; int maxTurn, currentTurn; }` are provided) |
  | Java | `public int[] play(State gameState)` returning `{pid, direction}` (`Piece` and `State` with `List<Piece>` fields are provided) |

  The same player-code restrictions apply. Each game starts the bot as a fresh process. Protocol:
  `STATE <currentTurn> <maxTurn> <n> <pid type x y>… <m> <pid type x y>…` in (ally pieces, then
  opponent pieces), `MOVE <pid> <direction>` out
  ([harness/board/](server/grader/harness/board/), plus `--board` in [runner.py](server/grader/harness/runner.py)).
  The 5 built-in sparring bots, easiest first, are Thẳng Tiến (races for the corner),
  Thận Trọng (one move ahead, never hangs a piece), Săn Mồi (hunter), Tính Toán (2-ply minimax) and
  Thấu Suốt (iterative-deepening alpha-beta), in [house_board_py/](server/grader/house_board_py/).
  The judge can edit them per tournament like the RPS ones.

## Tournament modes

The judge picks a mode when creating a tournament (older tournaments without one are brawls):

- **⚔️ Brawl:** a league played in **rounds** (vòng), described below. Every day at the judge's chosen
  time a round starts (the judge can add more with **⚡ đấu ngay**), and every team's newest working
  bot plays in it. Points add up round after round until the end date.
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

1. The judge creates a tournament with an end date (the deadline) and a **daily match time**, e.g. 21:00,
   in the judge's own time zone. Creating it is refused if that time never falls between the start and
   the end. The main page shows the next round and the end date.
2. Players press **Submit code**, pick a language and paste or upload their bot. Each submission
   is compiled and given a 5-turn test run. The newest ✅ submission is the one that plays.
   Every ✅ bot also plays a practice game (100 turns) against each of 10 built-in sparring bots
   ([server/grader/house_py/](server/grader/house_py/)): Kiên Định (one fixed move), Luân Hồi (R→P→S cycle),
   Vô Chiêu (random), Tâm Ma (copies you), Tùy Duyên (win-stay/lose-shift), Liệu Địch (frequency analysis),
   Thức Thời (decay/window), Thiên Cơ (Markov chain), Mưu Lược (n-gram) and Minh Triết (Bayesian inference).
   The submit page shows a practice board with every team's total (max 3000). Only you (and the judge)
   can open your per-bot scores. Practice games don't affect the tournament.
3. **A round** starts every day at the match time (from the start until the end date), and whenever
   the judge presses **⚡ đấu ngay**. Each team's newest ✅ bot submitted before that moment plays. The
   judge picks the pairing (and can change it for later rounds): **round robin** (every other team
   once) or **Swiss**: ⌈log₂(teams)⌉ stages (đợt) per round, each stage pairing teams with similar
   points (all rounds so far, this round's earlier stages included) and never the same two teams twice
   in a round; with an odd number of teams the lowest-ranked team that hasn't had a bye in that round
   sits the stage out and scores a win. Swiss keeps big tournaments manageable: 1000 teams play 10
   stages (5,000 matches) a round instead of 499,500. A match (100 RPS turns, or 2 board games with the
   sides swapped) scores **win = 3, draw = 1, loss = 0**. Submissions stay open throughout the
   tournament, except from the start of each round until its results are published; a new bot plays
   from the next round on.
   **Evaluation:** a team's evaluation points are the practice score of its newest ✅ bot (its
   total against the sparring bots, the same number as on the practice board), updated as soon as
   practice finishes. The ranking table shows each team's evaluation points, the points it gained in
   each round (one column per round, scrolling sideways) and its **total points**. It sorts by total
   points, then evaluation points.
4. A round's results stay hidden for **10 minutes** (`PUBLISH_DELAY_MS`), or until its last match ends
   if that takes longer. Then the cumulative standings update for everyone, and everyone can replay that
   round's matches. Before that only the judge sees the matches (on the live page, marked
   "chưa công bố"). The standings rank by points, then match wins, then the "điểm phụ" (total score
   in all matches). The live page counts down to the next round or to the next publication.
5. On the Judge desk the judge can change the daily time (it applies from the next occurrence, never
   retroactively to a time already passed today), add an extra round with **⚡ đấu ngay**, or end the
   tournament early (**kết thúc giải ngay**). After the end date, submissions close, the last round still
   publishes, and the top team becomes champion. Players can submit at most once every 90 seconds.
6. If the server is down at a match time, that round is played as soon as it is back, and a round cut
   off by a restart resumes where it stopped.

Brawls created before the daily league keep their elimination rounds in their records. Old brawls that
were still open become daily leagues, playing at their deadline's time of day.

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

- **Python:** only `import math` / `import random` / `import time` and one `def play(...)`. Everything
  else goes inside `play`. `time` offers only the clocks (`time`, `perf_counter`, `monotonic`,
  `process_time` and their `_ns` forms) and `sleep`. No other imports, classes, generators, `match`,
  names starting with `__`, attributes other than methods of the basic types and `math`/`random`/`time`, and only safe builtins (no `open`, `eval`,
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

With PostgreSQL (`DATABASE_URL`, see [server/db.js](server/db.js)), the tables are:

- `users`, `tournaments`: one JSONB document per row (accounts with scrypt password hashes;
  tournaments with their schedule, days, evaluations and judge bots)
- `submissions`: compile/test/practice results as a JSONB document, plus the source `code` column
- `matches`: one row per match: `summary` (teams, scores, winner, day/round) and `detail` (every move)
- `sessions`: logins, so they survive restarts. `meta`: site settings.

The server keeps the small data in memory (accounts, tournaments, submission results, match
summaries) and writes changes within 0.3 s. Source code and move logs stay in the database and are
read when needed (compiling, the submit page, a replay). Without `DATABASE_URL` the same data goes into
`data/db.json` (`codes` and `matchDetails` hold the code and moves).

Compiled bots go in `data/builds/`. If the server restarts mid-tournament it resumes where it
left off; matches already played are kept.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `JUDGE_PASSWORD` | random | password for the auto-created judge |
| `PYTHON_CMD` | `python` (Windows) / `python3` | Python interpreter |
| `CXX`, `JAVAC`, `JAVA` | `g++`, `javac`, `java` | compilers/runtimes |
| `PARALLEL_MATCHES` | CPUs | tournament matches run at the same time |
| `PARALLEL_BUILDS` | CPUs | compiles and submission checks run at the same time |
| `MATCH_PACE_MS` | 1500 | minimum time per match in old elimination brawls |
| `ROUND_BREAK_MS` | 5000 | pause between rounds (old elimination brawls only) |
| `PUBLISH_DELAY_MS` | 600000 | how long a brawl round's results stay hidden after the round starts |
| `DATABASE_URL` | (none: `data/db.json`) | PostgreSQL connection string |
| `PG_POOL_SIZE` | 10 | PostgreSQL connections |
| `DATA_DIR` | `./data` | where builds (and db.json) are kept |
| `SANDBOX` | (off) | `docker`: compile and run every bot in a sandbox container |
| `BOT_IMAGE` | `ottv1-bot:latest` | the sandbox image |
| `HOST_BUILD_ROOT` | `DATA_DIR/builds` | that builds folder as the Docker host sees it (set by docker-compose.yml) |
| `SANDBOX_MEMORY`, `SANDBOX_CPUS`, `SANDBOX_PIDS` | 512m, 1, 128 | limits of each sandbox container |
| `DOCKER` | `docker` | the Docker CLI |
| `PRACTICE_PARALLEL` | CPUs | practice matches run at the same time (across all submissions) |
| `SIGNUP_LIMIT` | 30 | max self-registrations per hour from one IP address |
| `TURNS` | 100 | turns per game |
| `CAMPAIGN_GAMES` | 5 | games a campaign submission must win in a row to beat a sparring bot |
| `SUBMIT_COOLDOWN_MS` | 90000 | minimum time between two submissions from one player |
| `MOVE_TIMEOUT_MS` / `FIRST_MOVE_TIMEOUT_MS` | 1000 / 10000 | per-move time limits |

## ⚠️ Security note

With `SANDBOX=docker` (the Docker setup above) submitted code is compiled and run in locked-down
throwaway containers. Without it, submitted code runs as ordinary processes on the machine, so only do
that for people you trust. The code checks in [restrict.js](server/grader/restrict.js) and
[runner.py](server/grader/harness/runner.py) apply in both cases.
