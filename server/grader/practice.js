// Practice evaluation: every working submission plays one match against each house bot
// (RPS: one 100-turn game against each of the 10; board game: two games, one per side, against
// each of the 5). Results live on submission.practice. Outside campaigns each match is also kept
// for replay: one per team and sparring bot, the newest bot's run replacing the older one.
const os = require('os');
const db = require('../db');
const { HOUSE_BOTS, houseBots, defaultRunnable } = require('./house');
const { runMatch } = require('./match');
const { mapOf, startPieces, GAMES } = require('./board');

// practice matches at the same time, across all submissions (default: one per CPU)
const PARALLEL = +process.env.PRACTICE_PARALLEL || os.cpus().length;
// Campaign: a sparring bot only counts as beaten if the submission wins this many games
// against it in a row. The first game it doesn't win ends the series.
const CAMPAIGN_GAMES = +process.env.CAMPAIGN_GAMES || 5;

let listener = () => {};
function onUpdate(fn) {
  listener = fn;
}

let active = 0;
const queue = [];
async function withSlot(fn) {
  if (active >= PARALLEL) await new Promise(r => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = queue.shift();
    if (next) next();
  }
}

// Showdown ("quyết đấu"): a window the judge sets in a brawl: from t.showdownAt, t.showdownMinutes
// long. Every t.showdownEveryMinutes from its start (start, start + 1 interval, ... while the window
// lasts) there is a showdown run: each team's newest working bot at that moment plays every sparring
// bot once, and scores, for every game, win * 550 + pieces * 25 (win = 1 if it won the game, pieces =
// how many of its pieces were left on the board; RPS has no pieces: only the win of each match).
// While the window lasts, a team's evaluation is its total in the last finished run (submitting a bot
// doesn't change it until the next run). t.showdownRun = the run being played, t.showdownLast = the
// last finished one: { number, at, startedAt, finishedAt, status, teams: { userId: { submissionId,
// teamName, total, results: [{ bot, name, status, score, botScore, winner, issue }] } } }.
const SHOWDOWN = { win: 550, piece: 25 };
const DEFAULT_SHOWDOWN_MINUTES = 300, DEFAULT_SHOWDOWN_EVERY = 60;
// limits the judge may pick: length 15 minutes to 3 days, interval 5 minutes to 1 day
const SHOWDOWN_LIMITS = { minutes: [15, 72 * 60], every: [5, 24 * 60] };
const showdownMinutesOf = t => t.showdownMinutes || DEFAULT_SHOWDOWN_MINUTES;
const showdownEveryOf = t => t.showdownEveryMinutes || DEFAULT_SHOWDOWN_EVERY;
const showdownEnd = t => (t && t.showdownAt ? Date.parse(t.showdownAt) + showdownMinutesOf(t) * 60000 : null);
const inShowdown = (t, now = Date.now()) => !!(t && t.showdownAt) && now >= Date.parse(t.showdownAt) && now < showdownEnd(t);
// The run due now (the latest interval mark passed), or null outside the window: { number, at }.
function showdownSlot(t, now = Date.now()) {
  if (!inShowdown(t, now)) return null;
  const start = Date.parse(t.showdownAt), every = showdownEveryOf(t) * 60000;
  const k = Math.floor((now - start) / every);
  return { number: k + 1, at: new Date(start + k * every).toISOString() };
}
// When the next run starts, or null if none is left in the window.
function nextShowdownRun(t, now = Date.now()) {
  if (!t.showdownAt) return null;
  const start = Date.parse(t.showdownAt), every = showdownEveryOf(t) * 60000;
  const next = now < start ? start : start + (Math.floor((now - start) / every) + 1) * every;
  return next < showdownEnd(t) ? new Date(next).toISOString() : null;
}
// A team's showdown result as it counts right now (the last finished run), or null.
const showdownTeam = (t, userId, now = Date.now()) => (inShowdown(t, now) && t.showdownLast && t.showdownLast.teams[userId]) || null;
// A match's showdown score for each side: { A, B }.
function showdownScore(r) {
  if (!r.games) return { A: r.winner === 'A' ? SHOWDOWN.win : 0, B: r.winner === 'B' ? SHOWDOWN.win : 0 };
  const side = who => r.games.reduce((s, g) => s + (g.winner === who ? SHOWDOWN.win : 0) + ((g.left || {})[who] || 0) * SHOWDOWN.piece, 0);
  return { A: side('A'), B: side('B') };
}
// The most one match against a sparring bot can be worth in the showdown.
const showdownMatchMax = t => (gameOf(t) === 'board' ? GAMES * (SHOWDOWN.win + startPieces(mapOf(t)) * SHOWDOWN.piece) : SHOWDOWN.win);

