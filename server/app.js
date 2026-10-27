const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

// The web server. server/index.js loads the database first, then requires this.
const db = require('./db');
const auth = require('./auth');
const grader = require('./grader');
const { normalizeAvatar } = require('../public/js/avatar');
const { TournamentManager, matchSummary } = require('./tournament');
const { TURNS } = require('./grader/match');
const boardGame = require('./grader/board');
const SUBMIT_COOLDOWN_MS = +process.env.SUBMIT_COOLDOWN_MS || 90000;
const campaign = require('./campaign');

auth.prepareUsers();
auth.ensureJudge();

const PORT = +process.env.PORT || 3000;
const VIEWS = path.join(__dirname, '..', 'views');
const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_CODE_LENGTH = 100000;

const app = express();
// Behind nginx or a tunnel on this machine, take the visitor's real IP from X-Forwarded-For
// (only trusted when the request itself comes from localhost).
app.set('trust proxy', 'loopback');
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = session({
  name: 'ottv1.sid',
  // with PostgreSQL, sessions survive restarts; otherwise they live in memory
  ...(db.pool ? { store: new (require('./session-store'))(db.pool) } : {}),
  secret: db.data.meta.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 },
});
app.use(sessionMiddleware);
app.use(express.json({ limit: '512kb' }));
app.use(express.static(PUBLIC, { index: false }));

const manager = new TournamentManager(io);

// ---------- helpers ----------
const findUser = id => db.data.users.find(u => u.id === id);
const findTournament = id => db.data.tournaments.find(t => t.id === id);
const currentUser = req => (req.session.userId ? findUser(req.session.userId) : null);
const { isJudge, isInviteOnly, canPlay, canSee } = require('./access');
// The tournament in the URL, if this user may see it (invite-only ones are hidden from outsiders).
const visibleTournament = req => {
  const t = findTournament(req.params.id);
  return t && canSee(t, req.user) ? t : null;
};

function apiAuth(req, res, next) {
  req.user = currentUser(req);
  if (!req.user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  next();
}
function apiJudge(req, res, next) {
  if (!isJudge(req.user)) return res.status(403).json({ error: 'Chỉ dành cho trọng tài' });
  next();
}
function pageAuth(req, res, next) {
  req.user = currentUser(req);
  if (!req.user) return res.redirect('/login');
  next();
}
// Every restart gets a new asset version, appended to the page's CSS/JS links, so browsers
// and proxies (e.g. Cloudflare) never serve a stale stylesheet or script after an update.
const ASSET_VERSION = Date.now().toString(36);
const view = name => (req, res) => {
  const html = fs.readFileSync(path.join(VIEWS, name), 'utf8')
    .replace(/(href|src)="(\/(?:css|js)\/[^"?]+)"/g, `$1="$2?v=${ASSET_VERSION}"`);
  res.set('Cache-Control', 'no-cache').type('html').send(html);
};
const fail = (res, code, error) => res.status(code).json({ error });
// Async route handlers: errors go to the error handler at the end instead of being lost.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Submissions as the API returns them, with their code (kept in the database, not in memory).
async function withCode(subs, extra = () => ({})) {
  const codes = await db.getCodes(subs.map(s => s.id));
  return subs.map(s => ({ ...publicSubmission(s), code: codes[s.id], ...extra(s) }));
}
const gameOf = grader.practice.gameOf;
// Points one match is worth at most (RPS: 3 per turn; board game: 3 per game).
const maxMatchScore = t => (gameOf(t) === 'board' ? boardGame.MAX_SCORE : TURNS * 3);

function publicTournament(t, user) {
  const subs = db.data.submissions.filter(s => s.tournamentId === t.id);
  const ready = new Set(subs.filter(s => s.status === 'ok' && canPlay(t, s.userId)).map(s => s.userId));
  const mine = user ? subs.filter(s => s.userId === user.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) : [];
  let championId = t.championId;
  if (!championId && t.mode === 'campaign' && t.status === 'finished') {
    // campaigns closed before "top team wins even without finishing" was introduced
    const top = campaign.board(t).rows[0];
    if (top && top.beaten > 0) championId = top.userId;
  }
  const champion = championId && (t.entries ? t.entries.find(e => e.userId === championId) : findUser(championId));
  return {
    id: t.id,
    name: t.name,
    mode: t.mode || 'brawl',
    game: gameOf(t),
    description: t.description || '',
    deadline: t.deadline,
    startsAt: t.startsAt || null,
    ...(daily.isDaily(t) ? { daily: { time: t.dailyTime, pairing: daily.pairingOf(t), nextAt: t.status === 'open' ? daily.nextSlot(t, Date.now()) : null, frozen: t.status === 'open' ? daily.frozen(t) : null, days: (t.days || []).filter(d => d.status === 'published').length, played: (t.days || []).length, publishDelayMs: daily.PUBLISH_DELAY_MS } } : {}),
    status: t.status,
    createdAt: t.createdAt || t.startsAt || t.deadline,
    teamsReady: t.entries ? t.entries.length : ready.size,
    access: isInviteOnly(t) ? 'invite' : 'open',
    members: isInviteOnly(t) && isJudge(user) ? (t.members || []).filter(id => findUser(id)).length : undefined,
    hidden: isJudge(user) ? !!t.hidden : undefined,
    champion: champion ? champion.teamName : null,
    announcements: publicAnnouncements(t),
    mySubmission: mine[0] ? publicSubmission(mine[0]) : null,
    myActive: (mine.find(s => s.status === 'ok') || {}).id || null,
  };
}
function publicSubmission(s) {
  return { id: s.id, tournamentId: s.tournamentId, language: s.language, target: s.target || null, status: s.status, message: s.message || '', createdAt: s.createdAt };
}
// Players may only peek at matches once the tournament is over (daily league: once that day's
// results are published); the judge can always.
const daily = require('./daily');
const canSeeMatches = (t, user) => isJudge(user) || t.status === 'finished' || daily.isDaily(t);
const canSeeMatch = (t, m, user) => isJudge(user) || !daily.isDaily(t) || daily.isPublished(t, m.day);
// The judge's announcements (t.announcements), shown on the tournament's pages for 24 hours each.
const ANNOUNCEMENT_TTL_MS = 24 * 3600 * 1000;
const MAX_ANNOUNCEMENT_LENGTH = 1000;
const liveAnnouncements = t => (t.announcements || []).filter(a => Date.parse(a.createdAt) + ANNOUNCEMENT_TTL_MS > Date.now());
const publicAnnouncements = t => liveAnnouncements(t)
  .map(a => ({ id: a.id, text: a.text, createdAt: a.createdAt, expiresAt: new Date(Date.parse(a.createdAt) + ANNOUNCEMENT_TTL_MS).toISOString() }))
  .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first

