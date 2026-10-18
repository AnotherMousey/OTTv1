// Tiny JSON-file database. Everything lives in memory and is flushed to
// data/db.json (atomically, via a temp file) shortly after each change.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const db = {
  DATA_DIR,
  DB_FILE,
  data: null,
  _timer: null,
  _dirty: false,

  load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let data = {};
    if (fs.existsSync(DB_FILE)) data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
    data.meta = data.meta || {};
    data.users = data.users || [];
    data.tournaments = data.tournaments || [];
    data.submissions = data.submissions || [];
    data.matches = data.matches || {};
    if (!data.meta.sessionSecret) data.meta.sessionSecret = crypto.randomBytes(32).toString('hex');
    this.data = data;
    this.flush(true);
    return data;
  },

  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), 150);
  },

  flush(force = false) {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this._dirty && !force) return;
    this._dirty = false;
    const json = JSON.stringify(this.data, null, 2);
    const tmp = DB_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, DB_FILE);
    } catch {
      fs.writeFileSync(DB_FILE, json); // rename can fail on Windows if the file is locked
    }
  },

  id() {
    return crypto.randomBytes(6).toString('hex');
  },
};

process.on('exit', () => db.data && db.flush());
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

module.exports = db;
