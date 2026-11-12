// Brawl ("hỗn chiến") as a daily league. On a schedule from the start until the deadline, the
// teams' newest working bots (submitted before that moment) play a round: win = 3, draw = 1, loss = 0.
// The schedule is either every day at t.dailyTime ('HH:MM' in the judge's time zone; t.tzOffset =
// the judge's Date#getTimezoneOffset()), or, with t.cycleMinutes, a cycle: a round every
// t.cycleMinutes counted from the start (start + 1 cycle, start + 2 cycles, ...).
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
//             finishedAt, publishedAt, pairing, live, and for Swiss: rounds, pairs: { r: [{ a, b, name }] },
//             byes: [{ round, userId }] }]
// t.rejudgeQueue = [{ day, pairing, requestedAt }]: days waiting to be rejudged, in request order.
// A day the judge rejudges is `live` until it is published again: its results show as its matches
// end (no hidden period, no frozen submissions), and it is published as soon as it is done.
const db = require('./db');
const { avatarOf } = require('./auth');
const { canPlay, isBanned } = require('./access');
const { botsFor, inShowdown, showdownEnd, showdownMinutesOf, showdownEveryOf } = require('./grader/practice');
const { MAX_SCORE } = require('./grader/board');
const { TURNS } = require('./grader/match');

const DAY_MS = 24 * 3600 * 1000;
const PUBLISH_DELAY_MS = process.env.PUBLISH_DELAY_MS !== undefined ? +process.env.PUBLISH_DELAY_MS : 10 * 60 * 1000;
const POINTS = { win: 3, draw: 1, loss: 0 };

const isDaily = t => t.format === 'daily';
// The number of the next day played. (Days are numbered 1, 2, 3...: when the judge deletes some, the
// others are numbered again, see the delete-days route in app.js.)
const nextDayNumber = t => (t.days || []).reduce((n, d) => Math.max(n, d.number), 0) + 1;
const pairingOf = t => (t.pairing === 'swiss' ? 'swiss' : 'rr');
const swissRounds = n => (n < 2 ? 0 : Math.ceil(Math.log2(n)));
const gameOf = t => (t.game === 'board' ? 'board' : 'rps');
// The most a bot can score in practice: every match against every sparring bot won outright.
// (none during the showdown: the evaluation is then the points of its rounds)
const evalMax = t => (inShowdown(t) ? null : botsFor(t).length * (gameOf(t) === 'board' ? MAX_SCORE : TURNS * 3));
const validTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
// A cycle the judge may pick, in hours: 15 minutes to 30 days.
const MIN_CYCLE_HOURS = 0.25, MAX_CYCLE_HOURS = 30 * 24;
const validCycle = h => typeof h === 'number' && Number.isFinite(h) && h >= MIN_CYCLE_HOURS && h <= MAX_CYCLE_HOURS;
const cycleHoursOf = t => (t.cycleMinutes ? t.cycleMinutes / 60 : null);