// Plays a showdown run (run.teams already lists the bots taking part), sharing the practice slots.
// onUpdate is called after every match. Stops early once run.cancelled is set.
async function runShowdown(t, run, ensureBuilt, onUpdate = () => {}) {
  const bots = botsFor(t);
  const map = mapOf(t);
  const jobs = [];
  for (const team of Object.values(run.teams)) {
    const sub = db.data.submissions.find(s => s.id === team.submissionId);
    team.total = 0;
    team.results = bots.map(h => ({ bot: h.id, name: h.name, status: sub ? 'queued' : 'skipped' }));
    if (!sub) continue;
    bots.forEach((h, i) => jobs.push(withSlot(async () => {
      const slot = team.results[i];
      if (run.cancelled) { slot.status = 'skipped'; return; }
      slot.status = 'playing';
      try {
        const r = await runMatch(sub, h.custom, ensureBuilt, { map });
        const sd = showdownScore(r);
        Object.assign(slot, { status: 'done', score: sd.A, botScore: sd.B, winner: r.winner, issue: r.issues.A });
        team.total += sd.A;
      } catch (e) {
        console.error('[showdown] match failed:', e);
        Object.assign(slot, { status: 'error' });
      }
      onUpdate();
    })));
  }
  await Promise.all(jobs);
}

const tournamentOf = sub => db.data.tournaments.find(x => x.id === sub.tournamentId);
const isCampaign = sub => (tournamentOf(sub) || {}).mode === 'campaign';
// 'rps' (also every tournament made before the board game existed) or 'board'.
const gameOf = t => (t && t.game === 'board' ? 'board' : 'rps');

// Judge-written bot code (a bot the judge added, or an edited copy of a built-in bot) keeps
// the last version that passed its check in `live` ({ buildId, language, code }). That version
// plays while a newer edit is being checked, or if the newer edit failed.
function liveOf(b) {
  if (b.live) return b.live;
  return b.status === 'ok' ? { buildId: b.id, language: b.language, code: b.code } : null; // added before `live` existed
}
const runnable = (live, game) => ({ id: live.buildId, language: live.language || 'python', code: live.code, trusted: true, game });

// The sparring bots of a tournament: the built-in ones of its game (or the judge's edited Python
// copy of one, once it works; under the name and description the judge gave it, t.houseNames and
// t.houseDescs; minus the ones the judge removed, t.houseRemoved), plus the working bots the judge added. Every bot
// carries `custom`: something shaped like a submission, compiled and run as a process by the grader.
function botsFor(t) {
  const game = gameOf(t);
  const edits = (t && t.houseEdits) || {};
  const names = (t && t.houseNames) || {};
  const descs = (t && t.houseDescs) || {};
  const removed = new Set((t && t.houseRemoved) || []);
  const house = houseBots(game).filter(h => !removed.has(h.id)).map(h => {
    const live = edits[h.id] && edits[h.id].live;
    return { id: h.id, name: names[h.id] || h.name, desc: descs[h.id] || h.desc, custom: live ? runnable(live, game) : defaultRunnable(h.id) };
  });
  const extra = t ? (t.bots || []).filter(liveOf) : [];
  return [...house, ...extra.map(b => ({ id: b.id, name: b.name, desc: b.desc || '', custom: runnable(liveOf(b), game) }))];
}

