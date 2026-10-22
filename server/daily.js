// Brawl ("hỗn chiến") as a daily league. Every day at t.dailyTime ('HH:MM' in the judge's time
// zone; t.tzOffset = the judge's Date#getTimezoneOffset()), from the start until the deadline, each
// team's newest working bot (submitted before that moment) plays every other team once: win = 3,
// draw = 1, loss = 0. A day's results stay hidden until PUBLISH_DELAY_MS after it started (or until
// its last match ends, if that takes longer); then the cumulative standings update for everyone.
// Before the round robin, each team's bot of the day plays every sample bot ("bot mẫu", see
// grader/house.js) once, scored the same way: that is the team's evaluation. The standings sort by
// points, then by the evaluation of the team's latest published day.
// t.days = [{ number, slot, startedAt, publishAt, entries, status: 'running' | 'done' | 'published',
//             evals: { userId: { sampleBotId: { winner, scoreA, scoreB } } }, finishedAt, publishedAt }]
const db = require('./db');
const { avatarOf } = require('./auth');
const { canPlay } = require('./access');
const { sampleBots } = require('./grader/house');

const DAY_MS = 24 * 3600 * 1000;
const PUBLISH_DELAY_MS = process.env.PUBLISH_DELAY_MS !== undefined ? +process.env.PUBLISH_DELAY_MS : 10 * 60 * 1000;
const POINTS = { win: 3, draw: 1, loss: 0 };

const isDaily = t => t.format === 'daily';
const gameOf = t => (t.game === 'board' ? 'board' : 'rps');
const resultPoints = winner => (winner === 'A' ? POINTS.win : winner === 'draw' ? POINTS.draw : POINTS.loss);
// A team's evaluation on one day: points against the sample bots (A = the team's bot).
function evaluation(t, day, userId) {
  const results = (day.evals || {})[userId] || {};
  const bots = sampleBots(gameOf(t));
  return {
    points: bots.reduce((s, b) => s + (results[b.id] ? resultPoints(results[b.id].winner) : 0), 0),
    max: bots.length * POINTS.win,
    detail: bots.map(b => ({ name: b.name, winner: results[b.id] ? results[b.id].winner : null })),
  };
}
const validTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// Match times in [from, to] (ms timestamps), oldest first.
function slotsBetween(t, from, to) {
  const [h, m] = t.dailyTime.split(':').map(Number);
  const off = (t.tzOffset || 0) * 60000; // UTC - local
  const local = new Date(from - off);
  let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const out = [];
  for (let k = 0; k < 4000; k++, day += DAY_MS) {
    const s = day + (h * 60 + m) * 60000 + off;
    if (s > to) break;
    if (s >= from) out.push(s);
  }
  return out;
}

// Daily matches only count from the start (and from when the judge last set the time, so moving
// it earlier doesn't fire today's match retroactively).
const firstMoment = t => Math.max(Date.parse(t.startsAt || t.createdAt), Date.parse(t.dailySince || t.createdAt));

// Scheduled times that have come and have no day yet.
function dueSlots(t, now) {
  const held = new Set((t.days || []).map(d => d.slot).filter(Boolean));
  return slotsBetween(t, firstMoment(t), Math.min(now, Date.parse(t.deadline))).filter(s => !held.has(new Date(s).toISOString()));
}

function nextSlot(t, now) {
  const [s] = slotsBetween(t, Math.max(firstMoment(t), now + 1), Date.parse(t.deadline));
  return s ? new Date(s).toISOString() : null;
}