// Match times in [from, to] (ms timestamps), oldest first: the regular schedule, except inside the
// showdown ("quyết đấu") window, where a round starts at its start and then every
// t.showdownEveryMinutes instead. (Only rounds from when the judge set the showdown, give or take 5
// minutes: setting one that started earlier doesn't fire its past rounds.)
function slotsBetween(t, from, to) {
  const regular = regularSlots(t, from, to);
  if (!t.showdownAt) return regular;
  const start = Date.parse(t.showdownAt), end = showdownEnd(t), every = showdownEveryOf(t) * 60000;
  const since = Math.max(from, Date.parse(t.showdownSince || t.showdownAt) - 5 * 60000);
  const showdown = [];
  for (let k = Math.max(0, Math.ceil((since - start) / every)), s; (s = start + k * every) < end && s <= to && showdown.length < 4000; k++) showdown.push(s);
  return [...regular.filter(s => s < start || s >= end), ...showdown].sort((a, b) => a - b);
}
function regularSlots(t, from, to) {
  if (t.cycleMinutes) {
    const start = Date.parse(t.startsAt || t.createdAt), every = t.cycleMinutes * 60000;
    const out = [];
    for (let k = Math.max(1, Math.ceil((from - start) / every)), s; (s = start + k * every) <= to && out.length < 4000; k++) out.push(s);
    return out;
  }
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

// Daily matches only count from the start (and from when the judge last set the time or the cycle,
// so moving it earlier doesn't fire a round retroactively).
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

// How long a day starting at `now` keeps its results hidden. During the showdown ("quyết đấu") a day
// is published as soon as its matches end, except the showdown's last one (no other round of it starts
// before it ends, or the tournament does), which waits the usual PUBLISH_DELAY_MS.
function publishDelay(t, now) {
  if (!inShowdown(t, now)) return PUBLISH_DELAY_MS;
  const next = nextSlot(t, now);
  const last = !next || Date.parse(next) >= showdownEnd(t);
  return last ? PUBLISH_DELAY_MS : 0;
}

// Every team's newest working bot submitted before `at` (banned teams only with withBanned).
function entriesAt(t, at, { withBanned = false } = {}) {
  const latest = new Map();
  for (const s of db.data.submissions) {
    if (s.tournamentId !== t.id || s.status !== 'ok' || !canPlay(t, s.userId) || Date.parse(s.createdAt) > at) continue;
    if (!withBanned && isBanned(t, s.userId)) continue;
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
  const day = (t.days || []).find(d => !shown(d));
  if (day) return { day: day.number, publishAt: day.publishAt };
  return dueSlots(t, now).length ? { day: nextDayNumber(t), publishAt: null } : null;
}

const dayMatches = (t, day) => Object.values(db.data.matches[t.id] || {}).filter(m => m.day === day.number);
// whether a day's results can be seen: published, or being rejudged live
const shown = d => d.status === 'published' || !!d.live;
const isPublished = (t, dayNumber) => (t.days || []).some(d => d.number === dayNumber && shown(d));

// Cumulative standings over the published days (and live ones, as far as they have been played). Teams with a working bot that haven't played a
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
  const published = (t.days || []).filter(shown);
  const last = published[published.length - 1];
  // the showdown's rounds (marked with the showdownAt they were played under, see tournament.js)
  const sdDay = day => !!t.showdownAt && day.showdown === t.showdownAt;
  const sdAdd = (day, r, p) => { if (sdDay(day)) r.sdPoints = (r.sdPoints || 0) + p; };
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
      sdAdd(day, r, POINTS.win);
      r.byes = (r.byes || 0) + 1;
      r.byDay[day.number] = (r.byDay[day.number] || 0) + POINTS.win;
      if (day === last) r.lastDay += POINTS.win;
    }
    for (const m of dayMatches(t, day)) {
      const a = row(m.userA, m.teamA), b = row(m.userB, m.teamB);
      const [pa, pb] = m.winner === 'A' ? [POINTS.win, POINTS.loss] : m.winner === 'B' ? [POINTS.loss, POINTS.win] : [POINTS.draw, POINTS.draw];
      a.points += pa; b.points += pb;
      sdAdd(day, a, pa); sdAdd(day, b, pb);
      a.byDay[day.number] = (a.byDay[day.number] || 0) + pa;
      b.byDay[day.number] = (b.byDay[day.number] || 0) + pb;
      a.score += m.scoreA; b.score += m.scoreB;
      a.played++; b.played++;
      if (m.winner === 'A') { a.w++; b.l++; } else if (m.winner === 'B') { b.w++; a.l++; } else { a.d++; b.d++; }
      if (day === last) { a.lastDay += pa; b.lastDay += pb; }
    }
  }
  const newest = entriesAt(t, Infinity, { withBanned: true }); // (banned teams stay listed, struck through)
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
  // showdown: the evaluation is the points (3 / 1 / 0) a team took in its published rounds instead
  if (inShowdown(t)) {
    for (const r of rows.values()) {
      r.eval = r.sdPoints || 0;
      r.evalStatus = 'done';
    }
  }
  for (const r of rows.values()) delete r.sdPoints;
  // banned teams: at the bottom, without a rank
  for (const r of rows.values()) r.banned = isBanned(t, r.userId);
  const list = [...rows.values()].sort((x, y) => x.banned - y.banned ||
    y.points - x.points || (y.eval ?? -1) - (x.eval ?? -1) || y.w - x.w || y.score - x.score || x.teamName.localeCompare(y.teamName));
  list.forEach((r, i) => { r.rank = r.banned ? null : i + 1; });
  return list;
}

