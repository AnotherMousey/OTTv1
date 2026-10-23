// Practice evaluation: every working submission plays one match against each house bot
// (RPS: one 100-turn game against each of the 10; board game: two games, one per side, against
// each of the 5). Results live on submission.practice. Outside campaigns each match is also kept
// for replay: one per team and sparring bot, the newest bot's run replacing the older one.
const os = require('os');
const db = require('../db');
const { HOUSE_BOTS, houseBots, defaultRunnable } = require('./house');
const { runMatch } = require('./match');

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

const tournamentOf = sub => db.data.tournaments.find(x => x.id === sub.tournamentId);
const isCampaign = sub => (tournamentOf(sub) || {}).mode === 'campaign';
// 'rps' (also every tournament made before the board game existed) or 'board'.
const gameOf = t => (t && t.game === 'board' ? 'board' : 'rps');

// Judge-written bot code (a bot added to a campaign, or an edited copy of a built-in bot) keeps
// the last version that passed its check in `live` ({ buildId, language, code }). That version
// plays while a newer edit is being checked, or if the newer edit failed.
function liveOf(b) {
  if (b.live) return b.live;
  return b.status === 'ok' ? { buildId: b.id, language: b.language, code: b.code } : null; // added before `live` existed
}
const runnable = (live, game) => ({ id: live.buildId, language: live.language || 'python', code: live.code, trusted: true, game });

// The sparring bots of a tournament: the built-in ones of its game (or the judge's edited Python
// copy of one, once it works), plus (campaign only) the working bots the judge added. Every bot
// carries `custom`: something shaped like a submission, compiled and run as a process by the grader.
function botsFor(t) {
  const game = gameOf(t);
  const edits = (t && t.houseEdits) || {};
  const house = houseBots(game).map(h => {
    const live = edits[h.id] && edits[h.id].live;
    return { id: h.id, name: h.name, desc: h.desc, custom: live ? runnable(live, game) : defaultRunnable(h.id) };
  });
  const extra = t && t.mode === 'campaign' ? (t.bots || []).filter(liveOf) : [];
  return [...house, ...extra.map(b => ({ id: b.id, name: b.name, custom: runnable(liveOf(b), game) }))];
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

const running = new Map();
function evaluate(sub, ensureBuilt) {
  if (running.has(sub.id)) return running.get(sub.id).promise;
  supersede(sub);
  // Campaign submissions aimed at one sparring bot only fight that bot.
  const all = botsFor(tournamentOf(sub));
  const opponents = isCampaign(sub) && sub.target ? all.filter(h => h.id === sub.target) : all;
  const play = async (house, opts) => {
    const r = await runMatch(sub, house.custom, ensureBuilt, opts);
    return { ...r, issue: r.issues.A };
  };
  sub.practice = {
    status: 'running',
    total: 0,
    startedAt: new Date().toISOString(),
    results: opponents.map(h => ({ bot: h.id, name: h.name, status: 'queued' })),
  };
  db.save();
  listener(sub);

  const promise = Promise.all(opponents.map((house, i) => withSlot(async () => {
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
    sub.practice.total = sub.practice.results.reduce((s, x) => s + (x.score || 0), 0);
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

// Resolves once every evaluation currently queued for this tournament has finished.
function waitFor(tournamentId) {
  return Promise.all([...running.values()].filter(r => r.tournamentId === tournamentId).map(r => r.promise));
}

module.exports = { PARALLEL, evaluate, waitFor, replayKey, replayName, onUpdate, botsFor, liveOf, gameOf, HOUSE_BOTS, houseBots, CAMPAIGN_GAMES };