// Brawl: practice only matters while submissions are open.
// Campaign: every submission made before the deadline gets fully evaluated, even after it.
const canEvaluate = sub => {
  const t = tournamentOf(sub);
  return !!t && (t.status === 'open' || t.mode === 'campaign');
};

// Brawl only: stop evaluating older submissions once the same player has a newer working one.
// (In a campaign every submission counts, so nothing is ever cancelled.)
function supersede(sub) {
  if (isCampaign(sub)) return;
  for (const s of db.data.submissions) {
    if (s !== sub && s.userId === sub.userId && s.tournamentId === sub.tournamentId && s.practice && s.practice.status === 'running') {
      s.practice.cancelled = true;
    }
  }
}

// Replays live with the tournament matches, under their own key (see app.js).
const replayKey = tournamentId => `practice:${tournamentId}`;
const replayName = (userId, botId) => `${userId}-${botId}`;
async function saveReplay(sub, house, r) {
  let newest = null;
  for (const s of db.data.submissions) {
    if (s.tournamentId === sub.tournamentId && s.userId === sub.userId && s.status === 'ok' && (!newest || newest.createdAt < s.createdAt)) newest = s;
  }
  if (newest !== sub) return false; // a newer bot took over while this one was playing
  const u = db.data.users.find(x => x.id === sub.userId);
  const { movesA, movesB, games, scoreA, scoreB, winner, issues } = r;
  try {
    await db.putMatch({
      tournamentId: replayKey(sub.tournamentId), name: replayName(sub.userId, house.id), submissionId: sub.id, bot: house.id,
      teamA: u ? u.teamName : '?', teamB: house.name, userA: sub.userId, playedAt: new Date().toISOString(),
      ...(games ? { games } : { movesA, movesB }), scoreA, scoreB, winner, issues,
    });
    return true;
  } catch (e) {
    console.error('[practice] could not save the replay:', e.message);
    return false;
  }
}

// The match rules practice was played under, per game, with the board game's map when it isn't the
// standard start. Changing it replays the practice of every team's newest bot in open brawls
// (at the next start, or right away when the judge switches maps), so all are scored alike.
const RULES = { board: 'cpu-180s-per-game' };
function rulesOf(t) {
  const rules = RULES[gameOf(t)] || null;
  const map = mapOf(t);
  if (!rules || !map) return rules;
  // (a map with the standard goals keeps the key it had before goals could be chosen)
  const goals = map.goals || map.goalMode !== 'any' ? ` goals:${map.goalMode}:${map.goals || ''}` : '';
  return `${rules} map:${map.width}x${map.height}:${map.layout} turns:${map.maxTurns}${goals}`;
}

