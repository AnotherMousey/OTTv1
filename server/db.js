// Storage. Two backends behind the same interface:
//  - PostgreSQL when DATABASE_URL is set (production; see docker-compose.yml);
//  - a JSON file (data/db.json) otherwise, for small local setups.
//
// The small, hot data lives in memory as plain objects that the rest of the server reads and
// mutates directly, then calls db.save():
//   db.data = { meta, users, tournaments, submissions, matches: { [tournamentId]: { [name]: summary } } }
// The big data is only in storage and fetched on demand:
//   - a submission's source code: putCode / getCode / getCodes
//   - a match's move log (movesA, movesB, games): putMatch stores it, getMatch returns the full match.
// Postgres keeps every user, tournament and submission as a JSONB document row; save() writes the
// ones that changed since the last write (and deletes the ones that are gone), at most every 300 ms.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DATABASE_URL = process.env.DATABASE_URL || '';
const DETAIL_KEYS = ['movesA', 'movesB', 'games']; // the bulky part of a match
const SAVE_DELAY_MS = 300;

const split = m => {
  const summary = {}, detail = {};
  for (const [k, v] of Object.entries(m)) (DETAIL_KEYS.includes(k) ? detail : summary)[k] = v;
  return { summary, detail };
};

// Puts loaded data into the in-memory shape. Old db.json files keep code inside submissions and
// whole matches in `matches`: those are moved out into `codes` / `details` (returned).
function normalize(raw) {
  const data = {
    meta: raw.meta || {},
    users: raw.users || [],
    tournaments: raw.tournaments || [],
    submissions: raw.submissions || [],
    matches: {},
  };
  const codes = { ...(raw.codes || {}) };
  const details = {};
  for (const s of data.submissions) {
    if (typeof s.code === 'string') { codes[s.id] = s.code; delete s.code; }
  }
  for (const [tid, byName] of Object.entries(raw.matches || {})) {
    data.matches[tid] = {};
    for (const [name, m] of Object.entries(byName)) {
      const { summary, detail } = split(m);
      data.matches[tid][name] = summary;
      const stored = (raw.matchDetails || {})[tid] && raw.matchDetails[tid][name];
      details[`${tid}\n${name}`] = stored || detail;
    }
  }
  if (!data.meta.sessionSecret) data.meta.sessionSecret = crypto.randomBytes(32).toString('hex');
  return { data, codes, details };
}

// ---------- JSON file ----------
const jsonBackend = {
  codes: {},
  details: {}, // "tournamentId\nname" -> { movesA, movesB, games }

  async load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const raw = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}') : {};
    const { data, codes, details } = normalize(raw);
    this.codes = codes;
    this.details = details;
    return data;
  },

  flushSync(data) {
    const matchDetails = {};
    for (const [key, d] of Object.entries(this.details)) {
      const [tid, name] = key.split('\n');
      (matchDetails[tid] = matchDetails[tid] || {})[name] = d;
    }
    const json = JSON.stringify({ ...data, codes: this.codes, matchDetails }, null, 2);
    const tmp = DB_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, DB_FILE);
    } catch {
      fs.writeFileSync(DB_FILE, json); // rename can fail on Windows if the file is locked
    }
  },
  async flush(data) { this.flushSync(data); },

  async putCode(sub, code) { this.codes[sub.id] = code; },
  async getCodes(ids) { return Object.fromEntries(ids.map(id => [id, this.codes[id] ?? ''])); },
  async putMatch(m, detail) { this.details[`${m.tournamentId}\n${m.name}`] = detail; },
  async getDetail(tid, name) { return this.details[`${tid}\n${name}`] || null; },
  async deleteTournament(tid, subIds) {
    for (const key of Object.keys(this.details)) if (key.startsWith(tid + '\n')) delete this.details[key];
    for (const id of subIds) delete this.codes[id];
  },
  async close() {},
};

// ---------- PostgreSQL ----------
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL, user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, doc JSONB NOT NULL, code TEXT NOT NULL DEFAULT '');
  CREATE INDEX IF NOT EXISTS submissions_tournament ON submissions (tournament_id);
  CREATE TABLE IF NOT EXISTS matches (
    tournament_id TEXT NOT NULL, name TEXT NOT NULL, played_at TIMESTAMPTZ,
    summary JSONB NOT NULL, detail JSONB NOT NULL, PRIMARY KEY (tournament_id, name));
  CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess JSONB NOT NULL, expires TIMESTAMPTZ NOT NULL);
  CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);
