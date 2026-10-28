# Runs a board bot and holds it to a CPU-time budget per move. Like Battlecode's bytecode limit, the
# limit is on the bot's own computation, not on the wall clock, so a busy server doesn't cost a bot
# its turn.
#
#   python -u _meter.py --limit <ms> --first <ms> <command> [args...]
#
# Every request line goes to the bot. Before each "MOVE ..." answer the meter prints "CPU <ms>": the
# bot's CPU time (all its threads) since it started working on that request, i.e. since the request
# was sent or since its previous answer, whichever is later. A bot's first request may use
# --first ms (it includes starting up), every other one --limit ms. The moment a bot goes over, the
# meter stops it: it kills the process, answers "CPU <ms>" + "MOVE X" for it (the grader skips the
# turn) and starts the bot afresh for its next turn (whatever it kept in memory is gone). Lines the
# bot prints starting with "CPU " are dropped, so a bot can't report its own time.
# The bot says "READY" once started. The first one is passed on (the grader waits for it before its
# first request; that request's budget still counts the CPU used to start). A restarted bot's start
# is not charged to the move it is restarted for, and it is not stopped before it is ready.
import collections
import os
import subprocess
import sys
import threading
import time

if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    _k32 = ctypes.windll.kernel32
    _k32.OpenProcess.restype = wintypes.HANDLE
    _handles = {}

    def cpu_ms(pid):
        h = _handles.get(pid) or _handles.setdefault(pid, _k32.OpenProcess(0x1000, False, pid))  # query limited info
        t = [wintypes.FILETIME() for _ in range(4)]  # creation, exit, kernel, user
        if not h or not _k32.GetProcessTimes(h, *(ctypes.byref(x) for x in t)):
            return None
        ft = lambda f: (f.dwHighDateTime << 32) | f.dwLowDateTime  # 100 ns units
        return (ft(t[2]) + ft(t[3])) // 10000
    def tree(pid):
        return [pid]
else:
    _TICK = os.sysconf("SC_CLK_TCK")

    def _stat(pid):
        try:
            with open(f"/proc/{pid}/stat") as f:
                return f.read().rsplit(")", 1)[1].split()  # after "pid (name)"
        except OSError:
            return None

    # the bot and every process it started (in the sandbox /proc only shows the container's)
    def tree(pid):
        parent = {}
        for name in os.listdir("/proc"):
            if name.isdigit():
                fields = _stat(name)
                if fields:
                    parent[int(name)] = int(fields[1])
        out, todo = [], [pid]
        while todo:
            p = todo.pop()
            out.append(p)
            todo.extend(c for c, pp in parent.items() if pp == p)
        return out

    def cpu_ms(pid):
        total = 0
        for p in tree(pid):
            fields = _stat(p)
            if fields is None:
                if p == pid:
                    return None
                continue
            try:
                total += int(fields[11]) + int(fields[12])  # utime + stime
            except (IndexError, ValueError):
                pass
        return total * 1000 // _TICK


class Meter:
    def __init__(self, command, limit, first):
        self.command, self.limit, self.first = command, limit, first
        self.lock = threading.Lock()   # guards everything below and stdout
        self.out = sys.stdout.buffer
        self.asked = collections.deque()  # (CPU reading when sent, budget) per request not answered yet
        self.started = 0                 # bots started so far (the first one gets --first)
        self.start()

    def start(self):
        self.child = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.last = 0     # CPU reading at this bot's previous answer (or when it became ready)
        self.ready = False
        self.served = 0   # requests sent to this bot
        self.started += 1
        threading.Thread(target=self.answers, args=(self.child,), daemon=True).start()

    def say(self, *lines):
        for line in lines:
            self.out.write(line)
        self.out.flush()

    # what the bot prints
    def answers(self, child):
        for line in child.stdout:
            if line.startswith(b"CPU "):
                continue
            if line.strip() == b"READY":
                with self.lock:
                    if child is not self.child or self.ready:
                        continue
                    self.ready = True
                    if self.started == 1:
                        self.say(line)
                    else:  # restarted: its start-up is not part of any move
                        self.last = cpu_ms(child.pid) or self.last
                continue
            with self.lock:
                if child is not self.child:
                    return  # a bot that was stopped: its output no longer counts
                if line.startswith(b"MOVE ") and self.asked:
                    now = cpu_ms(child.pid)
                    sent, _ = self.asked.popleft()
                    began = max(sent, self.last)
                    if now is not None:
                        self.last = now
                        self.say(b"CPU %d\n" % max(0, now - began))
                self.say(line)
        code = child.wait()
        with self.lock:
            if child is self.child:  # the bot ended (or crashed) by itself: end with it
                self.out.flush()
                os._exit(code if code >= 0 else 128 - code)

    # stops a bot that went over its budget, every few ms while it is thinking
    def watch(self):
        while True:
            time.sleep(0.005)
            with self.lock:
                if not self.asked or not self.ready:
                    continue
                now = cpu_ms(self.child.pid)
                if now is None:
                    continue
                sent, budget = self.asked[0]
                used = now - max(sent, self.last)
                if used <= budget:
                    continue
                old = self.child
                self.child = None  # its answers no longer count
                if os.name == "nt":  # (no process tree from /proc here)
                    subprocess.call(["taskkill", "/pid", str(old.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for p in reversed(tree(old.pid)):  # the bot and anything it started
                    try:
                        if p == old.pid:
                            old.kill()
                        else:
                            os.kill(p, 9)
                    except OSError:
                        pass
                # this request: over the budget; any older ones the grader gave up on: no answer
                self.asked.popleft()
                self.say(b"CPU %d\n" % used, b"MOVE X\n", *(b"MOVE X\n" for _ in self.asked))
                self.asked.clear()
                self.start()

    def request(self, line):
        with self.lock:
            if line.startswith((b"STATE ", b"TURN ")):
                first = self.started == 1 and self.served == 0
                self.served += 1
                # the first move's budget includes starting up: count from the bot's very start
                self.asked.append((0 if first else cpu_ms(self.child.pid) or self.last, self.first if first else self.limit))
            try:
                self.child.stdin.write(line)
                self.child.stdin.flush()
            except (BrokenPipeError, OSError):
                return False
        return True

    def run(self):
        threading.Thread(target=self.watch, daemon=True).start()
        for line in sys.stdin.buffer:
            if not self.request(line):
                break
        with self.lock:
            child = self.child
        try:
            child.stdin.close()
        except OSError:
            pass
        code = child.wait()
        sys.exit(code if code >= 0 else 128 - code)


def main():
    args = sys.argv[1:]
    limit = first = 1000
    while args and args[0] in ("--limit", "--first"):
        if args[0] == "--limit":
            limit = int(args[1])
        else:
            first = int(args[1])
        args = args[2:]
    Meter(args, limit, first).run()


main()
