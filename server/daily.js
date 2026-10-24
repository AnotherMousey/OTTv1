// Brawl ("hỗn chiến") as a daily league. Every day at t.dailyTime ('HH:MM' in the judge's time
// zone; t.tzOffset = the judge's Date#getTimezoneOffset()), from the start until the deadline, the
// teams' newest working bots (submitted before that moment) play: win = 3, draw = 1, loss = 0.
// The judge picks the pairing (t.pairing):
//   'rr'    round robin: every team plays every other team once.
//   'swiss' ceil(log2(teams)) rounds; each round pairs teams with similar points (all days so far,
//           this day's earlier rounds included), never the same two teams twice in a day. With an
//           odd number of teams the lowest-ranked one without a bye that day sits out and gets 3. A day's results stay hidden until PUBLISH_DELAY_MS after it started (or until
// its last match ends, if that takes longer); then the cumulative standings update for everyone.
// A team's evaluation is the practice score of its newest working bot (its total against the
// sparring bots, see grader/practice.js), live: the same number as on the practice board. The
// standings sort by points, then by evaluation.
// t.days = [{ number, slot, startedAt, publishAt, entries, status: 'running' | 'done' | 'published',
//             finishedAt, publishedAt, pairing, and for Swiss: rounds, pairs: { r: [{ a, b, name }] },
//             byes: [{ round, userId }] }]
const db = require('./db');
const { avatarOf } = require('./auth');
const { canPlay } = require('./access');
const { botsFor } = require('./grader/practice');
const { MAX_SCORE } = require('./grader/board');
const { TURNS } = require('./grader/match');

const DAY_MS = 24 * 3600 * 1000;
const PUBLISH_DELAY_MS = process.env.PUBLISH_DELAY_MS !== undefined ? +process.env.PUBLISH_DELAY_MS : 10 * 60 * 1000;
const POINTS = { win: 3, draw: 1, loss: 0 };

const isDaily = t => t.format === 'daily';
const pairingOf = t => (t.pairing === 'swiss' ? 'swiss' : 'rr');
const swissRounds = n => (n < 2 ? 0 : Math.ceil(Math.log2(n)));
const gameOf = t => (t.game === 'board' ? 'board' : 'rps');
// The most a bot can score in practice: every match against every sparring bot won outright.
const evalMax = t => botsFor(t).length * (gameOf(t) === 'board' ? MAX_SCORE : TURNS * 3);
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
// Swiss pairing for round `r` of `day`: { pairs: [{ a, b, name }], bye } (user ids). Teams are ranked
// by their points so far, every day's matches and byes counted (published or not: this is only for
// pairing), then by name; each is paired with the nearest-ranked team it hasn't met that day.
function swissPairs(t, day, r) {
  const points = new Map();
  const add = (id, n) => points.set(id, (points.get(id) || 0) + n);
  for (const m of Object.values(db.data.matches[t.id] || {})) {
    if (!m.day) continue;
    add(m.userA, m.winner === 'A' ? POINTS.win : m.winner === 'draw' ? POINTS.draw : 0);
    add(m.userB, m.winner === 'B' ? POINTS.win : m.winner === 'draw' ? POINTS.draw : 0);
  }
  for (const d of t.days || []) for (const b of d.byes || []) add(b.userId, POINTS.win);
  const met = new Set();
  for (const ps of Object.values(day.pairs || {})) for (const p of ps) { met.add(p.a + '|' + p.b); met.add(p.b + '|' + p.a); }
  let order = day.entries.slice().sort((x, y) => (points.get(y.userId) || 0) - (points.get(x.userId) || 0) || x.teamName.localeCompare(y.teamName));
  let bye = null;
  if (order.length % 2) {
    const had = new Set((day.byes || []).map(b => b.userId));
    bye = [...order].reverse().find(e => !had.has(e.userId)) || order[order.length - 1];
    order = order.filter(e => e !== bye);
  }
  // top down, each with the nearest one it hasn't met today (backtracking if that leaves someone stuck)
  const pair = list => {
    if (!list.length) return [];
    const [a, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      if (met.has(a.userId + '|' + rest[i].userId)) continue;
      const tail = pair([...rest.slice(0, i), ...rest.slice(i + 1)]);
      if (tail) return [[a, rest[i]], ...tail];
    }
    return null;
  };
  // (with ceil(log2 n) rounds a pairing without rematches always exists; just in case, allow them)
  const pairs = pair(order) || order.reduce((out, e, i) => (i % 2 ? out : [...out, [e, order[i + 1]]]), []);
  return {
    pairs: pairs.map(([a, b]) => ({ a: a.userId, b: b.userId, name: `day ${day.number} round ${r} - team ${a.teamName} vs team ${b.teamName}` })),
    bye: bye && bye.userId,
  };
}