// Every team's newest working bot submitted before `at`.
function entriesAt(t, at) {
  const latest = new Map();
  for (const s of db.data.submissions) {
    if (s.tournamentId !== t.id || s.status !== 'ok' || !canPlay(t, s.userId) || Date.parse(s.createdAt) > at) continue;
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

const matchName = (day, teamA, teamB) => `day ${day} - team ${teamA} vs team ${teamB}`;
const pairsOf = day => {
  const out = [];
  for (let i = 0; i < day.entries.length; i++) {
    for (let j = i + 1; j < day.entries.length; j++) out.push({ A: day.entries[i], B: day.entries[j], name: matchName(day.number, day.entries[i].teamName, day.entries[j].teamName) });
  }
  return out;
};
const dayMatches = (t, day) => Object.values(db.data.matches[t.id] || {}).filter(m => m.day === day.number);
const isPublished = (t, dayNumber) => (t.days || []).some(d => d.number === dayNumber && d.status === 'published');

// Cumulative standings over the published days. Teams with a working bot that haven't played a
// published day yet are listed with 0 points.
function standings(t) {
  const rows = new Map();
  const user = id => db.data.users.find(u => u.id === id);
  const row = (id, fallbackName) => {
    if (!rows.has(id)) {
      const u = user(id);
      rows.set(id, { userId: id, teamName: u ? u.teamName : fallbackName, username: u ? u.username : '', avatar: avatarOf(u || { teamName: fallbackName }), language: null, points: 0, eval: null, evalMax: sampleBots(gameOf(t)).length * POINTS.win, evalDetail: null, evalDay: null, w: 0, d: 0, l: 0, played: 0, score: 0, lastDay: null, days: 0 });
    }
    return rows.get(id);
  };
  const published = (t.days || []).filter(d => d.status === 'published');
  const last = published[published.length - 1];
  for (const day of published) {
    for (const e of day.entries) {
      const r = row(e.userId, e.teamName);
      r.language = e.language;
      r.days++;
      if (day === last) r.lastDay = 0;
      // the evaluation of the team's latest published day
      const ev = evaluation(t, day, e.userId);
      Object.assign(r, { eval: ev.points, evalDetail: ev.detail, evalDay: day.number });
    }
    for (const m of dayMatches(t, day)) {
      const a = row(m.userA, m.teamA), b = row(m.userB, m.teamB);
      const [pa, pb] = m.winner === 'A' ? [POINTS.win, POINTS.loss] : m.winner === 'B' ? [POINTS.loss, POINTS.win] : [POINTS.draw, POINTS.draw];
      a.points += pa; b.points += pb;
      a.score += m.scoreA; b.score += m.scoreB;
      a.played++; b.played++;
      if (m.winner === 'A') { a.w++; b.l++; } else if (m.winner === 'B') { b.w++; a.l++; } else { a.d++; b.d++; }
      if (day === last) { a.lastDay += pa; b.lastDay += pb; }
    }
  }
  if (t.status !== 'finished') {
    for (const e of entriesAt(t, Infinity)) {
      const r = row(e.userId, e.teamName);
      if (!r.language) r.language = e.language;
    }
  }
  const list = [...rows.values()].sort((x, y) =>
    y.points - x.points || (y.eval ?? -1) - (x.eval ?? -1) || y.w - x.w || y.score - x.score || x.teamName.localeCompare(y.teamName));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

// The public leaderboard: published standings, and for each day only its progress (never outcomes).
function board(t, now = Date.now()) {
  const rows = standings(t);
  const champ = t.championId && rows.find(r => r.userId === t.championId);
  return {
    id: t.id, name: t.name, mode: 'brawl', format: 'daily', status: t.status, error: t.error || null,
    deadline: t.deadline, startsAt: t.startsAt || null, dailyTime: t.dailyTime, nextAt: t.status === 'open' ? nextSlot(t, now) : null,
    publishDelayMs: PUBLISH_DELAY_MS,
    sampleBots: sampleBots(gameOf(t)).map(b => ({ name: b.name, desc: b.desc })),
    days: (t.days || []).map(d => {
      const fights = (d.entries.length * (d.entries.length - 1)) / 2;
      const evals = d.entries.length * sampleBots(gameOf(t)).length;
      const evalsDone = Object.values(d.evals || {}).reduce((s, r) => s + Object.keys(r).length, 0);
      const played = Math.min(fights, dayMatches(t, d).length);
      return { number: d.number, at: d.slot || d.startedAt, status: d.status, publishAt: d.publishAt, publishedAt: d.publishedAt || null, teams: d.entries.length,
        phase: evalsDone < evals ? 'evaluating' : 'fighting', played: evalsDone + played, totalMatches: evals + fights };
    }),
    champion: champ ? { userId: champ.userId, teamName: champ.teamName, avatar: champ.avatar } : null,
    rows,
  };
}

module.exports = { isDaily, evaluation, validTime, slotsBetween, dueSlots, nextSlot, entriesAt, pairsOf, dayMatches, isPublished, standings, board, PUBLISH_DELAY_MS };
