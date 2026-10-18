// Practice evaluation: every working submission plays one 100-turn game
// against each of the 10 house bots. Results live on submission.practice.
const db = require('../db');
const { HOUSE_BOTS } = require('./house');
const { runVsHouse } = require('./match');

const PARALLEL = +process.env.PRACTICE_PARALLEL || 2;

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

const tournamentOpen = sub => {
  const t = db.data.tournaments.find(x => x.id === sub.tournamentId);
  return t && t.status === 'open';
};

// Stop evaluating older submissions once the same player has a newer working one.
function supersede(sub) {
  for (const s of db.data.submissions) {
    if (s !== sub && s.userId === sub.userId && s.tournamentId === sub.tournamentId && s.practice && s.practice.status === 'running') {
      s.practice.cancelled = true;
    }
  }
}

const running = new Map();
function evaluate(sub, ensureBuilt) {
  if (running.has(sub.id)) return running.get(sub.id);
  supersede(sub);
  sub.practice = {
    status: 'running',
    total: 0,
    startedAt: new Date().toISOString(),
    results: HOUSE_BOTS.map(h => ({ bot: h.id, name: h.name, status: 'queued' })),
  };
  db.save();
  listener(sub);

  const promise = Promise.all(HOUSE_BOTS.map((house, i) => withSlot(async () => {
    const slot = sub.practice.results[i];
    if (sub.practice.cancelled || !tournamentOpen(sub)) { slot.status = 'skipped'; return; }
    slot.status = 'playing';
    const r = await runVsHouse(sub, house, ensureBuilt);
    Object.assign(slot, { status: 'done', score: r.scoreA, botScore: r.scoreB, winner: r.winner, issue: r.issue });
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
  running.set(sub.id, promise);
  return promise;
}

module.exports = { evaluate, onUpdate, HOUSE_BOTS };
