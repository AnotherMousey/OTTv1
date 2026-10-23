const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('../db');

const IS_WIN = process.platform === 'win32';
const BUILD_ROOT = path.join(db.DATA_DIR, 'builds');

// SANDBOX=docker: every compiler run and every bot runs in its own throwaway container from
// BOT_IMAGE (docker/bot.Dockerfile). The container has no network, limited memory / CPU /
// processes, no capabilities, a read-only filesystem except /tmp, runs as nobody, and sees only
// that one submission's build folder (as /bot; read-only while the bot plays).
// HOST_BUILD_ROOT: where BUILD_ROOT is on the Docker host (they differ when this server itself
// runs in a container and talks to the host's Docker daemon through its socket).
// Without SANDBOX, compilers and bots run as ordinary processes (local development only).
const SANDBOX = process.env.SANDBOX === 'docker';
const DOCKER = process.env.DOCKER || 'docker';
const BOT_IMAGE = process.env.BOT_IMAGE || 'ottv1-bot:latest';
const HOST_BUILD_ROOT = (process.env.HOST_BUILD_ROOT || BUILD_ROOT).replace(/[\\/]+$/, '');
const LIMITS = {
  memory: process.env.SANDBOX_MEMORY || '512m',
  cpus: process.env.SANDBOX_CPUS || '1',
  pids: process.env.SANDBOX_PIDS || '128',
};

const TOOLS = SANDBOX
  ? { cxx: 'g++', javac: 'javac', java: 'java', python: 'python3' } // inside BOT_IMAGE
  : {
    cxx: process.env.CXX || 'g++',
    javac: process.env.JAVAC || 'javac',
    java: process.env.JAVA || 'java',
    python: process.env.PYTHON_CMD || (IS_WIN ? 'python' : 'python3'),
  };
// Native Windows builds get a static .exe; in the sandbox it's always Linux.
const WIN_EXE = IS_WIN && !SANDBOX;

const LANGS = {
  cpp: { label: 'C++17', file: 'bot.cpp' },
  java: { label: 'Java', file: 'Bot.java' },
  python: { label: 'Python 3', file: 'bot.py' },
};

const buildDir = sub => path.join(BUILD_ROOT, sub.id);
// Which game a runnable plays: 'rps' (default, also for anything made before the board game) or 'board'.
const gameOf = sub => (sub.game === 'board' ? 'board' : 'rps');

// `cmd args`, run in the submission's build folder: directly, or in a fresh sandbox container.
// writable: the compile step may write into the folder; interactive: keep stdin open (a playing bot).
// Returns { cmd, args, cwd, container } (container = the container's name, to remove it later).
function boxed(sub, cmd, args, { writable = false, interactive = false } = {}) {
  const cwd = buildDir(sub);
  if (!SANDBOX) return { cmd, args, cwd, container: null };
  const container = `ottv1-${sub.id}-${crypto.randomBytes(4).toString('hex')}`;
  return {
    cmd: DOCKER,
    args: [
      'run', '--rm', ...(interactive ? ['-i'] : []), '--name', container,
      '--network', 'none',
      '--memory', LIMITS.memory, '--memory-swap', LIMITS.memory, '--cpus', LIMITS.cpus, '--pids-limit', LIMITS.pids,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534',
      '--read-only', '--tmpfs', '/tmp:rw,size=64m', '-e', 'HOME=/tmp',
      '-v', `${HOST_BUILD_ROOT}/${sub.id}:/bot${writable ? '' : ':ro'}`, '-w', '/bot',
      BOT_IMAGE, cmd, ...args,
    ],
    cwd,
    container,
  };
}

// Stops a sandbox container for good (killing the `docker run` client alone leaves it running).
function removeContainer(name) {
  if (!name) return;
  try {
    const p = spawn(DOCKER, ['rm', '-f', name], { stdio: 'ignore', windowsHide: true });
    p.on('error', () => {});
  } catch {}
}

// Board game: CPU time a bot may use per move, and for a game's first move (start-up included).
const MOVE_CPU_MS = +process.env.MOVE_TIMEOUT_MS || 1000;
const FIRST_MOVE_TIMEOUT_MS = +process.env.FIRST_MOVE_TIMEOUT_MS || 10000;

// How to launch a compiled submission. A board bot runs under the CPU meter (harness/meter.py),
// which stops it the moment a move goes over its CPU budget: the limit counts computation, not the clock.
function command(sub) {
  const box = (cmd, args) => (gameOf(sub) === 'board'
    ? boxed(sub, TOOLS.python, ['-u', '-B', '_meter.py', '--limit', String(MOVE_CPU_MS), '--first', String(FIRST_MOVE_TIMEOUT_MS), cmd, ...args], { interactive: true })
    : boxed(sub, cmd, args, { interactive: true }));
  switch (sub.language) {
    case 'cpp':
      return box(SANDBOX ? './bot' : path.join(buildDir(sub), WIN_EXE ? 'bot.exe' : 'bot'), []);
    case 'java':
      return box(TOOLS.java, ['-Xmx256m', '-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1', '-cp', 'out', 'Main']);
    case 'python':
      return box(TOOLS.python, ['-u', '-B', '-X', 'utf8', '_runner.py', ...(gameOf(sub) === 'board' ? ['--board'] : []), ...(sub.trusted ? [] : ['--restricted']), 'bot.py']);
    default:
      throw new Error('Unknown language ' + sub.language);
  }
}

module.exports = { MOVE_CPU_MS, FIRST_MOVE_TIMEOUT_MS, IS_WIN, WIN_EXE, SANDBOX, DOCKER, BOT_IMAGE, HOST_BUILD_ROOT, BUILD_ROOT, TOOLS, LANGS, buildDir, gameOf, boxed, removeContainer, command };
