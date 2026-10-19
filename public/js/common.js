// Shared helpers for every logged-in page.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const MOVES = {
  R: { name: 'búa' },
  P: { name: 'bao' },
  S: { name: 'kéo' },
  X: { name: 'bỏ lượt' },
};
const LANG_LABEL = { cpp: 'C++', java: 'Java', python: 'Python' };

let ME = null;
let serverOffset = 0;
const serverNow = () => Date.now() + serverOffset;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && typeof o.body !== 'string') {
    o.body = JSON.stringify(o.body);
    o.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, o);
  if (res.status === 401 && !url.endsWith('/api/login')) {
    location.href = '/login';
    throw new Error('Vui lòng đăng nhập');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (data.serverNow) serverOffset = data.serverNow - Date.now();
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return (d ? `${d} ngày ` : '') + `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('vi-VN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderTopbar() {
  const bar = $('#topbar');
  if (!bar || !ME) return;
  bar.className = 'topbar';
  bar.innerHTML = `
    <a class="logo" href="/"><span class="trio">${rpsIcon('R', 34)}${rpsIcon('P', 34)}${rpsIcon('S', 34)}</span> OTTv1</a>
    <nav>
      <a href="/">Giải đấu</a>
      ${ME.role === 'judge' ? '<a href="/admin">Bàn trọng tài</a>' : ''}
    </nav>
    <div class="mebox">
      <a href="/me" class="me-link" title="tùy chỉnh nhân vật">
        <div class="who">${esc(ME.teamName)}<small>@${esc(ME.username)}${ME.role === 'judge' ? ' · trọng tài' : ''}</small></div>
        ${avatarSvg(ME.avatar, 46)}
      </a>
      <button class="btn small" id="logout">Đăng xuất</button>
    </div>`;
  $('#logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/login';
  };
}

// Loads the current user, draws the top bar and connects the socket that
// yanks everyone to the live page the moment a tournament's timer runs out.
async function boot() {
  const { user } = await api('/api/me');
  ME = user;
  renderTopbar();
  const socket = io();
  socket.on('tournament:started', ({ id }) => {
    const target = `/tournament/${encodeURIComponent(id)}/live`;
    if (location.pathname !== target) location.href = target;
  });
  return socket;
}

function tournamentIdFromPath() {
  const m = location.pathname.match(/^\/tournament\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function confetti(n = 70) {
  const bits = ['🎉', '✨', '🎊', '⭐', rpsIcon('R', 30), rpsIcon('P', 30), rpsIcon('S', 30)];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.innerHTML = bits[i % bits.length];
    el.style.left = Math.random() * 100 + 'vw';
    el.style.animationDuration = 2 + Math.random() * 2.5 + 's';
    el.style.animationDelay = Math.random() * 0.8 + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }
}
