// Compiling, validating and launching submissions.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../db');
const Bot = require('./bot');
const { IS_WIN, TOOLS, LANGS, buildDir } = require('./languages');
const { normalize, FIRST_MOVE_TIMEOUT_MS, MOVE_TIMEOUT_MS } = require('./match');
const practice = require('./practice');
const { restrict } = require('./restrict');

const HARNESS = path.join(__dirname, 'harness');
const MAX_PARALLEL_BUILDS = 2;
// Written into .ok; a build made under older rules is rebuilt (and so re-checked) before it plays.
const BUILD_VERSION = 'v2-restricted';

function exec(cmd, args, cwd, timeoutMs = 90000) {
  return new Promise(resolve => {
    let out = '';
    let p;
    try {
      p = spawn(cmd, args, { cwd, windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out: e.message });
    }
    const timer = setTimeout(() => { out += '\n(timed out)'; p.kill(); }, timeoutMs);
    p.stdout.on('data', d => { out = (out + d).slice(-8000); });
    p.stderr.on('data', d => { out = (out + d).slice(-8000); });
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out: `${cmd}: ${e.message}` }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
  });
}

// Simple semaphore so we don't run 30 compilers at once.
let activeBuilds = 0;
const buildQueue = [];
async function withBuildSlot(fn) {
  if (activeBuilds >= MAX_PARALLEL_BUILDS) await new Promise(r => buildQueue.push(r));
  activeBuilds++;
  try {
    return await fn();
  } finally {
    activeBuilds--;
    const next = buildQueue.shift();
    if (next) next();
  }
}

const stripDir = (text, dir) => String(text).split(dir + path.sep).join('').trim();

// Player code (anything not marked `trusted`, i.e. not a built-in or judge bot) is restricted:
// see restrict.js for C++/Java and harness/runner.py for Python.
async function build(sub) {
  const dir = buildDir(sub);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let code = sub.code;
  if (!sub.trusted) {
    const checked = restrict(sub.language, code);
    if (checked.error) throw new Error(checked.error);
    code = checked.code;
  }
  fs.writeFileSync(path.join(dir, LANGS[sub.language].file), code);
  let r;
  if (sub.language === 'cpp') {
    fs.copyFileSync(path.join(HARNESS, 'main.cpp'), path.join(dir, 'harness_main.cpp'));
    const prelude = [];
    if (!sub.trusted) {
      fs.copyFileSync(path.join(HARNESS, 'prelude.hpp'), path.join(dir, 'prelude.hpp'));
      prelude.push('-include', 'prelude.hpp');
    }
    r = await exec(TOOLS.cxx, ['-O2', '-std=c++17', ...(IS_WIN ? ['-static'] : []), ...prelude, '-o', IS_WIN ? 'bot.exe' : 'bot', 'harness_main.cpp', 'bot.cpp'], dir);
  } else if (sub.language === 'java') {
    fs.copyFileSync(path.join(HARNESS, 'Main.java'), path.join(dir, 'Main.java'));
    fs.mkdirSync(path.join(dir, 'out'));
    r = await exec(TOOLS.javac, ['-encoding', 'UTF-8', '-d', 'out', 'Main.java', 'Bot.java'], dir);
  } else if (sub.language === 'python') {
    fs.copyFileSync(path.join(HARNESS, 'runner.py'), path.join(dir, '_runner.py'));
    r = sub.trusted
      ? await exec(TOOLS.python, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])', 'bot.py'], dir)
      : await exec(TOOLS.python, ['-X', 'utf8', '_runner.py', '--check', 'bot.py'], dir);
  } else {
    throw new Error('Unknown language');
  }
  if (r.code !== 0) throw new Error(stripDir(r.out, dir) || 'Biên dịch thất bại');
  fs.writeFileSync(path.join(dir, '.ok'), BUILD_VERSION + ' ' + new Date().toISOString());
}

const inFlightBuilds = new Map();
function isBuilt(sub) {
  try { return fs.readFileSync(path.join(buildDir(sub), '.ok'), 'utf8').startsWith(BUILD_VERSION + ' '); } catch { return false; }
}
function ensureBuilt(sub, force = false) {
  if (!force && isBuilt(sub)) return Promise.resolve();
  if (inFlightBuilds.has(sub.id)) return inFlightBuilds.get(sub.id);
  const p = withBuildSlot(() => build(sub)).finally(() => inFlightBuilds.delete(sub.id));
  inFlightBuilds.set(sub.id, p);
  return p;
}

