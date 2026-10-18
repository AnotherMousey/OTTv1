// Seeds 7 demo teams with example bots (all 3 languages) and a "Demo Cup"
// whose deadline is N seconds away (default 90). Stop the server first, run
// this, then start the server - it compiles the bots on boot.
//   node scripts/demo.js [secondsUntilDeadline]
const fs = require('fs');
const path = require('path');
const db = require('../server/db');
db.load();
const auth = require('../server/auth');
auth.ensureJudge();

// argv[2]: seconds until the deadline, or an exact date ("2026-10-18T21:00:00+07:00")
// argv[3]: tournament name
const arg = process.argv[2] || '90';
const deadlineMs = /^\d+$/.test(arg) ? Date.now() + +arg * 1000 : Date.parse(arg);
if (!Number.isFinite(deadlineMs)) throw new Error('Bad deadline: ' + arg);
const seconds = Math.round((deadlineMs - Date.now()) / 1000);
const tournamentName = process.argv[3] || 'Demo Cup';
const EX = path.join(__dirname, '..', 'examples');
const teams = [
  ['rocky', 'Rock Lobsters', 'python', 'rock.py'],
  ['cycler', 'Paper Tigers', 'cpp', 'cycler.cpp'],
  ['freq', 'Frequency Fezzes', 'java', 'Frequency.java'],
  ['copycat', 'The Copycats', 'python', 'copycat.py'],
  ['beatlast', 'Scissor Sisters', 'cpp', 'beat_last.cpp'],
  ['randy', 'Captain Random', 'java', 'Random.java'],
  ['markov', 'Markov Madness', 'python', 'markov.py'],
];

const now = Date.now();
const t = {
  id: db.id(),
  name: tournamentName,
  description: 'Seven silly bots, one fez.',
  deadline: new Date(deadlineMs).toISOString(),
  status: 'open',
  createdAt: new Date(now).toISOString(),
};
db.data.tournaments.push(t);

teams.forEach(([username, teamName, language, file], i) => {
  let u = db.data.users.find(x => x.username === username);
  if (!u) u = auth.createUser({ username, password: 'demo', teamName });
  db.data.submissions.push({
    id: db.id(), tournamentId: t.id, userId: u.id, language,
    code: fs.readFileSync(path.join(EX, file), 'utf8'),
    status: 'pending', message: '',
    createdAt: new Date(now + i).toISOString(),
  });
});
db.save();
db.flush();
console.log(`${tournamentName} created; submissions close ${new Date(deadlineMs).toString()} (in ${seconds}s). Demo players: ${teams.map(x => x[0]).join(', ')} (password "demo").`);
