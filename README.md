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

Users cannot register. Accounts are added to the `users` list in `data/db.json`. **Stop the server
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

## How a tournament works

1. The judge creates a tournament with a deadline. The main page lists it with a countdown.
2. Players press **Submit code**, pick a language and paste or upload their bot. Each submission
   is compiled and given a 5-turn test run. The newest ✅ submission is the one that plays.
   Every ✅ bot also plays a practice game (100 turns) against each of 10 built-in sparring bots
   ([server/grader/house.js](server/grader/house.js)): Nhất Chiêu Đoạt Mệnh (one fixed move), Luân Hồi (R→P→S cycle),
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
5. Each match is **100 turns**: win = 3 points, draw = 1, loss = 0.
6. Once the tournament is finished, everyone can watch every replay.

## Writing a bot

| Language | File | Signature |
|---|---|---|
| Python | `bot.py` | `def play(my_moves, opponent_moves) -> str` |
| C++17 | `bot.cpp` | `char play(const std::vector<char>& myMoves, const std::vector<char>& opponentMoves)` |
| Java | `Bot.java` | `public class Bot { public char play(List<Character> myMoves, List<Character> opponentMoves) }` |

The histories hold every previous turn, oldest first (`'R'`, `'P'`, `'S'`; `'X'` = a forfeited turn).
Return `R`, `P` or `S`. The bot process lives for the whole match, so globals, statics and fields keep
their state. Printing is allowed: only lines starting with `MOVE ` are read. You get 1 s per move
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
| `MOVE_TIMEOUT_MS` / `FIRST_MOVE_TIMEOUT_MS` | 1000 / 10000 | per-move time limits |

## ⚠️ Security note

Submitted code runs as ordinary processes on the server with no sandbox. Only run this for people
you trust, or inside a VM/container.
