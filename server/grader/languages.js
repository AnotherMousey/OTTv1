const path = require('path');
const db = require('../db');

const IS_WIN = process.platform === 'win32';
const BUILD_ROOT = path.join(db.DATA_DIR, 'builds');

const TOOLS = {
  cxx: process.env.CXX || 'g++',
  javac: process.env.JAVAC || 'javac',
  java: process.env.JAVA || 'java',
  python: process.env.PYTHON_CMD || (IS_WIN ? 'python' : 'python3'),
};

const LANGS = {
  cpp: { label: 'C++17', file: 'bot.cpp' },
  java: { label: 'Java', file: 'Bot.java' },
  python: { label: 'Python 3', file: 'bot.py' },
};

const buildDir = sub => path.join(BUILD_ROOT, sub.id);

// How to launch a compiled submission.
function command(sub) {
  const cwd = buildDir(sub);
  switch (sub.language) {
    case 'cpp':
      return { cmd: path.join(cwd, IS_WIN ? 'bot.exe' : 'bot'), args: [], cwd };
    case 'java':
      return { cmd: TOOLS.java, args: ['-Xmx256m', '-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1', '-cp', 'out', 'Main'], cwd };
    case 'python':
      return { cmd: TOOLS.python, args: ['-u', '-X', 'utf8', '_runner.py', ...(sub.trusted ? [] : ['--restricted']), 'bot.py'], cwd };
    default:
      throw new Error('Unknown language ' + sub.language);
  }
}

module.exports = { IS_WIN, BUILD_ROOT, TOOLS, LANGS, buildDir, command };
