// Runs tournaments: closes submissions at the deadline, plays round-robin
// rounds, eliminates min(3, t - 2) teams per round, broadcasts the leaderboard.
const os = require('os');
const db = require('./db');
const grader = require('./grader');
const { runMatch } = require('./grader/match');
const { avatarOf } = require('./auth');
const campaign = require('./campaign');
const { isInviteOnly, canPlay } = require('./access');
const avatarById = id => avatarOf(db.data.users.find(u => u.id === id) || { teamName: '' });

const PARALLEL_MATCHES = +process.env.PARALLEL_MATCHES || Math.max(1, Math.floor(os.cpus().length / 2));
const MATCH_PACE_MS = process.env.MATCH_PACE_MS !== undefined ? +process.env.MATCH_PACE_MS : 1500;
const ROUND_BREAK_MS = process.env.ROUND_BREAK_MS !== undefined ? +process.env.ROUND_BREAK_MS : 5000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const matchName = (round, teamA, teamB) => `round ${round} - team ${teamA} vs team ${teamB}`;
const eliminationCount = n => (n > 2 ? Math.min(3, n - 2) : 0);

async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

class TournamentManager {
  constructor(io) {
    this.io = io;
    this.active = new Set();
    // Re-validate anything that was mid-check when the server stopped.
    for (const s of db.data.submissions) if (s.status === 'pending') grader.validate(s);
    // Resume tournaments that were running when the server stopped (played matches are kept).
    for (const t of db.data.tournaments) if (t.status === 'running') this.launch(t);
    setInterval(() => this.tick(), 1000);
  }

  tick() {
    const now = Date.now();
    for (const t of db.data.tournaments) {
      if (t.status === 'open' && Date.parse(t.deadline) <= now) this.launch(t);
    }
  }

  matchesOf(t) {
    return (db.data.matches[t.id] = db.data.matches[t.id] || {});
  }

  entry(t, userId) {
    return t.entries.find(e => e.userId === userId);
  }

  async launch(t) {
    if (this.active.has(t.id)) return;
    this.active.add(t.id);
    try {
      if (t.status === 'open') {
        t.status = 'running';
        t.startedAt = new Date().toISOString();
        db.save();
        console.log(`[tournament] "${t.name}" deadline reached - starting`);
        // pull everyone who can watch it to the live page: all users, or for an invite-only
        // tournament just its players and the judges
        const rooms = isInviteOnly(t) ? ['judge', ...(t.members || []).map(id => 'u:' + id)] : ['users'];
        this.io.to(rooms).emit('tournament:started', { id: t.id, name: t.name });
        this.io.to('users').emit('tournaments:changed');
      }
      if (t.mode === 'campaign') return await this.closeCampaign(t);
      if (!t.entries) {
        await grader.waitForValidations(t.id);
        t.entries = this.collectEntries(t);
        t.rounds = [];
        db.save();
      }
      this.broadcast(t);
      await this.play(t);
    } catch (e) {
      console.error(`[tournament] "${t.name}" crashed:`, e);
      t.error = String(e.message || e);
      db.save();
      this.broadcast(t);
    } finally {
      this.active.delete(t.id);
    }
  }

  // Campaign deadline: no matches to play. Let every submission made before the
  // deadline finish compiling and sparring, then freeze the standings.
  async closeCampaign(t) {
    this.broadcast(t);
    grader.resumePractice(); // after a restart: re-queue games that were cut off (no-op otherwise)
    await grader.waitForValidations(t.id);
    await grader.practice.waitFor(t.id);
    const final = campaign.board(t);
    // winner = top of the final board (most bots beaten / earliest finish), if they beat any at all
    t.championId = final.rows.length && final.rows[0].beaten > 0 ? final.rows[0].userId : null;
    t.status = 'finished';
    t.finishedAt = new Date().toISOString();
    db.save();
    console.log(`[campaign] "${t.name}" closed. ${final.finishers} of ${final.rows.length} teams finished.`);
    this.broadcast(t);
    this.io.to('users').emit('tournaments:changed');
  }

  // Each player's newest working submission is their entry.
  collectEntries(t) {
    const latest = new Map();
    for (const s of db.data.submissions) {
      if (s.tournamentId !== t.id || s.status !== 'ok' || !canPlay(t, s.userId)) continue;
      const prev = latest.get(s.userId);
      if (!prev || prev.createdAt < s.createdAt) latest.set(s.userId, s);
    }
    return [...latest.values()]
      .map(s => {
        const u = db.data.users.find(x => x.id === s.userId);
        return u && { userId: u.id, teamName: u.teamName, submissionId: s.id, language: s.language, submittedAt: s.createdAt };
      })
      .filter(Boolean)
      .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  }

  alive(t) {
    const out = new Set(t.rounds.flatMap(r => r.eliminated));
    return t.entries.filter(e => !out.has(e.userId));
  }

