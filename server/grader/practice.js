// Practice evaluation: every working submission plays one 100-turn game
// against each of the 10 house bots. Results live on submission.practice.
const db = require('../db');
const { HOUSE_BOTS } = require('./house');
const { runVsHouse, runMatch } = require('./match');

const PARALLEL = +process.env.PRACTICE_PARALLEL || 2;
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

// The sparring bots of a tournament: the 10 built-in ones, plus (campaign only) the working
// bots the judge added to it. Judge bots carry `custom`: their record ({ id, language, code }),
// which is compiled and run like a submission.
function botsFor(t) {
  const extra = t && t.mode === 'campaign' ? (t.bots || []).filter(b => b.status === 'ok') : [];
  return [...HOUSE_BOTS, ...extra.map(b => ({ id: b.id, name: b.name, custom: b }))];
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

const running = new Map();
function evaluate(sub, ensureBuilt) {
  if (running.has(sub.id)) return running.get(sub.id).promise;
  supersede(sub);
  // Campaign submissions aimed at one sparring bot only fight that bot.
  const all = botsFor(tournamentOf(sub));
  const opponents = isCampaign(sub) && sub.target ? all.filter(h => h.id === sub.target) : all;
  const play = async house => {
    if (!house.custom) return runVsHouse(sub, house, ensureBuilt);
    const r = await runMatch(sub, house.custom, ensureBuilt);
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
      Object.assign(slot, { status: 'done', score: r.scoreA, botScore: r.scoreB, winner: r.winner, issue: r.issue });
    } else {
      const games = [];
      slot.games = games;
      slot.needed = CAMPAIGN_GAMES;
      while (games.length < CAMPAIGN_GAMES) {
        const r = await play(house);
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

module.exports = { evaluate, waitFor, onUpdate, botsFor, HOUSE_BOTS, CAMPAIGN_GAMES };