// Play 5 turns against a scripted opponent to make sure the bot actually answers.
async function smokeTest(sub) {
  const bot = new Bot(sub);
  bot.start();
  const script = 'RPSRP';
  let my = '-', opp = '-';
  try {
    for (let i = 0; i < script.length; i++) {
      const raw = await bot.move(my, opp, i === 0 ? FIRST_MOVE_TIMEOUT_MS : MOVE_TIMEOUT_MS);
      const m = normalize(raw);
      if (m === 'X') {
        const why = raw === null
          ? `Bot của bạn ${bot.reason || 'không phản hồi'} ở lượt thử thứ ${i + 1}.`
          : `Bot của bạn trả về "${String(raw).slice(0, 20)}" ở lượt thử thứ ${i + 1}, trong khi chỉ được trả về R, P hoặc S.`;
        await new Promise(r => setTimeout(r, 100)); // let the last stderr arrive
        const err = stripDir(bot.stderr, buildDir(sub));
        return { ok: false, message: why + (err ? '\n\n' + err : '') };
      }
      my = m;
      opp = script[i];
    }
    return { ok: true, message: 'Biên dịch thành công và vượt qua 5 lượt chơi thử. Sẵn sàng chiến!' };
  } finally {
    bot.stop();
  }
}

const pending = new Map(); // submissionId -> { tournamentId, promise }

// Compile + smoke test. Works for anything shaped like { id, language, code }.
async function check(sub) {
  try {
    await ensureBuilt(sub, true);
    return await smokeTest(sub);
  } catch (e) {
    return { ok: false, message: 'Lỗi biên dịch:\n' + e.message };
  }
}

// A sparring bot the judge added to a campaign: same checks as a submission, but no practice games.
// Judge-written bot code (an added bot, or an edited built-in): checks the latest version
// (`buildId`, `language`, `code`). If it passes it becomes the live one that plays; if not, the
// previous live version keeps playing. A result for a version the judge has since replaced is dropped.
async function checkBot(item) {
  const version = { id: item.buildId || item.id, language: item.language || 'python', code: item.code, trusted: true };
  const result = await check(version);
  if ((item.buildId || item.id) !== version.id) { removeBuild(version); return result; } // superseded meanwhile
  item.status = result.ok ? 'ok' : 'error';
  item.message = result.message;
  if (result.ok) {
    const old = item.live;
    item.live = { buildId: version.id, language: version.language, code: version.code };
    if (old && old.buildId !== version.id) removeBuild({ id: old.buildId });
  } else if (!item.live || item.live.buildId !== version.id) {
    removeBuild(version);
  }
  db.save();
  return result;
}

// Best effort: on Windows a build that is still running can't be deleted (it is just left behind).
function removeBuild(item) {
  try { fs.rmSync(buildDir(item), { recursive: true, force: true }); } catch {}
}

// Compile + smoke test; writes the result onto the submission record.
function validate(sub) {
  const promise = (async () => {
    const result = await check(sub);
    sub.status = result.ok ? 'ok' : 'error';
    sub.message = result.message;
    sub.checkedAt = new Date().toISOString();
    db.save();
    if (result.ok) practice.evaluate(sub, ensureBuilt);
    return result;
  })().finally(() => pending.delete(sub.id));
  pending.set(sub.id, { tournamentId: sub.tournamentId, promise });
  return promise;
}

function waitForValidations(tournamentId) {
  const ps = [...pending.values()].filter(p => p.tournamentId === tournamentId).map(p => p.promise.catch(() => {}));
  return Promise.all(ps);
}

// The submission that would play for this user right now (newest working one).
function activeSubmission(tournamentId, userId) {
  let best = null;
  for (const s of db.data.submissions) {
    if (s.tournamentId === tournamentId && s.userId === userId && s.status === 'ok' && (!best || best.createdAt < s.createdAt)) best = s;
  }
  return best;
}

// After a restart, finish practice runs that were cut off.
// Brawl: only the active submission of open tournaments. Campaign: every working submission
// of a tournament that isn't finished yet (submissions from before the deadline still count).
function resumePractice() {
  for (const t of db.data.tournaments) {
    if (t.mode === 'campaign') {
      if (t.status === 'finished') continue;
      for (const s of db.data.submissions) {
        if (s.tournamentId !== t.id || s.status !== 'ok') continue;
        // also regrade submissions graded before the best-of-5 rule (no per-game results)
        const oldRule = s.practice && s.practice.results.some(r => r.status === 'done' && !r.games);
        if (!s.practice || s.practice.status !== 'done' || oldRule) practice.evaluate(s, ensureBuilt);
      }
      continue;
    }
    if (t.status !== 'open') continue;
    const users = new Set(db.data.submissions.filter(s => s.tournamentId === t.id).map(s => s.userId));
    for (const uid of users) {
      const s = activeSubmission(t.id, uid);
      if (s && (!s.practice || s.practice.status !== 'done')) practice.evaluate(s, ensureBuilt);
    }
  }
}

module.exports = { LANGS, validate, checkBot, removeBuild, housePython: require('./house').pythonSource, ensureBuilt, waitForValidations, activeSubmission, resumePractice, practice };