// ---------- pages ----------
app.get('/login', (req, res) => (currentUser(req) ? res.redirect('/') : view('login.html')(req, res)));
app.get('/', pageAuth, view('index.html'));
app.get('/tournament/:id/submit', pageAuth, view('submit.html'));
app.get('/tournament/:id/live', pageAuth, view('live.html'));
// the board game has its own replay page
app.get('/tournament/:id/match', pageAuth, (req, res) => view(gameOf(findTournament(req.params.id)) === 'board' ? 'board-match.html' : 'match.html')(req, res));
app.get('/me', pageAuth, view('profile.html'));
app.get('/admin', pageAuth, (req, res) => (isJudge(req.user) ? view('admin.html')(req, res) : res.redirect('/')));
app.get('/tournament/:id/matches', pageAuth, view('matches.html'));
// (the old judge-only address)
app.get('/admin/matches', pageAuth, (req, res) => res.redirect(req.query.t ? `/tournament/${encodeURIComponent(req.query.t)}/matches` : '/admin'));

// ---------- auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.data.users.find(u => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
  if (!user || !auth.verifyPassword(password, user.passwordHash)) return fail(res, 401, 'Sai tên đăng nhập hoặc mật khẩu');
  req.session.regenerate(err => {
    if (err) return fail(res, 500, 'Lỗi phiên đăng nhập');
    req.session.userId = user.id;
    res.json({ user: auth.publicUser(user) });
  });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

// ---------- self-registration ----------
// Anyone can create a *player* account while the judge leaves sign-ups open.
const registrationOpen = () => db.data.meta.registrationOpen !== false;
const signupsByIp = new Map(); // ip -> timestamps of recent sign-ups
// Players at one venue often share an IP, so keep this generous (SIGNUP_LIMIT per hour per IP).
const SIGNUP_LIMIT = +process.env.SIGNUP_LIMIT || 30, SIGNUP_WINDOW_MS = 60 * 60 * 1000;

app.get('/register', (req, res) => (currentUser(req) ? res.redirect('/') : view('register.html')(req, res)));
app.get('/api/register', (req, res) => res.json({ open: registrationOpen() }));
app.post('/api/register', (req, res) => {
  if (!registrationOpen()) return fail(res, 403, 'Đang đóng đăng ký. Hãy xin trọng tài cấp tài khoản.');
  const { username, password, teamName } = req.body || {};
  if (String(password || '').length < 6) return fail(res, 400, 'Mật khẩu phải có ít nhất 6 ký tự');
  const ip = req.ip || 'unknown';
  const recent = (signupsByIp.get(ip) || []).filter(t => Date.now() - t < SIGNUP_WINDOW_MS);
  if (recent.length >= SIGNUP_LIMIT) return fail(res, 429, 'Mạng của bạn đã tạo quá nhiều tài khoản. Hãy thử lại sau.');
  let user;
  try {
    user = auth.createUser({ username, password, teamName, role: 'player' });
  } catch (e) {
    return fail(res, 400, e.message);
  }
  signupsByIp.set(ip, [...recent, Date.now()]);
  console.log(`[users] new player "${user.username}" (team "${user.teamName}") signed up`);
  io.to('judge').emit('users:changed');
  req.session.regenerate(err => {
    if (err) return fail(res, 500, 'Lỗi phiên đăng nhập');
    req.session.userId = user.id;
    res.json({ user: auth.publicUser(user) });
  });
});
app.post('/api/admin/registration', apiAuth, (req, res, next) => (isJudge(req.user) ? next() : fail(res, 403, 'Chỉ dành cho trọng tài')), (req, res) => {
  db.data.meta.registrationOpen = !!(req.body || {}).open;
  db.save();
  res.json({ open: registrationOpen() });
});
app.get('/api/me', apiAuth, (req, res) => res.json({ user: auth.publicUser(req.user), serverNow: Date.now() }));
// Players rename their own team (the username never changes) and change their password.
app.put('/api/me/team', apiAuth, (req, res) => {
  try {
    auth.renameTeam(req.user, (req.body || {}).teamName);
  } catch (e) {
    return fail(res, 400, e.message);
  }
  io.to('judge').emit('users:changed');
  io.to('users').emit('tournaments:changed');
  res.json({ user: auth.publicUser(req.user) });
});
app.put('/api/me/password', apiAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!auth.verifyPassword(currentPassword, req.user.passwordHash)) return fail(res, 400, 'Mật khẩu hiện tại không đúng');
  if (String(newPassword || '').length < 6) return fail(res, 400, 'Mật khẩu mới phải có ít nhất 6 ký tự');
  req.user.passwordHash = auth.hashPassword(newPassword);
  db.save();
  res.json({ ok: true });
});
app.put('/api/me/avatar', apiAuth, (req, res) => {
  req.user.avatar = normalizeAvatar((req.body || {}).avatar, req.user.teamName);
  db.save();
  res.json({ user: auth.publicUser(req.user) });
});

// ---------- tournaments ----------
app.get('/api/tournaments', apiAuth, (req, res) => {
  const list = db.data.tournaments
    .filter(t => canSee(t, req.user))
    .map(t => publicTournament(t, req.user))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  res.json({ tournaments: list, serverNow: Date.now() });
});

