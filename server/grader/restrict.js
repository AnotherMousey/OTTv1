// What player-submitted C++ and Java may contain. (Python is checked by harness/runner.py.)
// Players write only their play function / Bot class: no preprocessor or imports beyond the
// allowed ones, and no names that reach files, processes, the network or reflection.
// Returns { error } or { code } (the code to compile, line numbers unchanged).

// Headers in harness/prelude.hpp; an #include of one of these is accepted and dropped.
const CPP_HEADERS = new Set(['bits/stdc++.h', 'algorithm', 'array', 'bitset', 'cassert', 'chrono', 'climits', 'cmath',
  'cstdint', 'cstdlib', 'cstring', 'ctime', 'deque', 'functional', 'iostream', 'limits', 'list', 'map', 'numeric',
  'queue', 'random', 'set', 'stack', 'string', 'tuple', 'unordered_map', 'unordered_set', 'utility', 'vector',
  'math.h', 'stdlib.h', 'string.h', 'time.h', 'stdint.h', 'limits.h', 'assert.h']);

const CPP_DENY = new Set(`asm extern reinterpret_cast const_cast
  system popen pclose fopen fopen_s freopen freopen_s fdopen tmpfile tmpfile_s tmpnam tmpnam_s remove rename unlink
  rmdir mkdir chdir open openat creat getenv getenv_s putenv setenv unsetenv mkstemp realpath
  execl execle execlp execv execve execvp execvpe fork vfork posix_spawn posix_spawnp spawnl spawnle spawnlp spawnv
  spawnve spawnvp syscall dlopen dlsym mmap mprotect signal raise kill
  socket connect bind listen accept gethostbyname getaddrinfo
  fstream ifstream ofstream filebuf basic_fstream basic_ifstream basic_ofstream basic_filebuf filesystem
  CreateProcess CreateProcessA CreateProcessW WinExec ShellExecute ShellExecuteA ShellExecuteW LoadLibrary
  LoadLibraryA LoadLibraryW GetProcAddress CreateFile CreateFileA CreateFileW VirtualAlloc VirtualProtect`.split(/\s+/));

const JAVA_DENY = new Set(`java javax jdk sun com org package native
  Runtime Process ProcessBuilder ProcessHandle Thread ThreadGroup ThreadLocal InheritableThreadLocal Class
  ClassLoader Module ModuleLayer Package StackWalker SecurityManager Formatter ServiceLoader ResourceBundle
  PropertyResourceBundle Properties getClass forName getClassLoader`.split(/\s+/));
// The only uses of System allowed: System.out.print*/flush, System.err.print*/flush, the clocks.
const JAVA_SYSTEM_OK = /^System\.(?:(?:out|err)\.(?:print|println|printf|flush)|currentTimeMillis|nanoTime)$/;

// Splits code into tokens, skipping comments and string/char literals. Anything the compiler
// could read differently from this (backslashes outside literals, raw strings, unicode escapes)
// is rejected rather than guessed at.
function tokenize(code, lang) {
  const toks = [];
  let i = 0, line = 1;
  const n = code.length;
  const err = why => ({ error: `Dòng ${line}: ${why}` });
  const skipQuoted = q => {
    for (i++; i < n && code[i] !== q; i++) {
      if (code[i] === '\\') i++;
      if (code[i] === '\n') { if (q === "'" || lang === 'java') return false; line++; }
    }
    i++;
    return true;
  };
  while (i < n) {
    const c = code[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (code.startsWith('//', i)) { while (i < n && code[i] !== '\n') i++; continue; }
    if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) return err('chú thích /* không được đóng');
      line += (code.slice(i, end).match(/\n/g) || []).length;
      i = end + 2;
      continue;
    }
    if (lang === 'java' && code.startsWith('"""', i)) {
      const end = code.indexOf('"""', i + 3);
      if (end < 0) return err('chuỗi """ không được đóng');
      line += (code.slice(i, end).match(/\n/g) || []).length;
      i = end + 3;
      continue;
    }
    if (c === '"' || c === "'") {
      if (!skipQuoted(c)) return err('chuỗi/ký tự không được đóng');
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (lang === 'cpp' && code[j] === '"' && /^(?:u8|u|U|L)?R$/.test(word)) return err('không được dùng raw string R"(...)"');
      toks.push({ t: word, line, word: true });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] || ''))) {
      let j = i + 1;
      while (j < n) {
        if (/[eEpP]/.test(code[j]) && /[+-]/.test(code[j + 1] || '')) j += 2;
        else if (/[\w.]/.test(code[j])) j++;
        else if (lang === 'cpp' && code[j] === "'" && /\w/.test(code[j + 1] || '')) j += 2; // digit separator 1'000
        else break;
      }
      i = j;
      continue;
    }
    if (c === '\\') return err('không được dùng ký tự \\ ngoài chuỗi');
    if (c === '#' || (lang === 'cpp' && code.startsWith('%:', i))) return err('không được dùng lệnh tiền xử lý (#define, #include, #pragma, ...)');
    toks.push({ t: c, line });
    i++;
  }
  return { toks };
}

