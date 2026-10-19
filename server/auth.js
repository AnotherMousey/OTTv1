const crypto = require('crypto');
const db = require('./db');
const { normalizeAvatar } = require('../public/js/avatar');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(password), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function createUser({ username, password, teamName, role = 'player' }) {
  username = String(username || '').trim();
  teamName = String(teamName || '').trim() || username;
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) throw new Error('Tên đăng nhập phải có 2–32 ký tự: chữ không dấu, số, _ . hoặc -');
  if (String(password || '').length < 3) throw new Error('Mật khẩu phải có ít nhất 3 ký tự');
  if (teamName.length > 32) throw new Error('Tên đội tối đa 32 ký tự');
  if (!['player', 'judge'].includes(role)) throw new Error('Vai trò phải là player hoặc judge');
  const users = db.data.users;
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('Tên đăng nhập đã có người dùng');
  if (users.some(u => u.teamName.toLowerCase() === teamName.toLowerCase())) throw new Error('Tên đội đã có người dùng');
  const user = { id: db.id(), username, teamName, role, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  users.push(user);
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

module.exports = { hashPassword, verifyPassword, createUser, prepareUsers, ensureJudge, publicUser, avatarOf };
