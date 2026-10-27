// Campaign mode: players submit as many bots as they like; every working
// submission picks one sparring bot (the 10 built-in ones plus any the judge added) and
// plays up to 5 games against it, and only beats it by winning all 5 (strictly more points
// each game). A player finishes once every sparring bot has been beaten by at least one of
// their submissions.
// Ranking: finishers by finish time, then everyone else by bots beaten.
const db = require('./db');
const { CAMPAIGN_GAMES, botsFor } = require('./grader/practice');
const { avatarOf } = require('./auth');
const { canPlay } = require('./access');

const PEN_PER_SUBMISSION = 20;
const MAX_SUBS_LIMIT = 999;

// The judge may cap how many submissions each team aims at each sparring bot
// (t.botMaxSubs[botId]; absent = no limit). Submissions that failed the check don't use up an attempt.
const maxSubsOf = (t, botId) => {
  const n = t.mode === 'campaign' && t.botMaxSubs ? t.botMaxSubs[botId] : undefined;
  return Number.isInteger(n) ? n : null;
};
const attemptsUsed = (t, userId, botId) =>
  db.data.submissions.filter(s => s.tournamentId === t.id && s.userId === userId && s.target === botId && s.status !== 'error').length;

// Penalty (PEN), ICPC-style: 20 for every submission made before the one that finished
// the campaign, plus the minutes from the tournament's start (startsAt, else createdAt) to the finishing
// submission. Submissions after finishing are free. Unfinished: 20 per submission so far.
function penaltyOf(t, p) {
  if (!p.finishedAt) {
    return { pen: PEN_PER_SUBMISSION * p.subs.length, extraSubs: p.subs.length, minutes: null };
  }
  const finishing = Math.max(...Object.values(p.beaten).map(b => b.number)); // submission # that completed the set
  const minutes = Math.max(0, Math.floor((Date.parse(p.finishedAt) - Date.parse(t.startsAt || t.createdAt)) / 60000));
  return { pen: PEN_PER_SUBMISSION * (finishing - 1) + minutes, extraSubs: finishing - 1, minutes };
}

// Everything we know about one player's campaign.
function progressOf(t, userId) {
  const subs = db.data.submissions
    .filter(s => s.tournamentId === t.id && s.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  // only bots still in the campaign count (a bot the judge removed no longer does)
  const live = new Set(botsFor(t).map(h => h.id));
  const beaten = {}; // botId -> { at, number } (earliest submission that beat it)
  const best = {};   // botId -> best attempt { score, botScore, number }
  let busy = false;
  subs.forEach((s, i) => {
    const number = i + 1;
    if (s.status === 'pending') busy = true;
    if (s.status !== 'ok' || !s.practice) return;
    if (s.practice.status === 'running') busy = true;
    for (const r of s.practice.results) {
      if (r.status !== 'done' || !live.has(r.bot)) continue;
      if (r.winner === 'A' && !beaten[r.bot]) beaten[r.bot] = { at: s.createdAt, number };
      // best attempt so far: most games won, then best point margin
      const attempt = {
        number,
        wins: r.games ? r.wins : null,
        needed: r.needed || null,
        games: r.games ? r.games.map(g => g.winner) : null,
        score: r.score,
        botScore: r.botScore,
      };
      const b = best[r.bot];
      const key = x => [x.wins ?? -1, x.score - x.botScore];
      const [kw, km] = key(attempt);
      if (!b || kw > key(b)[0] || (kw === key(b)[0] && km > key(b)[1])) best[r.bot] = attempt;
    }
  });
  const times = Object.values(beaten).map(b => b.at).sort();
  const count = times.length;
  return {
    subs,
    beaten,
    best,
    busy,
    count,
    finishedAt: count === live.size ? times[times.length - 1] : null,
    lastProgressAt: count ? times[times.length - 1] : null,
  };
}

function participants(t) {
  return [...new Set(db.data.submissions.filter(s => s.tournamentId === t.id && canPlay(t, s.userId)).map(s => s.userId))]
    .map(id => db.data.users.find(u => u.id === id))
    .filter(Boolean);
}

// Public leaderboard: which sparring bots each team has beaten (square i = bot i) and
// finish times. Never code, submission numbers or game-by-game results.
function board(t) {
  const bots = botsFor(t);
  const rows = participants(t).map(u => {
    const p = progressOf(t, u.id);
    const pen = penaltyOf(t, p);
    return {
      userId: u.id,
      teamName: u.teamName,
      username: u.username,
      avatar: avatarOf(u),
      beaten: p.count,
      beatenBots: bots.map(h => !!p.beaten[h.id]),
      total: bots.length,
      finishedAt: p.finishedAt,
      lastProgressAt: p.lastProgressAt,
      submissions: p.subs.length,
      pen: pen.pen,
      penSubs: pen.extraSubs,
      penMinutes: pen.minutes,
      busy: p.busy,
    };
  });
  rows.sort((a, b) => {
    if (a.finishedAt && b.finishedAt) return a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0;
    if (a.finishedAt || b.finishedAt) return a.finishedAt ? -1 : 1;
    if (b.beaten !== a.beaten) return b.beaten - a.beaten;
    if (a.lastProgressAt !== b.lastProgressAt) return (a.lastProgressAt || '~') < (b.lastProgressAt || '~') ? -1 : 1;
    return a.teamName.localeCompare(b.teamName);
  });
  rows.forEach((r, i) => { r.rank = i + 1; });
  return {
    id: t.id,
    name: t.name,
    mode: 'campaign',
    status: t.status,
    deadline: t.deadline,
    startedAt: t.startsAt || t.createdAt,
    total: bots.length,
    gamesNeeded: CAMPAIGN_GAMES,
    bots: bots.map(h => h.name),
    finishers: rows.filter(r => r.finishedAt).length,
    rows,
  };
}

// Private breakdown for one player: which bots are down and how.
function details(t, userId) {
  const u = db.data.users.find(x => x.id === userId);
  if (!u) return null;
  const p = progressOf(t, userId);
  const playing = new Map(); // botId -> game number being played right now (or 0 if queued)
  for (const s of p.subs) {
    if (s.status === 'ok' && s.practice && s.practice.status === 'running') {
      s.practice.results.forEach(r => {
        if (r.status === 'done') return;
        const game = r.status === 'playing' ? (r.games ? r.games.length + 1 : 1) : 0;
        playing.set(r.bot, Math.max(playing.get(r.bot) || 0, game));
      });
    }
  }
  return {
    userId,
    teamName: u.teamName,
    submissions: p.subs.length,
    gamesNeeded: CAMPAIGN_GAMES,
    beatenCount: p.count,
    finishedAt: p.finishedAt,
    bots: botsFor(t).map(h => ({
      bot: h.id,
      name: h.name,
      desc: h.desc,
      beaten: !!p.beaten[h.id],
      used: p.subs.filter(s => s.target === h.id && s.status !== 'error').length,
      maxSubs: maxSubsOf(t, h.id),
      beatenBy: p.beaten[h.id] ? p.beaten[h.id].number : null,
      beatenAt: p.beaten[h.id] ? p.beaten[h.id].at : null,
      best: p.best[h.id] || null,
      inProgress: !p.beaten[h.id] && playing.has(h.id),
      liveGame: !p.beaten[h.id] && playing.get(h.id) ? playing.get(h.id) : null,
    })),
  };
}

module.exports = { board, details, maxSubsOf, attemptsUsed, MAX_SUBS_LIMIT };
