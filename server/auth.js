const crypto = require('crypto');
const db = require('./db');
const { normalizeAvatar } = require('../public/js/avatar');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

// Same format, but off the main thread: used for bulk creation so a big batch doesn't stall
// running matches (bots are timed with timers on the event loop).
function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => crypto.scrypt(String(password), salt, 64, (err, hash) =>
    (err ? reject(err) : resolve(`scrypt$${salt}$${hash.toString('hex')}`))));
}

// Easy-to-read random password (no 0/O, 1/l/I).
function randomPassword(len = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(len), b => chars[b % chars.length]).join('');
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(password), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Team names are shown everywhere and must be unique (case-insensitive). `except` = the user being
// renamed; `others` = accounts about to be created in the same batch.
function checkTeamName(teamName, except = null, others = []) {
  if (!teamName) throw new Error('Tên đội không được để trống');
  if (teamName.length > 32) throw new Error('Tên đội tối đa 32 ký tự');
  if ([...db.data.users, ...others].some(u => u !== except && u.teamName.toLowerCase() === teamName.toLowerCase())) throw new Error('Tên đội đã có người dùng');
}

// Validates a new account against existing users (and `others` from the same batch) and
// returns its cleaned-up fields. Throws with a message for the judge / player.
function checkNewUser({ username, password, teamName, role = 'player' }, others = []) {
  username = String(username || '').trim();
  teamName = String(teamName || '').trim() || username;
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) throw new Error('Tên đăng nhập phải có 2–32 ký tự: chữ không dấu, số, _ . hoặc -');
  if (String(password || '').length < 3) throw new Error('Mật khẩu phải có ít nhất 3 ký tự');
  if (!['player', 'judge'].includes(role)) throw new Error('Vai trò phải là player hoặc judge');
  if ([...db.data.users, ...others].some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('Tên đăng nhập đã có người dùng');
  checkTeamName(teamName, null, others);
  return { username, teamName, role, password: String(password) };
}

function createUser(fields) {
  const { username, teamName, role, password } = checkNewUser(fields);
  const user = { id: db.id(), username, teamName, role, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  db.data.users.push(user);
  db.save();
  return user;
}

// Creates many accounts, all or nothing. Blank passwords get a random one.
// Returns { errors: [{ line, error }] } if any entry is invalid (nothing is created),
// otherwise { created: [{ user, password }] } with the plain passwords to hand out.
async function createUsers(list) {
  const check = () => {
    const ok = [], errors = [];
    list.forEach((entry, i) => {
      try { ok.push(checkNewUser(entry, ok)); } catch (e) { errors.push({ line: i + 1, error: e.message }); }
    });
    return { ok, errors };
  };
  list = list.map(e => ({ ...e, password: String((e && e.password) || '').trim() || randomPassword() }));
  const first = check();
  if (first.errors.length) return { errors: first.errors };
  const hashes = await Promise.all(first.ok.map(u => hashPasswordAsync(u.password)));
  // check again: someone may have signed up with one of these names while we were hashing
  const { ok, errors } = check();
  if (errors.length) return { errors };
  const now = new Date().toISOString();
  const created = ok.map((f, i) => ({
    user: { id: db.id(), username: f.username, teamName: f.teamName, role: f.role, passwordHash: hashes[i], createdAt: now },
    password: f.password,
  }));
  db.data.users.push(...created.map(c => c.user));
  db.save();
  return { created };
}

// Change a user's team (display) name. Brawl entries and match records keep the name the
// team had when the tournament started, so finished results and replays stay unchanged.
function renameTeam(user, teamName) {
  teamName = String(teamName || '').trim();
  checkTeamName(teamName, user);
  // An uncustomised avatar takes its hat colour from the team name: pin it so the look doesn't change.
  if (!user.avatar) user.avatar = avatarOf(user);
  user.teamName = teamName;
  db.save();
  return user;
}

// Accounts are added by hand in db.json, e.g.
//   { "username": "alice", "password": "s3cret", "teamName": "Team Alice" }
// On startup, plain-text passwords are hashed (and removed) and missing fields are filled in.
function prepareUsers() {
  const seen = new Set();
  const kept = [];
  for (const u of db.data.users) {
    const name = String(u.username || '').trim();
    if (!name) { console.warn('[users] skipping an entry with no username'); continue; }
    if (seen.has(name.toLowerCase())) { console.warn(`[users] skipping duplicate username "${name}"`); continue; }
    seen.add(name.toLowerCase());
    u.username = name;
    u.id = u.id || db.id();
    u.role = u.role === 'judge' ? 'judge' : 'player';
    u.teamName = String(u.teamName || name).trim();
    u.createdAt = u.createdAt || new Date().toISOString();
    if (u.password !== undefined) {
      u.passwordHash = hashPassword(u.password);
      delete u.password;
      console.log(`[users] set password for "${name}"`);
    }
    if (!u.passwordHash) console.warn(`[users] "${name}" has no password and cannot log in`);
    kept.push(u);
  }
  db.data.users = kept;
  db.save();
  db.flush();
}

// Make sure there is always at least one judge account.
function ensureJudge() {
  if (db.data.users.some(u => u.role === 'judge')) return;
  const password = process.env.JUDGE_PASSWORD || crypto.randomBytes(5).toString('hex');
  createUser({ username: 'judge', password, teamName: 'The Judge', role: 'judge' });
  db.flush();
  console.log('\n  Created judge account ->  username: judge   password: ' + password + '\n');
}

function avatarOf(u) {
  return normalizeAvatar(u && u.avatar, u ? u.teamName : '');
}

function publicUser(u) {
  return u && { id: u.id, username: u.username, teamName: u.teamName, role: u.role, avatar: avatarOf(u) };
}

module.exports = { hashPassword, verifyPassword, createUser, createUsers, renameTeam, prepareUsers, ensureJudge, publicUser, avatarOf };
