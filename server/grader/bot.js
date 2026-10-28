// One running bot process, spoken to over stdin/stdout:
//   grader -> bot : "TURN <myPrevMove> <opponentPrevMove>"   ('-' on turn 1)
//   bot -> grader : "MOVE <R|P|S>"   (any other output line is ignored)
// Board game (see board.js): "STATE <turn> <maxTurn> <pieces>" in, "MOVE <pid> <direction>" out.
// Before anything else the bot prints "READY" (the harness does it, once the bot's code is loaded).
// Its first request is only sent after that, so the time it takes to start (a container, a JVM, a
// busy server starting many bots at once) never counts as time spent on a move.
const { spawn } = require('child_process');
const { command, removeContainer, SANDBOX, IS_WIN } = require('./languages');

// wall time a bot may take to start, before its first request is sent
const START_TIMEOUT_MS = +process.env.START_TIMEOUT_MS || 60000;

// Without the sandbox a bot can be more than one process (the CPU meter and the bot under it, or
// a launcher like Windows' java.exe): stop them all. In the sandbox, removing the container does.
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (SANDBOX) proc.kill();
    else if (IS_WIN) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    else process.kill(-proc.pid, 'SIGKILL'); // its process group (started detached)
  } catch {
    try { proc.kill(); } catch {}
  }
}

class Bot {
  constructor(sub) {
    this.sub = sub;
    this.proc = null;
    this.dead = false;
    this.reason = null;
    this.waiter = null;
    this.stdoutBuf = '';
    this.stderr = '';
    this.late = 0; // answers still owed to requests that timed out (thrown away when they come)
    this.cpu = null; // CPU ms the last answer took, as the meter reported it (board bots)
    this.ready = false;
    this.readyWaiters = [];
  }

  _setReady() {
    this.ready = true;
    for (const w of this.readyWaiters.splice(0)) w();
  }

  // Resolves once the bot has said READY (true) or is dead / took over START_TIMEOUT_MS (false).
  waitReady() {
    if (this.ready || this.dead || !this.proc) return Promise.resolve(this.ready && !this.dead);
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); resolve(this.ready && !this.dead); };
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter(w => w !== done);
        this.fail(`không khởi động xong trong ${START_TIMEOUT_MS / 1000} giây`);
        resolve(false);
      }, START_TIMEOUT_MS);
      this.readyWaiters.push(done);
    });
  }

  start() {
    try {
      const spec = command(this.sub);
      this.container = spec.container; // sandbox: the container to remove when the bot is stopped
      // (outside the sandbox on Linux, in its own process group so killTree reaches all of it)
      this.proc = spawn(spec.cmd, spec.args, { cwd: spec.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: !SANDBOX && !IS_WIN });
    } catch (e) {
      return this._die('không khởi động được: ' + e.message);
    }
    const p = this.proc;
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', chunk => this._onStdout(chunk));
    p.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-3000); });
    p.stdin.on('error', () => {});
    p.on('error', e => this._die('không khởi động được: ' + e.message));
    p.on('exit', code => this._die(`bị lỗi và dừng (mã thoát ${code})`));
  }

  _onStdout(chunk) {
    this.stdoutBuf += chunk;
    let i;
    while ((i = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, i).trim();
      this.stdoutBuf = this.stdoutBuf.slice(i + 1);
      if (line === 'READY') { if (!this.ready) this._setReady(); }
      else if (line.startsWith('CPU ')) this.cpu = +line.slice(4);
      else if (line.startsWith('MOVE ') && this.late > 0) this.late--;
      else if (line.startsWith('MOVE ') && this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w(line.slice(5).trim());
      }
    }
    if (this.stdoutBuf.length > 1e6) this.fail('in ra quá nhiều dữ liệu');
  }

  _die(reason) {
    if (this.dead) return;
    this.dead = true;
    this.reason = this.reason || reason;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
    for (const w of this.readyWaiters.splice(0)) w();
  }

  fail(reason) {
    this.reason = this.reason || reason;
    killTree(this.proc);
    removeContainer(this.container);
    this._die(reason);
  }

  // Resolves with the raw move string, or null if the bot is dead / too slow.
  move(myPrev, oppPrev, timeoutMs) {
    return this.ask(`TURN ${myPrev} ${oppPrev}`, timeoutMs);
  }

  // Sends one request line; resolves with the text after "MOVE ", or null (then this.dead tells
  // a dead bot from a slow one). Too slow: the bot is killed, or with { skipLate } it lives on and
  // its late answer is thrown away. The clock starts once the bot is ready (see waitReady).
  async ask(line, timeoutMs, { skipLate = false } = {}) {
    if (!this.ready && !(await this.waitReady())) return null;
    if (this.dead || !this.proc) return null;
    this.cpu = null;
    return new Promise(resolve => {
      const done = m => { clearTimeout(timer); resolve(m); };
      const timer = setTimeout(() => {
        if (this.waiter === done) {
          this.waiter = null;
          if (skipLate) this.late++;
          else this.fail(`mất quá ${timeoutMs} ms để ra nước`);
          resolve(null);
        }
      }, timeoutMs);
      this.waiter = done;
      this.proc.stdin.write(line + '\n');
    });
  }

  stop() {
    const p = this.proc;
    this.dead = true;
    if (!p) return;
    try { p.stdin.write('END\n'); p.stdin.end(); } catch {}
    setTimeout(() => {
      if (p.exitCode === null) { killTree(p); removeContainer(this.container); }
    }, 300);
  }
}

module.exports = Bot;
