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

auth.prepareUsers();
auth.ensureJudge();

const PORT = +process.env.PORT || 3000;
const VIEWS = path.join(__dirname, '..', 'views');
const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_CODE_LENGTH = 100000;

const app = express();
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
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  next();
}
function apiJudge(req, res, next) {
  if (!isJudge(req.user)) return res.status(403).json({ error: 'Judges only' });
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
  const champion = t.championId && t.entries && t.entries.find(e => e.userId === t.championId);
  return {
    id: t.id,
    name: t.name,
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
  if (!user || !auth.verifyPassword(password, user.passwordHash)) return fail(res, 401, 'Wrong username or password');
  req.session.regenerate(err => {
    if (err) return fail(res, 500, 'Session error');
    req.session.userId = user.id;
    res.json({ user: auth.publicUser(user) });
  });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
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
  if (!t) return fail(res, 404, 'No such tournament');
  const mine = db.data.submissions
    .filter(s => s.tournamentId === t.id && s.userId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(s => publicSubmission(s, true));
  res.json({ tournament: publicTournament(t, req.user), submissions: mine, languages: grader.LANGS, serverNow: Date.now() });
});

app.post('/api/tournaments/:id/submissions', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'No such tournament');
  if (isJudge(req.user)) return fail(res, 403, 'Judges judge. They do not play. (Log in as a player to submit.)');
  if (t.status !== 'open' || Date.parse(t.deadline) <= Date.now()) return fail(res, 400, 'Too late! Submissions for this tournament are closed.');
  const { language, code } = req.body || {};
  if (!grader.LANGS[language]) return fail(res, 400, 'Pick a language: cpp, java or python');
  if (typeof code !== 'string' || !code.trim()) return fail(res, 400, 'Your code is empty');
  if (code.length > MAX_CODE_LENGTH) return fail(res, 400, `Code is too long (max ${MAX_CODE_LENGTH} characters)`);
  const busy = db.data.submissions.some(s => s.tournamentId === t.id && s.userId === req.user.id && s.status === 'pending');
  if (busy) return fail(res, 429, 'Your previous submission is still being checked - hang on a sec');
  const sub = { id: db.id(), tournamentId: t.id, userId: req.user.id, language, code, status: 'pending', message: '', createdAt: new Date().toISOString() };
  db.data.submissions.push(sub);
  db.save();
  grader.validate(sub);
  res.json({ submission: publicSubmission(sub, true) });
});

app.get('/api/submissions/:id', apiAuth, (req, res) => {
  const s = db.data.submissions.find(x => x.id === req.params.id);
  if (!s || (s.userId !== req.user.id && !isJudge(req.user))) return fail(res, 404, 'No such submission');
  res.json({ submission: publicSubmission(s, true) });
});

// Practice leaderboard: everyone sees each team's total against the 10 house
// bots; the per-bot breakdown is only for the team itself (and the judge).
app.get('/api/tournaments/:id/practice', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'No such tournament');
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
    return fail(res, 403, "No peeking at other teams' scores 🤫");
  }
  res.json({ rows, details, maxTotal: grader.practice.HOUSE_BOTS.length * 300, serverNow: Date.now() });
});

app.get('/api/tournaments/:id/leaderboard', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'No such tournament');
  res.json({ leaderboard: manager.leaderboard(t), canSeeMatches: canSeeMatches(t, req.user), serverNow: Date.now() });
});

app.get('/api/tournaments/:id/matches', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'No such tournament');
  if (!canSeeMatches(t, req.user)) return fail(res, 403, 'Matches are revealed when the tournament ends');
  const list = Object.values(db.data.matches[t.id] || {}).map(matchSummary)
    .sort((a, b) => a.round - b.round || (a.playedAt < b.playedAt ? -1 : 1));
  res.json({ matches: list });
});

app.get('/api/tournaments/:id/matches/:name', apiAuth, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'No such tournament');
  if (!canSeeMatches(t, req.user)) return fail(res, 403, 'Matches are revealed when the tournament ends');
  const m = (db.data.matches[t.id] || {})[req.params.name];
  if (!m) return fail(res, 404, 'No such match');
  res.json({ match: m, avatars: { A: auth.avatarOf(findUser(m.userA) || { teamName: m.teamA }), B: auth.avatarOf(findUser(m.userB) || { teamName: m.teamB }) }, tournament: { id: t.id, name: t.name, status: t.status } });
});

// ---------- judge ----------
app.get('/api/admin/users', apiAuth, apiJudge, (req, res) => {
  res.json({ users: db.data.users.map(auth.publicUser) });
});
app.post('/api/admin/users/:id/password', apiAuth, apiJudge, (req, res) => {
  const u = findUser(req.params.id);
  if (!u) return fail(res, 404, 'No such user');
  if (String((req.body || {}).password || '').length < 3) return fail(res, 400, 'Password must be at least 3 characters');
  u.passwordHash = auth.hashPassword(req.body.password);
  db.save();
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', apiAuth, apiJudge, (req, res) => {
  if (req.params.id === req.user.id) return fail(res, 400, "You can't delete yourself");
  const i = db.data.users.findIndex(u => u.id === req.params.id);
  if (i < 0) return fail(res, 404, 'No such user');
  db.data.users.splice(i, 1);
  db.save();
  res.json({ ok: true });
});

function parseDeadline(v) {
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error('Invalid deadline');
  return new Date(ms).toISOString();
}
app.post('/api/admin/tournaments', apiAuth, apiJudge, (req, res) => {
  const { name, deadline, description } = req.body || {};
  if (!String(name || '').trim()) return fail(res, 400, 'Give the tournament a name');
  let dl;
  try { dl = parseDeadline(deadline); } catch (e) { return fail(res, 400, e.message); }
  const t = { id: db.id(), name: String(name).trim().slice(0, 80), description: String(description || '').slice(0, 500), deadline: dl, status: 'open', createdAt: new Date().toISOString() };
  db.data.tournaments.push(t);
  db.save();
  io.to('users').emit('tournaments:changed');
  res.json({ tournament: publicTournament(t) });
});
app.patch('/api/admin/tournaments/:id', apiAuth, apiJudge, (req, res) => {
  const t = findTournament(req.params.id);
  if (!t) return fail(res, 404, 'No such tournament');
  if (t.status !== 'open') return fail(res, 400, 'Only tournaments that have not started can be edited');
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
  if (!t) return fail(res, 404, 'No such tournament');
  if (t.status === 'running') return fail(res, 400, "Can't delete a tournament while it is running");
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

app.use('/api', (req, res) => fail(res, 404, 'Not found'));

// Tell open submit pages to refresh their practice leaderboard (at most ~2x per second per tournament).
const practiceTimers = new Map();
grader.practice.onUpdate(sub => {
  if (practiceTimers.has(sub.tournamentId)) return;
  practiceTimers.set(sub.tournamentId, setTimeout(() => {
    practiceTimers.delete(sub.tournamentId);
    io.to('users').emit('practice:updated', { tournamentId: sub.tournamentId });
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

server.listen(PORT, () => console.log(`OTTv1 is live at http://localhost:${PORT}`));