const running = new Map();
// topUp (brawl, after the judge added or removed a sparring bot): if this submission's practice
// already finished against every bot there was, under the current rules, keep those results,
// drop the ones against bots that are gone and only play the bots it hasn't met yet.
// Otherwise (and without topUp) every bot is played from scratch.
function evaluate(sub, ensureBuilt, { topUp = false } = {}) {
  if (running.has(sub.id)) return running.get(sub.id).promise;
  supersede(sub);
  // Campaign submissions aimed at one sparring bot only fight that bot.
  const all = botsFor(tournamentOf(sub));
  const opponents = isCampaign(sub) && sub.target ? all.filter(h => h.id === sub.target) : all;
  const play = async (house, opts) => {
    const r = await runMatch(sub, house.custom, ensureBuilt, { ...opts, map: mapOf(tournamentOf(sub)) });
    return { ...r, issue: r.issues.A };
  };
  const old = sub.practice;
  const kept = topUp && !isCampaign(sub) && old && old.status === 'done' && (old.rules ?? null) === rulesOf(tournamentOf(sub))
    ? new Map(old.results.filter(r => r.status === 'done').map(r => [r.bot, r]))
    : new Map();
  const results = opponents.map(h => (kept.has(h.id) ? { ...kept.get(h.id), name: h.name } : { bot: h.id, name: h.name, status: 'queued' }));
  const total = () => results.reduce((s, x) => s + (x.score || 0), 0);
  const toPlay = opponents.map((h, i) => [h, i]).filter(([, i]) => results[i].status === 'queued');
  if (kept.size && !toPlay.length) { // only a bot was removed: nothing to play
    Object.assign(old, { results, total: total() });
    db.save();
    listener(sub);
    return Promise.resolve();
  }
  sub.practice = {
    status: 'running',
    rules: rulesOf(tournamentOf(sub)),
    total: total(),
    startedAt: kept.size ? old.startedAt : new Date().toISOString(),
    results,
  };
  db.save();
  listener(sub);

  const promise = Promise.all(toPlay.map(([house, i]) => withSlot(async () => {
    const slot = sub.practice.results[i];
    if (sub.practice.cancelled || !canEvaluate(sub)) { slot.status = 'skipped'; return; }
    slot.status = 'playing';
    if (!isCampaign(sub)) {
      const r = await play(house);
      Object.assign(slot, { status: 'done', score: r.scoreA, botScore: r.scoreB, winner: r.winner, issue: r.issue, replay: await saveReplay(sub, house, r) });
    } else {
      const games = [];
      slot.games = games;
      slot.needed = CAMPAIGN_GAMES;
      while (games.length < CAMPAIGN_GAMES) {
        // board game: one game per step of the series, taking turns at moving first
        const r = await play(house, { games: 1, aWhite: games.length % 2 === 0 });
        games.push({ score: r.scoreA, botScore: r.scoreB, winner: r.winner });
        if (r.issue && !slot.issue) slot.issue = r.issue;
        listener(sub);
        if (r.winner !== 'A') break; // lost or drew one: this bot can't be beaten by this submission
      }
      const last = games[games.length - 1];
      Object.assign(slot, {
        status: 'done',
        wins: games.filter(g => g.winner === 'A').length,
        score: games.reduce((s, g) => s + g.score, 0),
        botScore: games.reduce((s, g) => s + g.botScore, 0),
        winner: last.winner === 'A' ? 'A' : last.winner, // 'A' only after 5 straight wins
      });
    }
    sub.practice.total = total();
    db.save();
    listener(sub);
  })))
    .then(() => {
      const p = sub.practice;
      p.status = p.results.every(x => x.status === 'done') ? 'done' : 'stopped';
      p.finishedAt = new Date().toISOString();
    })
    .catch(e => {
      console.error('[practice] failed:', e);
      sub.practice.status = 'error';
    })
    .finally(() => {
      delete sub.practice.cancelled;
      running.delete(sub.id);
      db.save();
      listener(sub);
    });
  running.set(sub.id, { tournamentId: sub.tournamentId, promise });
  return promise;
}

// The evaluation of this submission still going, if any (a promise).
const runningFor = sub => (running.get(sub.id) || {}).promise || null;

// Resolves once every evaluation currently queued for this tournament has finished.
function waitFor(tournamentId) {
  return Promise.all([...running.values()].filter(r => r.tournamentId === tournamentId).map(r => r.promise));
}

module.exports = { SHOWDOWN, SHOWDOWN_LIMITS, showdownMinutesOf, showdownEveryOf, inShowdown, showdownEnd, showdownSlot, nextShowdownRun, showdownTeam, showdownMatchMax, runShowdown, PARALLEL, rulesOf, evaluate, runningFor, waitFor, replayKey, replayName, onUpdate, botsFor, liveOf, gameOf, HOUSE_BOTS, houseBots, CAMPAIGN_GAMES };
