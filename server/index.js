// Entry point: load the database (PostgreSQL or data/db.json, see db.js), then start the server.
const db = require('./db');

db.load()
  .then(() => require('./app'))
  .catch(e => {
    console.error('Could not start:', e);
    process.exit(1);
  });
