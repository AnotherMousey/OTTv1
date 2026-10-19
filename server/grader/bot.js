// One running bot process, spoken to over stdin/stdout:
//   grader -> bot : "TURN <myPrevMove> <opponentPrevMove>"   ('-' on turn 1)
//   bot -> grader : "MOVE <R|P|S>"   (any other output line is ignored)
const { spawn } = require('child_process');
const { command } = require('./languages');

class Bot {
  constructor(sub) {
    this.sub = sub;
    this.proc = null;
    this.dead = false;
    this.reason = null;
    this.waiter = null;
    this.stdoutBuf = '';
    this.stderr = '';
  }

  start() {
    try {
      const spec = command(this.sub);
      this.proc = spawn(spec.cmd, spec.args, { cwd: spec.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
      if (line.startsWith('MOVE ') && this.waiter) {
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
  }

  fail(reason) {
    this.reason = this.reason || reason;
    try { if (this.proc) this.proc.kill(); } catch {}
    this._die(reason);
  }

  // Resolves with the raw move string, or null if the bot is dead / too slow.
  move(myPrev, oppPrev, timeoutMs) {
    if (this.dead || !this.proc) return Promise.resolve(null);
    return new Promise(resolve => {
      const done = m => { clearTimeout(timer); resolve(m); };
      const timer = setTimeout(() => {
        if (this.waiter === done) {
          this.waiter = null;
          this.fail(`mất quá ${timeoutMs} ms để ra nước`);
          resolve(null);
        }
      }, timeoutMs);
      this.waiter = done;
      this.proc.stdin.write(`TURN ${myPrev} ${oppPrev}\n`);
    });
  }

  stop() {
    const p = this.proc;
    this.dead = true;
    if (!p) return;
    try { p.stdin.write('END\n'); p.stdin.end(); } catch {}
    setTimeout(() => { try { if (p.exitCode === null) p.kill(); } catch {} }, 300);
  }
}

module.exports = Bot;