app.get('/api/tournaments/:id', apiAuth, wrap(async (req, res) => {
  const t = visibleTournament(req);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  const mine = await withCode(db.data.submissions
    .filter(s => s.tournamentId === t.id && s.userId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  res.json({
    tournament: publicTournament(t, req.user),
    submissions: mine,
    languages: grader.LANGS,
    bots: grader.practice.botsFor(t).map(h => ({ id: h.id, name: h.name, desc: h.desc })),
    turns: gameOf(t) === 'board' ? boardGame.MAX_TURNS : TURNS,
    maxScore: maxMatchScore(t),
    gamesNeeded: grader.practice.CAMPAIGN_GAMES,
    cooldownMs: SUBMIT_COOLDOWN_MS,
    serverNow: Date.now(),
  });
}));

app.post('/api/tournaments/:id/submissions', apiAuth, wrap(async (req, res) => {
  const t = visibleTournament(req);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (isJudge(req.user)) return fail(res, 403, 'Trọng tài chỉ chấm, không thi đấu. (Hãy đăng nhập bằng tài khoản người chơi để nộp bài.)');
  if (!canPlay(t, req.user.id)) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (t.status !== 'open' || Date.parse(t.deadline) <= Date.now()) return fail(res, 400, 'Muộn rồi! Giải này đã hết hạn nộp bài.');
  if (t.startsAt && Date.parse(t.startsAt) > Date.now()) return fail(res, 400, 'Giải chưa bắt đầu, hãy đợi đến giờ mở cửa nhé.');
  const frozen = daily.isDaily(t) && daily.frozen(t);
  if (frozen) return fail(res, 400, `Vòng ${frozen.day} đang thi đấu: tạm khóa nộp bài đến khi công bố kết quả.`);
  const { language, code, target } = req.body || {};
  if (!grader.LANGS[language]) return fail(res, 400, 'Hãy chọn ngôn ngữ: cpp, java hoặc python');
  // Campaign: each submission is aimed at one sparring bot.
  const isCampaign = t.mode === 'campaign';
  if (isCampaign && !grader.practice.botsFor(t).some(h => h.id === target)) return fail(res, 400, 'Hãy chọn bot đấu tập mà bài nộp này sẽ đấu');
  if (typeof code !== 'string' || !code.trim()) return fail(res, 400, 'Code của bạn đang trống');
  if (code.length > MAX_CODE_LENGTH) return fail(res, 400, `Code quá dài (tối đa ${MAX_CODE_LENGTH} ký tự)`);
  const busy = db.data.submissions.some(s => s.tournamentId === t.id && s.userId === req.user.id && s.status === 'pending');
  if (busy) return fail(res, 429, 'Bài nộp trước của bạn vẫn đang được kiểm tra, đợi chút nhé');
  // at most one submission every SUBMIT_COOLDOWN_MS per player (across all tournaments)
  const lastAt = db.data.submissions.filter(s => s.userId === req.user.id).reduce((m, s) => Math.max(m, Date.parse(s.createdAt)), 0);
  const waitMs = lastAt + SUBMIT_COOLDOWN_MS - Date.now();
  if (waitMs > 0) return fail(res, 429, `Chậm lại chút! Đợi ${Math.ceil(waitMs / 1000)} giây nữa rồi nộp tiếp nhé.`);
  const sub = { id: db.id(), tournamentId: t.id, userId: req.user.id, language, ...(gameOf(t) === 'board' ? { game: 'board' } : {}), ...(isCampaign ? { target } : {}), status: 'pending', message: '', createdAt: new Date().toISOString() };
  db.data.submissions.push(sub); // listed right away, so a second request counts as "busy"
  try {
    await db.putCode(sub, code);
  } catch (e) {
    db.data.submissions = db.data.submissions.filter(s => s !== sub);
    throw e;
  }
  db.save();
  grader.validate(sub);
  res.json({ submission: { ...publicSubmission(sub), code } });
}));

app.get('/api/submissions/:id', apiAuth, wrap(async (req, res) => {
  const s = db.data.submissions.find(x => x.id === req.params.id);
  if (!s || (s.userId !== req.user.id && !isJudge(req.user))) return fail(res, 404, 'Không tìm thấy bài nộp');
  res.json({ submission: (await withCode([s]))[0] });
}));

// Practice leaderboard: everyone sees each team's total against the 10 house
// bots; the per-bot breakdown is only for the team itself (and the judge).
app.get('/api/tournaments/:id/practice', apiAuth, (req, res) => {
  const t = visibleTournament(req);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (t.mode === 'campaign') {
    const want = String(req.query.user || req.user.id);
    if (want !== req.user.id && !isJudge(req.user)) return fail(res, 403, 'Không được xem tiến độ của đội khác 🤫');
    return res.json({ mode: 'campaign', board: campaign.board(t), details: campaign.details(t, want), serverNow: Date.now() });
  }
  const userIds = [...new Set(db.data.submissions.filter(s => s.tournamentId === t.id && canPlay(t, s.userId)).map(s => s.userId))];
  const rows = userIds.map(uid => {
    const u = findUser(uid);
    if (!u) return null;
    const s = grader.activeSubmission(t.id, uid);
    const p = s && s.practice;
    return {
      userId: uid,
      teamName: u.teamName,
      username: u.username,
      avatar: auth.avatarOf(u),
      language: s ? s.language : null,
      status: !s ? 'no-bot' : p ? p.status : 'queued',
      total: p ? p.total : null,
      played: p ? p.results.filter(r => r.status === 'done').length : 0,
    };
  }).filter(Boolean);
  rows.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.teamName.localeCompare(b.teamName));
  rows.forEach((r, i) => { r.rank = i + 1; });

  let details = null;
  const house = grader.practice.botsFor(t);
  const want = String(req.query.user || req.user.id);
  if (want === req.user.id || isJudge(req.user)) {
    const s = grader.activeSubmission(t.id, want);
    const u = findUser(want);
    const replays = db.data.matches[grader.practice.replayKey(t.id)] || {};
    if (s && u) {
      details = {
        userId: want,
        teamName: u.teamName,
        submissionId: s.id,
        language: s.language,
        submittedAt: s.createdAt,
        status: s.practice ? s.practice.status : 'queued',
        total: s.practice ? s.practice.total : 0,
        results: (s.practice ? s.practice.results : house.map(h => ({ bot: h.id, name: h.name, status: 'queued' })))
          // names come from the current bot list, so renamed bots show their new name on old results
          .map(({ bot, name, status, score, botScore, winner, issue }) => ({ bot, name: (house.find(h => h.id === bot) || { name }).name, desc: (house.find(h => h.id === bot) || {}).desc || '', status, score, botScore, winner, issue,
            replay: (replays[grader.practice.replayName(want, bot)] || {}).submissionId === s.id })),
      };
    }
  } else if (req.query.user) {
    return fail(res, 403, 'Không được xem điểm của đội khác 🤫');
  }
  res.json({ rows, details, turns: TURNS, maxScore: maxMatchScore(t), houseCount: house.length, maxTotal: house.length * maxMatchScore(t), serverNow: Date.now() });
});

// Replay of a practice match: your own (the judge: anyone's) against one sparring bot.
app.get('/api/tournaments/:id/practice/:bot', apiAuth, wrap(async (req, res) => {
  const t = visibleTournament(req);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  const want = String(req.query.user || req.user.id);
  if (want !== req.user.id && !isJudge(req.user)) return fail(res, 403, 'Không được xem trận đấu tập của đội khác 🤫');
  const m = await db.getMatch(grader.practice.replayKey(t.id), grader.practice.replayName(want, req.params.bot));
  if (!m) return fail(res, 404, 'Không tìm thấy trận đấu tập này');
  res.json({ match: { ...m, practice: true }, avatars: { A: auth.avatarOf(findUser(want) || { teamName: m.teamA }), B: auth.avatarOf({ teamName: m.teamB }) }, tournament: { id: t.id, name: t.name, status: t.status } });
}));

app.get('/api/tournaments/:id/leaderboard', apiAuth, (req, res) => {
  const t = visibleTournament(req);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  res.json({ leaderboard: manager.leaderboard(t), game: gameOf(t), canSeeMatches: canSeeMatches(t, req.user), announcements: publicAnnouncements(t), serverNow: Date.now() });
});

app.get('/api/tournaments/:id/matches', apiAuth, (req, res) => {
  const t = visibleTournament(req);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (!canSeeMatches(t, req.user)) return fail(res, 403, 'Các trận đấu sẽ được công khai khi giải kết thúc');
  const list = Object.values(db.data.matches[t.id] || {}).filter(m => canSeeMatch(t, m, req.user)).map(matchSummary)
    .sort((a, b) => a.round - b.round || (a.playedAt < b.playedAt ? -1 : 1));
  res.json({ matches: list });
});

app.get('/api/tournaments/:id/matches/:name', apiAuth, wrap(async (req, res) => {
  const t = visibleTournament(req);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (!canSeeMatches(t, req.user)) return fail(res, 403, 'Các trận đấu sẽ được công khai khi giải kết thúc');
  const m = await db.getMatch(t.id, req.params.name);
  if (!m) return fail(res, 404, 'Không tìm thấy trận đấu');
  if (!canSeeMatch(t, m, req.user)) return fail(res, 403, 'Kết quả vòng này chưa được công bố');
  res.json({ match: m, avatars: { A: auth.avatarOf(findUser(m.userA) || { teamName: m.teamA }), B: auth.avatarOf(findUser(m.userB) || { teamName: m.teamB }) }, tournament: { id: t.id, name: t.name, status: t.status } });
}));

// A tournament's match history, grouped by day (daily league) or round, by match id: the judge sees
// every match, players what they may watch (canSeeMatch). Matches from before ids existed are
// numbered 1..k in the order they were played (new ids start after them, see tournament.js).
app.get('/api/tournaments/:id/history', apiAuth, (req, res) => {
  const t = visibleTournament(req);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (!canSeeMatches(t, req.user)) return fail(res, 403, 'Các trận đấu sẽ được công khai khi giải kết thúc');
  const usernameOf = id => (findUser(id) || {}).username || '';
  const all = Object.values(db.data.matches[t.id] || {});
  const old = all.filter(m => !m.id).sort((a, b) => ((a.playedAt || '') < (b.playedAt || '') ? -1 : 1));
  const idOf = new Map(old.map((m, i) => [m, i + 1]));
  const matches = all
    .map(m => [m, m.id || idOf.get(m)])
    .filter(([m]) => canSeeMatch(t, m, req.user))
    .sort((a, b) => a[1] - b[1])
    .map(([m, id]) => ({
      id, name: m.name, group: m.day ? `d${m.day}` : `r${m.round}`, dayRound: m.dayRound || null,
      teamA: m.teamA, teamB: m.teamB, userA: usernameOf(m.userA), userB: usernameOf(m.userB),
      scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner, durationMs: m.durationMs ?? null, playedAt: m.playedAt || null,
    }));
  const groups = daily.isDaily(t)
    ? (t.days || []).map(d => ({ key: `d${d.number}`, label: `Vòng ${d.number}`, at: d.slot || d.startedAt, status: d.status, rounds: d.rounds || null }))
    : [...new Set(matches.map(m => m.group))].map(k => ({ key: k, label: `Vòng ${k.slice(1)}`, at: (matches.find(m => m.group === k) || {}).playedAt || null, status: 'published' }));
  res.json({ tournament: { id: t.id, name: t.name, game: gameOf(t), status: t.status }, judge: isJudge(req.user), groups, matches });
});

// ---------- judge ----------

app.get('/api/admin/users', apiAuth, apiJudge, (req, res) => {
  res.json({ users: db.data.users.map(auth.publicUser) });
});
app.post('/api/admin/users', apiAuth, apiJudge, (req, res) => {
  const { username, password, teamName, role = 'player' } = req.body || {};
  let user;
  try {
    user = auth.createUser({ username, password, teamName, role });
  } catch (e) {
    return fail(res, 400, e.message);
  }
  console.log(`[users] judge "${req.user.username}" added ${user.role} "${user.username}" (team "${user.teamName}")`);
  io.to('judge').emit('users:changed');
  res.json({ user: auth.publicUser(user) });
});
// Many accounts at once (all or nothing). Returns the plain passwords so the judge can hand them out.
const BULK_LIMIT = 500;
app.post('/api/admin/users/bulk', apiAuth, apiJudge, async (req, res) => {
  const list = (req.body || {}).users;
  if (!Array.isArray(list) || !list.length) return fail(res, 400, 'Danh sách tài khoản đang trống');
  if (list.length > BULK_LIMIT) return fail(res, 400, `Tối đa ${BULK_LIMIT} tài khoản mỗi lần`);
  let result;
  try {
    result = await auth.createUsers(list.map(u => ({ username: u && u.username, password: u && u.password, teamName: u && u.teamName, role: (u && u.role) || 'player' })));
  } catch (e) {
    return fail(res, 500, e.message);
  }
  if (result.errors) return res.status(400).json({ error: `Có ${result.errors.length} dòng bị lỗi, chưa tạo tài khoản nào`, errors: result.errors });
  console.log(`[users] judge "${req.user.username}" added ${result.created.length} accounts`);
  io.to('judge').emit('users:changed');
  res.json({ created: result.created.map(c => ({ ...auth.publicUser(c.user), password: c.password })) });
});
app.patch('/api/admin/users/:id', apiAuth, apiJudge, (req, res) => {
  const u = findUser(req.params.id);
  if (!u) return fail(res, 404, 'Không tìm thấy người dùng');
  try {
    auth.renameTeam(u, (req.body || {}).teamName);
  } catch (e) {
    return fail(res, 400, e.message);
  }
  io.to('judge').emit('users:changed');
  io.to('users').emit('tournaments:changed');
  res.json({ user: auth.publicUser(u) });
});
app.post('/api/admin/users/:id/password', apiAuth, apiJudge, (req, res) => {
  const u = findUser(req.params.id);
  if (!u) return fail(res, 404, 'Không tìm thấy người dùng');
  if (String((req.body || {}).password || '').length < 3) return fail(res, 400, 'Mật khẩu phải có ít nhất 3 ký tự');
  u.passwordHash = auth.hashPassword(req.body.password);
  db.save();
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', apiAuth, apiJudge, (req, res) => {
  if (req.params.id === req.user.id) return fail(res, 400, 'Bạn không thể tự xóa chính mình');
  const i = db.data.users.findIndex(u => u.id === req.params.id);
  if (i < 0) return fail(res, 404, 'Không tìm thấy người dùng');
  db.data.users.splice(i, 1);
  db.save();
  res.json({ ok: true });
});

function parseDeadline(v) {
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error('Hạn chót không hợp lệ');
  return new Date(ms).toISOString();
}
// Optional start time: submissions open then (until then players see a countdown).
// In a campaign the penalty minutes are counted from it.
function parseStart(v, deadline) {
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error('Giờ bắt đầu không hợp lệ');
  if (ms >= Date.parse(deadline)) throw new Error('Giờ bắt đầu phải trước hạn chót');
  return new Date(ms).toISOString();
}
app.post('/api/admin/tournaments', apiAuth, apiJudge, (req, res) => {
  const { name, deadline, startsAt, description, mode = 'brawl', game = 'rps', access = 'open', hidden = false, dailyTime, tzOffset = 0, pairing = 'rr' } = req.body || {};
  if (!String(name || '').trim()) return fail(res, 400, 'Hãy đặt tên cho giải đấu');
  if (!['rps', 'board'].includes(game)) return fail(res, 400, 'Trò chơi phải là rps (oẳn tù tì) hoặc board (cờ OTT)');
  if (!['brawl', 'campaign'].includes(mode)) return fail(res, 400, 'Chế độ phải là brawl (hỗn chiến) hoặc campaign (chiến dịch)');
  if (!['open', 'invite'].includes(access)) return fail(res, 400, 'Quyền tham gia phải là open hoặc invite');
  let dl, start = null;
  try {
    dl = parseDeadline(deadline);
    if (startsAt) start = parseStart(startsAt, dl);
  } catch (e) { return fail(res, 400, e.message); }
  // brawl = daily league: needs the time of day the matches start
  let schedule = {};
  if (mode === 'brawl') {
    if (!daily.validTime(dailyTime)) return fail(res, 400, 'Hãy chọn giờ thi đấu hằng ngày (HH:MM)');
    if (!Number.isInteger(tzOffset) || Math.abs(tzOffset) > 14 * 60) return fail(res, 400, 'Múi giờ không hợp lệ');
    const now = new Date().toISOString();
    if (!['rr', 'swiss'].includes(pairing)) return fail(res, 400, 'Thể thức phải là vòng tròn (rr) hoặc Thụy Sĩ (swiss)');
    schedule = { format: 'daily', pairing, dailyTime, tzOffset, dailySince: now, days: [] };
    if (!daily.nextSlot({ ...schedule, startsAt: start, createdAt: now, deadline: dl }, Date.now())) return fail(res, 400, `Không có vòng đấu nào: giờ ${dailyTime} không rơi vào khoảng từ lúc bắt đầu đến hạn chót`);
  }
  const t = { id: db.id(), name: String(name).trim().slice(0, 80), mode, game, ...schedule, access, ...(access === 'invite' ? { members: [] } : {}), ...(start ? { startsAt: start } : {}), ...(hidden === true ? { hidden: true } : {}), description: String(description || '').slice(0, 500), deadline: dl, status: 'open', createdAt: new Date().toISOString() };
  db.data.tournaments.push(t);
  db.save();
  io.to('users').emit('tournaments:changed');
  res.json({ tournament: publicTournament(t, req.user) });
});
app.patch('/api/admin/tournaments/:id', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  const { name, deadline, startsAt, description, access, hidden, dailyTime, tzOffset, pairing } = req.body || {};
  // hiding / showing works at any time; everything else only before the tournament starts
  const onlyHidden = Object.keys(req.body || {}).every(k => k === 'hidden');
  if (t.status !== 'open' && !onlyHidden) return fail(res, 400, 'Chỉ sửa được giải đấu chưa bắt đầu');
  if (hidden !== undefined && typeof hidden !== 'boolean') return fail(res, 400, 'hidden phải là true hoặc false');
  if (access !== undefined && !['open', 'invite'].includes(access)) return fail(res, 400, 'Quyền tham gia phải là open hoặc invite');
  if (pairing !== undefined) {
    if (!daily.isDaily(t) || !['rr', 'swiss'].includes(pairing)) return fail(res, 400, 'Thể thức phải là vòng tròn (rr) hoặc Thụy Sĩ (swiss)');
    t.pairing = pairing; // from the next day on
  }
  if (dailyTime !== undefined) {
    if (!daily.isDaily(t)) return fail(res, 400, 'Chỉ giải hỗn chiến mới có giờ thi đấu hằng ngày');
    if (!daily.validTime(dailyTime)) return fail(res, 400, 'Giờ thi đấu hằng ngày không hợp lệ (HH:MM)');
    t.dailyTime = dailyTime;
    if (Number.isInteger(tzOffset) && Math.abs(tzOffset) <= 14 * 60) t.tzOffset = tzOffset;
    t.dailySince = new Date().toISOString(); // a time already passed today waits for tomorrow
  }
  try {
    const dl = deadline !== undefined ? parseDeadline(deadline) : t.deadline;
    // startsAt: a date, or '' / null to remove it (submissions open right away)
    const start = startsAt === undefined ? t.startsAt || null : startsAt ? parseStart(startsAt, dl) : null;
    if (start && Date.parse(start) >= Date.parse(dl)) throw new Error('Giờ bắt đầu phải trước hạn chót');
    t.deadline = dl;
    if (start) t.startsAt = start; else delete t.startsAt;
  } catch (e) {
    return fail(res, 400, e.message);
  }
  if (name !== undefined && String(name).trim()) t.name = String(name).trim().slice(0, 80);
  if (description !== undefined) t.description = String(description).slice(0, 500);
  if (access !== undefined) {
    t.access = access;
    if (access === 'invite' && !t.members) t.members = [];
  }
  if (hidden !== undefined) {
    if (hidden) t.hidden = true; else delete t.hidden;
    if (hidden) kickWatchers(t);
  }
  db.save();
  io.to('users').emit('tournaments:changed');
  res.json({ tournament: publicTournament(t, req.user) });
});
// Daily league: play a day right now (on top of the scheduled ones).
app.post('/api/admin/tournaments/:id/play-now', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (!daily.isDaily(t) || t.status !== 'open') return fail(res, 400, 'Chỉ giải hỗn chiến đang mở mới đấu ngay được');
  if ((t.days || []).some(d => d.status === 'running')) return fail(res, 400, 'Đang có một vòng đấu chưa xong');
  t.runNow = true;
  db.save();
  res.json({ ok: true });
});
// Daily league: play day :n again from scratch (e.g. it ran with the wrong pairing). Its matches are
// deleted and the day goes back to 'running' with the same teams and bots; the next tick plays it,
// and its results publish PUBLISH_DELAY_MS from now. `pairing` also becomes the tournament's.
app.post('/api/admin/tournaments/:id/days/:n/rejudge', apiAuth, apiJudge, wrap(async (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (!daily.isDaily(t)) return fail(res, 400, 'Chỉ giải hỗn chiến mới chấm lại được một vòng');
  const day = (t.days || []).find(d => d.number === +req.params.n);
  if (!day) return fail(res, 404, 'Không tìm thấy vòng đấu này');
  const { pairing = daily.pairingOf(t) } = req.body || {};
  if (!['rr', 'swiss'].includes(pairing)) return fail(res, 400, 'Thể thức phải là vòng tròn (rr) hoặc Thụy Sĩ (swiss)');
  if (manager.active.has(t.id) || (t.days || []).some(d => d.status === 'running')) return fail(res, 400, 'Đang có một vòng đấu chưa xong');
  await db.deleteMatches(t.id, daily.dayMatches(t, day).map(m => m.name));
  t.pairing = pairing;
  day.pairing = pairing;
  day.status = 'running';
  day.publishAt = new Date(Date.now() + daily.PUBLISH_DELAY_MS).toISOString();
  for (const k of ['rounds', 'pairs', 'byes', 'finishedAt', 'publishedAt']) delete day[k];
  if (t.status === 'finished') { // the champion is decided again once every day is published
    t.status = 'running';
    delete t.championId;
    delete t.finishedAt;
  }
  delete t.error;
  db.save();
  console.log(`[daily] "${t.name}" day ${day.number}: rejudging (${pairing})`);
  manager.broadcast(t);
  io.to('users').emit('tournaments:changed');
  res.json({ ok: true });
}));
// Announcements: a short message to everyone who can see the tournament, gone after 24 hours.
app.post('/api/admin/tournaments/:id/announcements', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  const text = String((req.body || {}).text || '').trim();
  if (!text) return fail(res, 400, 'Thông báo đang trống');
  if (text.length > MAX_ANNOUNCEMENT_LENGTH) return fail(res, 400, `Thông báo dài tối đa ${MAX_ANNOUNCEMENT_LENGTH} ký tự`);
  t.announcements = [...liveAnnouncements(t), { id: db.id(), text, createdAt: new Date().toISOString(), by: req.user.id }]; // expired ones are dropped here
  db.save();
  io.to('users').emit('tournaments:changed');
  res.json({ announcements: publicAnnouncements(t) });
});
app.delete('/api/admin/tournaments/:id/announcements/:aid', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  t.announcements = liveAnnouncements(t).filter(a => a.id !== req.params.aid);
  if (!t.announcements.length) delete t.announcements;
  db.save();
  io.to('users').emit('tournaments:changed');
  res.json({ announcements: publicAnnouncements(t) });
});
// Stop live updates to players who were watching a tournament they may no longer see.
async function kickWatchers(t) {
  for (const s of await io.in('t:' + t.id).fetchSockets()) {
    if (!canSee(t, findUser(s.data.userId))) s.leave('t:' + t.id);
  }
}
// Invite-only tournaments: which players are in. Body: { userIds: [...] } (the full list).
app.get('/api/admin/tournaments/:id/members', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  const submitted = new Set(db.data.submissions.filter(s => s.tournamentId === t.id).map(s => s.userId));
  res.json({
    access: isInviteOnly(t) ? 'invite' : 'open',
    members: t.members || [],
    players: db.data.users.filter(u => u.role === 'player').map(u => ({ ...auth.publicUser(u), submitted: submitted.has(u.id) })),
  });
});
app.put('/api/admin/tournaments/:id/members', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (t.status !== 'open') return fail(res, 400, 'Chỉ đổi được danh sách khi giải còn đang mở');
  const ids = (req.body || {}).userIds;
  if (!Array.isArray(ids)) return fail(res, 400, 'Danh sách người chơi không hợp lệ');
  const players = new Set(db.data.users.filter(u => u.role === 'player').map(u => u.id));
  t.members = [...new Set(ids.map(String))].filter(id => players.has(id));
  db.save();
  io.to('users').emit('tournaments:changed');
  io.to('users').emit('practice:updated', { tournamentId: t.id });
  manager.broadcast(t);
  res.json({ members: t.members });
});
app.delete('/api/admin/tournaments/:id', apiAuth, apiJudge, wrap(async (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (t.status === 'running') return fail(res, 400, 'Không thể xóa giải đấu đang diễn ra');
  const subIds = db.data.submissions.filter(s => s.tournamentId === t.id).map(s => s.id);
  db.data.tournaments = db.data.tournaments.filter(x => x !== t);
  db.data.submissions = db.data.submissions.filter(s => s.tournamentId !== t.id);
  await db.deleteTournament(t.id, subIds);
  await db.deleteTournament(grader.practice.replayKey(t.id), []);
  io.to('users').emit('tournaments:changed');
  res.json({ ok: true });
}));
// Sparring bots the judge controls, per tournament:
//  - t.bots: bots added on top of the built-in ones, any language (a campaign: more bots to beat;
//    a brawl: more practice opponents, so more points in the evaluation score);
//  - t.houseEdits[houseId]: an edited Python copy of a built-in bot (all modes; in a brawl it
//    only changes the practice games);
//  - t.houseNames[houseId] / t.houseDescs[houseId]: a built-in bot's name and description in this
//    tournament (an added bot keeps its own, bot.name / bot.desc), t.houseRemoved: the
//    built-in bots taken out of it (they can be put back).
// Each keeps its latest code (status = result of its check) and `live`, the last version that
// passed, which is the one that plays (see grader/practice.js).
const houseBot = (t, id) => grader.practice.houseBots(gameOf(t)).find(h => h.id === id);
const publicBot = b => ({ id: b.id, name: b.name, desc: b.desc || '', language: b.language, code: b.code, status: b.status, message: b.message || '', live: !!grader.practice.liveOf(b), stale: b.status !== 'ok' && !!grader.practice.liveOf(b), createdAt: b.createdAt, updatedAt: b.updatedAt || null });
// A judge bot was added, edited or finished compiling: refresh pickers, campaign boards and the judge desk.
function botChanged(t) {
  grader.replayStalePractice(t); // brawl: a bot added or removed changes everyone's practice
  io.to('users').emit('tournaments:changed');
  io.to('users').emit('practice:updated', { tournamentId: t.id });
  manager.broadcast(t);
}
function checkBot(t, bot) {
  grader.checkBot(bot, gameOf(t)).then(() => botChanged(t));
}
function badCode(code) {
  if (typeof code !== 'string' || !code.trim()) return 'Code của bot đang trống';
  if (code.length > MAX_CODE_LENGTH) return `Code quá dài (tối đa ${MAX_CODE_LENGTH} ký tự)`;
  return null;
}
// Bot changes only while the tournament is open (results must not shift under a running/finished one).
function editableTournament(req, res) {
  const t = findTournament(req.params.id);
  if (!t) { fail(res, 404, 'Không tìm thấy giải đấu'); return null; }
  if (t.status !== 'open') { fail(res, 400, 'Chỉ thay đổi được bot đấu tập khi giải còn đang mở'); return null; }
  return t;
}
// Starts checking new code for an added bot or an edited built-in. The previous working
// version (if any) keeps playing until this one passes.
function newVersion(t, item, fields) {
  const live = grader.practice.liveOf(item);
  if (live) item.live = live;
  Object.assign(item, fields, { buildId: 'bot-' + db.id(), status: 'pending', message: '', updatedAt: new Date().toISOString() });
  db.save();
  checkBot(t, item);
  botChanged(t);
}