// Matches a day will have in all.
const dayTotal = d => (d.pairing === 'swiss' ? (d.rounds || 0) * Math.floor(d.entries.length / 2) : (d.entries.length * (d.entries.length - 1)) / 2);

// Submissions are frozen from a match time until that day's results are published:
// { day, publishAt } (publishAt is null while the day hasn't been set up yet), or null.
function frozen(t, now = Date.now()) {
  const day = (t.days || []).find(d => d.status !== 'published');
  if (day) return { day: day.number, publishAt: day.publishAt };
  return dueSlots(t, now).length ? { day: (t.days || []).length + 1, publishAt: null } : null;
}

const dayMatches = (t, day) => Object.values(db.data.matches[t.id] || {}).filter(m => m.day === day.number);
const isPublished = (t, dayNumber) => (t.days || []).some(d => d.number === dayNumber && d.status === 'published');

// Cumulative standings over the published days. Teams with a working bot that haven't played a
// published day yet are listed with 0 points. byDay[day number] = the points a team gained that day
// (missing: it didn't take part).
function standings(t) {
  const rows = new Map();
  const user = id => db.data.users.find(u => u.id === id);
  const row = (id, fallbackName) => {
    if (!rows.has(id)) {
      const u = user(id);
      rows.set(id, { userId: id, teamName: u ? u.teamName : fallbackName, username: u ? u.username : '', avatar: avatarOf(u || { teamName: fallbackName }), language: null, points: 0, eval: null, evalStatus: 'no-bot', evalMax: evalMax(t), w: 0, d: 0, l: 0, played: 0, score: 0, lastDay: null, days: 0, byDay: {} });
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
      r.byDay[day.number] = 0;
      if (day === last) r.lastDay = 0;
    }
    for (const b of day.byes || []) {
      const r = row(b.userId, (day.entries.find(e => e.userId === b.userId) || {}).teamName || '?');
      r.points += POINTS.win;
      r.byes = (r.byes || 0) + 1;
      r.byDay[day.number] = (r.byDay[day.number] || 0) + POINTS.win;
      if (day === last) r.lastDay += POINTS.win;
    }
    for (const m of dayMatches(t, day)) {
      const a = row(m.userA, m.teamA), b = row(m.userB, m.teamB);
      const [pa, pb] = m.winner === 'A' ? [POINTS.win, POINTS.loss] : m.winner === 'B' ? [POINTS.loss, POINTS.win] : [POINTS.draw, POINTS.draw];
      a.points += pa; b.points += pb;
      a.byDay[day.number] = (a.byDay[day.number] || 0) + pa;
      b.byDay[day.number] = (b.byDay[day.number] || 0) + pb;
      a.score += m.scoreA; b.score += m.scoreB;
      a.played++; b.played++;
      if (m.winner === 'A') { a.w++; b.l++; } else if (m.winner === 'B') { b.w++; a.l++; } else { a.d++; b.d++; }
      if (day === last) { a.lastDay += pa; b.lastDay += pb; }
    }
  }
  const newest = entriesAt(t, Infinity);
  if (t.status !== 'finished') {
    for (const e of newest) {
      const r = row(e.userId, e.teamName);
      if (!r.language) r.language = e.language;
    }
  }
  // evaluation: the practice score of the newest working bot (a stopped run counts what it played)
  const subs = new Map(db.data.submissions.filter(s => s.tournamentId === t.id).map(s => [s.id, s]));
  for (const e of newest) {
    const r = rows.get(e.userId);
    const p = r && (subs.get(e.submissionId) || {}).practice;
    if (!r) continue;
    r.evalStatus = p ? p.status : 'queued';
    if (p && (p.status === 'done' || p.status === 'stopped')) r.eval = p.total;
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
    publishDelayMs: PUBLISH_DELAY_MS, pairing: pairingOf(t),
    days: (t.days || []).map(d => {
      const fights = dayTotal(d);
      return { number: d.number, at: d.slot || d.startedAt, status: d.status, publishAt: d.publishAt, publishedAt: d.publishedAt || null, teams: d.entries.length,
        played: Math.min(fights, dayMatches(t, d).length), totalMatches: fights,
        ...(d.pairing === 'swiss' ? { rounds: d.rounds, round: Object.keys(d.pairs || {}).length } : {}) };
    }),
    champion: champ ? { userId: champ.userId, teamName: champ.teamName, avatar: champ.avatar } : null,
    rows,
  };
}

module.exports = { isDaily, pairingOf, swissRounds, swissPairs, frozen, validTime, slotsBetween, dueSlots, nextSlot, entriesAt, pairsOf, dayMatches, isPublished, standings, board, PUBLISH_DELAY_MS };
