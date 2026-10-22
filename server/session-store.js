// express-session store on PostgreSQL (the sessions table, see db.js), so logins survive restarts.
const session = require('express-session');

const DAY_MS = 24 * 3600 * 1000;

class PgSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
    // drop expired sessions now and then
    setInterval(() => this.pool.query('DELETE FROM sessions WHERE expires < now()').catch(() => {}), 3600 * 1000).unref();
  }

  expiry(sess) {
    const ms = sess && sess.cookie && sess.cookie.expires ? Date.parse(sess.cookie.expires) : Date.now() + DAY_MS;
    return new Date(ms);
  }

  get(sid, cb) {
    this.pool.query('SELECT sess FROM sessions WHERE sid = $1 AND expires >= now()', [sid])
      .then(r => cb(null, r.rows[0] ? r.rows[0].sess : null), cb);
  }

  set(sid, sess, cb = () => {}) {
    this.pool.query(`INSERT INTO sessions (sid, sess, expires) VALUES ($1, $2, $3)
      ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expires = EXCLUDED.expires`, [sid, JSON.stringify(sess), this.expiry(sess)])
      .then(() => cb(null), cb);
  }

  destroy(sid, cb = () => {}) {
    this.pool.query('DELETE FROM sessions WHERE sid = $1', [sid]).then(() => cb(null), cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.pool.query('UPDATE sessions SET expires = $2 WHERE sid = $1', [sid, this.expiry(sess)]).then(() => cb(null), cb);
  }
}

module.exports = PgSessionStore;