app.get('/api/admin/tournaments/:id/bots', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  const edits = t.houseEdits || {};
  res.json({
    game: gameOf(t),
    builtIn: grader.practice.houseBots(gameOf(t)).map(h => {
      const e = edits[h.id];
      return { id: h.id, name: houseName(t)(h), defaultName: h.name, removed: (t.houseRemoved || []).includes(h.id), desc: (t.houseDescs || {})[h.id] || h.desc, defaultDesc: h.desc, defaultCode: grader.housePython(h.id), edit: e ? { ...publicBot({ ...e, name: h.name }), language: 'python' } : null };
    }),
    bots: (t.bots || []).map(publicBot),
    languages: grader.LANGS,
  });
});
app.put('/api/admin/tournaments/:id/house/:houseId', apiAuth, apiJudge, (req, res) => {
  const t = editableTournament(req, res);
  if (!t) return;
  const h = houseBot(t, req.params.houseId);
  if (!h) return fail(res, 404, 'Không tìm thấy bot');
  const { code } = req.body || {};
  const bad = badCode(code);
  if (bad) return fail(res, 400, bad);
  const edits = (t.houseEdits = t.houseEdits || {});
  const e = (edits[h.id] = edits[h.id] || { id: h.id, language: 'python', createdAt: new Date().toISOString() });
  newVersion(t, e, { code });
  res.json({ ok: true });
});
// Back to the original built-in bot.
// A built-in bot's name and description ('' = its own again) and whether it plays in this tournament.
// Body: { name?, desc?, removed? }.
app.patch('/api/admin/tournaments/:id/house/:houseId', apiAuth, apiJudge, (req, res) => {
  const t = editableTournament(req, res);
  if (!t) return;
  const h = houseBot(t, req.params.houseId);
  if (!h) return fail(res, 404, 'Không tìm thấy bot');
  const { name, desc, removed } = req.body || {};
  if (removed !== undefined && typeof removed !== 'boolean') return fail(res, 400, 'removed phải là true hoặc false');
  if (desc !== undefined) {
    const d = botDesc(desc);
    const descs = (t.houseDescs = t.houseDescs || {});
    if (d && d !== h.desc) descs[h.id] = d; else delete descs[h.id];
    if (!Object.keys(descs).length) delete t.houseDescs;
  }
  if (name !== undefined) {
    const n = String(name).trim().slice(0, 40);
    const bad = n && checkBotName(t, n, h.id);
    if (bad) return fail(res, 400, bad);
    const names = (t.houseNames = t.houseNames || {});
    if (n && n !== h.name) names[h.id] = n; else delete names[h.id];
    if (!Object.keys(names).length) delete t.houseNames;
  }
  if (removed !== undefined) {
    const was = new Set(t.houseRemoved || []);
    if (removed && !was.has(h.id) && botCount(t) <= 1) return fail(res, 400, LAST_BOT);
    if (removed) was.add(h.id); else was.delete(h.id);
    if (was.size) t.houseRemoved = [...was]; else delete t.houseRemoved;
  }
  db.save();
  botChanged(t);
  res.json({ ok: true });
});
app.delete('/api/admin/tournaments/:id/house/:houseId', apiAuth, apiJudge, (req, res) => {
  const t = editableTournament(req, res);
  if (!t) return;
  const e = t.houseEdits && t.houseEdits[req.params.houseId];
  if (!e) return fail(res, 404, 'Bot này đang dùng bản mặc định');
  delete t.houseEdits[req.params.houseId];
  db.save();
  [e.buildId, e.live && e.live.buildId].filter(Boolean).forEach(id => grader.removeBuild({ id }));
  botChanged(t);
  res.json({ ok: true });
});
// except: the bot being renamed (an added bot, or a built-in one's id).
function checkBotName(t, name, except = null) {
  if (!name) return 'Hãy đặt tên cho bot';
  const names = [
    ...grader.practice.houseBots(gameOf(t)).filter(h => h.id !== except).map(houseName(t)),
    ...(t.bots || []).filter(b => b !== except).map(b => b.name),
  ];
  if (names.some(n => n.toLowerCase() === name.toLowerCase())) return 'Đã có bot đấu tập tên này';
  return null;
}
const houseName = t => h => (t.houseNames || {})[h.id] || h.name;
// What players read about a bot (shown next to its name), a few sentences at most.
const botDesc = d => String(d ?? '').trim().slice(0, MAX_BOT_DESC);
const MAX_BOT_DESC = 300;
// A tournament must keep at least one sparring bot.
const botCount = t => grader.practice.houseBots(gameOf(t)).length - (t.houseRemoved || []).length + (t.bots || []).length;
const LAST_BOT = 'Giải cần ít nhất một bot đấu tập';
app.post('/api/admin/tournaments/:id/bots', apiAuth, apiJudge, (req, res) => {
  const t = editableTournament(req, res);
  if (!t) return;
  const { language, code } = req.body || {};
  const name = String((req.body || {}).name || '').trim().slice(0, 40);
  const bad = checkBotName(t, name) || (!grader.LANGS[language] && 'Hãy chọn ngôn ngữ: cpp, java hoặc python') || badCode(code);
  if (bad) return fail(res, 400, bad);
  const bot = { id: 'bot-' + db.id(), name, desc: botDesc((req.body || {}).desc), createdAt: new Date().toISOString() };
  (t.bots = t.bots || []).push(bot);
  newVersion(t, bot, { language, code });
  res.json({ bot: publicBot(bot) });
});
// Edit an added bot: a new name only takes effect at once; new code/language is checked first.
app.put('/api/admin/tournaments/:id/bots/:botId', apiAuth, apiJudge, (req, res) => {
  const t = editableTournament(req, res);
  if (!t) return;
  const bot = (t.bots || []).find(b => b.id === req.params.botId);
  if (!bot) return fail(res, 404, 'Không tìm thấy bot');
  const { language, code } = req.body || {};
  const name = String((req.body || {}).name ?? bot.name).trim().slice(0, 40);
  const bad = checkBotName(t, name, bot) || (!grader.LANGS[language] && 'Hãy chọn ngôn ngữ: cpp, java hoặc python') || badCode(code);
  if (bad) return fail(res, 400, bad);
  bot.name = name;
  if ((req.body || {}).desc !== undefined) bot.desc = botDesc(req.body.desc);
  if (code !== bot.code || language !== bot.language) newVersion(t, bot, { language, code });
  else { db.save(); botChanged(t); }
  res.json({ bot: publicBot(bot) });
});
// An added bot's name and/or description (its code stays as it is). Body: { name?, desc? }.
app.patch('/api/admin/tournaments/:id/bots/:botId', apiAuth, apiJudge, (req, res) => {
  const t = editableTournament(req, res);
  if (!t) return;
  const bot = (t.bots || []).find(b => b.id === req.params.botId);
  if (!bot) return fail(res, 404, 'Không tìm thấy bot');
  const { name, desc } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim().slice(0, 40);
    const bad = checkBotName(t, n, bot);
    if (bad) return fail(res, 400, bad);
    bot.name = n;
  }
  if (desc !== undefined) bot.desc = botDesc(desc);
  db.save();
  botChanged(t);
  res.json({ bot: publicBot(bot) });
});
app.delete('/api/admin/tournaments/:id/bots/:botId', apiAuth, apiJudge, (req, res) => {
  const t = editableTournament(req, res);
  if (!t) return;
  const bot = (t.bots || []).find(b => b.id === req.params.botId);
  if (!bot) return fail(res, 404, 'Không tìm thấy bot');
  if (botCount(t) <= 1) return fail(res, 400, LAST_BOT);
  t.bots = t.bots.filter(b => b !== bot);
  db.save();
  [bot.id, bot.buildId, bot.live && bot.live.buildId].filter(Boolean).forEach(id => grader.removeBuild({ id }));
  botChanged(t);
  res.json({ ok: true });
});
app.get('/api/admin/tournaments/:id/submissions', apiAuth, apiJudge, wrap(async (req, res) => {
  const subs = await withCode(db.data.submissions.filter(s => s.tournamentId === req.params.id),
    s => { const u = findUser(s.userId) || {}; return { teamName: u.teamName || '(deleted user)', username: u.username || '' }; });
  res.json({ submissions: subs });
}));