function checkCpp(code) {
  // Allowed #include lines are blanked (the prelude already has them); anything else with # fails below.
  const out = code.split('\n').map(l => {
    const m = l.match(/^\s*#\s*include\s*<([\w./+]+)>\s*(?:\/\/.*)?\r?$/);
    return m && CPP_HEADERS.has(m[1]) ? '' : l;
  });
  for (let k = 0; k < out.length; k++) {
    const m = out[k].match(/^\s*#\s*include\s*[<"]([^>"]*)/);
    if (m) return { error: `Dòng ${k + 1}: không được include "${m[1]}". Các thư viện được dùng: ${[...CPP_HEADERS].join(', ')}` };
  }
  const src = out.join('\n');
  const r = tokenize(src, 'cpp');
  if (r.error) return r;
  for (const tok of r.toks) {
    if (!tok.word) continue;
    if (tok.t.startsWith('_')) return { error: `Dòng ${tok.line}: không được dùng tên bắt đầu bằng dấu _ (\`${tok.t}\`)` };
    if (CPP_DENY.has(tok.t)) return { error: `Dòng ${tok.line}: không được dùng \`${tok.t}\`` };
  }
  return { code: src };
}

function checkJava(code) {
  if (/\\u/.test(code)) return { error: 'Không được dùng \\u (mã unicode) trong code Java' };
  // Only java.util classes and Math may be imported; those lines are blanked before scanning.
  const ALLOWED_IMPORT = /^\s*import\s+(?:java\s*\.\s*util\s*\.\s*(\*|[A-Za-z]\w*)|static\s+java\s*\.\s*lang\s*\.\s*Math\s*\.\s*(?:\*|\w+))\s*;\s*(?:\/\/.*)?\r?$/;
  const lines = code.split('\n');
  const scan = lines.map(l => {
    const m = l.match(ALLOWED_IMPORT);
    if (!m) return l;
    if (m[1] && JAVA_DENY.has(m[1])) return l; // e.g. java.util.Formatter: rejected by the scan
    return '';
  }).join('\n');
  const r = tokenize(scan, 'java');
  if (r.error) return r;
  const toks = r.toks;
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (!tok.word) continue;
    if (tok.t === 'import') return { error: `Dòng ${tok.line}: chỉ được import java.util.* (và java.lang.Math)` };
    if (tok.t === 'class' && toks[k - 1] && toks[k - 1].t === '.') return { error: `Dòng ${tok.line}: không được dùng .class` };
    if (tok.t === 'System') {
      const parts = ['System'];
      for (let j = k + 1; parts.length < 3 && toks[j] && toks[j].t === '.' && toks[j + 1] && toks[j + 1].word; j += 2) parts.push(toks[j + 1].t);
      if (!JAVA_SYSTEM_OK.test(parts.join('.')) && !JAVA_SYSTEM_OK.test(parts.slice(0, 2).join('.'))) {
        return { error: `Dòng ${tok.line}: chỉ được dùng System.out.println/print/printf (hoặc System.err), System.currentTimeMillis và System.nanoTime` };
      }
      continue;
    }
    if (JAVA_DENY.has(tok.t)) return { error: `Dòng ${tok.line}: không được dùng \`${tok.t}\`` };
  }
  // java.util is always imported; on line 1 so compiler line numbers still match.
  return { code: 'import java.util.*; ' + code };
}

function restrict(language, code) {
  if (language === 'cpp') return checkCpp(code);
  if (language === 'java') return checkJava(code);
  return { code };
}

module.exports = { restrict };
