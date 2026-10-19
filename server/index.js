const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const db = require('./db');
db.load();
const auth = require('./auth');
const grader = require('./grader');
const { normalizeAvatar } = require('../public/js/avatar');
const { TournamentManager, matchSummary } = require('./tournament');
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
const isJudge = u => u && u.role === 'judge';

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
const view = name => (req, res) => res.sendFile(path.join(VIEWS, name));
const fail = (res, code, error) => res.status(code).json({ error });

function publicTournament(t, user) {
  const subs = db.data.submissions.filter(s => s.tournamentId === t.id);
  const ready = new Set(subs.filter(s => s.status === 'ok').map(s => s.userId));
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
    description: t.description || '',
    deadline: t.deadline,
    status: t.status,
    teamsReady: t.entries ? t.entries.length : ready.size,
    champion: champion ? champion.teamName : null,
    mySubmission: mine[0] ? publicSubmission(mine[0]) : null,
    myActive: (mine.find(s => s.status === 'ok') || {}).id || null,
  };
}
function publicSubmission(s, withCode = false) {
  const out = { id: s.id, tournamentId: s.tournamentId, language: s.language, status: s.status, message: s.message || '', createdAt: s.createdAt };
  if (withCode) out.code = s.code;
  return out;
}
// Players may only peek at matches once the tournament is over; the judge can always.
const canSeeMatches = (t, user) => isJudge(user) || t.status === 'finished';

// ---------- pages ----------
app.get('/login', (req, res) => (currentUser(req) ? res.redirect('/') : res.sendFile(path.join(VIEWS, 'login.html'))));
app.get('/', pageAuth, view('index.html'));
app.get('/tournament/:id/submit', pageAuth, view('submit.html'));
app.get('/tournament/:id/live', pageAuth, view('live.html'));
app.get('/tournament/:id/match', pageAuth, view('match.html'));
app.get('/me', pageAuth, view('profile.html'));
app.get('/admin', pageAuth, (req, res) => (isJudge(req.user) ? view('admin.html')(req, res) : res.redirect('/')));

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

app.get('/register', (req, res) => (currentUser(req) ? res.redirect('/') : res.sendFile(path.join(VIEWS, 'register.html'))));
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
app.put('/api/me/avatar', apiAuth, (req, res) => {
  req.user.avatar = normalizeAvatar((req.body || {}).avatar, req.user.teamName);
  db.save();
  res.json({ user: auth.publicUser(req.user) });
});

// ---------- tournaments ----------
app.get('/api/tournaments', apiAuth, (req, res) => {
  const order = { running: 0, open: 1, finished: 2 };
  const list = db.data.tournaments
    .map(t => publicTournament(t, req.user))
    .sort((a, b) => order[a.status] - order[b.status] || (a.status === 'finished' ? (a.deadline < b.deadline ? 1 : -1) : a.deadline < b.deadline ? -1 : 1));
  res.json({ tournaments: list, serverNow: Date.now() });
});

app.get('/api/tournaments/:id', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  const mine = db.data.submissions
    .filter(s => s.tournamentId === t.id && s.userId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(s => publicSubmission(s, true));
  res.json({ tournament: publicTournament(t, req.user), submissions: mine, languages: grader.LANGS, serverNow: Date.now() });
});

app.post('/api/tournaments/:id/submissions', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (isJudge(req.user)) return fail(res, 403, 'Trọng tài chỉ chấm, không thi đấu. (Hãy đăng nhập bằng tài khoản người chơi để nộp bài.)');
  if (t.status !== 'open' || Date.parse(t.deadline) <= Date.now()) return fail(res, 400, 'Muộn rồi! Giải này đã hết hạn nộp bài.');
  const { language, code } = req.body || {};
  if (!grader.LANGS[language]) return fail(res, 400, 'Hãy chọn ngôn ngữ: cpp, java hoặc python');
  if (typeof code !== 'string' || !code.trim()) return fail(res, 400, 'Code của bạn đang trống');
  if (code.length > MAX_CODE_LENGTH) return fail(res, 400, `Code quá dài (tối đa ${MAX_CODE_LENGTH} ký tự)`);
  const busy = db.data.submissions.some(s => s.tournamentId === t.id && s.userId === req.user.id && s.status === 'pending');
  if (busy) return fail(res, 429, 'Bài nộp trước của bạn vẫn đang được kiểm tra, đợi chút nhé');
  const sub = { id: db.id(), tournamentId: t.id, userId: req.user.id, language, code, status: 'pending', message: '', createdAt: new Date().toISOString() };
  db.data.submissions.push(sub);
  db.save();
  grader.validate(sub);
  res.json({ submission: publicSubmission(sub, true) });
});