app.use('/api', (req, res) => fail(res, 404, 'Không tìm thấy'));
app.use((err, req, res, next) => {
  console.error(`[http] ${req.method} ${req.path}:`, err);
  if (res.headersSent) return next(err);
  fail(res, 500, 'Máy chủ gặp lỗi, hãy thử lại');
});

// Tell open submit pages to refresh their practice leaderboard (at most ~2x per second per tournament).
const practiceTimers = new Map();
grader.practice.onUpdate(sub => {
  if (practiceTimers.has(sub.tournamentId)) return;
  practiceTimers.set(sub.tournamentId, setTimeout(() => {
    practiceTimers.delete(sub.tournamentId);
    io.to('users').emit('practice:updated', { tournamentId: sub.tournamentId });
    const t = findTournament(sub.tournamentId);
    if (t && (t.mode === 'campaign' || daily.isDaily(t))) manager.broadcast(t); // a daily league shows practice scores as evaluation
  }, 500));
});
grader.resumePractice();
// Judge bots that were still compiling when the server stopped.
for (const t of db.data.tournaments) {
  for (const b of [...(t.bots || []), ...Object.values(t.houseEdits || {})]) if (b.status === 'pending') checkBot(t, b);
}

// ---------- sockets ----------
io.engine.use(sessionMiddleware);
io.on('connection', socket => {
  const user = socket.request.session && findUser(socket.request.session.userId);
  if (!user) return socket.disconnect(true);
  socket.join('users');
  socket.data.userId = user.id;
  socket.join('u:' + user.id);
  if (isJudge(user)) socket.join('judge');
  socket.on('watch', id => {
    const t = findTournament(String(id));
    if (!t || !canSee(t, findUser(user.id))) return;
    socket.join('t:' + t.id);
    socket.emit('leaderboard', manager.leaderboard(t));
  });
});

// HOST defaults to every network interface, so the site is reachable from other machines.
// Set HOST=127.0.0.1 to only allow local connections (e.g. when nginx sits in front).
const HOST = process.env.HOST || '0.0.0.0';
grader.checkSandbox();
server.listen(PORT, HOST, () => {
  const where = HOST === '0.0.0.0' ? `all network interfaces, port ${PORT} (e.g. http://<this-machine's-IP>:${PORT})` : `http://${HOST}:${PORT}`;
  console.log(`OTTv1 is live on ${where}`);
});