  async play(t) {
    const matches = this.matchesOf(t);
    for (;;) {
      let round = t.rounds[t.rounds.length - 1];
      if (!round || round.status === 'done') {
        const alive = this.alive(t);
        if ((round && round.participants.length <= 2) || alive.length <= 1) return this.finish(t);
        round = {
          number: t.rounds.length + 1,
          participants: alive.map(e => e.userId),
          eliminated: [],
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        t.rounds.push(round);
        db.save();
        console.log(`[tournament] "${t.name}" round ${round.number}: ${alive.length} teams`);
        this.broadcast(t);
      }

      const players = round.participants.map(id => this.entry(t, id));
      const jobs = [];
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const name = matchName(round.number, players[i].teamName, players[j].teamName);
          if (!matches[name]) jobs.push({ A: players[i], B: players[j], name });
        }
      }
      await pool(jobs, PARALLEL_MATCHES, job => this.playMatch(t, round, job));

      const standings = this.roundStandings(t, round);
      const k = eliminationCount(standings.length);
      if (k) round.eliminated = standings.slice(standings.length - k).map(s => s.userId);
      else if (standings.length) t.championId = standings[0].userId;
      round.status = 'done';
      round.finishedAt = new Date().toISOString();
      db.save();
      this.broadcast(t);
      if (k) await sleep(ROUND_BREAK_MS);
    }
  }

  async playMatch(t, round, { A, B, name }) {
    const sub = id => db.data.submissions.find(s => s.id === id);
    const [res] = await Promise.all([runMatch(sub(A.submissionId), sub(B.submissionId), grader.ensureBuilt), sleep(MATCH_PACE_MS)]);
    const m = {
      name,
      tournamentId: t.id,
      round: round.number,
      teamA: A.teamName, teamB: B.teamName,
      userA: A.userId, userB: B.userId,
      languageA: A.language, languageB: B.language,
      movesA: res.movesA, movesB: res.movesB,
      scoreA: res.scoreA, scoreB: res.scoreB,
      winner: res.winner,
      issues: res.issues,
      playedAt: new Date().toISOString(),
    };
    this.matchesOf(t)[name] = m;
    db.save();
    this.broadcast(t);
    this.io.to('judge').emit('match:done', { tournamentId: t.id, ...matchSummary(m) });
  }

  finish(t) {
    if (!t.championId) {
      const alive = this.alive(t);
      if (alive.length === 1) t.championId = alive[0].userId;
    }
    t.status = 'finished';
    t.finishedAt = new Date().toISOString();
    db.save();
    const champ = t.championId && this.entry(t, t.championId);
    console.log(`[tournament] "${t.name}" finished. Champion: ${champ ? champ.teamName : 'nobody'}`);
    this.broadcast(t);
    this.io.to('users').emit('tournaments:changed');
  }

  totals(t) {
    const totals = {};
    for (const m of Object.values(this.matchesOf(t))) {
      totals[m.userA] = (totals[m.userA] || 0) + m.scoreA;
      totals[m.userB] = (totals[m.userB] || 0) + m.scoreB;
    }
    return totals;
  }

  // Ranking inside one round: points, then match wins, then all-time points, then earliest submission.
  roundStandings(t, round, totals = this.totals(t)) {
    const rows = new Map(round.participants.map(id => [id, {
      userId: id, teamName: this.entry(t, id).teamName, points: 0, w: 0, d: 0, l: 0, played: 0,
    }]));
    for (const m of Object.values(this.matchesOf(t))) {
      if (m.round !== round.number) continue;
      const a = rows.get(m.userA), b = rows.get(m.userB);
      if (!a || !b) continue;
      a.points += m.scoreA; b.points += m.scoreB;
      a.played++; b.played++;
      if (m.winner === 'A') { a.w++; b.l++; } else if (m.winner === 'B') { b.w++; a.l++; } else { a.d++; b.d++; }
    }
    const order = new Map(t.entries.map((e, i) => [e.userId, i]));
    return [...rows.values()].sort((x, y) =>
      y.points - x.points || y.w - x.w || (totals[y.userId] || 0) - (totals[x.userId] || 0) || order.get(x.userId) - order.get(y.userId));
  }

  leaderboard(t) {
    if (t.mode === 'campaign') return campaign.board(t);
    const info = {
      id: t.id, name: t.name, status: t.status, deadline: t.deadline, error: t.error || null,
      entries: t.entries ? t.entries.length : null, round: null, champion: null, rows: [],
    };
    if (!t.entries) return info;
    const totals = this.totals(t);
    const rounds = t.rounds || [];
    const cur = rounds[rounds.length - 1];
    const lang = id => this.entry(t, id).language;
    if (!cur) {
      info.rows = t.entries.map(e => ({ userId: e.userId, teamName: e.teamName, avatar: avatarById(e.userId), language: e.language, status: 'alive', round: 0, points: 0, w: 0, d: 0, l: 0, played: 0, total: 0 }));
    } else {
      const n = cur.participants.length;
      info.round = {
        number: cur.number, teams: n, status: cur.status,
        played: Object.values(this.matchesOf(t)).filter(m => m.round === cur.number).length,
        totalMatches: (n * (n - 1)) / 2,
        eliminating: eliminationCount(n),
        isFinal: n <= 2,
      };
      for (let r = rounds.length - 1; r >= 0; r--) {
        const round = rounds[r];
        for (const s of this.roundStandings(t, round, totals)) {
          const isCur = r === rounds.length - 1;
          const out = round.eliminated.includes(s.userId);
          if (!isCur && !out) continue; // already listed under a later round
          let status = out ? 'eliminated' : 'alive';
          if (t.championId === s.userId) status = 'champion';
          else if (isCur && round.status === 'done' && !out && n <= 2) status = 'runner-up';
          info.rows.push({ ...s, avatar: avatarById(s.userId), language: lang(s.userId), status, round: round.number, total: totals[s.userId] || 0 });
        }
      }
    }
    info.rows.forEach((row, i) => { row.rank = i + 1; });
    if (t.championId) info.champion = { userId: t.championId, teamName: this.entry(t, t.championId).teamName, avatar: avatarById(t.championId) };
    return info;
  }

  broadcast(t) {
    this.io.to('t:' + t.id).emit('leaderboard', this.leaderboard(t));
  }
}

function matchSummary(m) {
  return { name: m.name, round: m.round, teamA: m.teamA, teamB: m.teamB, scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner, playedAt: m.playedAt };
}

module.exports = { TournamentManager, matchSummary };