app.get('/api/submissions/:id', apiAuth, (req, res) => {
  const s = db.data.submissions.find(x => x.id === req.params.id);
  if (!s || (s.userId !== req.user.id && !isJudge(req.user))) return fail(res, 404, 'Không tìm thấy bài nộp');
  res.json({ submission: publicSubmission(s, true) });
});

// Practice leaderboard: everyone sees each team's total against the 10 house
// bots; the per-bot breakdown is only for the team itself (and the judge).
app.get('/api/tournaments/:id/practice', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (t.mode === 'campaign') {
    const want = String(req.query.user || req.user.id);
    if (want !== req.user.id && !isJudge(req.user)) return fail(res, 403, 'Không được xem tiến độ của đội khác 🤫');
    return res.json({ mode: 'campaign', board: campaign.board(t), details: campaign.details(t, want), serverNow: Date.now() });
  }
  const userIds = [...new Set(db.data.submissions.filter(s => s.tournamentId === t.id).map(s => s.userId))];
  const rows = userIds.map(uid => {
    const u = findUser(uid);
    if (!u) return null;
    const s = grader.activeSubmission(t.id, uid);
    const p = s && s.practice;
    return {
      userId: uid,
      teamName: u.teamName,
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
  const want = String(req.query.user || req.user.id);
  if (want === req.user.id || isJudge(req.user)) {
    const s = grader.activeSubmission(t.id, want);
    const u = findUser(want);
    if (s && u) {
      details = {
        userId: want,
        teamName: u.teamName,
        submissionId: s.id,
        language: s.language,
        submittedAt: s.createdAt,
        status: s.practice ? s.practice.status : 'queued',
        total: s.practice ? s.practice.total : 0,
        results: (s.practice ? s.practice.results : grader.practice.HOUSE_BOTS.map(h => ({ bot: h.id, name: h.name, status: 'queued' })))
          .map(({ bot, name, status, score, botScore, winner, issue }) => ({ bot, name, status, score, botScore, winner, issue })),
      };
    }
  } else if (req.query.user) {
    return fail(res, 403, 'Không được xem điểm của đội khác 🤫');
  }
  res.json({ rows, details, maxTotal: grader.practice.HOUSE_BOTS.length * 300, serverNow: Date.now() });
});

app.get('/api/tournaments/:id/leaderboard', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  res.json({ leaderboard: manager.leaderboard(t), canSeeMatches: canSeeMatches(t, req.user), serverNow: Date.now() });
});

app.get('/api/tournaments/:id/matches', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (!canSeeMatches(t, req.user)) return fail(res, 403, 'Các trận đấu sẽ được công khai khi giải kết thúc');
  const list = Object.values(db.data.matches[t.id] || {}).map(matchSummary)
    .sort((a, b) => a.round - b.round || (a.playedAt < b.playedAt ? -1 : 1));
  res.json({ matches: list });
});

app.get('/api/tournaments/:id/matches/:name', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (!canSeeMatches(t, req.user)) return fail(res, 403, 'Các trận đấu sẽ được công khai khi giải kết thúc');
  const m = (db.data.matches[t.id] || {})[req.params.name];
  if (!m) return fail(res, 404, 'Không tìm thấy trận đấu');
  res.json({ match: m, avatars: { A: auth.avatarOf(findUser(m.userA) || { teamName: m.teamA }), B: auth.avatarOf(findUser(m.userB) || { teamName: m.teamB }) }, tournament: { id: t.id, name: t.name, status: t.status } });
});