`;
const TABLES = ['users', 'tournaments', 'submissions'];

const pgBackend = {
  pool: null,
  written: null, // table -> Map(id -> JSON last written), to write only what changed

  async load() {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: DATABASE_URL, max: +process.env.PG_POOL_SIZE || 10 });
    // the database container may still be starting
    for (let attempt = 1; ; attempt++) {
      try { await this.pool.query('SELECT 1'); break; } catch (e) {
        if (attempt >= 30) throw e;
        console.log(`[db] waiting for PostgreSQL (${e.message})`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    // team names and messages are Vietnamese: anything but UTF-8 would reject them
    const enc = (await this.pool.query('SHOW server_encoding')).rows[0].server_encoding;
    if (enc !== 'UTF8') throw new Error(`the database must use UTF8 encoding, not ${enc} (CREATE DATABASE ... ENCODING 'UTF8' TEMPLATE template0)`);
    await this.pool.query(SCHEMA);
    this.written = Object.fromEntries(TABLES.map(t => [t, new Map()]));

    const empty = (await this.pool.query('SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM tournaments) AS n')).rows[0].n === '0';
    if (empty && fs.existsSync(DB_FILE)) return this.importJson();

    const raw = { meta: {}, matches: {} };
    for (const r of (await this.pool.query('SELECT key, value FROM meta')).rows) raw.meta[r.key] = r.value;
    for (const t of TABLES) raw[t] = (await this.pool.query(`SELECT doc FROM ${t} ORDER BY ${t === 'submissions' ? 'created_at, id' : 'id'}`)).rows.map(r => r.doc);
    for (const r of (await this.pool.query('SELECT tournament_id, name, summary FROM matches')).rows) {
      (raw.matches[r.tournament_id] = raw.matches[r.tournament_id] || {})[r.name] = r.summary;
    }
    const { data } = normalize(raw);
    for (const t of TABLES) for (const doc of data[t]) this.written[t].set(doc.id, JSON.stringify(doc));
    return data;
  },

  // First start on an empty database: bring over everything from data/db.json.
  async importJson() {
    console.log(`[db] importing ${DB_FILE} into PostgreSQL…`);
    const { data, codes, details } = normalize(JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}'));
    await this.flush(data);
    for (const s of data.submissions) await this.putCode(s, codes[s.id] || '');
    for (const [tid, byName] of Object.entries(data.matches)) {
      for (const [name, summary] of Object.entries(byName)) await this.putMatch(summary, details[`${tid}\n${name}`] || {});
    }
    const kept = `${DB_FILE}.imported-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(DB_FILE, kept);
    console.log(`[db] imported ${data.users.length} users, ${data.tournaments.length} tournaments, ${data.submissions.length} submissions; the file is kept as ${path.basename(kept)}`);
    return data;
  },

  async flush(data) {
    const changes = [];
    const next = {};
    for (const t of TABLES) {
      next[t] = new Map();
      for (const doc of data[t]) {
        const json = JSON.stringify(doc);
        next[t].set(doc.id, json);
        if (this.written[t].get(doc.id) !== json) changes.push({ t, doc, json });
      }
    }
    const gone = TABLES.flatMap(t => [...this.written[t].keys()].filter(id => !next[t].has(id)).map(id => ({ t, id })));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(data.meta)) {
        await client.query('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
      }
      for (const { t, doc, json } of changes) {
        if (t === 'submissions') {
          await client.query(`INSERT INTO submissions (id, tournament_id, user_id, created_at, doc) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET tournament_id = EXCLUDED.tournament_id, user_id = EXCLUDED.user_id, doc = EXCLUDED.doc`,
          [doc.id, doc.tournamentId, doc.userId, doc.createdAt, json]);
        } else {
          await client.query(`INSERT INTO ${t} (id, doc) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`, [doc.id, json]);
        }
      }
      for (const { t, id } of gone) await client.query(`DELETE FROM ${t} WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    this.written = next;
  },

  async putCode(sub, code) {
    await this.pool.query(`INSERT INTO submissions (id, tournament_id, user_id, created_at, doc, code) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code`, [sub.id, sub.tournamentId, sub.userId, sub.createdAt, JSON.stringify(sub), code]);
  },
  async getCodes(ids) {
    if (!ids.length) return {};
    const rows = (await this.pool.query('SELECT id, code FROM submissions WHERE id = ANY($1)', [ids])).rows;
    return Object.fromEntries(ids.map(id => [id, (rows.find(r => r.id === id) || {}).code ?? '']));
  },
  async putMatch(m, detail) {
    await this.pool.query(`INSERT INTO matches (tournament_id, name, played_at, summary, detail) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tournament_id, name) DO UPDATE SET played_at = EXCLUDED.played_at, summary = EXCLUDED.summary, detail = EXCLUDED.detail`,
    [m.tournamentId, m.name, m.playedAt || null, JSON.stringify(m), JSON.stringify(detail)]);
  },
  async getDetail(tid, name) {
    const r = (await this.pool.query('SELECT detail FROM matches WHERE tournament_id = $1 AND name = $2', [tid, name])).rows[0];
    return r ? r.detail : null;
  },
  async deleteTournament(tid) {
    await this.pool.query('DELETE FROM matches WHERE tournament_id = $1', [tid]); // its submission rows go with the next save
  },
  async close() { if (this.pool) await this.pool.end(); },
};

const backend = DATABASE_URL ? pgBackend : jsonBackend;

const db = {
  DATA_DIR,
  DB_FILE,
  backend: DATABASE_URL ? 'postgres' : 'json',
  data: null,
  _timer: null,
  _dirty: false,
  _flushing: null,

  async load() {
    this.data = await backend.load();
    await this.flush(true);
    console.log(`[db] storage: ${this.backend === 'postgres' ? 'PostgreSQL' : DB_FILE}`);
    return this.data;
  },

  // The pg pool (Postgres only), e.g. for the session store.
  get pool() { return backend.pool || null; },

  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush().catch(e => console.error('[db] save failed:', e.message)), SAVE_DELAY_MS);
  },

  // Writes pending changes now. Writes never overlap: a change made during one is written right after.
  async flush(force = false) {
    clearTimeout(this._timer);
    this._timer = null;
    if (this._flushing) {
      await this._flushing.catch(() => {});
      if (!this._dirty) return;
    }
    if (!this._dirty && !force) return;
    this._dirty = false;
    this._flushing = backend.flush(this.data).catch(e => { this._dirty = true; throw e; });
    try { await this._flushing; } finally { this._flushing = null; }
  },

  // ---------- big data ----------
  putCode(sub, code) { return backend.putCode(sub, code); },
  async getCode(id) { return (await backend.getCodes([id]))[id]; },
  getCodes(ids) { return backend.getCodes(ids); },

  // Stores a played match: its summary in memory (db.data.matches), the whole thing in storage.
  async putMatch(m) {
    const { summary, detail } = split(m);
    (this.data.matches[m.tournamentId] = this.data.matches[m.tournamentId] || {})[m.name] = summary;
    await backend.putMatch(summary, detail);
    if (this.backend === 'json') this.save();
  },
  // The whole match (summary + moves), or null.
  async getMatch(tid, name) {
    const summary = (this.data.matches[tid] || {})[name];
    if (!summary) return null;
    return { ...summary, ...((await backend.getDetail(tid, name)) || {}) };
  },
  // A deleted tournament's matches and code. (Remove it and its submissions from db.data first.)
  async deleteTournament(tid, subIds) {
    delete this.data.matches[tid];
    await backend.deleteTournament(tid, subIds);
    this.save();
  },

  async close() {
    await this.flush();
    await backend.close();
  },

  id() {
    return crypto.randomBytes(6).toString('hex');
  },
};

// Save everything before stopping (docker stop sends SIGTERM).
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    (db.data ? db.close() : Promise.resolve()).catch(e => console.error('[db] final save failed:', e.message)).finally(() => process.exit(0));
  });
}
process.on('exit', () => { if (db.data && db.backend === 'json' && db._dirty) jsonBackend.flushSync(db.data); });

module.exports = db;