// The showdown as the pages show it: its window and interval, and when its next round starts.
function showdownInfo(t, now = Date.now()) {
  if (!t.showdownAt) return { showdownAt: null, showdown: false };
  const next = nextSlot(t, Math.max(now, Date.parse(t.showdownAt) - 1));
  return {
    showdownAt: t.showdownAt, showdownMinutes: showdownMinutesOf(t), showdownEveryMinutes: showdownEveryOf(t), showdown: inShowdown(t, now),
    showdownNextAt: next && Date.parse(next) < showdownEnd(t) ? next : null,
  };
}

// Deletes the days numbered in `numbers` (a Set) and their matches, then numbers the days left
// 1, 2, 3... again, renaming their matches ("day N - ...") to match. The caller makes sure no day is
// being played meanwhile. Returns { deleted: [old numbers], matches, renumbered }.
async function deleteDays(t, numbers) {
  const gone = (t.days || []).filter(d => numbers.has(d.number));
  const names = gone.flatMap(d => dayMatches(t, d).map(m => m.name));
  t.days = (t.days || []).filter(d => !numbers.has(d.number)).sort((a, b) => a.number - b.number);
  if (t.rejudgeQueue) {
    t.rejudgeQueue = t.rejudgeQueue.filter(q => !numbers.has(q.day));
    if (!t.rejudgeQueue.length) delete t.rejudgeQueue;
  }
  await db.deleteMatches(t.id, names);
  // lowest first, so a day's new (smaller) number is always free by the time it gets it
  const renames = [], renumber = new Map(); // old number -> new
  const rename = (name, n) => name.replace(/^day \d+ /, `day ${n} `);
  t.days.forEach((d, i) => {
    const n = i + 1;
    if (d.number === n) return;
    renumber.set(d.number, n);
    for (const m of dayMatches(t, d)) renames.push({ from: m.name, to: rename(m.name, n), set: { day: n } });
    for (const list of Object.values(d.pairs || {})) for (const p of list) p.name = rename(p.name, n);
    d.number = n;
  });
  for (const q of t.rejudgeQueue || []) if (renumber.has(q.day)) q.day = renumber.get(q.day);
  await db.renameMatches(t.id, renames);
  // a finished league crowns whoever leads the standings without these days
  if (t.status === 'finished') {
    const [top] = standings(t);
    t.championId = top && top.played > 0 ? top.userId : null;
  }
  db.save();
  return { deleted: gone.map(d => d.number), matches: names.length, renumbered: renumber.size };
}

// The public leaderboard: published standings, and for each day only its progress (never outcomes).
function board(t, now = Date.now()) {
  const rows = standings(t);
  const champ = t.championId && rows.find(r => r.userId === t.championId);
  return {
    id: t.id, name: t.name, mode: 'brawl', format: 'daily', status: t.status, error: t.error || null,
    deadline: t.deadline, startsAt: t.startsAt || null, dailyTime: t.dailyTime || null, cycleHours: cycleHoursOf(t), nextAt: t.status === 'open' ? nextSlot(t, now) : null,
    publishDelayMs: PUBLISH_DELAY_MS, pairing: pairingOf(t), ...showdownInfo(t, now), rejudgeQueue: (t.rejudgeQueue || []).map(q => q.day),
    days: (t.days || []).map(d => {
      const fights = dayTotal(d);
      return { number: d.number, at: d.slot || d.startedAt, status: d.status, live: !!d.live, publishAt: d.publishAt, publishedAt: d.publishedAt || null, teams: d.entries.length,
        played: Math.min(fights, dayMatches(t, d).length), totalMatches: fights,
        ...(d.pairing === 'swiss' ? { rounds: d.rounds, round: Object.keys(d.pairs || {}).length } : {}) };
    }),
    champion: champ ? { userId: champ.userId, teamName: champ.teamName, avatar: champ.avatar } : null,
    rows,
  };
}

module.exports = { publishDelay, deleteDays, nextDayNumber, showdownInfo, isDaily, pairingOf, swissRounds, swissPairs, frozen, validTime, validCycle, cycleHoursOf, MIN_CYCLE_HOURS, MAX_CYCLE_HOURS, slotsBetween, dueSlots, nextSlot, entriesAt, pairsOf, dayMatches, isPublished, standings, board, PUBLISH_DELAY_MS };
