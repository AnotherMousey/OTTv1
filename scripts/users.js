// Manage accounts from the command line (stop the server first - it owns db.json while running).
//   node scripts/users.js list
//   node scripts/users.js add <username> <password> <team name> [--judge]
//   node scripts/users.js passwd <username> <new password>
//   node scripts/users.js remove <username>
const db = require('../server/db');
db.load();
const auth = require('../server/auth');

const [cmd, ...args] = process.argv.slice(2);
const judge = args.includes('--judge');
const rest = args.filter(a => a !== '--judge');
const byName = name => db.data.users.find(u => u.username.toLowerCase() === String(name).toLowerCase());

try {
  if (cmd === 'list') {
    for (const u of db.data.users) console.log(`${u.role.padEnd(7)} ${u.username.padEnd(20)} ${u.teamName}`);
  } else if (cmd === 'add') {
    const [username, password, ...team] = rest;
    const u = auth.createUser({ username, password, teamName: team.join(' ') || username, role: judge ? 'judge' : 'player' });
    console.log(`added ${u.role} ${u.username} (team "${u.teamName}")`);
  } else if (cmd === 'passwd') {
    const u = byName(rest[0]);
    if (!u) throw new Error('No such user');
    if (!rest[1]) throw new Error('Give a new password');
    u.passwordHash = auth.hashPassword(rest[1]);
    console.log(`password changed for ${u.username}`);
  } else if (cmd === 'remove') {
    const u = byName(rest[0]);
    if (!u) throw new Error('No such user');
    db.data.users = db.data.users.filter(x => x !== u);
    console.log(`removed ${u.username}`);
  } else {
    console.log('usage: node scripts/users.js list | add <user> <pass> <team> [--judge] | passwd <user> <pass> | remove <user>');
  }
  db.save();
  db.flush();
} catch (e) {
  console.error('error: ' + e.message);
  process.exit(1);
}