// ---------- judge ----------
app.get('/api/admin/users', apiAuth, apiJudge, (req, res) => {
  res.json({ users: db.data.users.map(auth.publicUser) });
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
app.post('/api/admin/tournaments', apiAuth, apiJudge, (req, res) => {
  const { name, deadline, description, mode = 'brawl' } = req.body || {};
  if (!String(name || '').trim()) return fail(res, 400, 'Hãy đặt tên cho giải đấu');
  if (!['brawl', 'campaign'].includes(mode)) return fail(res, 400, 'Chế độ phải là brawl (hỗn chiến) hoặc campaign (chiến dịch)');
  let dl;
  try { dl = parseDeadline(deadline); } catch (e) { return fail(res, 400, e.message); }
  const t = { id: db.id(), name: String(name).trim().slice(0, 80), mode, description: String(description || '').slice(0, 500), deadline: dl, status: 'open', createdAt: new Date().toISOString() };
  db.data.tournaments.push(t);
  db.save();
  io.to('users').emit('tournaments:changed');
  res.json({ tournament: publicTournament(t) });
});
app.patch('/api/admin/tournaments/:id', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (t.status !== 'open') return fail(res, 400, 'Chỉ sửa được giải đấu chưa bắt đầu');
  const { name, deadline, description } = req.body || {};
  try {
    if (deadline !== undefined) t.deadline = parseDeadline(deadline);
  } catch (e) {
    return fail(res, 400, e.message);
  }
  if (name !== undefined && String(name).trim()) t.name = String(name).trim().slice(0, 80);
  if (description !== undefined) t.description = String(description).slice(0, 500);
  db.save();
  io.to('users').emit('tournaments:changed');
  res.json({ tournament: publicTournament(t) });
});
app.delete('/api/admin/tournaments/:id', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'Không tìm thấy giải đấu');
  if (t.status === 'running') return fail(res, 400, 'Không thể xóa giải đấu đang diễn ra');
  db.data.tournaments = db.data.tournaments.filter(x => x !== t);
  db.data.submissions = db.data.submissions.filter(s => s.tournamentId !== t.id);
  delete db.data.matches[t.id];
  db.save();
  io.to('users').emit('tournaments:changed');
  res.json({ ok: true });
});
app.get('/api/admin/tournaments/:id/submissions', apiAuth, apiJudge, (req, res) => {
  const subs = db.data.submissions.filter(s => s.tournamentId === req.params.id).map(s => ({
    ...publicSubmission(s, true), teamName: (findUser(s.userId) || {}).teamName || '(deleted user)',
  }));
  res.json({ submissions: subs });
});

app.use('/api', (req, res) => fail(res, 404, 'Không tìm thấy'));

// Tell open submit pages to refresh their practice leaderboard (at most ~2x per second per tournament).
const practiceTimers = new Map();
grader.practice.onUpdate(sub => {
  if (practiceTimers.has(sub.tournamentId)) return;
  practiceTimers.set(sub.tournamentId, setTimeout(() => {
    practiceTimers.delete(sub.tournamentId);
    io.to('users').emit('practice:updated', { tournamentId: sub.tournamentId });
    const t = findTournament(sub.tournamentId);
    if (t && t.mode === 'campaign') manager.broadcast(t);
  }, 500));
});
grader.resumePractice();

// ---------- sockets ----------
io.engine.use(sessionMiddleware);
io.on('connection', socket => {
  const user = socket.request.session && findUser(socket.request.session.userId);
  if (!user) return socket.disconnect(true);
  socket.join('users');
  if (isJudge(user)) socket.join('judge');
  socket.on('watch', id => {
    const t = findTournament(String(id));
    if (!t) return;
    socket.join('t:' + t.id);
    socket.emit('leaderboard', manager.leaderboard(t));
  });
});

// HOST defaults to every network interface, so the site is reachable from other machines.
// Set HOST=127.0.0.1 to only allow local connections (e.g. when nginx sits in front).
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  const where = HOST === '0.0.0.0' ? `all network interfaces, port ${PORT} (e.g. http://<this-machine's-IP>:${PORT})` : `http://${HOST}:${PORT}`;
  console.log(`OTTv1 is live on ${where}`);
});
